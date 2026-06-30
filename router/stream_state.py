"""
流式状态基类与工具，管理 SSE 推送队列
"""

import asyncio
import threading
from dataclasses import dataclass
from typing import Any

_DONE = object()


@dataclass
class SessionState:
    queue: asyncio.Queue
    cancel: threading.Event
    loop: asyncio.AbstractEventLoop
    created_at: float
    user_id: str = ""
    db: Any = None
    session_id: str = ""
    total_tokens: int = 0
    total_elapsed_ms: int = 0


def push(state: SessionState, event: dict):
    try:
        asyncio.run_coroutine_threadsafe(state.queue.put(event), state.loop)
    except RuntimeError:
        pass


def push_done(state: SessionState):
    try:
        asyncio.run_coroutine_threadsafe(state.queue.put(_DONE), state.loop)
    except RuntimeError:
        pass
