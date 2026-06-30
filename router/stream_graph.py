"""
流式 LangGraph 节点与工作流定义
"""

import logging
import re
import operator
import sys
import os
import datetime
from datetime import timedelta
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, END

_PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_DIR not in sys.path:
    sys.path.insert(0, _PROJECT_DIR)

from agents import create_llm, SYSTEM_PROMPTS
from tools import search_knowledge, web_search
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
    total_tokens: int
    total_elapsed_ms: int
    web_search_enabled: bool
    web_search_results: str


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


def _stream_llm(role: str, prompt: str, state: StreamWorkflowState, temperature: float = 0.3) -> str:
    """辅助函数：通用 LLM 流式调用并推送到队列"""
    session = state["session"]
    import time
    start_time = time.time()
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
    
    elapsed_ms = int((time.time() - start_time) * 1000)
    token_count = len(prompt) + len(content)
    session.total_tokens += token_count
    session.total_elapsed_ms += elapsed_ms
    
    if getattr(session, "db", None) and getattr(session, "session_id", None):
        try:
            session.db.create_step_log(
                session_id=session.session_id,
                task_type=state.get("task_type", ""),
                agent_name=role,
                status="done",
                elapsed_ms=elapsed_ms,
                token_count=token_count,
            )
            logger.info(f"stream_graph | _stream_llm | saved step log for {role}, session={session.session_id}")
        except Exception as e:
            logger.error("stream_graph | step_log error: %s", e)

    logger.info("stream | agent_end=%s | chars=%d", role, len(content))
    return content


def bot_node(state: StreamWorkflowState) -> dict:
    session = state["session"]
    logger.info("stream_graph | bot_node | enter | input=%s", state["user_input"][:60])
    prompt = f"{get_prompt('Bot', state)}\n\n"
    if state.get("web_search_results"):
        now = datetime.datetime.now().strftime("%Y年%m月%d日 %H:%M:%S")
        prompt += f"当前时间: {now}（北京时间）\n\n"
        prompt += (
            "以下为联网搜索结果（每个结果以 [webpage N] 标记）：\n"
            f"{state['web_search_results']}\n\n"
            "请严格遵循：\n"
            "1. 仅基于以上搜索结果回答，不要编造搜索结果中不存在的细节。\n"
            "2. 如果搜索结果中不包含用户所需信息，请如实告知「未搜索到相关信息」。\n"
            "3. 在回答中使用 [citation:N] 标注信息来源编号。\n\n"
        )
    prompt += f"用户输入: {state['user_input']}"
    content = _stream_llm("Bot", prompt, state, temperature=0.5)
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
    prompt = f"{get_prompt('Planner', state)}\n{extra}\n\n"
    if state.get("web_search_results"):
        now = datetime.datetime.now().strftime("%Y年%m月%d日 %H:%M:%S")
        prompt += f"当前时间: {now}（北京时间）\n\n"
        prompt += (
            "以下为联网搜索结果（每个结果以 [webpage N] 标记）：\n"
            f"{state['web_search_results']}\n\n"
            "请严格遵循：\n"
            "1. 仅基于以上搜索结果进行规划，不要编造搜索结果中不存在的细节。\n"
            "2. 如果搜索结果中不包含用户所需信息，请在计划中注明「未搜索到相关信息」。\n"
            "3. 可使用 [citation:N] 标注信息来源编号。\n\n"
        )
    prompt += f"用户需求: {state['user_input']}"
    content = _stream_llm("Planner", prompt, state)
    logger.info("stream_graph | planner_node | exit | plan_chars=%d", len(content))
    return {"plan": content, "thinking": [{"name": "Planner", "content": content}]}


def retriever_node(state: StreamWorkflowState) -> dict:
    session = state["session"]
    import time
    start_time = time.time()
    logger.info("stream_graph | retriever_node | enter")
    push(session, {"type": "agent_start", "name": "Retriever"})
    kb_result = search_knowledge.invoke(state["user_input"])
    prompt = (
        f"{get_prompt('Retriever', state)}\n\n"
        f"任务：{state['user_input']}\n"
        f"任务类型：{state.get('task_type', '')}\n"
        f"计划：{state.get('plan', '')}\n"
        f"知识库检索结果：{kb_result}\n"
    )
    if state.get("web_search_results"):
        prompt += f"联网搜索结果：{state['web_search_results']}\n"
    prompt += "\n请总结与任务最相关的信息。"
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
    
    elapsed_ms = int((time.time() - start_time) * 1000)
    token_count = len(prompt) + len(content)
    session.total_tokens += token_count
    session.total_elapsed_ms += elapsed_ms
    if getattr(session, "db", None) and getattr(session, "session_id", None):
        try:
            session.db.create_step_log(
                session_id=session.session_id, task_type=state.get("task_type", ""),
                agent_name="Retriever", status="done", elapsed_ms=elapsed_ms, token_count=token_count
            )
            logger.info(f"stream_graph | retriever_node | saved step log for Retriever, session={session.session_id}")
        except Exception as e:
            logger.error("stream_graph | retriever step_log error: %s", e)

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
    if state.get("web_search_results"):
        prompt += f"联网搜索结果：{state['web_search_results']}\n\n"
    if state.get("test_result") and "✅" in state.get("test_result", ""):
        prompt += f"上一次审阅反馈（请据此修改代码）：\n{state.get('test_result')}\n\n"
    if state.get("execution_result") and "exitcode:" in state.get("execution_result", ""):
        prompt += f"上一次执行结果，请据此修复代码！：\n{state.get('execution_result')}\n\n"
    prompt += "请编写代码实现上述需求。"
    session_prompt = f"{sys_prompt}\n\n{prompt}"
    content = _stream_llm("Coder", session_prompt, state, temperature=0.2)
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
    if state.get("web_search_results"):
        prompt += f"联网搜索结果：{state['web_search_results']}\n\n"
    if state.get("test_result") and "✅" in state.get("test_result", ""):
        prompt += f"上一次审阅反馈（请据此修改文稿）：\n{state.get('test_result')}\n\n"
    prompt += "请撰写满足需求的文稿/报告。"
    session_prompt = f"{get_prompt('Writer', state)}\n\n{prompt}"
    content = _stream_llm("Writer", session_prompt, state, temperature=0.4)
    logger.info("stream_graph | writer_node | exit | draft_chars=%d", len(content))
    return {"code_or_draft": content, "thinking": [{"name": "Writer", "content": content}]}


