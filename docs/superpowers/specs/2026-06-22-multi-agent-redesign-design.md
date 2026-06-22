# Multi-Agent 系统重构设计文档

**日期**: 2026-06-22
**分支**: Fahaxiokio
**状态**: 待实施

---

## 1. 概述

### 1.1 目标

将现有的 AG2 GroupChat 多智能体系统全面迁移至 **LangGraph + LangChain** 技术栈，同时实现以下功能：

- ✅ 快慢车道手动切换（左侧栏控件）
- ✅ Tesseract OCR 支持（图片文字识别 + 知识库入库）
- ✅ 启动速度优化（目标：首次 10-15s，热启动 <5s）
- ✅ 专业仪表盘风格 UI 美化
- ✅ 保留 LangChain、LLM、Pillow、Tesseract 技术栈

### 1.2 技术栈变化

| 组件 | 旧 | 新 |
|------|-----|-----|
| 多 Agent 编排 | AG2 GroupChat | **LangGraph StateGraph** |
| Agent 定义 | AG2 AssistantAgent | **LangChain create_agent** |
| 工具注册 | AG2 register_function | **LangChain @tool** |
| 代码执行 | AG2 UserProxyAgent | **自建 executor.py** |
| OCR | 无 | **Tesseract + Pillow** |
| 快慢车道路由 | router.py 自动分类 | **侧边栏手动切换** |

### 1.3 删除的文件
- `groupchat.py` — LangGraph 替代
- `router.py` — 自动分类不再需要
- `requirements.txt` 中移除 `ag2`

### 1.4 新增/重写的文件
| 文件 | 操作 | 说明 |
|------|------|------|
| `workflow.py` | 新建 | LangGraph 状态图，快/慢车道工作流 |
| `executor.py` | 新建 | 代码沙箱，替代 UserProxyAgent |
| `agents.py` | 重写 | LangChain create_agent 方式 |
| `tools.py` | 重写 | LangChain Tool 格式 + OCR tool |
| `app/chat.py` | 重写 | 适配 LangGraph streaming |
| `app/ocr.py` | 新建 | Tesseract OCR 模块 |
| `app/components.py` | 修改 | UI 美化 |
| `app/knowledge.py` | 修改 | 支持图片上传 + OCR 入库 |
| `main.py` | 修改 | 侧边栏快慢车道 + UI 美化 |
| `config.py` | 微调 | 适配新调用方式 |

---

## 2. 架构设计

### 2.1 整体架构

```
Streamlit UI (main.py)
    │
    ├─ 侧边栏: lane_mode (fast/slow), 模型显示, 知识库管理
    │
    └─ 主区域: 聊天界面
         │
         v
app/chat.py
    │
    v
workflow.py (LangGraph StateGraph)
    │
    ├─ 快车道: bot_node → END
    │
    └─ 慢车道: planner_node → retriever_node → [coder_node | writer_node]
                  → executor_node → tester_node → (loop ≤2) → summarizer_node → END
         │              │
         v              v
    agents.py       executor.py
    (LangChain      (subprocess 沙箱)
     AgentExecutor)
         │
         v
    tools.py (LangChain Tools)
    ├─ search_knowledge  (ChromaDB)
    ├─ read_file / write_file
    ├─ calculate / analyze_data / visualize_data (Pillow)
    └─ ocr_image (Tesseract) ★新增
```

### 2.2 数据流

```
用户输入
  │
  v
StateGraph.invoke({"user_input": "...", "lane_mode": "slow"})
  │
  v
[每个节点执行后 yield 状态更新，前端 streaming 渲染]
  │
  v
final_output → 聊天界面展示
```

---

## 3. LangGraph 工作流设计

### 3.1 状态定义

```python
from typing import TypedDict, Annotated
from langgraph.graph.message import add_messages

class WorkflowState(TypedDict):
    # 输入
    user_input: str
    lane_mode: str          # "fast" | "slow"
    
    # 中间产物
    task_type: str          # "coding" | "writing" (Planner 判断)
    plan: str
    knowledge: str
    code_or_draft: str
    test_result: str
    fix_count: int
    
    # 消息历史 (streaming 给前端)
    messages: Annotated[list, add_messages]
    
    # 最终输出
    final_output: str
```

### 3.2 节点

