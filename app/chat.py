"""
聊天管道 —— Router 分类 → 关键词覆写 → 自动/手动车道 → 快/慢车道执行。

自动模式：Router 判断 task_type + complexity，关键词覆写修正
手动模式：用户选择 fast/slow，跳过 Router
"""

import os
import glob
import re
import threading
import time
from router import classify

CODING_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "coding")

_TIMEOUT_SLOW = 90  # 慢车道超时秒数


def _scan_generated_files(since: float | None = None) -> list[dict]:
    """递归扫描 coding/ 目录下生成的图片和文档。
    若指定 since（Unix 时间戳），仅返回该时间之后修改的文件。"""
    files = []
    for ext in ("png", "jpg", "jpeg", "gif", "bmp", "py", "md", "csv", "xlsx", "txt", "html"):
        pattern = os.path.join(CODING_DIR, "**", f"*.{ext}")
        for fp in sorted(glob.glob(pattern, recursive=True), key=os.path.getmtime, reverse=True):
            name = os.path.basename(fp)
            ext_lower = ext.lower()
            if name == "sales_data.csv":
                continue
            if ext_lower in ("png", "jpg", "jpeg", "gif", "bmp") and os.path.getsize(fp) < 100:
                continue
            if since is not None and os.path.getmtime(fp) <= since:
                continue
            files.append({"name": name, "path": fp, "ext": ext_lower})
    return files


def run_chat_pipeline(user_input: str, history: list[dict] | None = None, lane_mode: str = "auto") -> dict:
    """
    处理一条用户消息，返回:
      {"reply": "...", "thinking": [...], "task_type": "...", "speaking_log": [...], "generated_files": [...]}

    lane_mode: "auto" | "fast" | "slow"
    """
    # 记录执行前时间戳，仅返回本次执行期间新生成的文件
    _ts_before = time.time()
    from router import classify

    task_type, complexity, need_report = classify(user_input)
    print(f"[PIPE] router: task={task_type}, complexity={complexity}, need_report = {need_report}")

    # ── Phase 1: 车道手动强制覆盖 ──
    if lane_mode == "fast":
        complexity = "轻"
    elif lane_mode == "slow":
        complexity = "重"

    # ── Phase 3: 车道分发 ──
    if complexity == "轻":
        return _run_fast(user_input, task_type, history, _ts_before)
    return _run_slow(user_input, task_type, history, _ts_before, need_report)


def _run_fast(user_input: str, task_type: str, history: list[dict] | None, since: float) -> dict:
    """快车道：Bot 直接回复"""
    from workflow import build_workflow

    msg = user_input
    if history:
        summary = _build_context_summary(history)
        if summary:
            msg = f"上下文：{summary}\n\n当前任务：{user_input}"

    wf = build_workflow()
    initial_state = {
        "user_input": msg,
        "lane_mode": "fast",
        "task_type": task_type,
        "complexity": "轻",
        "fix_count": 0,
    }
    result = wf.invoke(initial_state)

    return {
        "reply": result.get("final_output", "（无输出）"),
        "thinking": _parse_thinking(result.get("agent_messages", [])),
        "task_type": task_type,
        "speaking_log": result.get("speaking_log", []),
        "generated_files": _scan_generated_files(since),
    }


