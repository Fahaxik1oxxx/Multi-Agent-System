"""
聊天管道 —— Router 分类 → 复杂度判定 → 快/慢车道执行。

复杂度「轻」→ 快车道（Bot 直接回复），无论标签是什么
复杂度「重」→ 慢车道（GroupChat 多 Agent 流水线）
"""

import os
import glob
import shutil
import warnings
import threading
import re
warnings.filterwarnings("ignore")

CODING_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "coding")


def _scan_generated_files() -> list[dict]:
    """递归扫描 coding/ 目录中新生成的图片和文档，返回 [{name, path, ext}]"""
    files = []
    for ext in ("png", "jpg", "jpeg", "gif", "bmp", "py", "md", "csv", "xlsx", "txt", "html"):
        pattern = os.path.join(CODING_DIR, "**", f"*.{ext}")
        for fp in sorted(glob.glob(pattern, recursive=True), key=os.path.getmtime, reverse=True):
            name = os.path.basename(fp)
            ext_lower = ext.lower()
            if name == "sales_data.csv":
                continue
            # 过滤明显损坏/空的图片文件（如 code_interpreter 写出的残片）
            if ext_lower in ("png", "jpg", "jpeg", "gif", "bmp") and os.path.getsize(fp) < 100:
                continue
            files.append({"name": name, "path": fp, "ext": ext_lower})
    return files

_TIMEOUT_SLOW = 90  # 慢车道超时秒数


def _cleanup_temp_files():
    """清理 coding/ 下 code_interpreter 临时工作目录，保留手动 .py 产出"""
    for d in glob.glob(os.path.join(CODING_DIR, "tmp_code_*")):
        try:
            shutil.rmtree(d, ignore_errors=True)
        except OSError:
            pass


def run_chat_pipeline(user_input: str, history: list[dict] | None = None):
    """
    处理一条用户消息，返回:
      {"reply": "...", "thinking": [...], "task_type": "..."}
    """
    from router import classify
    task_type, complexity = classify(user_input)

    # 搜索关键词检测（最高优先级：命中后不执行非Python降级）
    _search = re.search(
        r'(搜索|查资料|检索|查找.*知识|基于知识库)',
        user_input, re.IGNORECASE
    )
    if _search and complexity == "轻":
        complexity = "重"
        task_type = "写作"

    # 分析关键词强制慢车道（弥补 Router 对长/复杂 prompt 的分类误判）
    _analysis = re.match(r'^\s*分析', user_input)
    if _analysis and complexity == "轻":
        complexity = "重"
        if task_type not in ("分析", "编程"):
            task_type = "分析"

    # 非 Python 语言请求 → 强制快车道（仅当非搜索任务）
    if not _search:
        _non_py = re.search(
            r'(c语言|c\s*代码|java|rust|go\s*语言|golang|swift|c\+\+|c#|typescript)',
            user_input, re.IGNORECASE
        )
        if _non_py and task_type == "编程":
            task_type = "问答"
            complexity = "轻"

    if complexity == "轻":
        return _run_fast(user_input, task_type, history)
    return _run_slow(user_input, task_type, history)


def _run_fast(user_input: str, task_type: str, history: list[dict] | None) -> dict:
    """快车道：Bot 单次对话（含上下文摘要）"""
    from agents import bot

    msgs = [{"role": "user", "content": user_input}]
    if history:
        summary = _build_context_summary(history)
        if summary:
            msgs.insert(0, {"role": "system", "content": f"之前的对话摘要：\n{summary}"})

    try:
        reply = bot.generate_reply(messages=msgs, sender=None)
    except Exception as e:
        reply = f"抱歉，回复时遇到错误：{e}"

    return {
        "reply": _extract_content(reply),
        "thinking": [],
        "task_type": task_type,
        "generated_files": [],
    }


def _run_slow(user_input: str, task_type: str, history: list[dict] | None) -> dict:
    """慢车道：GroupChat + 软超时（90s 后收集已有结果）"""
    from groupchat import (reset_speaking_log, coding_manager, writing_manager)
    from agents import user

    reset_speaking_log()
    mgr = coding_manager if task_type in ("编程", "分析") else writing_manager

    # 清除上一轮 GroupChat 的残留消息，防止 Tester 跨对话污染
    mgr.groupchat.messages.clear()

    msg = user_input
    if history:
        summary = _build_context_summary(history)
        if summary:
            msg = f"上下文：{summary}\n\n当前任务：{user_input}"

    result_container = {}

    def _runner():
        try:
            user.initiate_chat(mgr, message=msg, clear_history=True)
            result_container["msgs"] = list(mgr.groupchat.messages)
        except Exception as e:
            result_container["error"] = str(e)
            try:
                result_container["msgs"] = list(mgr.groupchat.messages)
            except Exception:
                result_container["msgs"] = []

    t = threading.Thread(target=_runner, daemon=True)
    t.start()
    t.join(timeout=_TIMEOUT_SLOW)

    # 收集消息（可能只有部分，线程可能还在跑）
    partial_msgs = list(mgr.groupchat.messages)

    # 清理临时文件（Coder 写的 .py 脚本 + code_interpreter 工作目录）
    _cleanup_temp_files()

    generated_files = _scan_generated_files()

    if t.is_alive():
        thinking = _filter_thinking(partial_msgs)
        if thinking:
            return {
                "reply": (
                    f"执行超过 {_TIMEOUT_SLOW} 秒，已收集到 {len(thinking)} 条中间结果。\n\n"
                    "以下是系统已完成的工作："
                ),
                "thinking": thinking,
                "task_type": task_type,
                "generated_files": generated_files,
            }
        return {
            "reply": f"任务执行超时（>{_TIMEOUT_SLOW}s）且未产生结果。请简化描述或缩小范围。",
            "thinking": [],
            "task_type": task_type,
            "generated_files": generated_files,
        }

    if result_container.get("error"):
        partial_msgs.append({"name": "System", "content": f"错误：{result_container['error']}"})

    thinking = _filter_thinking(partial_msgs)
    reply = _extract_summary(partial_msgs, user_input, task_type)
    return {"reply": reply, "thinking": thinking, "task_type": task_type, "generated_files": generated_files}


