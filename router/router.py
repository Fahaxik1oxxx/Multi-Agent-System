"""
Multi-Agent API Router — Start/Subscribe/Cancel Streaming Agent Collaboration.
所有端点均要求用户认证。
"""

import uuid
import json
import time
import logging
import asyncio
import threading

from pydantic import BaseModel, Field
from fastapi import APIRouter, Request, Depends
from fastapi.responses import StreamingResponse, JSONResponse

from router.stream import SessionState, sessions, push, push_done, run_workflow_streaming, _DONE
from user.helpers import require_auth, _get_db

logger = logging.getLogger(__name__)

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    lane_mode: str = Field(default="auto")
    project_id: str | None = Field(default=None)
    session_id: str | None = Field(default=None)
    history: list = Field(default_factory=list)
    web_search_enabled: bool = Field(default=False)


@router.post("/chat/start")
async def chat_start(
    body: ChatRequest,
    request: Request,
    user: dict = Depends(require_auth),
):
    stream_id = str(uuid.uuid4())
    db_session_id = body.session_id or str(uuid.uuid4())

    logger.info(
        "api | chat_start | stream=%s | db_session=%s | user=%s | input=%s | lane=%s",
        stream_id,
        db_session_id,
        user["user_id"],
        body.message[:60],
        body.lane_mode,
    )

    state = SessionState(
        queue=asyncio.Queue(),
        cancel=threading.Event(),
        loop=asyncio.get_running_loop(),
        created_at=time.time(),
        user_id=user["user_id"],
        session_id=db_session_id,
        db=getattr(request.app.state, "db", None),
    )
    sessions[stream_id] = state

    thread = threading.Thread(
        target=run_workflow_streaming,
        args=(body.model_dump(), state),
        daemon=True,
    )
    thread.start()

    return JSONResponse({"session_id": stream_id})


@router.get("/chat/stream/{session_id}")
async def chat_stream(
    session_id: str,
    request: Request,
    user: dict = Depends(require_auth),
):
    state = sessions.get(session_id)
    if not state:
        logger.warning("api | stream | session=%s not found", session_id)
        return JSONResponse({"error": "session not found"}, status_code=404)

    # 归属校验：只有创建者可以订阅
    if state.user_id and state.user_id != user["user_id"]:
        return JSONResponse({"error": "无权访问此会话"}, status_code=403)

    logger.info("api | stream | session=%s SSE connected | user=%s", session_id, user["user_id"])

    async def event_stream():
        try:
            while True:
                event = await state.queue.get()
                if event is _DONE:
                    break
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except asyncio.CancelledError:
            logger.info("api | stream | session=%s SSE cancelled", session_id)
        finally:
            sessions.pop(session_id, None)
            logger.info("api | stream | session=%s SSE disconnected", session_id)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/chat/cancel/{session_id}")
async def chat_cancel(
    session_id: str,
    request: Request,
    user: dict = Depends(require_auth),
):
    state = sessions.get(session_id)
    if not state:
        logger.warning("api | cancel | session=%s not found", session_id)
        return JSONResponse({"error": "session not found"}, status_code=404)

    if state.user_id and state.user_id != user["user_id"]:
        return JSONResponse({"error": "无权操作此会话"}, status_code=403)

    state.cancel.set()
    logger.info("api | cancel | session=%s cancelled", session_id)
    return JSONResponse({"status": "cancelled"})


@router.get("/chat/sessions")
async def list_sessions(
    request: Request,
    user: dict = Depends(require_auth),
):
    """列出当前用户的活跃会话"""
    now = time.time()
    user_sessions = [
        {"session_id": sid, "age": round(now - s.created_at, 1)}
        for sid, s in sessions.items()
        if s.user_id == user["user_id"]
    ]
    return JSONResponse(user_sessions)


@router.get("/monitor/session/{session_id}")
async def get_monitor_session(
    session_id: str,
    request: Request,
    user: dict = Depends(require_auth),
):
    """获取指定 session 的监控日志 (各 Agent 步骤详情)"""
    db = getattr(request.app.state, "db", None)
    if not db:
        logger.error(f"get_monitor_session | DB not initialized, session_id={session_id}")
        return JSONResponse({"error": "数据库未初始化"}, status_code=500)
    
    steps = db.get_session_steps(session_id)
    logger.info(f"get_monitor_session | Fetched {len(steps)} steps for session_id={session_id}")
    
    if not steps:
        # 也可能是还没有任何日志，返回空
        logger.warning(f"get_monitor_session | No steps found for session_id={session_id}")
        task_type = "未知"
    else:
        # 如果有 step，查第一个的 task_type，或者就不用返回 task_type，返回步骤列表即可
        task_type = steps[0].get("task_type", "未知") if "task_type" in steps[0] else "未知"
        
    return JSONResponse({
        "session_id": session_id,
        "task_type": task_type,
        "steps": steps,
    })
