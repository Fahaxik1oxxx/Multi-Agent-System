"""
双 Lane GroupChat 状态机（Router 上游分类后选择用哪条）。

coding lane:  Planner→Retriever→Coder→Tester↔Coder→User→Summarizer
writing lane: Planner→Retriever→Writer→Tester↔Writer→Summarizer

修复迭代：每类最多 _MAX_FIX_CYCLES 次 Tester 驳回重建。
"""

import re
from autogen import GroupChat, GroupChatManager
from agents import planner, retriever, coder, writer, tester, summarizer, user
from tools import read_file, write_file, search_knowledge, calculate, analyze_data, visualize_data

_MAX_FIX_CYCLES = 2

speaking_log: list[dict] = []
_retry_count: dict[str, int] = {}


def reset_speaking_log():
    speaking_log.clear()
    _retry_count.clear()


def get_speaking_log() -> list[dict]:
    return list(speaking_log)


def _has_code_in_conversation(msgs: list) -> bool:
    for m in msgs:
        if m.get("name") == "Coder" and "```" in (m.get("content") or ""):
            return True
    return False


# ========== coding lane 状态机 ==========
def _coding_speaker_selection(last_speaker, groupchat):
    agent_map = {a.name: a for a in groupchat.agents}
    msgs = groupchat.messages
    name = last_speaker.name
    content = (msgs[-1].get("content") or "") if msgs else ""

    # 如果助手下一条消息包含 tool_calls/function_call，路由到 User 执行
    if name != "User" and msgs:
        last_msg = msgs[-1]
        if last_msg.get("tool_calls") or last_msg.get("function_call"):
            return _next(last_speaker, agent_map.get("User"))

    if name == "User":
        user_msgs = [m for m in msgs if m.get("name") == "User"]
        if len(user_msgs) <= 1:
            return _next(last_speaker, agent_map.get("Planner"))

        # ── 检测是否为工具执行结果（非代码执行）──
        prev_agent = None
        for m in reversed(msgs[:-1]):
            if m.get("name") not in ("User", None):
                prev_agent = m
                break
        if prev_agent and (prev_agent.get("tool_calls") or prev_agent.get("function_call")):
            prev_name = prev_agent.get("name", "")
            if prev_name in agent_map:
                return _next(last_speaker, agent_map.get(prev_name))
            return _next(last_speaker, agent_map.get("Planner"))

        # ── 正常代码执行路径 ──
        success = "exitcode: 0" in content
        fail_count = sum(
            1 for m in msgs
            if m.get("name") == "User"
            and "exitcode:" in (m.get("content") or "")
            and "exitcode: 0" not in (m.get("content") or "")
        )
        if success:                    return _next(last_speaker, agent_map.get("Summarizer"))
        if fail_count > _MAX_FIX_CYCLES: return _next(last_speaker, agent_map.get("Summarizer"))
        return _next(last_speaker, agent_map.get("Coder"))

    if name == "Planner":    return _next(last_speaker, agent_map.get("Retriever"))
    if name == "Retriever":  return _next(last_speaker, agent_map.get("Coder"))
    if name == "Coder":      return _next(last_speaker, agent_map.get("Tester"))

    if name == "Tester":
        if "✅" in content:
            if _has_code_in_conversation(msgs):
                return _next(last_speaker, agent_map.get("User"))
            return _next(last_speaker, agent_map.get("Summarizer"))
        retry = _retry_count.get("Coder", 0) + 1
        _retry_count["Coder"] = retry
        if retry > _MAX_FIX_CYCLES:
            return _next(last_speaker, agent_map.get("Summarizer"))
        return _next(last_speaker, agent_map.get("Coder"))

    if name == "Summarizer": return _next(last_speaker, None)
    return _next(last_speaker, None)


# ========== writing lane 状态机 ==========
def _writing_speaker_selection(last_speaker, groupchat):
    agent_map = {a.name: a for a in groupchat.agents}
    msgs = groupchat.messages
    name = last_speaker.name
    content = (msgs[-1].get("content") or "") if msgs else ""

    # 如果助手下一条消息包含 tool_calls/function_call，路由到 User 执行
    if name != "User" and msgs:
        last_msg = msgs[-1]
        if last_msg.get("tool_calls") or last_msg.get("function_call"):
            return _next(last_speaker, agent_map.get("User"))

    if name == "User":
        user_msgs = [m for m in msgs if m.get("name") == "User"]
        if len(user_msgs) <= 1:
            return _next(last_speaker, agent_map.get("Planner"))

        # ── 检测是否为工具执行结果（非代码执行）──
        prev_agent = None
        for m in reversed(msgs[:-1]):
            if m.get("name") not in ("User", None):
                prev_agent = m
                break
        if prev_agent and (prev_agent.get("tool_calls") or prev_agent.get("function_call")):
            prev_name = prev_agent.get("name", "")
            if prev_name in agent_map:
                return _next(last_speaker, agent_map.get(prev_name))
            return _next(last_speaker, agent_map.get("Planner"))

        return _next(last_speaker, agent_map.get("Summarizer"))

    if name == "Planner":    return _next(last_speaker, agent_map.get("Retriever"))
    if name == "Retriever":  return _next(last_speaker, agent_map.get("Writer"))
    if name == "Writer":     return _next(last_speaker, agent_map.get("Tester"))

    if name == "Tester":
        if "✅" in content:
            return _next(last_speaker, agent_map.get("Summarizer"))
        retry = _retry_count.get("Writer", 0) + 1
        _retry_count["Writer"] = retry
        if retry > _MAX_FIX_CYCLES:
            return _next(last_speaker, agent_map.get("Summarizer"))
        return _next(last_speaker, agent_map.get("Writer"))

    if name == "Summarizer": return _next(last_speaker, None)
    return _next(last_speaker, None)


def _next(last_speaker, next_speaker):
    next_name = next_speaker.name if next_speaker else "（结束）"
    speaking_log.append({"from": last_speaker.name, "to": next_name})
    return next_speaker


# ========== GroupChat 构建 ==========
_coding_agents    = [planner, retriever, coder,      tester,       user, summarizer]
_writing_agents   = [planner, retriever,       writer, tester,           summarizer]

coding_groupchat = GroupChat(
    agents=_coding_agents, messages=[],
    max_round=15, speaker_selection_method=_coding_speaker_selection,
)
coding_manager = GroupChatManager(
    groupchat=coding_groupchat, name="Manager",
    llm_config=planner.llm_config,
)

writing_groupchat = GroupChat(
    agents=_writing_agents, messages=[],
    max_round=10, speaker_selection_method=_writing_speaker_selection,
)
writing_manager = GroupChatManager(
    groupchat=writing_groupchat, name="Manager",
    llm_config=planner.llm_config,
)

# 工具注册到两个 Manager
_all_tools = [read_file, write_file, search_knowledge, calculate, analyze_data, visualize_data]
for mgr in (coding_manager, writing_manager):
    for fn in _all_tools:
        mgr._function_map[fn.__name__] = fn