def executor_node(state: StreamWorkflowState) -> dict:
    session = state["session"]
    import time
    start_time = time.time()
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
    
    elapsed_ms = int((time.time() - start_time) * 1000)
    session.total_elapsed_ms += elapsed_ms
    if getattr(session, "db", None) and getattr(session, "session_id", None):
        try:
            session.db.create_step_log(
                session_id=session.session_id, task_type=state.get("task_type", ""),
                agent_name="Executor", status="done", elapsed_ms=elapsed_ms, token_count=0
            )
            logger.info(f"stream_graph | executor_node | saved step log for Executor, session={session.session_id}")
        except Exception as e:
            logger.error("stream_graph | executor step_log error: %s", e)
            
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
    content = _stream_llm("Tester", session_prompt, state, temperature=0.2)
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
    content = _stream_llm("Summarizer", prompt, state)
    logger.info("stream_graph | summarizer_node | exit | report_chars=%d", len(content))
    return {"final_output": content, "thinking": [{"name": "Summarizer", "content": content}]}


# —— 联网搜索节点 ——
def web_search_node(state: StreamWorkflowState) -> dict:
    enabled = state.get("web_search_enabled", False)
    if not enabled:
        return {"web_search_results": "", "thinking": []}

    session = state["session"]
    push(session, {"type": "agent_start", "name": "WebSearch"})

    now = datetime.datetime.now()
    query = state["user_input"]
    augmented = (
        query.replace("今天", now.strftime("%Y年%m月%d日"))
        .replace("昨天", (now - timedelta(days=1)).strftime("%Y年%m月%d日"))
        .replace("明天", (now + timedelta(days=1)).strftime("%Y年%m月%d日"))
        .replace("现在", now.strftime("%Y年%m月%d日"))
    )

    # 用 LLM 提取搜索关键词
    try:
        llm = create_llm("Bot", temperature=0)
        kw_prompt = (
            "你是一个搜索引擎关键词提取器。将用户的问题转化为 2-4 个搜索引擎关键词，"
            "用空格分隔。只输出关键词，不要任何其他文字。\n"
            f"用户问题：{augmented}"
        )
        extracted = llm.invoke(kw_prompt).content.strip()
        if 3 < len(extracted) < 100:
            augmented = extracted
    except Exception:
        pass

    date_str = now.strftime("%Y年%m月%d日")
    month_str = now.strftime("%Y年%m月")

    search_queries = [augmented]
    if month_str not in augmented:
        search_queries.append(f"{month_str} {query}")
    if date_str not in augmented:
        search_queries.append(f"{date_str} {query}")
    search_queries = list(dict.fromkeys(search_queries))

    seen_urls = set()
    formatted = []
    page_num = 0
    for sq in search_queries[:3]:
        raw = web_search.invoke(sq)
        for line in raw.split("\n\n"):
            line = line.strip()
            if not line or not line[0].isdigit():
                continue
            parts = line.split("\n", 1)
            if len(parts) < 2:
                continue
            url = parts[1].rsplit("\n", 1)[-1].strip() if "\n" in parts[1] else ""
            if url and url in seen_urls:
                continue
            if url:
                seen_urls.add(url)
            page_num += 1
            formatted.append(f"[webpage {page_num}]\n{parts[1]}\n[/webpage {page_num}]")
            if page_num >= 8:
                break
        if page_num >= 8:
            break

    results_text = "\n\n".join(formatted) if formatted else "未找到相关结果。"
    push(session, {"type": "token", "name": "WebSearch", "content": results_text})
    push(session, {"type": "agent_end", "name": "WebSearch", "content": results_text})
    logger.info("stream_graph | web_search_node | queries=%s | pages=%d", search_queries, page_num)
    return {
        "web_search_results": results_text,
        "thinking": [{"name": "WebSearch", "content": results_text}],
    }


# —— 构建 LangGraph ——
def build_stream_workflow() -> StateGraph:
    logger.info("stream_graph | build_static | 9 agent nodes, 7 conditional edges")
    wf = StateGraph(StreamWorkflowState)
    wf.add_node("bot", bot_node)
    wf.add_node("planner", planner_node)
    wf.add_node("retriever", retriever_node)
    wf.add_node("coder", coder_node)
    wf.add_node("writer", writer_node)
    wf.add_node("executor", executor_node)
    wf.add_node("tester", tester_node)
    wf.add_node("summarizer", summarizer_node)
    wf.add_node("web_search", web_search_node)
    wf.add_edge("__start__", "web_search")
    wf.add_conditional_edges("web_search", _route_lane)
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
