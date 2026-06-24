# Multi-Agent 系统重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 AG2 GroupChat 多智能体系统迁移至 LangGraph + LangChain 技术栈，同时增加 Tesseract OCR、快慢车道手动切换、启动优化和 UI 美化。

**Architecture:** LangGraph StateGraph 编排 7 个 LangChain Agent 的工作流，Streamlit 负责 UI 和 streaming 渲染。快车道 Bot 直接回复，慢车道走 Planner→Retriever→Coder/Writer→Executor→Tester→Summarizer 流水线。

**Tech Stack:** Streamlit >=1.35, LangGraph, LangChain (langchain-deepseek, langchain-core, langchain-community, langchain-huggingface, langchain-text-splitters), ChromaDB >=1.5, Sentence-Transformers >=3.0, Pillow >=10, pytesseract >=0.3.10, pandas >=2.0

## Global Constraints

- Python 仅支持 Python 代码执行（非 Python 语言由 Bot 告知用户自行处理）
- Tester 最多 2 轮修复循环
- 代码执行超时 60s
- 快慢车道由用户在侧边栏手动选择（`st.session_state.lane_mode`），不再自动分类
- 配色方案：深蓝 `#1a1f36`（侧边栏）、科技蓝 `#4f8cff`（强调）、翠绿 `#10b981`（成功）、琥珀 `#f59e0b`（处理中）、珊瑚 `#ef4444`（错误）、浅灰 `#f8f9fc`（背景）、纯白 `#ffffff`（卡片）

---

### Task 1: 新建 requirements.txt 并安装新依赖

**Files:**
- Modify: `requirements.txt`

**Interfaces:**
- Consumes: 无
- Produces: 安装好的 Python 依赖环境

- [ ] **Step 1: 更新 requirements.txt**

用以下内容覆盖 `requirements.txt`：

```txt
# 多智能体协作系统依赖

streamlit>=1.35
pandas>=2.0
langgraph>=0.2
langchain>=0.3
langchain-deepseek>=0.1
langchain-community>=0.4
langchain-huggingface>=1.0
langchain-text-splitters>=1.1
chromadb>=1.5
sentence-transformers>=3.0
pypdf>=6.0
Pillow>=10
pytesseract>=0.3.10
```

- [ ] **Step 2: 安装依赖**

```bash
pip install -r requirements.txt
```

- [ ] **Step 3: 验证关键包可导入**

```bash
python -c "import langgraph; import langchain; import langchain_deepseek; print('OK')"
```

预期输出: `OK`

- [ ] **Step 4: 验证 Tesseract 可用**

```bash
python -c "import pytesseract; from PIL import Image; print('Tesseract+Pillow OK')"
```

预期输出: `Tesseract+Pillow OK`

> ⚠️ 如果 `pytesseract` 报错 "tesseract is not installed"，需先安装 Tesseract-OCR 引擎：https://github.com/UB-Mannheim/tesseract/wiki，安装时勾选中文语言包。

- [ ] **Step 5: Commit**

```bash
git add requirements.txt
git commit -m "deps: 替换 ag2 为 langgraph/langchain，添加 pytesseract

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 新建 executor.py — 代码执行沙箱

**Files:**
- Create: `executor.py`

**Interfaces:**
- Consumes: 无
- Produces: `class CodeExecutor` with method `execute(self, code: str) -> dict`

- [ ] **Step 1: 创建 executor.py**

```python
"""
安全代码执行沙箱 —— 替代 AG2 UserProxyAgent。
在 coding/ 目录下用 subprocess 隔离执行 Python 代码。
"""

import subprocess
import uuid
import os

_PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.join(_PROJECT_DIR, "coding")


class CodeExecutor:
    """安全代码执行沙箱"""

    TIMEOUT = 60  # 秒

    def execute(self, code: str) -> dict:
        """
        1. 写入 coding/tmp_{uuid}.py
        2. subprocess.run 执行
        3. 清理临时文件
        返回 {"stdout": str, "stderr": str, "exitcode": int}
        """
        os.makedirs(WORKSPACE, exist_ok=True)

        file_id = str(uuid.uuid4())[:8]
        filepath = os.path.join(WORKSPACE, f"tmp_{file_id}.py")

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(code)

        try:
            result = subprocess.run(
                ["python", filepath],
                capture_output=True, text=True,
                timeout=self.TIMEOUT, cwd=WORKSPACE,
            )
            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "exitcode": result.returncode,
            }
        except subprocess.TimeoutExpired:
            return {"stdout": "", "stderr": "执行超时 (>60s)", "exitcode": 1}
        finally:
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except OSError:
                    pass
```

- [ ] **Step 2: 验证 executor.py 可独立运行**

```bash
python -c "from executor import CodeExecutor; e=CodeExecutor(); r=e.execute('print(1+1)'); assert r['exitcode']==0; assert '2' in r['stdout']; print('executor OK')"
```

预期输出: `executor OK`

- [ ] **Step 3: Commit**

```bash
git add executor.py
git commit -m "feat: 新建 executor.py 代码执行沙箱

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 新建 workflow.py — LangGraph 工作流

**Files:**
- Create: `workflow.py`

**Interfaces:**
- Consumes: 来自 Task 4 的 `agents.py` (`create_llm`, `SYSTEM_PROMPTS`), 来自 Task 2 的 `executor.CodeExecutor`
- Produces: `build_workflow() -> CompiledStateGraph`, `WorkflowState` TypedDict

**注意:** 此 Task 创建基础框架，节点实现在 Task 6 中补全（因为节点需要 Task 4 的 Agent 和 Task 5 的 Tool）。

- [ ] **Step 1: 创建 workflow.py 基础框架**

```python
"""
LangGraph 工作流 —— 快/慢车道多 Agent 编排。
替换 groupchat.py 的 AG2 GroupChat 状态机。
"""

from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages


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
    messages: Annotated[list, add_messages]
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


# ===== 节点函数占位（Task 6 中补全） =====
def bot_node(state: WorkflowState) -> dict:
    ...

def planner_node(state: WorkflowState) -> dict:
    ...

def retriever_node(state: WorkflowState) -> dict:
    ...

def coder_node(state: WorkflowState) -> dict:
    ...

def writer_node(state: WorkflowState) -> dict:
    ...

def executor_node(state: WorkflowState) -> dict:
    ...

def tester_node(state: WorkflowState) -> dict:
    ...

def summarizer_node(state: WorkflowState) -> dict:
    ...


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
```

- [ ] **Step 2: 验证 workflow.py 语法正确**

```bash
python -c "import ast; ast.parse(open('workflow.py').read()); print('syntax OK')"
```

预期输出: `syntax OK`

- [ ] **Step 3: Commit**

```bash
git add workflow.py
git commit -m "feat: 新建 workflow.py LangGraph 工作流框架

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 重写 agents.py — LangChain Agent 定义

**Files:**
- Modify: `agents.py` (全量重写)

**Interfaces:**
- Consumes: `config.get_config`
- Produces: `create_llm(role: str, temperature: float) -> ChatDeepSeek`, `SYSTEM_PROMPTS: dict[str, str]`, `TOOL_ASSIGNMENTS: dict[str, list[str]]`

- [ ] **Step 1: 重写 agents.py**

```python
"""
Agent 定义 —— 基于 LangChain create_agent。
7 个角色：Planner, Bot, Retriever, Coder, Writer, Tester, Summarizer。
"""