| 节点 | Agent | 输入 | 输出 |
|------|-------|------|------|
| `planner_node` | Planner | user_input | plan (步骤列表) |
| `retriever_node` | Retriever | user_input + plan | knowledge |
| `coder_node` | Coder | user_input + plan + knowledge | code_or_draft |
| `writer_node` | Writer | user_input + plan + knowledge | code_or_draft |
| `executor_node` | — (subprocess) | code_or_draft | 执行结果 |
| `tester_node` | Tester | user_input + code_or_draft + 执行结果 | test_result (通过/不通过 + 建议) |
| `summarizer_node` | Summarizer | 所有中间产物 | final_output |
| `bot_node` | Bot | user_input | final_output |

### 3.3 条件边

```python
# 快慢车道分流 (从 __start__)
def route_lane(state) -> str:
    return "bot" if state["lane_mode"] == "fast" else "planner"

# 任务类型分流 (从 retriever_node)
def route_task(state) -> str:
    return "coder" if state["task_type"] == "coding" else "writer"

# Tester 审查结果分流
def route_test(state) -> str:
    if state["test_result"] == "通过":
        return "summarizer"
    if state["fix_count"] < 2:
        return "coder" if state["task_type"] == "coding" else "writer"
    return "summarizer"  # 超过最大修复次数，强行结束
```

### 3.4 图构建

```python
from langgraph.graph import StateGraph, END

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
    
    wf.set_conditional_entry_point(route_lane)
    
    wf.add_edge("bot", END)
    wf.add_edge("planner", "retriever")
    wf.add_conditional_edges("retriever", route_task)
    wf.add_edge("coder", "executor")
    wf.add_edge("executor", "tester")
    wf.add_edge("writer", "tester")
    wf.add_conditional_edges("tester", route_test)
    wf.add_edge("summarizer", END)
    
    return wf.compile()
```

---

## 4. Agent 设计

### 4.1 LLM 统一创建

```python
from langchain_deepseek import ChatDeepSeek

def create_llm(role: str, temperature: float = 0.3):
    cfg = get_config(role)["config_list"][0]
    return ChatDeepSeek(
        model=cfg["model"],
        api_key=cfg["api_key"],
        api_base=cfg["base_url"],
        temperature=temperature,
    )
```

### 4.2 Agent 清单

| Agent | System Prompt 要点 | 工具 | temperature |
|-------|-------------------|------|-------------|
| Planner | 将用户任务拆解为编号步骤，判断 task_type (coding/writing) | 无 | 0.3 |
| Bot | 快速直接回复，闲聊/问答/简单编程 | 无 | 0.5 |
| Retriever | 检索知识库，返回最相关的 3 条内容 | `search_knowledge` | 0.1 |
| Coder | 编写 Python 代码，输出到 coding/ 目录 | `write_file`, `read_file`, `calculate` | 0.2 |
| Writer | 撰写文档/报告/文章 | `write_file`, `read_file`, `search_knowledge` | 0.4 |
| Tester | 对照原始需求审查输出，给出 通过/不通过 判定 | `read_file` | 0.2 |
| Summarizer | 汇总所有步骤为最终报告 | 无 | 0.3 |

---

## 5. Tool 设计

### 5.1 现有工具（LangChain 化）

```python
# tools.py
from langchain.tools import tool

@tool
def search_knowledge(query: str) -> str:
    """在知识库中搜索相关文档。输入查询字符串，返回相关文本片段。"""

@tool
def read_file(path: str) -> str:
    """读取 coding/ 目录下的文件内容。"""

@tool
def write_file(path: str, content: str) -> str:
    """将内容写入 coding/ 目录的文件。"""

@tool
def calculate(expression: str) -> str:
    """安全计算数学表达式。支持 +, -, *, /, **, %。"""

@tool
def analyze_data(path: str, group_by: str, agg_col: str) -> str:
    """分析 CSV/Excel 数据，按 group_by 分组聚合 agg_col。"""

@tool
def visualize_data(path: str, x_col: str, y_col: str, chart_type: str = "bar") -> str:
    """从 CSV 数据生成图表 (bar/line)，返回图片路径。使用 Pillow 渲染。"""
```

### 5.2 新增 OCR Tool

```python
@tool
def ocr_image(image_path: str, language: str = "chi_sim+eng") -> str:
    """从图片中提取文字。支持中英文混合识别。
    
    Args:
        image_path: 图片文件路径 (PNG/JPG/PNG等)
        language: OCR语言代码，默认 chi_sim+eng
    
    Returns:
        识别出的文字内容
    """
    import pytesseract
    from PIL import Image
    
    img = Image.open(image_path)
    text = pytesseract.image_to_string(img, lang=language)
    return text.strip()
```

