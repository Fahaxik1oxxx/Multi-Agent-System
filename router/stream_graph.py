"""
流式 LangGraph 节点与工作流定义
"""

import logging
import re
import operator
import sys
import os
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, END

_PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_DIR not in sys.path:
    sys.path.insert(0, _PROJECT_DIR)

from agents import create_llm, SYSTEM_PROMPTS
from tools import search_knowledge
from executor import CodeExecutor
from router.stream_state import SessionState, push

logger = logging.getLogger(__name__)


# —— LangGraph 状态定义 ——
class StreamWorkflowState(TypedDict):
    session: SessionState
    user_input: str
    lane_mode: str
    task_type: str
    complexity: str
    need_report: bool
    plan: str
    knowledge: str
    code_or_draft: str
    execution_result: str
    test_result: str
    fix_count: int
    thinking: Annotated[list, operator.add]
    final_output: str


_MAX_FIX_CYCLES = 2


def get_prompt(role: str, state: StreamWorkflowState) -> str:
    default = SYSTEM_PROMPTS.get(role, "")
    session = state.get("session")
    if not session or getattr(session, "db", None) is None:
        return default
    try:
        user_config = session.db.get_user_config(session.user_id)
        if user_config and user_config.get("roles") and user_config["roles"].get(role):
            return user_config["roles"][role]
    except Exception:
        pass
    return default

# —— LangGraph 节点与路由 ——
def _route_lane(state: StreamWorkflowState) -> str:
    chosen = "bot" if state.get("complexity") == "低" else "planner"
    logger.info("stream_graph | route_lane | complexity=%s -> %s", state.get("complexity"), chosen)
    return chosen


def _route_task(state: StreamWorkflowState) -> str:
    task_type = state.get("task_type", "编程")
    chosen = "writer" if task_type == "写作" else "coder"
    logger.info("stream_graph | route_task | task_type=%s -> %s", task_type, chosen)
    return chosen


def _route_after_executor(state: StreamWorkflowState) -> str:
    exec_result = state.get("execution_result", "")
    if "无代码" in exec_result or "没有有效代码块" in exec_result:
        chosen = "summarizer" if state.get("need_report", True) else END
        logger.info("stream_graph | route_after_executor | 无代码 -> %s", chosen)
        return chosen
    logger.info("stream_graph | route_after_executor | has_code -> tester")
    return "tester"


def _route_test(state: StreamWorkflowState) -> str:
    test_result = state.get("test_result", "")
    fix_count = state.get("fix_count", 0)
    task_type = state.get("task_type", "编程")
    need_report = state.get("need_report", True)
    if "✅" in test_result or fix_count >= _MAX_FIX_CYCLES:
        chosen = "summarizer" if need_report else END
        logger.info("stream_graph | route_test | pass/fix_exhausted(fix_count=%d) -> %s", fix_count, chosen)
        return chosen
    chosen = "coder" if task_type in ("编程", "分析") else "writer"
    logger.info("stream_graph | route_test | need_fix(fix_count=%d) -> %s", fix_count, chosen)
    return chosen


def _stream_llm(role: str, prompt: str, session: SessionState, temperature: float = 0.3) -> str:
    """辅助函数：通用 LLM 流式调用并推送到队列"""
    push(session, {"type": "agent_start", "name": role})
    llm = create_llm(role, temperature=temperature)
    content = ""
    for chunk in llm.stream(prompt):
        if session.cancel.is_set():
            push(session, {"type": "cancelled"})
            break
        text = chunk.content if hasattr(chunk, "content") else str(chunk)
        content += text
        push(session, {"type": "token", "name": role, "content": text})
    push(session, {"type": "agent_end", "name": role, "content": content})
    logger.info("stream | agent_end=%s | chars=%d", role, len(content))
    return content


def bot_node(state: StreamWorkflowState) -> dict:
    session = state["session"]
    logger.info("stream_graph | bot_node | enter | input=%s", state["user_input"][:60])
    prompt = f"{get_prompt('Bot', state)}\n\n用户输入: {state['user_input']}"
    content = _stream_llm("Bot", prompt, session, temperature=0.5)
    logger.info("stream_graph | bot_node | exit | reply_chars=%d", len(content))
    return {"final_output": content, "thinking": [{"name": "Bot", "content": content}]}


def planner_node(state: StreamWorkflowState) -> dict:
    session = state["session"]
    task_type = state.get("task_type", "编程")
    extra = ""
    if task_type == "分析":
        extra = "\n注意：这是数据分析任务。规划步骤应包含：数据加载 → 清洗 → 统计/分组 → 可视化。"
    elif task_type == "编程":
        extra = "\n注意：执行环境仅支持 Python。如用户要求 C/Java/Rust 等语言，只规划到「编写代码阶段」这一步。"
    logger.info("stream_graph | planner_node | enter | task_type=%s", task_type)
    prompt = f"{get_prompt('Planner', state)}\n{extra}\n\n用户需求: {state['user_input']}"
    content = _stream_llm("Planner", prompt, session)
    logger.info("stream_graph | planner_node | exit | plan_chars=%d", len(content))
    return {"plan": content, "thinking": [{"name": "Planner", "content": content}]}