import os
os.environ["NO_PROXY"] = os.environ.get("NO_PROXY", "") + ",localhost,127.0.0.1"
os.environ["no_proxy"] = os.environ.get("no_proxy", "") + ",localhost,127.0.0.1"

from langchain_deepseek import ChatDeepSeek
from config import get_config


def create_llm(role: str, temperature: float = 0.3):
    """创建指定角色使用的 LLM 实例"""
    cfg = get_config(role)["config_list"][0]
    return ChatDeepSeek(
        model=cfg["model"],
        api_key=cfg["api_key"],
        api_base=cfg["base_url"],
        temperature=temperature,
    )


# ===== System Prompts =====
SYSTEM_PROMPTS = {
    "Planner": (
        "你是高级项目经理。根据用户需求制定详细的执行计划。\n"
        "用编号列表列出执行步骤，每步含：目标、技术/工具、预期输出。\n"
        "最后一行必须是 'task_type: coding' 或 'task_type: writing'，表示任务类型。\n\n"
        "注意：执行环境仅支持 Python。如用户要求 C/Java/Rust 等语言，"
        "只规划到「编写代码片段」这一步，编译/运行由用户自行完成，task_type 标为 coding。"
    ),
    "Bot": (
        "你是友好的 AI 助手。用简洁、自然的中文直接回答用户。\n"
        "闲聊时友善亲切；问答时准确清晰，不啰嗦。\n"
        "如果是简单的编程问题（如「Hello World」「怎么写冒泡排序」），"
        "直接给出代码片段和简要说明，不要说「我帮你规划」之类的话。\n"
        "绝对不要暴露任何内部角色名（Planner/Coder 等）。你就是普通助手。"
    ),
    "Retriever": (
        "你是知识检索专家。你的**唯一职责**是从知识库中查找与任务相关的信息。\n"
        "使用 search_knowledge 工具查询知识库。\n\n"
        "铁律：\n"
        "- 你只能调用 search_knowledge，不得编写代码、不得写文件。\n"
        "- 如果搜索结果与当前任务完全不相关，"
        "必须明确回复「知识库中无相关内容，请使用自身知识完成任务」。\n"
        "- 如果找到相关信息，总结要点后交给下游角色处理。\n"
        "- 不要把检索结果原文全部贴出来——只贴最相关的 1-2 条摘要。"
    ),
    "Coder": (
        "你是 Python 程序员（仅 Python）。你的核心职责是：**编写并执行代码**。\n\n"
        "1. 用 ```python ... ``` 代码块编写可直接执行的 Python 代码。\n"
        "2. 代码必须包含 print() 输出关键结果，用 assert 做验证。\n"
        "3. 如需要保存文件（图表/报告），使用 write_file 工具。\n"
        "4. 不要在代码块里写「建议」「如果」「可以」——给出确定的可执行代码。\n\n"
        "能力边界：你只能写 Python。如用户要 C/Java/Go 等语言，"
        "只提供代码片段 + 注释说明，末尾标注「需用户手动编译运行」。"
    ),
    "Writer": (
        "你是专业文档撰写专家。根据 Planner 的计划和 Retriever 提供的资料撰写内容。\n"
        "写作要求：结构清晰（标题/摘要/正文/结论）、语言专业、数据有据。\n"
        "使用 Markdown 格式输出，适当使用表格和列表。"
    ),
    "Tester": (
        "你是高级 QA 评审工程师。审查下游输出是否满足用户的原始需求。\n\n"
        "核心原则：以「用户最初要什么」为标准，不以外观/格式为转移。\n"
        "对于代码：审查逻辑正确性、边界条件、实际可运行。\n"
        "对于报告/文章：审查内容是否真正回答了用户的问题。\n\n"
        "如果发现偏离用户原始需求，回复以 '❌ 发现以下问题' 开头。\n"
        "如果完全满足用户要求，回复以 '✅ 评审全部通过' 开头。"
    ),
    "Summarizer": (
        "你是技术文档专家。汇总整个执行过程，生成简洁报告。\n\n"
        "原则：输出长度与任务体量成正比。\n"
        "简单任务（HelloWorld/示例）→ 2-3 段即可，不要过度结构化。\n"
        "复杂任务（完整项目/数据分析）→ 可用节/表/代码块详细展开。\n"
        "报告包含：任务概述、关键产出、评审结论。使用 Markdown。"
    ),
}


# ===== 工具分配表（工具名列表，Task 5 中定义实际工具） =====
TOOL_ASSIGNMENTS = {
    "Planner":    [],
    "Bot":        [],
    "Retriever":  ["search_knowledge"],
    "Coder":      ["write_file", "read_file", "calculate"],
    "Writer":     ["write_file", "read_file", "search_knowledge"],
    "Tester":     ["read_file"],
    "Summarizer": [],
}
```

- [ ] **Step 2: 验证 agents.py 语法正确**

```bash
python -c "import ast; ast.parse(open('agents.py').read()); print('syntax OK')"
```

预期输出: `syntax OK`

- [ ] **Step 3: 验证 create_llm 可调用**

```bash
python -c "from agents import create_llm; llm=create_llm('Planner'); print(type(llm).__name__)"
```

预期输出: `ChatDeepSeek`

- [ ] **Step 4: Commit**

```bash
git add agents.py
git commit -m "refactor: 重写 agents.py 为 LangChain 格式

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 重写 tools.py — LangChain Tool 格式

**Files:**
- Modify: `tools.py` (全量重写，保留核心逻辑)

**Interfaces:**
- Consumes: `rag.knowledge_base.search`, `executor.CodeExecutor`
- Produces: `ALL_TOOLS: dict[str, BaseTool]` — `search_knowledge`, `read_file`, `write_file`, `calculate`, `analyze_data`, `visualize_data`, `ocr_image`

- [ ] **Step 1: 重写 tools.py**