---

## 6. 代码执行器设计 (executor.py)

```python
import subprocess
import uuid
import os

class CodeExecutor:
    """安全代码执行沙箱"""
    
    WORKSPACE = "coding/"
    TIMEOUT = 60  # 秒
    
    def execute(self, code: str) -> dict:
        """
        1. 写入 coding/tmp_{uuid}.py
        2. subprocess.run 执行
        3. 清理临时文件
        返回 {"stdout": str, "stderr": str, "exitcode": int}
        """
        file_id = str(uuid.uuid4())[:8]
        filepath = os.path.join(self.WORKSPACE, f"tmp_{file_id}.py")
        
        os.makedirs(self.WORKSPACE, exist_ok=True)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(code)
        
        try:
            result = subprocess.run(
                ["python", filepath],
                capture_output=True, text=True,
                timeout=self.TIMEOUT, cwd=self.WORKSPACE
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
                os.remove(filepath)
```

---

## 7. 快慢车道切换设计

### 7.1 侧边栏控件

```python
# main.py 侧边栏最顶部
st.markdown("### ⚡ 执行模式")

lane_mode = st.radio(
    "选择执行模式",
    options=["fast", "slow"],
    format_func=lambda x: "🚀 快车道 (直接回复)" if x == "fast" else "🔄 慢车道 (多Agent协作)",
    key="lane_mode",
    horizontal=True,
)

st.caption(f"当前: {'🚀 快车道' if lane_mode == 'fast' else '🔄 慢车道'}")
```

### 7.2 行为

- **快车道**：所有消息 → `bot_node` → 直接返回。不管任务多复杂，一律单 Agent 回复
- **慢车道**：所有消息 → LangGraph 慢车道工作流。即使"你好"也走完整流水线
- 切换即时生效（读取 `st.session_state.lane_mode`）

---

## 8. OCR 模块设计 (app/ocr.py)

### 8.1 功能

```python
# app/ocr.py

def ocr_file(uploaded_file) -> str:
    """将上传的图片文件 OCR 提取文字"""

def ocr_clipboard(image_bytes: bytes) -> str:
    """从剪贴板图片 OCR 提取文字"""

def ocr_and_index(uploaded_file, knowledge_base) -> int:
    """OCR 提取文字后直接存入知识库，返回新增 chunk 数"""
```

### 8.2 依赖

- `pytesseract` — Tesseract OCR Python 绑定
- `Pillow` — 图片预处理（已安装）
- 系统需安装 Tesseract-OCR 引擎（Windows: `tesseract.exe` 在 PATH 中）

### 8.3 集成点

| 入口 | 功能 |
|------|------|
| 聊天输入区 📷 按钮 | 上传/粘贴图片 → OCR → 文字填入输入框 |
| 知识库管理页 | 上传图片 → OCR → 文字存入 ChromaDB |

---

## 9. 启动优化方案

### 9.1 优化项

| # | 措施 | 实现方式 | 预期收益 |
|---|------|---------|---------|
| 1 | RAG 懒加载 | `HuggingFaceEmbeddings` + ChromaDB 仅在 `search_knowledge` 首次调用时初始化 | -15~20s |
| 2 | 重依赖延迟 import | `pandas`, `pytesseract`, `PIL` 改为函数内 import | -3~5s |
| 3 | Streamlit 缓存 | `@st.cache_resource` 缓存 LLM、Agent、Embedding | 热启动 -20s+ |
| 4 | 移除 AG2 | 去除 `ag2` 依赖，LangGraph+LangChain 导入更快 | -5~10s |
| 5 | Sentence-Transformers 按需 | 随 RAG 懒加载一起延迟 | -10~15s |
| 6 | ChromaDB 延迟连接 | `PersistentClient` 不在 import 时创建 | -2s |

### 9.2 预期效果

| 场景 | 当前 | 优化后 |
|------|------|--------|
| 首次启动 (app 打开) | ~40-60s | **~10-15s** |
| 热启动 (缓存命中) | ~10-15s | **<5s** |
| 首次搜索 (触发 embedding 加载) | 已包含在启动中 | 额外 ~10s (仅一次) |

### 9.3 实现示例

```python
# agents.py - LLM 缓存
@st.cache_resource
def _get_llm(role: str):
    return create_llm(role)

# rag/knowledge_base.py - 懒加载
_embeddings = None
_vector_store = None

def _get_embeddings():
    global _embeddings
    if _embeddings is None:
        _embeddings = HuggingFaceEmbeddings(...)
    return _embeddings
```

