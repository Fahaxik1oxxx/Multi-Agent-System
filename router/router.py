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
    history: list = Field(default_factory=list)


@router.post("/chat/start")
async def chat_start(
    body: ChatRequest,
    request: Request,
    user: dict = Depends(require_auth),
):
    session_id = str(uuid.uuid4())

    logger.info(
        "api | chat_start | session=%s | user=%s | input=%s | lane=%s",
        session_id,
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
    )
    sessions[session_id] = state

    thread = threading.Thread(
        target=run_workflow_streaming,
        args=(body.model_dump(), state),
        daemon=True,
    )
    thread.start()

    return JSONResponse({"session_id": session_id})


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