```python
"""
工具系统 —— 基于 LangChain @tool 装饰器。
所有工具返回字符串，供 Agent 调用。
"""

import os
os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

from langchain.tools import tool

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
WORK_DIR = os.path.join(PROJECT_DIR, "coding")


def _resolve_path(path: str) -> str:
    if path.startswith("coding/"):
        return os.path.join(PROJECT_DIR, path)
    return os.path.join(WORK_DIR, path)


# ===== 文件读写 =====

@tool
def read_file(path: str) -> str:
    """读取 coding/ 目录下的文件内容。参数 path: 文件路径（如 'output.py' 或 'coding/output.py'）"""
    full_path = _resolve_path(path)
    if not os.path.exists(full_path):
        return f"[错误] 文件 {path} 不存在"
    with open(full_path, "r", encoding="utf-8") as f:
        return f.read()


@tool
def write_file(path: str, content: str) -> str:
    """将内容写入 coding/ 目录的文件。参数 path: 文件路径, content: 要写入的内容"""
    full_path = _resolve_path(path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, "w", encoding="utf-8") as f:
        f.write(content)
    return f"[成功] 已写入 {path}"


# ===== 知识库检索 =====

@tool
def search_knowledge(query: str) -> str:
    """在知识库中搜索相关文档。输入查询字符串，返回相关文本片段（最多3条）。"""
    try:
        from rag.knowledge_base import search
        results = search(query)
        if not results:
            return "知识库中未找到相关信息，请使用自身知识完成任务。"
        filtered = [r for r in results if len(r.strip()) > 50]
        if not filtered:
            return "知识库中未找到相关信息，请使用自身知识完成任务。"
        return "\n\n---\n\n".join(filtered[:3])
    except Exception as e:
        return f"[检索失败] {e}"


# ===== 计算器 =====

@tool
def calculate(expression: str) -> str:
    """安全计算数学表达式。支持 +, -, *, /, **, %, 以及 abs/round/min/max/pow/int/float。参数 expression: 数学表达式字符串，如 '2+3*4'"""
    import ast
    import operator as _op

    _SAFE_BUILTINS = {"abs": abs, "round": round, "min": min, "max": max,
                      "pow": pow, "int": int, "float": float, "len": len}
    _SAFE_OPS = {
        ast.Add: _op.add, ast.Sub: _op.sub, ast.Mult: _op.mul,
        ast.Div: _op.truediv, ast.FloorDiv: _op.floordiv,
        ast.Mod: _op.mod, ast.Pow: _op.pow, ast.USub: _op.neg,
    }

    def _eval(node):
        if isinstance(node, ast.Expression):
            return _eval(node.body)
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.BinOp):
            op = _SAFE_OPS.get(type(node.op))
            if op is None:
                raise ValueError(f"不支持的操作符: {type(node.op).__name__}")
            return op(_eval(node.left), _eval(node.right))
        if isinstance(node, ast.UnaryOp):
            op = _SAFE_OPS.get(type(node.op))
            if op is None:
                raise ValueError(f"不支持的操作符: {type(node.op).__name__}")
            return op(_eval(node.operand))
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id in _SAFE_BUILTINS:
                args = [_eval(a) for a in node.args]
                return _SAFE_BUILTINS[node.func.id](*args)
            raise ValueError("仅支持内置函数: abs, round, min, max, pow, int, float, len")
        raise ValueError(f"不支持的表达式类型: {type(node).__name__}")

    try:
        tree = ast.parse(expression.strip(), mode="eval")
        result = _eval(tree)
        return str(result)
    except Exception as e:
        return f"[计算错误] {e}"


# ===== 数据分析 =====

@tool
def analyze_data(path: str, group_by: str = "", agg_col: str = "") -> str:
    """分析 CSV/Excel 文件：按指定列分组求和，返回降序结果。
    参数 path: 文件路径, group_by: 分组列名（留空自动选）, agg_col: 汇总列名（留空自动选）"""
    full_path = _resolve_path(path)
    if not os.path.exists(full_path):
        return f"[错误] 文件 {path} 不存在"
    try:
        import pandas as pd
    except ImportError:
        return "[错误] pandas 未安装，请执行 pip install pandas"
    try:
        if path.endswith(".csv"):
            df = pd.read_csv(full_path)
        elif path.endswith((".xlsx", ".xls")):
            df = pd.read_excel(full_path)
        else:
            return "[错误] 仅支持 .csv / .xlsx / .xls 文件"

        col_info = f"列名: {list(df.columns)}（共 {len(df)} 行）\n"
        num_cols = df.select_dtypes(include=["number"]).columns.tolist()
        obj_cols = df.select_dtypes(exclude=["number"]).columns.tolist()
        gb = group_by if group_by in df.columns else (obj_cols[0] if obj_cols else "")
        ac = agg_col if agg_col in df.columns else (num_cols[0] if num_cols else "")

        if not gb or not ac:
            return col_info + "[提示] 未能自动识别分组列和数值列，请指定 group_by 和 agg_col 参数"

        result = df.groupby(gb)[ac].sum().sort_values(ascending=False)
        lines = [f"{k}: {v}" for k, v in result.items()]
        return col_info + "\n".join(lines[:50])
    except Exception as e:
        return f"[分析错误] {e}"


# ===== 数据可视化 (Pillow) =====

@tool
def visualize_data(path: str, chart_type: str = "bar", save_as: str = "chart.png",
                   group_by: str = "", agg_col: str = "") -> str:
    """读取 CSV 用 Pillow 绘制统计图表（柱状图/折线图）并保存。
    参数 path: CSV 文件路径, chart_type: 'bar'或'line', save_as: 输出文件名,
    group_by: 分组列名（留空自动选）, agg_col: 汇总列名（留空自动选）"""
    full_path = _resolve_path(path)
    if not os.path.exists(full_path):
        return f"[错误] 文件 {path} 不存在"

    try:
        import pandas as pd
    except ImportError:
        return "[错误] pandas 未安装"
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return "[错误] Pillow 未安装，请执行 pip install Pillow"

    _FONT_PATHS = [
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc",
    ]
    _cjk_font = None
    _title_font = None
    for fp in _FONT_PATHS:
        if os.path.exists(fp):
            try:
                _cjk_font = ImageFont.truetype(fp, 14)
                _title_font = ImageFont.truetype(fp, 22)
                break
            except Exception:
                continue

    try:
        df = pd.read_csv(full_path)
    except Exception as e:
        return f"[错误] 无法读取 CSV: {e}"

    if group_by and group_by in df.columns and agg_col and agg_col in df.columns:
        df = df.groupby(group_by, as_index=False)[agg_col].sum().sort_values(agg_col, ascending=False)

    num_cols = df.select_dtypes(include=["number"]).columns
    obj_cols = df.select_dtypes(exclude=["number"]).columns
    if len(obj_cols) == 0 or len(num_cols) == 0:
        return "[错误] CSV 需至少包含一列文本和一列数值"

    label_col = obj_cols[0]
    val_col = num_cols[0]
    labels = df[label_col].astype(str).tolist()
    values = df[val_col].tolist()
    max_val = max(values) if values else 1
    n = len(labels)

    W, H = 800, 500
    ML, MR, MT, MB = 80, 40, 60, 80
    CW, CH = W - ML - MR, H - MT - MB

    img = Image.new("RGB", (W, H), (255, 255, 255))
    draw = ImageDraw.Draw(img)

    title = f"{label_col} × {val_col}" if group_by else f"{label_col} 汇总"
    if _title_font:
        draw.text((ML, 10), title, fill=(30, 30, 30), font=_title_font)

    if chart_type == "line":
        draw.line([ML, MT, ML, H - MB], fill="black", width=2)
        draw.line([ML, H - MB, W - MR, H - MB], fill="black", width=2)
        for i in range(6):
            y_val = max_val * i / 5
            y = H - MB - int(CH * i / 5)
            draw.line([ML - 5, y, ML, y], fill="black")
            if _cjk_font:
                draw.text((5, y - 8), f"{y_val:.0f}", fill="black", font=_cjk_font)
        pts = []
        for i, (label, val) in enumerate(zip(labels, values)):
            x = ML + i * CW // (n - 1) if n > 1 else ML + CW // 2
            y = H - MB - int((val / max_val) * CH)
            pts.append((x, y))
            draw.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(66, 133, 244))
            if _cjk_font:
                draw.text((x - 12, H - MB + 5), label[:6], fill="black", font=_cjk_font)
        for i in range(1, len(pts)):
            draw.line([pts[i - 1], pts[i]], fill=(66, 133, 244), width=3)
    else:
        step = CW // n if n > 0 else CW
        bar_w = min(step // 3, 36)
        draw.line([ML, MT, ML, H - MB], fill="black", width=2)
        draw.line([ML, H - MB, W - MR, H - MB], fill="black", width=2)
        for i in range(6):
            y_val = max_val * i / 5
            y = H - MB - int(CH * i / 5)
            draw.line([ML - 5, y, ML, y], fill="black")
            if _cjk_font:
                draw.text((5, y - 8), f"{y_val:.0f}", fill="black", font=_cjk_font)
        for i, (label, val) in enumerate(zip(labels, values)):
            x_c = ML + i * step + step // 2
            bh = int((val / max_val) * CH)
            x0, y0 = x_c - bar_w // 2, H - MB - bh
            x1, y1 = x_c + bar_w // 2, H - MB
            draw.rectangle([x0, y0, x1, y1], fill=(66, 133, 244), outline=(40, 100, 200))
            if _cjk_font:
                draw.text((x_c - 10, H - MB + 5), label[:6], fill="black", font=_cjk_font)

    full_save = os.path.join(WORK_DIR, save_as)
    img.save(full_save)
    return f"[成功] 图表已保存至 {save_as}（{len(labels)} 条{chart_type}图）"


# ===== OCR (Tesseract) ★新增 =====

@tool
def ocr_image(image_path: str, language: str = "chi_sim+eng") -> str:
    """从图片中提取文字（OCR）。支持中英文混合识别。
    参数 image_path: 图片文件路径（PNG/JPG等）, language: OCR语言代码（默认 chi_sim+eng）"""
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return "[错误] pytesseract 或 Pillow 未安装"

    full_path = _resolve_path(image_path)
    if not os.path.exists(full_path):
        return f"[错误] 图片 {image_path} 不存在"

    try:
        img = Image.open(full_path)
        text = pytesseract.image_to_string(img, lang=language)
        return text.strip() or "[提示] 图片中未识别到文字"
    except Exception as e:
        return f"[OCR错误] {e}"


# ===== 工具字典（供 workflow.py 使用） =====

ALL_TOOLS = {
    "read_file": read_file,
    "write_file": write_file,
    "search_knowledge": search_knowledge,
    "calculate": calculate,
    "analyze_data": analyze_data,
    "visualize_data": visualize_data,
    "ocr_image": ocr_image,
}
```