def retriever_node(state: StreamWorkflowState) -> dict:
    session = state["session"]
    logger.info("stream_graph | retriever_node | enter")
    push(session, {"type": "agent_start", "name": "Retriever"})
    user_id = state.get("user_id", "shared")
    kb_result = search_knowledge.invoke({"query": state["user_input"], "user_id": user_id})
    prompt = (
        f"{get_prompt('Retriever', state)}\n\n"
        f"任务：{state['user_input']}\n"
        f"任务类型：{state.get('task_type', '')}\n"
        f"计划：{state.get('plan', '')}\n"
        f"知识库检索结果：{kb_result}\n\n"
        f"请总结与任务最相关的信息。"
    )
    llm = create_llm("Retriever")
    content = ""
    for chunk in llm.stream(prompt):
        if session.cancel.is_set():
            push(session, {"type": "cancelled"})
            break
        text = chunk.content if hasattr(chunk, "content") else str(chunk)
        content += text
        push(session, {"type": "token", "name": "Retriever", "content": text})
    push(session, {"type": "agent_end", "name": "Retriever", "content": content})
    logger.info("stream_graph | retriever_node | exit | chars=%d", len(content))
    return {"knowledge": content, "thinking": [{"name": "Retriever", "content": content}]}


def coder_node(state: StreamWorkflowState) -> dict:
    session = state["session"]
    task_type = state.get("task_type", "编程")
    sys_prompt = get_prompt("Coder", state)
    if task_type == "分析":
        sys_prompt = (
            "你是 Python 数据分析师。你的核心职责是："
            "**编写数据分析代码并执行**。\n"
            "1. 用 ```python ... ``` 代码块编写可直接运行的 Python 代码。\n"
            "2. 使用 pandas 读取数据、分组聚合、统计分析。\n"
            "3. 使用 matplotlib 生成图表。\n"
            "4. 代码必须包含 print() 输出关键分析结果。\n"
            "5. 不要在代码块里写「建议」「如果」「可以」——"
            "给出确定的可执行代码。"
        )
    has_test_result = bool(state.get("test_result"))
    has_exec_result = bool(state.get("execution_result"))
    logger.info(
        "stream_graph | coder_node | enter | task_type=%s | has_test_result=%s | has_exec_result=%s",
        task_type, has_test_result, has_exec_result,
    )
    prompt = (
        f"用户需求：{state['user_input']}\n\n"
        f"任务类型：{task_type}\n\n"
        f"执行计划：{state.get('plan', '')}\n\n"
        f"知识库参考：{state.get('knowledge', '')}\n\n"
    )
    if state.get("test_result") and "✅" in state.get("test_result", ""):
        prompt += f"上一次审阅反馈（请据此修改代码）：\n{state.get('test_result')}\n\n"
    if state.get("execution_result") and "exitcode:" in state.get("execution_result", ""):
        prompt += f"上一次执行结果，请据此修复代码！：\n{state.get('execution_result')}\n\n"
    prompt += "请编写代码实现上述需求。"
    session_prompt = f"{sys_prompt}\n\n{prompt}"
    content = _stream_llm("Coder", session_prompt, session, temperature=0.2)
    logger.info("stream_graph | coder_node | exit | code_chars=%d", len(content))
    return {"code_or_draft": content, "thinking": [{"name": "Coder", "content": content}]}


def writer_node(state: StreamWorkflowState) -> dict:
    session = state["session"]
    has_test_result = bool(state.get("test_result"))
    logger.info(
        "stream_graph | writer_node | enter | has_test_result=%s", has_test_result,
    )
    prompt = (
        f"用户需求：{state['user_input']}\n\n"
        f"执行计划：{state.get('plan', '')}\n\n"
        f"参考资料：{state.get('knowledge', '')}\n\n"
    )
    if state.get("test_result") and "✅" in state.get("test_result", ""):
        prompt += f"上一次审阅反馈（请据此修改文稿）：\n{state.get('test_result')}\n\n"
    prompt += "请撰写满足需求的文稿/报告。"
    session_prompt = f"{get_prompt('Writer', state)}\n\n{prompt}"
    content = _stream_llm("Writer", session_prompt, session, temperature=0.4)
    logger.info("stream_graph | writer_node | exit | draft_chars=%d", len(content))
    return {"code_or_draft": content, "thinking": [{"name": "Writer", "content": content}]}