def _run_slow(user_input: str, task_type: str, history: list[dict] | None, since: float, need_report: bool) -> dict:
    """慢车道：多 Agent 协作流水线（带超时）"""
    from workflow import build_workflow

    msg = user_input
    if history:
        summary = _build_context_summary(history)
        if summary:
            msg = f"上下文：{summary}\n\n当前任务：{user_input}"

    wf = build_workflow()
    initial_state = {
        "user_input": msg,
        "lane_mode": "slow",
        "task_type": task_type,
        "complexity": "重",
        "fix_count": 0,
        "need_report": need_report,
    }

    result_container = {}

    def _runner():
        try:
            result_container["result"] = wf.invoke(initial_state)
        except Exception as e:
            result_container["error"] = str(e)

    t = threading.Thread(target=_runner, daemon=True)
    t.start()
    t.join(timeout=_TIMEOUT_SLOW)

    if t.is_alive():
        return {
            "reply": f"任务执行超时（>{_TIMEOUT_SLOW}s）。请简化描述或缩小范围。",
            "thinking": [],
            "task_type": task_type,
            "speaking_log": [],
            "generated_files": _scan_generated_files(since),
        }

    if "error" in result_container:
        return {
            "reply": f"❌ 执行失败: {result_container['error']}",
            "thinking": [],
            "task_type": task_type,
            "speaking_log": [],
            "generated_files": [],
        }

    result = result_container.get("result", {})
    thinking = _parse_thinking(result.get("agent_messages", []))

    # 根据任务类型组合回复
    reply = _compose_reply(result, thinking, user_input, task_type)

    return {
        "reply": reply,
        "thinking": thinking,
        "task_type": task_type,
        "speaking_log": result.get("speaking_log", []),
        "generated_files": _scan_generated_files(since),
    }


def generate_report_from_thinking(thinking: list[dict]) -> str:
    """从 thinking 记录生成结构化报告"""
    if not thinking:
        return "无可用记录。"

    from agents import create_llm, SYSTEM_PROMPTS

    llm = create_llm("Summarizer")
    context = "\n\n".join(f"{m.get('name', '')}: {m.get('content', '')[:2000]}" for m in thinking if m.get("content"))
    prompt = (
        f"{SYSTEM_PROMPTS['Summarizer']}\n\n"
        f"以下是一个多智能体协作过程的内部记录。请你据此生成一份结构化的执行报告。\n\n"
        f"协作记录：\n\n{context}"
    )
    try:
        response = llm.invoke(prompt)
        return response.content if hasattr(response, "content") else str(response)
    except Exception:
        return "# 多智能体协作报告\n\n报告生成失败。"


# ===== helpers =====


def _parse_thinking(raw_messages: list) -> list[dict]:
    """将 agent_messages 解析为前端可用的 thinking 列表"""
    thinking = []
    for m in raw_messages:
        if hasattr(m, "content"):
            name = getattr(m, "name", "") or getattr(m, "type", "") or ""
            content = m.content or ""
        elif isinstance(m, dict):
            name = m.get("name", m.get("role", ""))
            content = m.get("content", "")
        else:
            continue
        if content and name:
            thinking.append({"name": name, "content": content})
    return thinking


def _build_context_summary(history: list[dict]) -> str:
    """从前几轮对话提取摘要（最多最近 3 轮）"""
    recent = [m for m in history[-6:] if m.get("content")]
    if not recent:
        return ""
    lines = []
    for m in recent:
        role = "用户" if m["role"] == "user" else "助手"
        content = m.get("content", "")
        lines.append(f"{role}: {content[:200]}")
    return "\n".join(lines)


def _compose_reply(result: dict, thinking: list[dict], user_input: str, task_type: str) -> str:
    """根据任务类型组合回复正文"""
    # 优先使用 Summarizer 输出
    final = result.get("final_output", "")
    if final and final != "（无输出）":
        return final

    # 兜底：从 thinking 中提取
    if not thinking:
        return f"收到{task_type}任务「{user_input[:50]}」。多智能体已完成协作。"

    # 编程/分析：提取最后一条有效内容
    if task_type in ("编程", "分析"):
        for m in reversed(thinking):
            content = m.get("content", "")
            if "```" in content and len(content) > 50:
                return content
        return thinking[-1].get("content", "") if thinking else ""

    # 写作：提取 Writer 或 Summarizer
    if task_type == "写作":
        for m in reversed(thinking):
            if m.get("name") in ("Writer", "Summarizer"):
                return m.get("content", "")

    # 默认
    return thinking[-1].get("content", "") if thinking else ""