- [ ] **Step 2: 验证 tools.py 语法正确**

```bash
python -c "import ast; ast.parse(open('tools.py').read()); print('syntax OK')"
```

预期输出: `syntax OK`

- [ ] **Step 3: 快测核心工具**

```bash
python -c "from tools import calculate, ALL_TOOLS; assert '3' in calculate.invoke('1+2'); assert len(ALL_TOOLS)==7; print('tools OK')"
```

预期输出: `tools OK`

- [ ] **Step 4: Commit**

```bash
git add tools.py
git commit -m "refactor: 重写 tools.py 为 LangChain Tool 格式，新增 ocr_image

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 补全 workflow.py 节点实现 + 集成 Agent/Tool

**Files:**
- Modify: `workflow.py` (补全节点函数)

**Interfaces:**
- Consumes: `agents.create_llm`, `agents.SYSTEM_PROMPTS`, `agents.TOOL_ASSIGNMENTS`, `tools.ALL_TOOLS`, `executor.CodeExecutor`
- Produces: 完整的 `build_workflow() -> CompiledStateGraph`

- [ ] **Step 1: 补全 workflow.py 节点实现**

替换 Task 3 中所有 `...` 占位节点为以下实现。在 `workflow.py` 中，在 `from langgraph.graph import StateGraph, END` 之后插入：

```python
import re
from langchain.agents import create_agent
from agents import create_llm, SYSTEM_PROMPTS, TOOL_ASSIGNMENTS
from tools import ALL_TOOLS
from executor import CodeExecutor

_executor = CodeExecutor()


def _get_agent(role: str, temperature: float = 0.3):
    """按角色创建 LangChain Agent（带工具）"""
    llm = create_llm(role, temperature)
    tool_names = TOOL_ASSIGNMENTS.get(role, [])
    tools = [ALL_TOOLS[name] for name in tool_names if name in ALL_TOOLS]
    system_prompt = SYSTEM_PROMPTS.get(role, "")
    if tools:
        return create_agent(llm, tools, system_prompt=system_prompt)
    else:
        return create_agent(llm, [], system_prompt=system_prompt)


def _invoke_agent(agent, prompt: str) -> str:
    """调用 Agent 并返回文本输出"""
    result = agent.invoke({"messages": [{"role": "user", "content": prompt}]})
    msgs = result.get("messages", [])
    if msgs:
        last = msgs[-1]
        if hasattr(last, "content"):
            return last.content
        return str(last)
    return "（空回复）"


# ===== 节点实现 =====

def bot_node(state: WorkflowState) -> dict:
    agent = _get_agent("Bot", temperature=0.5)
    reply = _invoke_agent(agent, state["user_input"])
    return {
        "final_output": reply,
        "messages": [{"role": "assistant", "content": reply, "name": "Bot"}],
    }


def planner_node(state: WorkflowState) -> dict:
    agent = _get_agent("Planner")
    plan = _invoke_agent(agent, state["user_input"])

    # 提取 task_type
    task_type = "writing"  # 默认
    m = re.search(r"task_type:\s*(coding|writing)", plan, re.IGNORECASE)
    if m:
        task_type = m.group(1).lower()

    return {
        "plan": plan,
        "task_type": task_type,
        "fix_count": state.get("fix_count", 0),
        "messages": [{"role": "assistant", "content": plan, "name": "Planner"}],
    }


def retriever_node(state: WorkflowState) -> dict:
    agent = _get_agent("Retriever")
    prompt = f"任务：{state['user_input']}\n\n计划：{state.get('plan', '')}\n\n请在知识库中搜索相关信息。"
    knowledge = _invoke_agent(agent, prompt)
    return {
        "knowledge": knowledge,
        "messages": [{"role": "assistant", "content": knowledge, "name": "Retriever"}],
    }


def coder_node(state: WorkflowState) -> dict:
    agent = _get_agent("Coder", temperature=0.2)
    prompt = (
        f"用户需求：{state['user_input']}\n\n"
        f"执行计划：{state.get('plan', '')}\n\n"
        f"知识库参考：{state.get('knowledge', '')}\n\n"
    )
    # 如果 Tester 给出了修改建议，追加到 prompt
    if state.get("test_result") and "❌" in state.get("test_result", ""):
        prompt += f"上一次评审反馈（请据此修改代码）：\n{state.get('test_result')}\n\n"

    prompt += "请编写代码实现上述需求。"
    code_or_draft = _invoke_agent(agent, prompt)
    return {
        "code_or_draft": code_or_draft,
        "fix_count": state.get("fix_count", 0),
        "task_type": state.get("task_type", "coding"),
        "messages": [{"role": "assistant", "content": code_or_draft, "name": "Coder"}],
    }


