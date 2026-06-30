"""
流式工作流引擎 —— 管理 SSE 会话并在后台线程运行 LangGraph。
"""

import threading
import logging
import time
import os
import sys

logger = logging.getLogger(__name__)

_PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_DIR not in sys.path:
    sys.path.insert(0, _PROJECT_DIR)

from router.stream_state import SessionState, push, push_done, _DONE
from router.stream_graph import build_stream_workflow, StreamWorkflowState
from router.classify import classify

sessions: dict[str, "SessionState"] = {}


# —— 后台 session 清理 ——
def _cleanup_loop():
    while True:
        time.sleep(120)
        now = time.time()
        expired = [sid for sid, s in list(sessions.items()) if now - s.created_at > 1800]
        for sid in expired:
            sessions.pop(sid, None)
            logger.info("stream | cleanup expired session=%s", sid)


threading.Thread(target=_cleanup_loop, daemon=True).start()

# 初始化全局的图实例
_stream_graph = build_stream_workflow()


async def run_sync_workflow(user_input: str, lane_mode: str = "auto", timeout: float = 90.0) -> dict:
    """同步版工作流：在后台线程运行流式图，收集所有事件后返回结果 dict。"""
    import uuid
    import asyncio

    loop = asyncio.get_event_loop()
    session_id = uuid.uuid4().hex
    state = SessionState(
        queue=asyncio.Queue(),
        cancel=threading.Event(),
        loop=loop,
        created_at=time.time(),
        user_id="sync",
        session_id=session_id,
    )
    sessions[session_id] = state

    thread = threading.Thread(
        target=run_workflow_streaming,
        args=({"message": user_input, "lane_mode": lane_mode}, state),
        daemon=True,
    )
    thread.start()

    reply = ""
    thinking: list = []
    task_type = "未知"
    error = None

    while True:
        try:
            event = await asyncio.wait_for(state.queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            state.cancel.set()
            error = f"执行超时（>{timeout}s）"
            break
        if event is _DONE:
            break
        if event["type"] == "done":
            reply = event.get("reply", "")
            thinking = event.get("thinking", [])
            task_type = event.get("task_type", "未知")
        elif event["type"] == "error":
            error = event.get("content", "未知错误")

    sessions.pop(session_id, None)

    if error:
        raise RuntimeError(error)

    return {"reply": reply, "thinking": thinking, "task_type": task_type}


# —— 提供给 router 的入口 ——
def run_workflow_streaming(data: dict, state: SessionState):
    """在后台线程运行 LangGraph 流式工作流，通过 queue 推送到 SSE。"""
    try:
        user_input = data.get("message", "")
        lane_mode = data.get("lane_mode", "auto")
        project_id = data.get("project_id")

        logger.info("stream | start langgraph pipeline | input=%s | user=%s | project=%s", user_input[:60], state.user_id, project_id)

        task_type, complexity, need_report = classify(user_input, lane_mode)

        pipeline_config = None
        graph_source = "default"
        if project_id and getattr(state, "db", None):
            import json
            db = state.db
            proj = db.get_project(project_id)
            if proj and proj.get("agent_config"):
                try:
                    config = json.loads(proj["agent_config"])
                    if isinstance(config, dict):
                        pipeline_config = config.get("pipeline")
                except Exception as e:
                    logger.warning("stream | failed to parse agent_config: %s", e)

        if pipeline_config and pipeline_config.get("nodes"):
            from router.dynamic_graph import build_dynamic_workflow
            graph = build_dynamic_workflow(pipeline_config)
            graph_source = "dynamic"
        else:
            graph = _stream_graph
            graph_source = "default"

        logger.info(
            "stream | graph selected | source=%s | project=%s | pipeline_nodes=%d",
            graph_source, project_id,
            len(pipeline_config.get("nodes", [])) if pipeline_config else 0,
        )

        initial_state = StreamWorkflowState(
            session=state,
            user_input=user_input,
            lane_mode=lane_mode,
            task_type=task_type,
            complexity=complexity,
            need_report=need_report,
            plan="",
            knowledge="",
            code_or_draft="",
            execution_result="",
            test_result="",
            fix_count=0,
            thinking=[],
            final_output="",
            total_tokens=0,
            total_elapsed_ms=0,
            web_search_enabled=data.get("web_search_enabled", False),
            web_search_results="",
        )

        result_state = graph.invoke(initial_state)

        final_reply = result_state.get("final_output") or result_state.get("code_or_draft", "")
        thinking = result_state.get("thinking", [])

        push(
            state,
            {
                "type": "done",
                "reply": final_reply,
                "thinking": thinking,
                "task_type": result_state.get("task_type", "未知"),
            },
        )
        logger.info("stream | pipeline finished | reply_chars=%d", len(final_reply))

        if project_id and getattr(state, "db", None):
            try:
                state.db.create_eval_log(
                    project_id=project_id,
                    session_id=state.session_id,
                    task_type=result_state.get("task_type", "未知"),
                    complexity=complexity,
                    agent_count=len(thinking),
                    total_tokens=state.total_tokens,
                    elapsed_ms=state.total_elapsed_ms,
                    has_error=0,
                )
            except Exception as eval_e:
                logger.error("stream | failed to write eval_log: %s", eval_e)

    except Exception as e:
        import traceback

        tb = traceback.format_exc()
        logger.error("stream | pipeline exception: %s\n%s", e, tb)
        push(state, {"type": "error", "content": f"{type(e).__name__}: {e}"})

        # Record error eval log if possible
        try:
            if 'project_id' in locals() and project_id and getattr(state, "db", None):
                state.db.create_eval_log(
                    project_id=project_id,
                    session_id=state.session_id,
                    task_type="错误",
                    complexity="",
                    agent_count=0,
                    total_tokens=state.total_tokens,
                    elapsed_ms=int((time.time() - state.created_at) * 1000),
                    has_error=1,
                )
        except Exception:
            pass
    finally:
        push_done(state)
