"""
团队聊天 API 路由 — 频道/消息/待办 + SSE 推送
"""
import json
import asyncio
from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse, StreamingResponse

from user.helpers import _get_db, require_auth

chat_router = APIRouter()

# SSE 活跃连接 {org_id: [asyncio.Queue, ...]}
_active_listeners: dict[str, list[asyncio.Queue]] = {}


async def _broadcast(org_id: str, event: dict):
    queues = _active_listeners.get(org_id, [])
    dead = []
    for q in queues:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        queues.remove(q)


# ── 频道 ──

@chat_router.get("/{org_id}/channels")
async def list_channels(request: Request, org_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权访问"}, status_code=403)
    channels = db.list_channels(org_id)
    if not channels:
        cid = db.create_channel(org_id, "general")
        channels = [{"id": cid, "org_id": org_id, "name": "general"}]
    return JSONResponse(channels)


@chat_router.post("/{org_id}/channels")
async def create_channel(request: Request, org_id: str, user: dict = Depends(require_auth)):
    data = await request.json()
    name = (data.get("name") or "").strip()
    if not name:
        return JSONResponse({"error": "频道名不能为空"}, status_code=400)
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None:
        return JSONResponse({"error": "无权创建频道"}, status_code=403)
    cid = db.create_channel(org_id, name)
    return JSONResponse({"id": cid, "name": name, "status": "ok"}, status_code=201)


# ── 消息 ──

@chat_router.get("/{org_id}/channels/{channel_id}/messages")
async def list_messages(request: Request, org_id: str, channel_id: str,
                        user: dict = Depends(require_auth)):
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权访问"}, status_code=403)
    messages = db.list_messages(channel_id)
    return JSONResponse(messages)


@chat_router.post("/{org_id}/channels/{channel_id}/messages")
async def send_message(request: Request, org_id: str, channel_id: str,
                       user: dict = Depends(require_auth)):
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None:
        return JSONResponse({"error": "无权发送消息"}, status_code=403)

    data = await request.json()
    content = (data.get("content") or "").strip()
    if not content:
        return JSONResponse({"error": "消息不能为空"}, status_code=400)

    mid = db.create_message(channel_id, user["user_id"], content)
    user_name = db.get_user_name(user["user_id"])

    agent_reply = None
    if "@agent" in content:
        agent_reply = await _handle_agent_command(content, org_id, user["user_id"], db)

    msg = {"id": mid, "content": content, "user_name": user_name, "is_agent": 0}
    await _broadcast(org_id, {"type": "message", "message": msg})

    if agent_reply:
        await _broadcast(org_id, {"type": "message", "message": agent_reply})

    return JSONResponse({"id": mid, "status": "ok", "agent_reply": agent_reply})


async def _handle_agent_command(content: str, org_id: str, user_id: str, db) -> dict | None:
    import re
    channels = db.list_channels(org_id)
    default_channel = channels[0]["id"] if channels else ""

    # @agent 总结一下
    if re.search(r'@agent\s*总结', content):
        messages = []
        for ch in channels:
            msgs = db.list_messages(ch["id"], limit=20)
            messages.extend([m["content"] for m in msgs if not m.get("is_agent")])
        if not messages:
            content_text = "📋 暂无消息可总结。"
        else:
            try:
                from agents import get_cached_llm
                llm = get_cached_llm("Summarizer", temperature=0.3)
                prompt = f"请用中文简要总结以下团队讨论：\n\n" + "\n".join(messages[-20:])
                summary = llm.invoke(prompt)
                content_text = f"📋 讨论总结：\n\n{summary.content}"
            except Exception as e:
                content_text = f"❌ 总结生成失败: {e}"
        mid = db.create_message(default_channel, user_id, content_text, is_agent=1)
        return {"id": mid, "content": content_text, "user_name": "🤖 Agent", "is_agent": 1}

    # @agent 创建待办: xxx @user
    todo_match = re.search(r'创建待办[：:]\s*(.+?)(?:@(\S+))?\s*$', content)
    if todo_match:
        todo_content = todo_match.group(1).strip()
        assignee_name = todo_match.group(2)
        assignee_id = None
        if assignee_name:
            target = db.get_user(assignee_name)
            assignee_id = target["id"] if target else None
        tid = db.create_todo(org_id, todo_content, user_id, assignee_id)
        content_text = f"✅ 待办已创建: {todo_content}"
        mid = db.create_message(default_channel, user_id, content_text, is_agent=1)
        return {"id": mid, "content": content_text, "user_name": "🤖 Agent", "is_agent": 1}

    # @agent 搜索 xxx
    search_match = re.search(r'@agent\s*搜索\s*(.+)', content)
    if search_match:
        query = search_match.group(1).strip()
        try:
            from rag.knowledge_base import search
            results = search(query, user_id="shared")
            if results and any(len(r.strip()) > 50 for r in results):
                content_text = "🔍 搜索结果：\n\n" + "\n\n---\n\n".join(
                    [r[:300] for r in results[:3] if len(r.strip()) > 50]
                )
            else:
                content_text = "🔍 未找到相关结果。"
        except Exception:
            content_text = "🔍 知识库搜索暂时不可用。"
        mid = db.create_message(default_channel, user_id, content_text, is_agent=1)
        return {"id": mid, "content": content_text, "user_name": "🤖 Agent", "is_agent": 1}

    return None


# ── SSE 推送 ──

@chat_router.get("/{org_id}/stream")
async def stream_org(request: Request, org_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权访问"}, status_code=403)

    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    if org_id not in _active_listeners:
        _active_listeners[org_id] = []
    if len(_active_listeners[org_id]) >= 5:
        return JSONResponse({"error": "连接数已达上限"}, status_code=429)
    _active_listeners[org_id].append(q)

    async def event_stream():
        try:
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
        finally:
            if q in _active_listeners.get(org_id, []):
                _active_listeners[org_id].remove(q)
            if not _active_listeners.get(org_id):
                _active_listeners.pop(org_id, None)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ── 待办 ──

@chat_router.get("/{org_id}/todos")
async def list_todos(request: Request, org_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权访问"}, status_code=403)
    todos = db.list_todos(org_id)
    return JSONResponse(todos)


@chat_router.post("/{org_id}/todos")
async def create_todo(request: Request, org_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None:
        return JSONResponse({"error": "无权创建待办"}, status_code=403)
    data = await request.json()
    content = (data.get("content") or "").strip()
    if not content:
        return JSONResponse({"error": "待办内容不能为空"}, status_code=400)
    tid = db.create_todo(org_id, content, user["user_id"], data.get("assignee_id"))
    return JSONResponse({"id": tid, "status": "ok"}, status_code=201)


@chat_router.put("/{org_id}/todos/{todo_id}")
async def update_todo(request: Request, org_id: str, todo_id: str,
                      user: dict = Depends(require_auth)):
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None:
        return JSONResponse({"error": "无权操作"}, status_code=403)
    data = await request.json()
    completed = data.get("completed")
    content = data.get("content")
    if completed is None and content is None:
        return JSONResponse({"error": "无更新内容"}, status_code=400)
    db.update_todo(todo_id,
                   completed=int(completed) if completed is not None else None,
                   content=content)
    return JSONResponse({"status": "ok"})