def writer_node(state: WorkflowState) -> dict:
    agent = _get_agent("Writer", temperature=0.4)
    prompt = (
        f"用户需求：{state['user_input']}\n\n"
        f"执行计划：{state.get('plan', '')}\n\n"
        f"参考资料：{state.get('knowledge', '')}\n\n"
    )
    if state.get("test_result") and "❌" in state.get("test_result", ""):
        prompt += f"上一次评审反馈（请据此修改文档）：\n{state.get('test_result')}\n\n"

    prompt += "请撰写满足需求的文档/报告。"
    code_or_draft = _invoke_agent(agent, prompt)
    return {
        "code_or_draft": code_or_draft,
        "fix_count": state.get("fix_count", 0),
        "task_type": state.get("task_type", "writing"),
        "messages": [{"role": "assistant", "content": code_or_draft, "name": "Writer"}],
    }


def executor_node(state: WorkflowState) -> dict:
    code_or_draft = state.get("code_or_draft", "")

    # 提取代码块
    code_blocks = re.findall(r"```(?:python)?\s*\n(.*?)```", code_or_draft, re.DOTALL)
    if not code_blocks:
        return {
            "execution_result": "（无代码需要执行）",
            "messages": [],
        }

    all_results = []
    for i, code in enumerate(code_blocks):
        code = code.strip()
        if len(code) < 10:
            continue
        result = _executor.execute(code)
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
        "messages": [{"role": "assistant", "content": combined, "name": "Executor"}],
    }


def tester_node(state: WorkflowState) -> dict:
    agent = _get_agent("Tester", temperature=0.2)
    exec_info = state.get("execution_result", "")
    code_or_draft = state.get("code_or_draft", "")

    prompt = (
        f"用户原始需求：{state['user_input']}\n\n"
        f"产出内容：\n{code_or_draft[:3000]}\n\n"
    )
    if exec_info and exec_info != "（无代码需要执行）":
        prompt += f"执行结果：\n{exec_info}\n\n"

    prompt += "请评审上述产出是否满足用户原始需求。"
    test_result = _invoke_agent(agent, prompt)

    # 判断是否不通过
    new_fix_count = state.get("fix_count", 0)
    if "❌" in test_result:
        new_fix_count += 1

    return {
        "test_result": test_result,
        "fix_count": new_fix_count,
        "task_type": state.get("task_type", "coding"),
        "messages": [{"role": "assistant", "content": test_result, "name": "Tester"}],
    }


def summarizer_node(state: WorkflowState) -> dict:
    agent = _get_agent("Summarizer")
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
        "以下是多智能体协作过程记录。请生成结构化执行报告（Markdown 格式），"
        "包括：任务概述、执行步骤、关键产出、评审结论。\n\n"
        + "\n\n".join(context_parts)
    )
    final_output = _invoke_agent(agent, prompt)

    return {
        "final_output": final_output,
        "messages": [{"role": "assistant", "content": final_output, "name": "Summarizer"}],
    }
```

- [ ] **Step 2: 验证 workflow.py 完整可导入**

```bash
python -c "from workflow import build_workflow; wf=build_workflow(); print(type(wf).__name__)"
```

预期输出: `CompiledStateGraph`

- [ ] **Step 3: 测试快车道（仅调用 bot_node）**

```bash
python -c "
from workflow import build_workflow
wf = build_workflow()
result = wf.invoke({'user_input': '你好', 'lane_mode': 'fast', 'task_type': 'coding', 'fix_count': 0})
assert result.get('final_output'), 'Bot 应有回复'
print('快车道 OK:', result['final_output'][:80])
"
```

预期: 输出 Bot 的回复文字

- [ ] **Step 4: 测试慢车道（完整流水线）**

```bash
python -c "
from workflow import build_workflow
wf = build_workflow()
result = wf.invoke({
    'user_input': '写一个Python函数计算斐波那契数列',
    'lane_mode': 'slow',
    'task_type': 'coding',
    'fix_count': 0,
})
print('慢车道 OK')
print('Plan length:', len(result.get('plan', '')))
print('Final output:', result.get('final_output', '')[:120])
"
```

预期: 走完整个 Planner→Retriever→Coder→Executor→Tester→Summarizer 流水线

- [ ] **Step 5: Commit**

```bash
git add workflow.py
git commit -m "feat: 补全 workflow.py 节点实现，集成 LangChain Agent 和 Tool

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 重写 app/chat.py — 适配 LangGraph

**Files:**
- Modify: `app/chat.py` (全量重写)

**Interfaces:**
- Consumes: `workflow.build_workflow`, `app.components.render_agent_card`
- Produces: `run_chat_pipeline(user_input, history, lane_mode) -> dict`

- [ ] **Step 1: 重写 app/chat.py**

```python
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

    # 构建上下文消息
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

    # 提取 thinking（非空消息）
    raw_messages = result.get("messages", [])
    thinking = [
        {"name": m.get("name", m.get("role", "")), "content": m.get("content", "")}
        for m in raw_messages
        if m.get("content")
    ]

    # 提取 task_type
    task_type = result.get("task_type", "coding")
    task_type_label = {"coding": "编程", "writing": "写作"}.get(task_type, task_type)

    # 扫描文件
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
```

- [ ] **Step 2: 验证 app/chat.py 可导入**

```bash
python -c "from app.chat import run_chat_pipeline; print('chat OK')"
```

预期输出: `chat OK`

- [ ] **Step 3: 端到端测试——快车道**

```bash
python -c "
from app.chat import run_chat_pipeline
result = run_chat_pipeline('你好，介绍一下你自己', lane_mode='fast')
print('Reply:', result['reply'][:100])
print('Task type:', result['task_type'])
print('Thinking count:', len(result['thinking']))
"
```

预期: 有 Bot 回复，thinking 包含 Bot 消息

- [ ] **Step 4: 端到端测试——慢车道**

```bash
python -c "
from app.chat import run_chat_pipeline
result = run_chat_pipeline('写一个hello world程序', lane_mode='slow')
print('Reply:', result['reply'][:150])
print('Task type:', result['task_type'])
print('Thinking count:', len(result['thinking']))
"
```

预期: 走完完整流水线，thinking 包含 Planner→Retriever→Coder→Executor→Tester→Summarizer

- [ ] **Step 5: Commit**

```bash
git add app/chat.py
git commit -m "refactor: 重写 app/chat.py 适配 LangGraph streaming

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: 修改 main.py — 侧边栏快慢车道 + UI 美化

**Files:**
- Modify: `main.py`

**Interfaces:**
- Consumes: `app.chat.run_chat_pipeline`, `config.ROLE_MODEL`, `config.get_model_display`, `app.components.render_agent_card`, `app.knowledge.render_knowledge_sidebar`
- Produces: 完整的 Streamlit UI

- [ ] **Step 1: 重写 main.py**

```python
"""
多智能体协作系统 — 聊天入口
运行：streamlit run main.py
"""

import os, sys

_PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
if _PROJECT_DIR not in sys.path:
    sys.path.insert(0, _PROJECT_DIR)

os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
os.environ["NO_PROXY"] = "localhost,127.0.0.1"
os.environ["no_proxy"] = "localhost,127.0.0.1"
os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["PYTHONUTF8"] = "1"

import logging
logging.getLogger().handlers.clear()
import warnings
warnings.filterwarnings("ignore", category=UserWarning)

# ──── 模型信息 ────
import config as _cfg
try:
    get_model_display = _cfg.get_model_display
    ROLE_MODEL = _cfg.ROLE_MODEL
