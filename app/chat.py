"""
聊天管道 —— 基于 LangGraph 的快/慢车道。
"""

import os
import glob
import re

CODING_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "coding")


def _scan_generated_files() -> list[dict]:
    """扫描 coding/ 目录下生成的图片和文档"""
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
            files.append({"name": name, "path": fp, "ext": ext_lower})
    return files


def run_chat_pipeline(user_input: str, history: list[dict] | None = None,
                      lane_mode: str = "slow") -> dict:
    """
    处理一条用户消息，返回:
      {"reply": "...", "thinking": [...], "task_type": "...", "generated_files": [...]}
    """
    from workflow import build_workflow

    msg = user_input
    if history:
        summary = _build_context_summary(history)
        if summary:
            msg = f"上下文：{summary}\n\n当前任务：{user_input}"

    wf = build_workflow()
    initial_state = {
        "user_input": msg,
        "lane_mode": lane_mode,
        "task_type": "coding",
        "fix_count": 0,
    }

    result = wf.invoke(initial_state)

    raw_messages = result.get("messages", [])
    thinking = [
        {"name": m.get("name", m.get("role", "")), "content": m.get("content", "")}
        for m in raw_messages
        if m.get("content")
    ]

    task_type = result.get("task_type", "coding")
    task_type_label = {"coding": "编程", "writing": "写作"}.get(task_type, task_type)

    generated_files = _scan_generated_files()

    return {
        "reply": result.get("final_output", "（无输出）"),
        "thinking": thinking,
        "task_type": task_type_label,
        "generated_files": generated_files,
    }


def generate_report_from_thinking(thinking: list[dict]) -> str:
    """从 thinking 记录生成结构化报告"""
    if not thinking:
        return "无可用记录。"

    from agents import create_llm, SYSTEM_PROMPTS

    llm = create_llm("Summarizer")
    context = "\n\n".join(
        f"{m.get('name', '')}: {m.get('content', '')[:2000]}"
        for m in thinking if m.get("content")
    )
    prompt = (
        f"{SYSTEM_PROMPTS['Summarizer']}\n\n"
        f"以下是多智能体协作过程的内部记录。请据此生成一份结构化的执行报告。\n\n"
        f"协作记录：\n\n{context}"
    )
    try:
        response = llm.invoke(prompt)
        return response.content if hasattr(response, "content") else str(response)
    except Exception:
        return "# 多智能体协作报告\n\n报告生成失败。"


# ===== helpers =====

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
