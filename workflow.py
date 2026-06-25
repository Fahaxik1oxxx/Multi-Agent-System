"""
LangGraph 工作流 —— 快/慢车道多 Agent 编排。

支持 5 种任务类型：编程 / 写作 / 分析 / 问答 / 闲聊
慢车道含 exitcode 分支、speaking_log 记录、最多 2 轮修复循环。
"""

from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, END
import operator
import re


# ===== 状态定义 =====
class WorkflowState(TypedDict):
    user_input: str
    lane_mode: str  # "auto" | "fast" | "slow"
    task_type: str  # "编程" | "写作" | "分析" | "问答" | "闲聊"
    complexity: str  # "轻" | "重"
    plan: str
    knowledge: str
    code_or_draft: str
    execution_result: str
    test_result: str
    fix_count: int
    agent_messages: Annotated[list, operator.add]
    speaking_log: Annotated[list, operator.add]
    final_output: str
    need_report: bool


_MAX_FIX_CYCLES = 2


# ===== 辅助函数 =====
def _log_speak(from_name: str, to_name: str) -> dict:
    return {"from": from_name, "to": to_name}


# ===== 条件路由函数 =====
def _route_lane(state: WorkflowState) -> str:
    """根据 complexity 路由：轻 → bot，重 → planner"""
    return "bot" if state.get("complexity") == "轻" else "planner"


def _route_task(state: WorkflowState) -> str:
    """根据任务类型选择执行者"""
    task_type = state.get("task_type", "编程")
    if task_type == "写作":
        return "writer"
    # 编程 和 分析 都走 coder lane
    return "coder"


def _route_test(state: WorkflowState) -> str:
    """评审后路由：通过 → summarizer，未通过 → 重试或强制结束"""
    task_type = state.get("task_type", "编程")
    test_result = state.get("test_result", "")
    fix_count = state.get("fix_count", 0)

    if "✅" in test_result:
        # 有代码产出且 exitcode 通过 → summarizer
        return "summarizer"

    if fix_count >= _MAX_FIX_CYCLES:
        # 超过最大修复次数，强制结束
        return "summarizer"

    # 返回对应执行者重试
    return "coder" if task_type in ("编程", "分析") else "writer"


def _route_after_executor(state: WorkflowState) -> str:
    """代码执行后的分支决策（基于 exitcode）"""
    exec_result = state.get("execution_result", "")
    task_type = state.get("task_type", "编程")

    # 无代码需要执行 → 跳过 tester 直接到 summarizer
    if "无代码需要执行" in exec_result or "无有效代码块执行" in exec_result:
        return "summarizer"

    return "tester"


# ===== 节点函数 =====


def bot_node(state: WorkflowState) -> dict:
    from agents import create_llm, SYSTEM_PROMPTS

    _log_speak("用户", "Bot")

    llm = create_llm("Bot", temperature=0.5)
    response = llm.invoke(f"{SYSTEM_PROMPTS['Bot']}\n\n用户输入: {state['user_input']}")
    reply = response.content if hasattr(response, "content") else str(response)

    return {
        "final_output": reply,
        "agent_messages": [{"role": "assistant", "content": reply, "name": "Bot"}],
        "speaking_log": [_log_speak("用户", "Bot"), _log_speak("Bot", "结束")],
    }


def planner_node(state: WorkflowState) -> dict:
    from agents import create_llm, SYSTEM_PROMPTS

    _log_speak("用户", "Planner")

    task_type = state.get("task_type", "编程")

    # 根据任务类型定制 Planner prompt
    if task_type == "分析":
        extra = "\n注意：这是数据分析任务。规划步骤应包含：数据加载 → 清洗 → 统计/分组 → 可视化。"
    elif task_type == "编程":
        extra = (
            "\n注意：执行环境仅支持 Python。如用户要求 C/Java/Rust 等语言，"
            "只规划到「编写代码片段」这一步，编译/运行由用户自行完成。"
        )
    else:
        extra = ""

    llm = create_llm("Planner")
    response = llm.invoke(f"{SYSTEM_PROMPTS['Planner']}\n{extra}\n\n用户需求: {state['user_input']}")
    plan = response.content if hasattr(response, "content") else str(response)

    # 从 Planner 输出提取 task_type（保底用上游传入的值）
    resolved_type = task_type
    m = re.search(r"task_type:\s*(coding|writing|analysis)", plan, re.IGNORECASE)
    if m:
        t = m.group(1).lower()
        resolved_type = {"coding": "编程", "writing": "写作", "analysis": "分析"}.get(t, task_type)

    return {
        "plan": plan,
        "task_type": resolved_type,
        "fix_count": state.get("fix_count", 0),
        "agent_messages": [{"role": "assistant", "content": plan, "name": "Planner"}],
        "speaking_log": [
            _log_speak("用户", "Planner"),
            _log_speak("Planner", "Retriever"),
        ],
    }