except AttributeError:
    ROLE_MODEL = {k: "?" for k in [
        "Planner", "Retriever", "Coder", "Writer",
        "Tester", "Summarizer", "Bot",
    ]}
    def get_model_display(role):
        return "?"

import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(
    page_title="多智能体协作", page_icon="🤖",
    layout="wide", initial_sidebar_state="expanded",
)

# ──── 自定义 CSS ────
st.markdown("""
<style>
    /* 侧边栏深蓝背景 */
    [data-testid="stSidebar"] {
        background-color: #1a1f36;
    }
    [data-testid="stSidebar"] * {
        color: #e0e0e0;
    }
    [data-testid="stSidebar"] h1,
    [data-testid="stSidebar"] h2,
    [data-testid="stSidebar"] h3 {
        color: #ffffff;
    }
    [data-testid="stSidebar"] .stButton > button {
        background-color: #4f8cff;
        color: white;
        border: none;
        border-radius: 8px;
        transition: all 0.2s;
    }
    [data-testid="stSidebar"] .stButton > button:hover {
        background-color: #3d6fd9;
        transform: translateY(-1px);
    }

    /* 主区域 */
    .main .block-container {
        padding-top: 1rem;
    }

    /* 聊天消息卡片 */
    [data-testid="stChatMessage"] {
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        margin-bottom: 0.5rem;
    }

    /* 输入框美化 */
    [data-testid="stChatInput"] textarea {
        border-radius: 12px;
        border: 1px solid #e0e0e0;
    }

    /* 思考卡片 */
    [data-testid="stExpander"] {
        border-radius: 8px;
        border: 1px solid #e8ecf1;
    }
</style>
""", unsafe_allow_html=True)

# ──── Session State ────
if "messages" not in st.session_state:
    st.session_state.messages = []
if "jump_to" not in st.session_state:
    st.session_state.jump_to = -1
if "lane_mode" not in st.session_state:
    st.session_state.lane_mode = "slow"  # 默认慢车道


# ══════ 侧边栏 ══════
with st.sidebar:
    st.markdown("""
    <div style="text-align:center; padding:10px 0;">
        <h1 style="margin:0; color:#4f8cff;">🤖 Multi-Agent</h1>
        <p style="margin:0; font-size:0.85rem; opacity:0.7;">多智能体协作系统</p>
    </div>
    """, unsafe_allow_html=True)
    st.divider()

    # ⚡ 快慢车道切换
    st.markdown("### ⚡ 执行模式")
    lane_mode = st.radio(
        "选择执行模式",
        options=["fast", "slow"],
        format_func=lambda x: "🚀 快车道 (直接回复)" if x == "fast" else "🔄 慢车道 (多Agent协作)",
        key="lane_mode",
        horizontal=True,
    )
    color = "#10b981" if lane_mode == "slow" else "#4f8cff"
    st.markdown(
        f'<p style="text-align:center; color:{color}; font-weight:bold;">'
        f'当前: {"🔄 慢车道" if lane_mode == "slow" else "🚀 快车道"}'
        f'</p>',
        unsafe_allow_html=True,
    )

    st.divider()

    # 📊 系统状态
    st.markdown("### 📊 系统状态")
    for name in ROLE_MODEL:
        st.caption(f"{name}  ·  {get_model_display(name)}")

    st.divider()

    # 📚 知识库管理
    from app.knowledge import render_knowledge_sidebar
    render_knowledge_sidebar()

    # 📜 对话跳转
    user_questions = [
        (i, m["content"][:40])
        for i, m in enumerate(st.session_state.messages)
        if m["role"] == "user"
    ]
    if len(user_questions) > 1:
        st.divider()
        st.markdown("### 📜 对话跳转")
        for i, q_text in user_questions[-10:]:
            label = q_text + ("..." if len(q_text) >= 40 else "")
            if st.button(label, key=f"jump_{i}"):
                st.session_state.jump_to = i


# ══════ 主区域 ══════
from app.components import render_agent_card
from app.chat import run_chat_pipeline, generate_report_from_thinking

# ── 历史消息渲染 ──
for idx, msg in enumerate(st.session_state.messages):
    if msg["role"] == "user":
        st.markdown(f'<div id="msg_{idx}"></div>', unsafe_allow_html=True)
        st.chat_message("user").markdown(
            msg.get("content", "").replace("$", "\\$")
        )
    else:
        with st.chat_message("assistant"):
            thinking = msg.get("thinking", [])
            task_type = msg.get("task_type", "?")

            if thinking:
                st.caption(f"🏷 {task_type}")
                is_latest = (idx == len(st.session_state.messages) - 1)
                render_agent_card(thinking, key_suffix=str(idx), expanded=is_latest)

            st.markdown(msg["content"])

            # 生成文件预览
            for f in (msg.get("generated_files") or []):
                ext = f.get("ext", "").lower()
                if ext in ("png", "jpg", "jpeg", "gif", "bmp"):
                    try:
                        st.image(f.get("path", ""), caption=f.get("name", ""))
                    except Exception:
                        st.caption(f"⚠️ 图片无法显示：{f.get('name', '?')}")

            # 生成详细报告按钮
            if thinking and task_type not in ("闲聊", "问答"):
                if st.button("📥 生成详细报告", key=f"btn_report_{idx}"):
                    with st.spinner("正在生成..."):
                        report = generate_report_from_thinking(thinking)
                    os.makedirs(os.path.join(_PROJECT_DIR, "reports"), exist_ok=True)
                    report_path = os.path.join(_PROJECT_DIR, "reports", f"report_{idx}.md")
                    try:
                        with open(report_path, "w", encoding="utf-8") as f_rp:
                            f_rp.write(report)
                        files = list(msg.get("generated_files", []))
                        files.append({"name": f"report_{idx}.md", "path": report_path, "ext": "md"})
                    except OSError:
                        files = msg.get("generated_files", [])
                    st.session_state[f"report_{idx}"] = {"content": report, "files": files}
                    st.rerun()

            # 已生成的报告展示
            report_state = st.session_state.get(f"report_{idx}")
            if report_state:
                with st.expander("📊 详细报告", expanded=True):
                    if isinstance(report_state, dict):
                        st.markdown(report_state.get("content", ""))
                        for f in report_state.get("files", []):
                            ext = f.get("ext", "").lower()
                            if ext in ("png", "jpg", "jpeg", "gif", "bmp"):
                                st.image(f.get("path", ""), caption=f.get("name", ""))
                    else:
                        st.markdown(str(report_state))

# ── 跳转执行 ──
if st.session_state.jump_to >= 0:
    idx = st.session_state.jump_to
    components.html(
        f"<script>window.parent.document.getElementById('msg_{idx}')?.scrollIntoView({{behavior:'smooth',block:'start'}});</script>",
        height=0
    )
    st.session_state.jump_to = -1

# ── 输入区 ──
if prompt := st.chat_input("💬 描述你的任务（编程 / 写作 / 分析 / 问答 / 闲聊）"):
    st.session_state.messages.append({"role": "user", "content": prompt})

    with st.spinner("思考中..."):
        result = run_chat_pipeline(
            prompt,
            history=st.session_state.messages[:-1],
            lane_mode=st.session_state.lane_mode,
        )

    st.session_state.messages.append({
        "role": "assistant",
        "content": result["reply"],
        "thinking": result["thinking"],
        "task_type": result["task_type"],
        "generated_files": result.get("generated_files", []),
    })
    st.rerun()