def executor_node(state: StreamWorkflowState) -> dict:
    session = state["session"]
    code_or_draft = state.get("code_or_draft", "")
    code_blocks = re.findall(r"```(?:python)?\s*\n(.*?)```", code_or_draft, re.DOTALL)
    logger.info(
        "stream_graph | executor_node | enter | code_blocks=%d", len(code_blocks),
    )
    if not code_blocks:
        logger.info("stream_graph | executor_node | no code blocks found")
        return {"execution_result": "（没有有效代码块执行）"}
    push(session, {"type": "agent_start", "name": "Executor"})
    executor = CodeExecutor()
    all_results = []
    for i, code in enumerate(code_blocks):
        code = code.strip()
        if len(code) < 10:
            continue
        result = executor.execute(code)
        logger.info(
            "stream_graph | executor_node | block %d | exitcode=%d | stdout=%d chars | stderr=%d chars",
            i + 1, result["exitcode"], len(result["stdout"]), len(result["stderr"]),
        )
        text = (
            f"--- 代码块 {i + 1} ---\n"
            f"exitcode: {result['exitcode']}\n"
            f"stdout:\n{result['stdout']}\n"
            f"stderr:\n{result['stderr']}"
        )
        all_results.append(text)
        push(session, {"type": "token", "name": "Executor", "content": text + "\n\n"})
    execution_result = "\n\n".join(all_results) if all_results else "（没有有效代码块执行）"
    push(session, {"type": "agent_end", "name": "Executor", "content": execution_result})
    logger.info("stream_graph | executor_node | exit | execution_result_chars=%d", len(execution_result))
    return {"execution_result": execution_result, "thinking": [{"name": "Executor", "content": execution_result}]}


def tester_node(state: StreamWorkflowState) -> dict:
    session = state["session"]
    task_type = state.get("task_type", "编程")
    code_or_draft = state.get("code_or_draft", "")
    execution_result = state.get("execution_result", "")
    fix_count = state.get("fix_count", 0)
    logger.info(
        "stream_graph | tester_node | enter | fix_count=%d | task_type=%s",
        fix_count, task_type,
    )
    prompt = f"用户原始需求：{state['user_input']}\n\n任务类型：{task_type}\n产出内容：\n{code_or_draft[:3000]}\n"
    if "无代码" not in execution_result:
        prompt += f"执行结果：\n{execution_result}\n\n"
    prompt += "请审阅上述产出是否满足用户原始需求。"
    session_prompt = f"{get_prompt('Tester', state)}\n\n{prompt}"
    content = _stream_llm("Tester", session_prompt, session, temperature=0.2)
    new_fix_count = state.get("fix_count", 0) + 1
    logging.info(
        "stream_graph | tester_node | exit | fix_count=%d | has_pass=%s",
        new_fix_count, "✅" in content,
    )
    return {"test_result": content, "fix_count": new_fix_count, "thinking": [{"name": "Tester", "content": content}]}


def summarizer_node(state: StreamWorkflowState) -> dict:
    session = state["session"]
    need_report = state.get("need_report", True)
    logger.info("stream_graph | summarizer_node | enter | need_report=%s", need_report)
    prompt = (
        f"{get_prompt('Summarizer', state)}\n\n"
        "以下是多个智能体协作过程的记录。请你据此生成一份结构化的执行报告。\n\n"
        f"### 用户需求\n{state['user_input']}\n"
        f"### 任务类型\n{state.get('task_type', '')}\n"
        f"### 执行计划\n{state.get('plan', '')}\n"
        f"### 产出\n{state.get('code_or_draft', '')[:3000]}\n"
        f"### 审阅结果\n{state.get('test_result', '')}"
    )
    content = _stream_llm("Summarizer", prompt, session)
    logger.info("stream_graph | summarizer_node | exit | report_chars=%d", len(content))
    return {"final_output": content, "thinking": [{"name": "Summarizer", "content": content}]}


# —— 构建 LangGraph ——
def build_stream_workflow() -> StateGraph:
    logger.info("stream_graph | build_static | 8 agent nodes, 6 conditional edges")
    wf = StateGraph(StreamWorkflowState)
    wf.add_node("bot", bot_node)
    wf.add_node("planner", planner_node)
    wf.add_node("retriever", retriever_node)
    wf.add_node("coder", coder_node)
    wf.add_node("writer", writer_node)
    wf.add_node("executor", executor_node)
    wf.add_node("tester", tester_node)
    wf.add_node("summarizer", summarizer_node)
    wf.set_conditional_entry_point(_route_lane)
    wf.add_edge("bot", END)
    wf.add_edge("planner", "retriever")
    wf.add_conditional_edges("retriever", _route_task)
    wf.add_edge("coder", "executor")
    wf.add_conditional_edges("executor", _route_after_executor)
    wf.add_edge("writer", "tester")
    wf.add_conditional_edges("tester", _route_test)
    wf.add_edge("summarizer", END)
    compiled = wf.compile()
    logger.info("stream_graph | build_static | complete")
    return compiled
