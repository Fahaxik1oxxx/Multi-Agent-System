"""
LangGraph 工作流 —— 快/慢车道多 Agent 编排。
替换 groupchat.py 的 AG2 GroupChat 状态机。
"""

from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, END
import operator


# ===== 状态定义 =====
class WorkflowState(TypedDict):
    user_input: str
    lane_mode: str          # "fast" | "slow"
    task_type: str          # "coding" | "writing" (Planner 判断)
    plan: str
    knowledge: str
    code_or_draft: str
    execution_result: str
    test_result: str
    fix_count: int
    agent_messages: Annotated[list, operator.add]  # 使用 operator.add 拼接列表
    final_output: str


# ===== 条件路由函数 =====
def _route_lane(state: WorkflowState) -> str:
    return "bot" if state.get("lane_mode") == "fast" else "planner"


def _route_task(state: WorkflowState) -> str:
    return "coder" if state.get("task_type") == "coding" else "writer"


def _route_test(state: WorkflowState) -> str:
    if "✅" in state.get("test_result", ""):
        return "summarizer"
    if state.get("fix_count", 0) < 2:
        return "coder" if state.get("task_type") == "coding" else "writer"
    return "summarizer"


# ===== 节点函数（Task 6 中补全实现） =====

def bot_node(state: WorkflowState) -> dict:
    from agents import create_llm, SYSTEM_PROMPTS

    llm = create_llm("Bot", temperature=0.5)
    response = llm.invoke(
        f"{SYSTEM_PROMPTS['Bot']}\n\n用户输入: {state['user_input']}"
    )
    reply = response.content if hasattr(response, "content") else str(response)

    return {
        "final_output": reply,
        "agent_messages": [{"role": "assistant", "content": reply, "name": "Bot"}],
    }


import re


def planner_node(state: WorkflowState) -> dict:
    from agents import create_llm, SYSTEM_PROMPTS

    llm = create_llm("Planner")
    response = llm.invoke(
        f"{SYSTEM_PROMPTS['Planner']}\n\n用户需求: {state['user_input']}"
    )
    plan = response.content if hasattr(response, "content") else str(response)

    task_type = "writing"
    m = re.search(r"task_type:\s*(coding|writing)", plan, re.IGNORECASE)
    if m:
        task_type = m.group(1).lower()

    return {
        "plan": plan,
        "task_type": task_type,
        "fix_count": state.get("fix_count", 0),
        "agent_messages": [{"role": "assistant", "content": plan, "name": "Planner"}],
    }


def retriever_node(state: WorkflowState) -> dict:
    from agents import create_llm, SYSTEM_PROMPTS
    from tools import search_knowledge

    # 先执行检索
    kb_result = search_knowledge.invoke(state["user_input"])

    llm = create_llm("Retriever")
    prompt = (
        f"任务：{state['user_input']}\n"
        f"计划：{state.get('plan', '')}\n"
        f"知识库检索结果：{kb_result}\n\n"
        "请总结与任务最相关的信息。"
    )
    response = llm.invoke(f"{SYSTEM_PROMPTS['Retriever']}\n\n{prompt}")
    knowledge = response.content if hasattr(response, "content") else str(response)

    return {
        "knowledge": knowledge,
        "agent_messages": [{"role": "assistant", "content": knowledge, "name": "Retriever"}],
    }


def coder_node(state: WorkflowState) -> dict:
    from agents import create_llm, SYSTEM_PROMPTS

    llm = create_llm("Coder", temperature=0.2)
    prompt = (
        f"用户需求：{state['user_input']}\n\n"
        f"执行计划：{state.get('plan', '')}\n\n"
        f"知识库参考：{state.get('knowledge', '')}\n\n"
    )
    if state.get("test_result") and "❌" in state.get("test_result", ""):
        prompt += f"上一次评审反馈（请据此修改代码）：\n{state.get('test_result')}\n\n"
    prompt += "请编写代码实现上述需求。"

    response = llm.invoke(f"{SYSTEM_PROMPTS['Coder']}\n\n{prompt}")
    code_or_draft = response.content if hasattr(response, "content") else str(response)

    return {
        "code_or_draft": code_or_draft,
        "fix_count": state.get("fix_count", 0),
        "task_type": state.get("task_type", "coding"),
        "agent_messages": [{"role": "assistant", "content": code_or_draft, "name": "Coder"}],
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
        "task_type": state.get("task_type", "writing"),
        "agent_messages": [{"role": "assistant", "content": code_or_draft, "name": "Writer"}],
    }