```

- [ ] **Step 2: 验证 main.py 语法正确**

```bash
python -c "import ast; ast.parse(open('main.py').read()); print('syntax OK')"
```

预期输出: `syntax OK`

- [ ] **Step 3: Commit**

```bash
git add main.py
git commit -m "feat: 侧边栏快慢车道切换 + UI 美化

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: 修改 app/components.py — Agent 卡片组件

**Files:**
- Modify: `app/components.py`

- [ ] **Step 1: 重写 app/components.py**

```python
"""
Streamlit 可复用组件 —— Agent 卡片、状态指示器。
"""

import streamlit as st

_ICONS = {
    "Planner":    "📋", "Retriever": "🔍",
    "Coder":      "💻", "Writer":    "✍️",
    "Tester":     "✅", "Summarizer":"📊",
    "Bot":        "🤖", "Executor":  "⚙️",
}

_COLORS = {
    "Planner":    "#4f8cff",
    "Retriever":  "#8b5cf6",
    "Coder":      "#10b981",
    "Writer":     "#f59e0b",
    "Tester":     "#ef4444",
    "Summarizer": "#4f8cff",
    "Bot":        "#10b981",
    "Executor":   "#8b5cf6",
}


def _icon(name: str) -> str:
    return _ICONS.get(name, "🔹")


def _color(name: str) -> str:
    return _COLORS.get(name, "#4f8cff")


def render_agent_card(thinking: list[dict], key_suffix: str = "", expanded: bool = False):
    """渲染思考过程，每个 Agent 一张卡片"""
    if not thinking:
        return

    # 滚动容器样式
    st.markdown("""
    <style>
    div[data-testid="stExpander"] div[data-testid="stExpanderContent"] {
        max-height: 500px;
        overflow-y: auto;
    }
    </style>
    """, unsafe_allow_html=True)

    # 发言顺序条
    flow = " → ".join(
        f"{_icon(m.get('name', ''))} {m.get('name', '')}"
        for m in thinking if m.get("name")
    )

    with st.expander(f"🧠 思考过程（{flow}）", expanded=expanded):
        for i, msg in enumerate(thinking):
            name = msg.get("name", "")
            content = msg.get("content", "")
            if not content:
                continue

            color = _color(name)
            st.markdown(
                f'<span style="display:inline-block; background:{color}20; '
                f'border-left:3px solid {color}; padding:4px 12px; '
                f'border-radius:4px; font-weight:bold;">'
                f'{_icon(name)} {name}</span>',
                unsafe_allow_html=True,
            )
            st.markdown(content)
            if i < len(thinking) - 1:
                st.divider()


def render_status_badge(status: str) -> str:
    cmap = {"就绪": "🟢", "运行中": "🟡", "完成": "✅", "错误": "❌"}
    return f"{cmap.get(status, '⚪')} {status}"
```

- [ ] **Step 2: 验证 components.py 语法正确**

```bash
python -c "import ast; ast.parse(open('app/components.py').read()); print('syntax OK')"
```

预期输出: `syntax OK`

- [ ] **Step 3: Commit**

```bash
git add app/components.py
git commit -m "refactor: 美化 Agent 卡片组件（彩色标签 + 图标）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: 修改 app/knowledge.py — 支持图片 OCR 入库

**Files:**
- Modify: `app/knowledge.py`

- [ ] **Step 1: 修改 app/knowledge.py**

```python
"""侧边栏知识库管理。"""

import os
import streamlit as st
from rag.knowledge_base import build_index, get_document_list, get_stats


def render_knowledge_sidebar():
    """在侧边栏渲染知识库管理。"""
    st.markdown("### 📚 知识库")
    col1, col2 = st.columns(2)
    stats = get_stats()
    with col1:
        st.metric("文档", stats.get("文档数", 0))
    with col2:
        st.metric("切片", stats.get("切片数", 0))

    # 重建索引按钮
    if st.button("🔄 重建索引", use_container_width=True):
        with st.spinner("重建中..."):
            n = build_index()
        st.success(f"新增 {n} 切片")
        st.rerun()

    # 文档上传（支持 PDF/TXT + 图片 OCR 入库）
    st.markdown("---")
    uploaded = st.file_uploader(
        "📤 上传文档 (PDF/TXT/PNG/JPG)",
        type=["pdf", "txt", "png", "jpg", "jpeg"],
        accept_multiple_files=False,
        key="kb_upload",
    )
    if uploaded:
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        doc_dir = os.path.join(base, "rag", "documents")
        os.makedirs(doc_dir, exist_ok=True)

        ext = uploaded.name.rsplit(".", 1)[-1].lower()

        if ext in ("png", "jpg", "jpeg"):
            # 图片 → OCR → 存为 txt
            st.info("🔍 正在 OCR 识别图片文字...")
            try:
                from PIL import Image
                import pytesseract
                import io

                img = Image.open(io.BytesIO(uploaded.getbuffer()))
                text = pytesseract.image_to_string(img, lang="chi_sim+eng")

                if not text.strip():
                    st.warning("⚠️ 图片中未识别到文字")
                else:
                    txt_name = uploaded.name.rsplit(".", 1)[0] + "_ocr.txt"
                    txt_path = os.path.join(doc_dir, txt_name)
                    with open(txt_path, "w", encoding="utf-8") as f:
                        f.write(text)
                    st.success(f"已 OCR 识别并保存为 {txt_name}")
            except ImportError:
                st.error("pytesseract 或 Pillow 未安装")
            except Exception as e:
                st.error(f"OCR 失败: {e}")
        else:
            # PDF/TXT 直接保存
            doc_path = os.path.join(doc_dir, uploaded.name)
            with open(doc_path, "wb") as f:
                f.write(uploaded.getbuffer())
            st.success(f"已上传 {uploaded.name}")

        st.rerun()

    # 文档列表
    docs = get_document_list()
    if docs:
        st.markdown("---")
        st.caption("已上传文档")
        for doc in docs:
            c1, c2 = st.columns([5, 1])
            with c1:
                st.markdown(f"- {doc}")
            with c2:
                if st.button("🗑", key=f"kb_del_{doc}", help="删除"):
                    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                    os.remove(os.path.join(base, "rag", "documents", doc))
                    st.rerun()
```

- [ ] **Step 2: 验证 knowledge.py 语法**

```bash
python -c "from app.knowledge import render_knowledge_sidebar; print('knowledge OK')"
```

预期输出: `knowledge OK`

- [ ] **Step 3: Commit**

```bash
git add app/knowledge.py
git commit -m "feat: 知识库支持图片 OCR 入库 (Tesseract)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: 新建 app/ocr.py — OCR 独立模块

**Files:**
- Create: `app/ocr.py`

- [ ] **Step 1: 创建 app/ocr.py**