---

## 10. UI 美化设计

### 10.1 配色方案

```
深蓝主色: #1a1f36  (侧边栏)
科技蓝:   #4f8cff  (强调/按钮)
翠绿:     #10b981  (成功/通过)
琥珀:     #f59e0b  (处理中)
珊瑚:     #ef4444  (失败/错误)
浅灰底:   #f8f9fc  (主背景)
纯白:     #ffffff  (卡片/气泡)
```

### 10.2 侧边栏布局

```
┌────────────────────┐
│  🏠 Multi-Agent    │  ← logo + 标题，深蓝背景
│  多智能体协作系统   │
├────────────────────┤
│  ⚡ 执行模式       │  ← 醒目控件
│  ● 快车道 ○ 慢车道 │
├────────────────────┤
│  📊 系统状态       │  ← 模型/知识库状态
│  LLM: DeepSeek V4  │
│  RAG: N文档 M块    │
├────────────────────┤
│  ⚙️ 知识库管理    │  ← expander
│  📜 对话跳转      │  ← expander
└────────────────────┘
```

### 10.3 对话消息卡片

```python
# app/components.py - render_agent_card()
def render_agent_card(agent_name: str, icon: str, content: str, elapsed: float):
    """
    渲染带 Agent 图标的卡片:
    ┌──────────────────────────────────┐
    │ 📋 Planner  ·  步骤规划  ⏱ 1.2s │
    ├──────────────────────────────────┤
    │ (markdown 内容)                  │
    └──────────────────────────────────┘
    """
```

特点：
- 每个 Agent 有专属图标和颜色标签
- 右上角显示耗时
- 执行中用脉冲动画，完成后变绿色对勾
- 思考过程可折叠（默认折叠旧消息，展开最新一条）

### 10.4 底部输入区

```
┌──────────────────────────────────────┐
│  💬 输入你的任务...                  │
│                                      │
│  📎 上传  📷 OCR  📊 数据    [发送→] │
└──────────────────────────────────────┘
```

### 10.5 CSS 自定义

通过 `st.markdown("""<style>...</style>""", unsafe_allow_html=True)` 注入自定义 CSS：

- 侧边栏深蓝背景
- 圆角卡片阴影
- 按钮 hover 动画
- 滚动条美化
- 字体优化（系统默认中文字体 + 等宽代码字体）

---

## 11. Tesseract 环境要求

### Windows 安装

1. 下载 Tesseract-OCR 安装包: https://github.com/UB-Mannheim/tesseract/wiki
2. 安装时勾选中文语言包 (`chi_sim`)
3. 确认 `tesseract.exe` 在系统 PATH 中
4. 验证: `tesseract --version`

### Python 依赖

```
pytesseract>=0.3.10
Pillow>=10.0  (已安装)
```

---

## 12. 实施顺序

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **Phase 1** | `workflow.py` + `executor.py` 新建 | — |
| **Phase 2** | `agents.py` + `tools.py` 重写 (含 OCR tool) | Phase 1 |
| **Phase 3** | `app/chat.py` 重写 (适配 LangGraph) | Phase 2 |
| **Phase 4** | `main.py` 修改 (侧边栏切换 + UI美化) | Phase 3 |
| **Phase 5** | `app/components.py` + `app/knowledge.py` 修改 | Phase 4 |
| **Phase 6** | `app/ocr.py` 新建 | Phase 5 |
| **Phase 7** | 启动优化 (懒加载 + 缓存) | Phase 6 |
| **Phase 8** | `requirements.txt` 更新 + 清理旧代码 | Phase 7 |
| **Phase 9** | 端到端测试 | Phase 8 |

---

## 13. 验证计划

1. **快车道**：选择快车道 → 发送任何消息 → 确认 Bot 直接回复，不走流水线
2. **慢车道**：选择慢车道 → 发送编程任务 → 确认走完整 Planner→Coder→Tester→Summarizer
3. **OCR**：上传含中文的图片 → 确认文字正确提取
4. **OCR + RAG**：上传图片到知识库 → 搜索 → 确认能检索到 OCR 提取的文字
5. **启动速度**：关闭 Streamlit → 重新 `streamlit run main.py` → 计时 <15s
6. **UI**：检查侧边栏配色、消息卡片样式、动画效果
7. **循环修复**：给 Coder 一个会出错的任务 → 确认 Tester 检测到 → Coder 修复 → 最多 2 轮