def retriever_node(state: WorkflowState) -> dict:
    from agents import create_llm, SYSTEM_PROMPTS
    from tools import search_knowledge

    kb_result = search_knowledge.invoke(state["user_input"])

    llm = create_llm("Retriever")
    prompt = (
        f"任务：{state['user_input']}\n"
        f"任务类型：{state.get('task_type', '')}\n"
        f"计划：{state.get('plan', '')}\n"
        f"知识库检索结果：{kb_result}\n\n"
        "请总结与任务最相关的信息。"
    )
    response = llm.invoke(f"{SYSTEM_PROMPTS['Retriever']}\n\n{prompt}")
    knowledge = response.content if hasattr(response, "content") else str(response)

    next_agent = _route_task(state)  # coder 或 writer

    return {
        "knowledge": knowledge,
        "agent_messages": [{"role": "assistant", "content": knowledge, "name": "Retriever"}],
        "speaking_log": [
            _log_speak("Planner", "Retriever"),
            _log_speak("Retriever", next_agent),
        ],
    }


def coder_node(state: WorkflowState) -> dict:
    from agents import create_llm, SYSTEM_PROMPTS

    task_type = state.get("task_type", "编程")

    # 分析任务使用带数据分析提示的 Coder
    if task_type == "分析":
        system_prompt = (
            "你是 Python 数据分析师。你的核心职责是：**编写数据分析代码并执行**。\n\n"
            "1. 用 ```python ... ``` 代码块编写可直接执行的 Python 代码。\n"
            "2. 使用 pandas 读取数据、分组聚合、统计分析。\n"
            "3. 使用 matplotlib（通过 Pillow 绑定的 visualize_data 工具）生成图表。\n"
            "4. 代码必须包含 print() 输出关键分析结果。\n"
            "5. 如需要保存文件（图表/报告），使用 write_file 工具。\n"
            "6. 不要在代码块里写「建议」「如果」「可以」——给出确定的可执行代码。"
        )
    else:
        system_prompt = SYSTEM_PROMPTS["Coder"]

    llm = create_llm("Coder", temperature=0.2)
    prompt = (
        f"用户需求：{state['user_input']}\n\n"
        f"任务类型：{task_type}\n\n"
        f"执行计划：{state.get('plan', '')}\n\n"
        f"知识库参考：{state.get('knowledge', '')}\n\n"
    )
    if state.get("test_result") and "❌" in state.get("test_result", ""):
        prompt += f"上一次评审反馈（请据此修改代码）：\n{state.get('test_result')}\n\n"
    if state.get("execution_result") and "exitcode:" in state.get("execution_result", ""):
        prompt += f"上一次执行结果（请据此修复代码）：\n{state.get('execution_result')}\n\n"
    prompt += "请编写代码实现上述需求。"

    response = llm.invoke(f"{system_prompt}\n\n{prompt}")
    code_or_draft = response.content if hasattr(response, "content") else str(response)

    return {
        "code_or_draft": code_or_draft,
        "fix_count": state.get("fix_count", 0),
        "task_type": task_type,
        "agent_messages": [{"role": "assistant", "content": code_or_draft, "name": "Coder"}],
        "speaking_log": [
            _log_speak("Retriever", "Coder"),
            _log_speak("Coder", "Executor"),
        ],
    }


def writer_node(state: WorkflowState) -> dict:
    from agents import create_llm, SYSTEM_PROMPTS

    llm = create_llm("Writer", temperature=0.4)
    prompt = (
        f"用户需求：{state['user_input']}\n\n"
        f"执行计划：{state.get('plan', '')}\n\n"
        f"参考资料：{state.get('knowledge', '')}\n\n"
    )
    if state.get("test_result") and "❌" in state.get("test_result", ""):
        prompt += f"上一次评审反馈（请据此修改文档）：\n{state.get('test_result')}\n\n"
    prompt += "请撰写满足需求的文档/报告。"

    response = llm.invoke(f"{SYSTEM_PROMPTS['Writer']}\n\n{prompt}")
    code_or_draft = response.content if hasattr(response, "content") else str(response)

    return {
        "code_or_draft": code_or_draft,
        "fix_count": state.get("fix_count", 0),
        "task_type": state.get("task_type", "写作"),
        "agent_messages": [{"role": "assistant", "content": code_or_draft, "name": "Writer"}],
        "speaking_log": [
            _log_speak("Retriever", "Writer"),
            _log_speak("Writer", "Tester"),
        ],
    }


def executor_node(state: WorkflowState) -> dict:
    from executor import CodeExecutor

    code_or_draft = state.get("code_or_draft", "")
    task_type = state.get("task_type", "编程")
    executor = CodeExecutor()

    code_blocks = re.findall(r"```(?:python)?\s*\n(.*?)```", code_or_draft, re.DOTALL)
    if not code_blocks:
        return {
            "execution_result": "（无代码需要执行）",
            "agent_messages": [],
            "speaking_log": [],
        }

    all_results = []
    overall_exitcode = 0
    for i, code in enumerate(code_blocks):
        code = code.strip()
        if len(code) < 10:
            continue
        result = executor.execute(code)
        result_text = (
            f"--- 代码块 {i + 1} ---\n"
            f"exitcode: {result['exitcode']}\n"
            f"stdout:\n{result['stdout']}\n"
            f"stderr:\n{result['stderr']}"
        )
        all_results.append(result_text)
        if result["exitcode"] != 0:
            overall_exitcode = result["exitcode"]

    combined = "\n\n".join(all_results) if all_results else "（无有效代码块执行）"

    # exitcode 驱动分支
    next_step = "Tester" if overall_exitcode == 0 else "Coder(修复)"

    # 如果没有任何代码执行成功且已超过修复次数，不再循环
    if overall_exitcode != 0 and state.get("fix_count", 0) >= _MAX_FIX_CYCLES:
        next_step = "Summarizer(强制结束)"

    return {
        "execution_result": combined,
        "agent_messages": [{"role": "assistant", "content": combined, "name": "Executor"}],
        "speaking_log": [
            _log_speak("Coder", "Executor"),
            _log_speak("Executor", next_step),
        ],
    }