```python
"""
OCR 模块 —— Tesseract 图片文字识别。
"""

import io
import os


def ocr_file(uploaded_file) -> str:
    """将上传的图片文件 OCR 提取文字。
    uploaded_file: Streamlit UploadedFile 或 file-like object
    返回识别的文字内容
    """
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return "[错误] pytesseract 或 Pillow 未安装"

    try:
        if hasattr(uploaded_file, "getbuffer"):
            data = uploaded_file.getbuffer()
        elif hasattr(uploaded_file, "read"):
            data = uploaded_file.read()
        else:
            data = uploaded_file

        img = Image.open(io.BytesIO(data))
        text = pytesseract.image_to_string(img, lang="chi_sim+eng")
        return text.strip() or ""
    except Exception as e:
        return f"[OCR错误] {e}"


def ocr_clipboard(image_bytes: bytes) -> str:
    """从剪贴板图片 OCR 提取文字"""
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return "[错误] pytesseract 或 Pillow 未安装"

    try:
        img = Image.open(io.BytesIO(image_bytes))
        text = pytesseract.image_to_string(img, lang="chi_sim+eng")
        return text.strip() or ""
    except Exception as e:
        return f"[OCR错误] {e}"


def ocr_and_index(uploaded_file, knowledge_base) -> int:
    """OCR 提取文字后直接存入知识库，返回新增 chunk 数。
    注意：这个函数需要在 Streamlit 上下文中调用 build_index。
    """
    text = ocr_file(uploaded_file)
    if not text or text.startswith("[OCR错误]"):
        return 0

    # 保存 OCR 文本为临时文件
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    doc_dir = os.path.join(base, "rag", "documents")
    os.makedirs(doc_dir, exist_ok=True)

    txt_name = uploaded_file.name.rsplit(".", 1)[0] + "_ocr.txt" if hasattr(uploaded_file, "name") else "clipboard_ocr.txt"
    txt_path = os.path.join(doc_dir, txt_name)
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(text)

    # 重建索引
    from rag.knowledge_base import build_index
    return build_index()
```

- [ ] **Step 2: 验证 app/ocr.py 语法**

```bash
python -c "import ast; ast.parse(open('app/ocr.py').read()); print('ocr OK')"
```

预期输出: `ocr OK`

- [ ] **Step 3: Commit**

```bash
git add app/ocr.py
git commit -m "feat: 新建 app/ocr.py Tesseract OCR 模块

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 12: 启动优化 — 懒加载 + Streamlit 缓存

**Files:**
- Modify: `agents.py` (添加缓存)
- Modify: `rag/knowledge_base.py` (已支持懒加载，无改动)
- Modify: `config.py` (无改动，仅确认)

- [ ] **Step 1: 在 agents.py 添加 Streamlit 缓存**

在 `agents.py` 末尾追加：

```python
# ===== Streamlit 缓存（启动优化）=====
# 通过 @st.cache_resource 缓存 LLM 实例，避免每次 rerun 重建

def get_cached_llm(role: str, temperature: float = 0.3):
    """获取缓存的 LLM 实例。在 Streamlit 上下文中自动缓存。"""
    try:
        import streamlit as st

        @st.cache_resource
        def _cached(role: str, temperature: float):
            return create_llm(role, temperature)

        return _cached(role, temperature)
    except ImportError:
        # 非 Streamlit 环境（如 CLI 测试），直接创建
        return create_llm(role, temperature)
```

- [ ] **Step 2: 修改 workflow.py 使用缓存**

在 `workflow.py` 的 `_get_agent` 函数中，将 `create_llm` 替换为 `get_cached_llm`：

```python
# 将
from agents import create_llm, SYSTEM_PROMPTS, TOOL_ASSIGNMENTS
# 改为
from agents import create_llm, get_cached_llm, SYSTEM_PROMPTS, TOOL_ASSIGNMENTS

# 在 _get_agent 中，将
llm = create_llm(role, temperature)
# 改为
llm = get_cached_llm(role, temperature)
```

- [ ] **Step 3: 验证缓存生效**

```bash
python -c "from agents import get_cached_llm; llm1=get_cached_llm('Bot',0.5); print('cache OK')"
```

预期输出: `cache OK`

- [ ] **Step 4: Commit**

```bash
git add agents.py workflow.py
git commit -m "perf: Streamlit 缓存 LLM 实例，显著减少热启动时间

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 13: 清理旧代码 + 删除废弃文件

**Files:**
- Delete: `groupchat.py` (AG2 GroupChat)
- Delete: `router.py` (自动分类)
- Modify: `config.py` (移除 AG2 相关注释)

- [ ] **Step 1: 删除 groupchat.py**

```bash
git rm groupchat.py
```

- [ ] **Step 2: 删除 router.py**

```bash
git rm router.py
```

- [ ] **Step 3: 更新 config.py 注释**

在 `config.py` 中，将 docstring 中步骤 3 里 AG2 相关的描述简化。当前文件已干净（之前已清理过），无需大改。

- [ ] **Step 4: Commit**

```bash
git add config.py
git commit -m "chore: 删除 groupchat.py 和 router.py（AG2 → LangGraph 迁移完成）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 14: 端到端测试

**Files:** 无新建

- [ ] **Step 1: 测试快车道**

```bash
python -c "
from app.chat import run_chat_pipeline
result = run_chat_pipeline('解释一下什么是机器学习', lane_mode='fast')
assert result['reply'], '快车道应有回复'
assert len(result['thinking']) >= 1, 'thinking 应包含 Bot 消息'
print('✅ 快车道通过')
"
```

- [ ] **Step 2: 测试慢车道完整流水线**

```bash
python -c "
from app.chat import run_chat_pipeline
result = run_chat_pipeline('写一个冒泡排序Python函数并测试', lane_mode='slow')
assert result['reply'], '慢车道应有回复'
# 应包含多个 Agent 的 thinking
names = [m['name'] for m in result['thinking'] if m.get('name')]
print('Agent 流水线:', ' → '.join(names))
assert 'Planner' in names, '应包含 Planner'
print('✅ 慢车道通过')
"
```

- [ ] **Step 3: 测试 OCR tool**

```bash
python -c "
from tools import ocr_image
# 测试 tool 可调用（不要求真的识别图片）
result = ocr_image.invoke('nonexistent.png')
assert '不存在' in result or 'OCR错误' in result
print('✅ OCR tool 通过')
"
```

- [ ] **Step 4: 启动 Streamlit 进行人工验证**

```bash
streamlit run main.py
```

在浏览器中验证：
- 左侧栏快慢车道切换按钮可见
- 切换到快车道 → 发送任意消息 → Bot 直接回复
- 切换到慢车道 → 发送编程任务 → 看到完整 Agent 流水线
- 知识库上传图片 → OCR 识别入库
- 深蓝色侧边栏 + 圆角卡片样式正常

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: 端到端测试通过，AG2→LangGraph 迁移完成

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 实施顺序依赖图

```
Task 1 (requirements) ──┐
                         ├──> Task 2 (executor.py)
                         │         │
                         │         v
                         ├──> Task 3 (workflow.py 框架)
                         │         │
                         ├──> Task 4 (agents.py) ──┐
                         │                          │
                         ├──> Task 5 (tools.py) ────┤
                         │                          │
                         v                          v
                    Task 6 (workflow.py 节点补全)
                              │
                              v
                    Task 7 (app/chat.py)
                              │
                              v
                    Task 8 (main.py)
                              │
                    ┌─────────┼─────────┐
                    v         v         v
             Task 9     Task 10    Task 11
          (components) (knowledge) (ocr.py)
                    │         │         │
                    └─────────┼─────────┘
                              v
                    Task 12 (启动优化)
                              │
                              v
                    Task 13 (清理旧代码)
                              │
                              v
                    Task 14 (端到端测试)
```
