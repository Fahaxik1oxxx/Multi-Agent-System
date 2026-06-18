import os
os.environ["NO_PROXY"] = os.environ.get("NO_PROXY", "") + ",localhost,127.0.0.1"
os.environ["no_proxy"] = os.environ.get("no_proxy", "") + ",localhost,127.0.0.1"

from autogen import AssistantAgent, UserProxyAgent
from config import get_config

from tools import read_file, write_file, search_knowledge, calculate, analyze_data, visualize_data

# ====== 1. Planner（仅拆解任务，不分类） ======
planner = AssistantAgent(
    name="Planner",
    system_message=(
        "你是高级项目经理。根据用户需求制定详细的执行计划。\n"
        "用编号列表列出执行步骤，每步含：目标、技术/工具、预期输出。\n\n"
        "注意：执行环境仅支持 Python。如用户要求 C/Java/Rust 等语言，"
        "只规划到「编写代码片段」这一步，编译/运行由用户自行完成。"
    ),
    llm_config=get_config("Planner"),
)

# ====== 2. Bot（快车道：闲聊 / 问答 / 轻量编程） ======
bot = AssistantAgent(
    name="Bot",
    system_message=(
        "你是友好的 AI 助手。用简洁、自然的中文直接回答用户。\n"
        "闲聊时友善亲切；问答时准确清晰，不啰嗦。\n"
        "如果是简单的编程问题（如「Hello World」「怎么写冒泡排序」），"
        "直接给出代码片段和简要说明，不要说「我帮你规划」之类的话。\n"
        "绝对不要暴露任何内部角色名（Planner/Coder 等）。你就是普通助手。"
    ),
    llm_config=get_config("Bot"),
)

# ====== 3. Retriever（知识库检索） ======
retriever = AssistantAgent(
    name="Retriever",
    system_message=(
        "你是知识检索专家。你的**唯一职责**是从知识库中查找与任务相关的信息。\n"
        "使用 search_knowledge 工具查询知识库。\n\n"
        "铁律：\n"
        "- 你只能调用 search_knowledge，不得编写代码、不得写文件、不得做任何超出检索范围的事。\n"
        "- 如果搜索结果与当前任务完全不相关（比如用户要编程，返回的是论文内容），"
        "必须明确回复「知识库中无相关内容，请 Coder 使用自身知识完成任务」。\n"
        "- 如果找到相关信息，总结要点后交给下游角色处理。\n"
        "- 不要把检索结果原文全部贴出来——只贴最相关的 1-2 条摘要。"
    ),
    llm_config=get_config("Retriever"),
)

# ====== 4. Coder（代码编写） ======
coder = AssistantAgent(
    name="Coder",
    system_message=(
        "你是 Python 程序员（仅 Python）。你的核心职责是：**编写并执行代码**。\n\n"
        "1. 用 ```python ... ``` 代码块编写可直接执行的 Python 代码。\n"
        "2. 代码必须包含 print() 输出关键结果，用 assert 做验证。\n"
        "3. 如需要保存文件（图表/报告），使用 plt.savefig('xxx.png') 或 write_file 工具。\n"
        "4. 不要在代码块里写「建议」「如果」「可以」——给出确定的可执行代码。\n\n"
        "能力边界：你只能写 Python。如用户要 C/Java/Go 等语言，"
        "只提供代码片段 + 注释说明，末尾标注「需用户手动编译运行」。\n"
        "绝对不要假装 Python 能运行非 Python 代码。"
    ),
    llm_config=get_config("Coder"),
)

# ====== 5. Writer（报告 / 方案 / 文章写作） ======
writer = AssistantAgent(
    name="Writer",
    system_message=(
        "你是专业文档撰写专家。根据 Planner 的计划和 Retriever 提供的资料撰写内容。\n"
        "写作要求：结构清晰（标题/摘要/正文/结论）、语言专业、数据有据。\n"
        "使用 Markdown 格式输出，适当使用表格和列表。"
    ),
    llm_config=get_config("Writer"),
)

# ====== 6. Tester（通用评审） ======
tester = AssistantAgent(
    name="Tester",
    system_message=(
        "你是高级 QA 评审工程师。审查下游输出是否满足用户的原始需求。\n\n"
        "核心原则：以「用户最初要什么」为标准，不以外观/格式为转移。\n"
        "对于代码：审查逻辑正确性、边界条件、实际可运行。\n"
        "对于报告/文章：审查内容是否真正回答了用户的问题。\n\n"
        "如果发现偏离用户原始需求，回复以 '❌ 发现以下问题' 开头。\n"
        "如果完全满足用户要求，回复以 '✅ 评审全部通过' 开头。"
    ),
    llm_config=get_config("Tester"),
)

# ====== 7. Summarizer（汇总报告） ======
summarizer = AssistantAgent(
    name="Summarizer",
    system_message=(
        "你是技术文档专家。汇总整个执行过程，生成简洁报告。\n\n"
        "原则：输出长度与任务体量成正比。\n"
        "简单任务（HelloWorld/示例）→ 2-3 段即可，不要过度结构化。\n"
        "复杂任务（完整项目/数据分析）→ 可用节/表/代码块详细展开。\n"
        "报告包含：任务概述、关键产出、评审结论。使用 Markdown。"
    ),
    llm_config=get_config("Summarizer"),
)

# ====== 7. User（代码执行器） ======
user = UserProxyAgent(
    name="User",
    human_input_mode="NEVER",
    code_execution_config={
        "work_dir": "coding",
        "use_docker": False,
    },
)

# ====== 工具注册（按角色分派，防止越权） ======
from autogen import register_function

_all_agents = [planner, bot, retriever, coder, writer, tester, summarizer, user]

# 工具清单
_all_tool_fns = [read_file, write_file, search_knowledge, calculate, analyze_data, visualize_data]

# ── 角色 → 允许调用的工具 ──
# Retriever 只搜不写，避免弱模型 Qwen 拿 write_file 越权写代码
_role_tools = {
    retriever:  [search_knowledge],
    coder:      [write_file, read_file, calculate],
    tester:     [read_file],
    writer:     [write_file, read_file, search_knowledge],
}

_tool_descriptions = {
    read_file:       "读取 coding/ 工作区中的文件内容",
    write_file:      "写内容到 coding/ 工作区中的文件",
    search_knowledge: "从知识库中检索与查询相关的文档内容",
    calculate:       "执行安全的数学表达式计算，如 2+3*4",
    analyze_data:    "分析 CSV/Excel 文件：按分组列（group_by）汇总数值列（agg_col），返回降序结果",
    visualize_data:  "读取 CSV 绘制统计图表（柱状图/折线图），可用 group_by 分组汇总后绘图",
}

# 注册工具 schema 给各角色
for role, tools in _role_tools.items():
    for fn in tools:
        register_function(fn, caller=role, executor=user, description=_tool_descriptions[fn])

# 注册 _function_map 给所有 Agent（含 User/Manager，确保执行链路完整）
for agent in _all_agents:
    for fn in _all_tool_fns:
        agent._function_map[fn.__name__] = fn