def generate_report_from_thinking(thinking: list[dict]) -> str:
    if not thinking:
        return "无可用记录。"
    from agents import summarizer
    context = "\n\n".join(
        f"{m.get('name', '')}: {m.get('content', '')[:2000]}"
        for m in thinking if m.get("content")
    )
    msgs = [
        {"role": "system", "content": (
            "以下是一个多智能体协作过程的内部记录。请你据此生成一份结构化的执行报告，"
            "使用 Markdown 格式，包括：任务概述、执行步骤、关键产出、结论。"
            "输出长度与任务体量成正比，简单任务不要过度格式化。"
        )},
        {"role": "user", "content": f"协作记录：\n\n{context}"},
    ]
    try:
        reply = summarizer.generate_reply(messages=msgs, sender=None)
    except Exception:
        return "# 多智能体协作报告\n\n报告生成失败。"
    return _extract_content(reply)


# ── helpers ──

def _extract_content(reply):
    if isinstance(reply, str):
        return reply.strip() or "（空回复）"
    if isinstance(reply, dict):
        return reply.get("content", "（空回复）") or "（空回复）"
    return str(reply)


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


def _filter_thinking(msgs: list) -> list:
    out = []
    seen_user = False
    for m in msgs:
        name = m.get("name", "")
        content = m.get("content", "")
        if not content:
            continue
        if name == "User":
            if not seen_user:
                seen_user = True
                continue
        out.append({"name": name, "content": content})
    return out


def _extract_summary(msgs: list, user_input: str, task_type: str = "") -> str:
    """
    根据任务类型组合正文：
    - 编程/分析：提取代码块 + 报告作为正文
    - 写作：Writer 原文 + 评审摘要
    - 轻型：Summarizer → Planner → 默认
    """
    # ── 1. 提取 Summarizer 报告 ──
    summarizer_out = ""
    for m in reversed(msgs):
        if m.get("name") == "Summarizer" and m.get("content"):
            summarizer_out = m["content"]
            break

    # ── 2. 提取 Coder 代码块（编程/分析任务）──
    code_blocks = []
    if task_type in ("编程", "分析"):
        for m in msgs:
            if m.get("name") == "Coder":
                content = m.get("content", "")
                blocks = re.findall(r'```(?:python)?\s*\n(.*?)```', content, re.DOTALL)
                for b in blocks:
                    b = b.strip()
                    if len(b) > 30:
                        code_blocks.append(b)

    # ── 3. 编程/分析：代码 + 报告 ──
    if task_type in ("编程", "分析") and code_blocks:
        parts = []
        parts.append("## 💻 代码实现\n")
        for i, cb in enumerate(code_blocks):
            if len(code_blocks) > 1:
                parts.append(f"### 第 {i+1} 段\n")
            parts.append(f"```python\n{cb}\n```\n")

        if summarizer_out:
            parts.append("## 📊 任务报告\n")
            parts.append(summarizer_out)
        else:
            # 兜底：Planner 计划 + 提示无最终报告
            for m in reversed(msgs):
                if m.get("name") == "Planner" and m.get("content"):
                    parts.append("## 📋 执行计划\n")
                    parts.append(m["content"])
                    break
        return "\n".join(parts)

    # ── 4. 写作：Writer/Summarizer → Planner ──
    if task_type == "写作":
        if summarizer_out:
            return summarizer_out
        for m in reversed(msgs):
            if m.get("name") == "Writer" and m.get("content"):
                return m["content"]
        for m in reversed(msgs):
            if m.get("name") == "Planner" and m.get("content"):
                return m["content"]
        return f"收到写作任务「{user_input[:50]}」。多智能体已完成协作。"

    # ── 5. 默认：Summarizer → Planner → 兜底 ──
    if summarizer_out:
        return summarizer_out
    for m in reversed(msgs):
        if m.get("name") == "Planner" and m.get("content"):
            return m["content"]
    return f"收到任务「{user_input[:50]}」。多智能体已完成协作。"