def executor_node(state: WorkflowState) -> dict:
    from executor import CodeExecutor

    code_or_draft = state.get("code_or_draft", "")
    executor = CodeExecutor()

    code_blocks = re.findall(r"```(?:python)?\s*\n(.*?)```", code_or_draft, re.DOTALL)
    if not code_blocks:
        return {"execution_result": "（无代码需要执行）", "agent_messages": []}

    all_results = []
    for i, code in enumerate(code_blocks):
        code = code.strip()
        if len(code) < 10:
            continue
        result = executor.execute(code)
        result_text = (
            f"--- 代码块 {i+1} ---\n"
            f"exitcode: {result['exitcode']}\n"
            f"stdout:\n{result['stdout']}\n"
            f"stderr:\n{result['stderr']}"
        )
        all_results.append(result_text)

    combined = "\n\n".join(all_results) if all_results else "（无有效代码块执行）"
    return {
        "execution_result": combined,
        "agent_messages": [{"role": "assistant", "content": combined, "name": "Executor"}],
    }


def tester_node(state: WorkflowState) -> dict:
    from agents import create_llm, SYSTEM_PROMPTS

    llm = create_llm("Tester", temperature=0.2)
    exec_info = state.get("execution_result", "")
    code_or_draft = state.get("code_or_draft", "")

    prompt = (
        f"用户原始需求：{state['user_input']}\n\n"
        f"产出内容：\n{code_or_draft[:3000]}\n\n"
    )
    if exec_info and exec_info != "（无代码需要执行）":
        prompt += f"执行结果：\n{exec_info}\n\n"
    prompt += "请评审上述产出是否满足用户原始需求。"

    response = llm.invoke(f"{SYSTEM_PROMPTS['Tester']}\n\n{prompt}")
    test_result = response.content if hasattr(response, "content") else str(response)

    new_fix_count = state.get("fix_count", 0)
    if "❌" in test_result:
        new_fix_count += 1

    return {
        "test_result": test_result,
        "fix_count": new_fix_count,
        "task_type": state.get("task_type", "coding"),
        "agent_messages": [{"role": "assistant", "content": test_result, "name": "Tester"}],
    }


def summarizer_node(state: WorkflowState) -> dict:
    from agents import create_llm, SYSTEM_PROMPTS

    llm = create_llm("Summarizer")
    context_parts = [
        f"## 用户需求\n{state['user_input']}",
        f"## 执行计划\n{state.get('plan', '')}",
        f"## 产出\n{state.get('code_or_draft', '')[:3000]}",
    ]
    exec_info = state.get("execution_result", "")
    if exec_info and exec_info != "（无代码需要执行）":
        context_parts.append(f"## 执行结果\n{exec_info}")
    context_parts.append(f"## 评审结果\n{state.get('test_result', '')}")

    prompt = (
        f"{SYSTEM_PROMPTS['Summarizer']}\n\n"
        "以下是一个多智能体协作过程的记录。请你据此生成一份结构化的执行报告，"
        "使用 Markdown 格式，包括：任务概述、执行步骤、关键产出、结论。\n\n"
        + "\n\n".join(context_parts)
    )
    response = llm.invoke(prompt)
    final_output = response.content if hasattr(response, "content") else str(response)

    return {
        "final_output": final_output,
        "agent_messages": [{"role": "assistant", "content": final_output, "name": "Summarizer"}],
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

    wf.add_edge("bot", END)
    wf.add_edge("planner", "retriever")
    wf.add_conditional_edges("retriever", _route_task, {
        "coder": "coder",
        "writer": "writer",
    })
    wf.add_edge("coder", "executor")
    wf.add_edge("executor", "tester")
    wf.add_edge("writer", "tester")
    wf.add_conditional_edges("tester", _route_test, {
        "coder": "coder",
        "writer": "writer",
        "summarizer": "summarizer",
    })
    wf.add_edge("summarizer", END)

    return wf.compile()