def tester_node(state: WorkflowState) -> dict:
    from agents import create_llm, SYSTEM_PROMPTS

    llm = create_llm("Tester", temperature=0.2)
    exec_info = state.get("execution_result", "")
    code_or_draft = state.get("code_or_draft", "")
    task_type = state.get("task_type", "编程")

    prompt = f"用户原始需求：{state['user_input']}\n\n任务类型：{task_type}\n\n产出内容：\n{code_or_draft[:3000]}\n\n"
    if exec_info and "无代码" not in exec_info:
        prompt += f"执行结果：\n{exec_info}\n\n"
    prompt += "请评审上述产出是否满足用户原始需求。"

    response = llm.invoke(f"{SYSTEM_PROMPTS['Tester']}\n\n{prompt}")
    test_result = response.content if hasattr(response, "content") else str(response)

    new_fix_count = state.get("fix_count", 0)
    next_agent = "Summarizer"
    if "❌" in test_result:
        new_fix_count += 1
        next_agent = ("Coder" if task_type in ("编程", "分析") else "Writer") + (
            f"(第{new_fix_count}次修复)" if new_fix_count <= _MAX_FIX_CYCLES else "(强制结束)"
        )

    return {
        "test_result": test_result,
        "fix_count": new_fix_count,
        "task_type": task_type,
        "agent_messages": [{"role": "assistant", "content": test_result, "name": "Tester"}],
        "speaking_log": [
            _log_speak("Executor", "Tester"),
            _log_speak("Tester", next_agent),
        ],
    }


def summarizer_node(state: WorkflowState) -> dict:
    from agents import create_llm, SYSTEM_PROMPTS

    llm = create_llm("Summarizer")
    context_parts = [
        f"## 用户需求\n{state['user_input']}",
        f"## 任务类型\n{state.get('task_type', '')}",
        f"## 执行计划\n{state.get('plan', '')}",
        f"## 产出\n{state.get('code_or_draft', '')[:3000]}",
    ]
    exec_info = state.get("execution_result", "")
    if exec_info and "无代码" not in exec_info:
        context_parts.append(f"## 执行结果\n{exec_info}")
    context_parts.append(f"## 评审结果\n{state.get('test_result', '')}")

    prompt = (
        f"{SYSTEM_PROMPTS['Summarizer']}\n\n"
        "以下是一个多智能体协作过程的记录。请你据此生成一份结构化的执行报告，"
        "使用 Markdown 格式，包括：任务概述、执行步骤、关键产出、结论。\n\n" + "\n\n".join(context_parts)
    )
    response = llm.invoke(prompt)
    report = response.content if hasattr(response, "content") else str(response)
    if state.get("need_report", True):
        final_output = report
    else:
        final_output = state.get("code_or_draft", "")

    return {
        "final_output": final_output,
        "agent_messages": [{"role": "assistant", "content": report, "name": "Summarizer"}],
        "speaking_log": [
            _log_speak("Tester", "Summarizer"),
            _log_speak("Summarizer", "结束"),
        ],
    }


# ===== 图构建 =====
def build_workflow() -> StateGraph:
    wf = StateGraph(WorkflowState)

    wf.add_node("bot", bot_node)
    wf.add_node("planner", planner_node)
    wf.add_node("retriever", retriever_node)
    wf.add_node("coder", coder_node)
    wf.add_node("writer", writer_node)
    wf.add_node("executor", executor_node)
    wf.add_node("tester", tester_node)
    wf.add_node("summarizer", summarizer_node)

    wf.set_conditional_entry_point(_route_lane)

    # 快车道
    wf.add_edge("bot", END)

    # 慢车道
    wf.add_edge("planner", "retriever")
    wf.add_conditional_edges(
        "retriever",
        _route_task,
        {
            "coder": "coder",
            "writer": "writer",
        },
    )
    wf.add_edge("coder", "executor")
    wf.add_conditional_edges(
        "executor",
        _route_after_executor,
        {
            "tester": "tester",
            "summarizer": "summarizer",
        },
    )
    wf.add_edge("writer", "tester")
    wf.add_conditional_edges(
        "tester",
        _route_test,
        {"coder": "coder", "writer": "writer", "summarizer": "summarizer"},
    )
    wf.add_edge("summarizer", END)

    return wf.compile()
