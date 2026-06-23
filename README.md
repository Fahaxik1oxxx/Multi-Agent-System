# 多智能体协作系统 v3.1

基于 **LangGraph + LangChain** 的八角色多智能体协作系统，支持编程/写作/分析/问答/闲聊 5 种任务，集成 Router 意图分类、RAG 知识库、Tesseract OCR、自动/手动快慢车道切换与 FastAPI + Bootstrap 5 专业 Web 仪表盘。

---

## 1 项目概述

用户输入任务 → Router LLM 自动分类意图（5 类型 + 轻/重复杂度）→ 系统通过 **LangGraph StateGraph** 编排 **7 个专业 Agent** 协作完成。快车道 Bot 秒级回复，慢车道多 Agent 流水线含 exitcode 分支和 ≤2 轮修复循环。

### 1.1 角色列表

| 角色 | 图标 | 职责 | 工具 |
|------|:----:|------|------|
| **Router** | 🧠 | 意图分类（编程/写作/分析/问答/闲聊 + 轻/重） | 独立 LLM 调用 |
| **Bot** | 🤖 | 快车道直接回复 | 无 |
| **Planner** | 📋 | 拆解任务，制定步骤 | 无 |
| **Retriever** | 🔍 | 搜索知识库 | `search_knowledge` |
| **Coder** | 💻 | 编写 Python 代码 / 数据分析 | `write_file`, `read_file`, `calculate` |
| **Writer** | ✍️ | 撰写报告/方案/文章 | `write_file`, `read_file`, `search_knowledge` |
| **Tester** | ✅ | 审查代码/文档 | `read_file` |
| **Summarizer** | 📊 | 汇总为结构化报告 | 无 |

> Router 不是 Agent，是独立轻量 LLM 调用。所有 7 个 Agent 统一使用 DeepSeek API。

### 1.2 支持的任务

| 类型 | 示例 | Router 判断 |
|------|------|:------:|
| 编程 | "写一个快排" / "实现 LRU Cache" | 编程\|重 |
| 写作 | "写一份市场分析报告" | 写作\|重 |
| 分析 | "分析 CSV 销售数据" | 分析\|重 |
| 问答 | "什么是机器学习" | 问答\|轻 |
| 闲聊 | "你好" / "你是谁" | 闲聊\|轻 |

### 1.3 关键词覆写

Router 分类后，系统会用正则检测做二次修正：

| 检测 | 触发词 | 覆写效果 |
|------|--------|---------|
| 搜索关键词 | 搜索/查资料/检索/基于知识库 | 强制慢车道（重） |
| 分析关键词 | 以"分析"开头 | 强制慢车道 + 分析类型 |
| 非 Python 语言 | C语言/Java/Rust/Go/C++/C# | 降级为问答 + 快车道 |

---

## 2 快速开始

### 2.1 前提条件

- Python 3.11+
- DeepSeek API Key（设环境变量 `MULTI_DEEPSEEK_API_KEY`）
- Tesseract-OCR（可选，OCR 功能需要）

### 2.2 安装

```bash
pip install -r requirements.txt
```

### 2.3 启动

```bash
uvicorn main:app --reload --port 8501
```

浏览器打开 `http://localhost:8501`。

### 2.4 配置模型

编辑 `config.py` 的 `MODEL_POOL` 添加新模型，`ROLE_MODEL` 指定角色用哪个模型。

---

## 3 快慢车道

### 3.1 三种模式

侧边栏顶部 **⚡ 执行模式** 选择：

| 模式 | 图标 | 行为 | 适用场景 |
|------|:----:|------|------|
| **自动** | 🧠 | Router LLM 分类 + 关键词覆写 → 自动选车道 | 日常使用（默认） |
| **快车道** | 🚀 | Bot 直接回复，<3s | 强制快速回复 |
| **慢车道** | 🔄 | 7 Agent 协作流水线 | 强制完整流程 |

### 3.2 Router 意图分类

Router 是一次独立 LLM 调用（非 Agent），返回 `(任务类型, 复杂度)`：

- 5 种类型：编程 / 写作 / 分析 / 问答 / 闲聊
- 2 种复杂度：轻 → 快车道 / 重 → 慢车道

详细逻辑见 `router.py`。

### 3.3 慢车道流水线

```
Planner → Retriever → [Coder|Writer] → Executor → Tester → Summarizer
                        ↑       │              ↑        │
                        │       └── 修复 ──────┘        │
                        └─────────── 修复 (≤2轮) ───────┘
```

**exitcode 分支：** 代码执行后检查 exitcode — `0` 进入 Tester 评审，`≠0` 返回 Coder 修复。

**speaking_log：** 每个节点记录 `{from, to}` 发言流转，前端可追踪完整执行路径。

---

## 4 知识库 + OCR

### 知识库管理

- 侧边栏 📚 知识库 → 上传 PDF/TXT → 自动切分索引
- Agent 通过 `search_knowledge` 工具检索相关内容
- 嵌入模型：BAAI/bge-small-zh-v1.5（离线加载，首次 ~10s）

### 图片 OCR

- 上传 PNG/JPG → 自动 Tesseract OCR → 文字存入知识库
- `ocr_image` 工具可供 Agent 在任务中调用
- 支持中英文混合识别

> ⚠️ 需要安装 Tesseract-OCR：https://github.com/UB-Mannheim/tesseract/wiki

---

## 5 技术栈

| 领域 | 技术 |
|------|------|
| Agent 框架 | **LangGraph ≥0.2**（StateGraph 编排） |
| Agent 实现 | **LangChain ≥0.3**（ChatDeepSeek + @tool） |
| LLM | DeepSeek V4 Flash |
| Web 框架 | **FastAPI** + **Jinja2** + **Bootstrap 5** + 原生 JS |
| 意图分类 | **Router**（独立 LLM 调用，urllib） |
| 代码执行 | subprocess 沙箱（`executor.py`） |
| 知识库 | ChromaDB + BAAI/bge-small-zh-v1.5 |
| OCR | Tesseract + Pillow |
| 数据分析 | Pandas + Pillow |

---

## 6 项目结构

```
├── main.py              # FastAPI 入口 + 全部路由 + uvicorn 启动
├── router.py            # Router 意图分类器（独立 LLM）
├── config.py            # 模型配置（MODEL_POOL + ROLE_MODEL）
├── workflow.py          # LangGraph 工作流（含 exitcode 分支 + speaking_log）
├── executor.py          # 代码执行沙箱（subprocess 隔离）
├── agents.py            # 7 个 Agent System Prompts + LLM 缓存
├── tools.py             # 7 个 LangChain Tool（含 OCR）
│
├── app/
│   ├── chat.py          # 聊天管道（Router + 关键词覆写 + 超时守护）
│   ├── knowledge.py     # 知识库 API 路由（FastAPI Router）
│   └── ocr.py           # Tesseract OCR 模块
│
├── templates/
│   ├── base.html        # Jinja2 布局骨架（Bootstrap 5）
│   ├── index.html       # 聊天主页面
│   └── components/
│       └── sidebar.html # 侧边栏（模式切换 + 状态 + 知识库）
│
├── static/
│   ├── css/custom.css   # 自定义样式（深蓝侧边栏 + 气泡 + 折叠）
│   └── js/chat.js       # 聊天交互（fetch + DOM 渲染）
│
├── tests/
│   └── test_knowledge_routes.py  # 知识库 API 测试
│
├── rag/
│   ├── knowledge_base.py  # ChromaDB 封装
│   ├── documents/         # 知识文档
│   └── chroma_db/         # 向量数据库
│
├── coding/              # 代码执行工作目录
├── reports/             # 报告输出目录
└── requirements.txt     # 依赖清单
```

---

## 7 API 路由

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/` | 聊天页面 |
| `POST` | `/api/chat` | 发送消息 `{message, lane_mode, history}` |
| `POST` | `/api/report` | 从 thinking 生成报告 |
| `GET` | `/api/knowledge/stats` | 文档数 + 切片数 |
| `POST` | `/api/knowledge/rebuild` | 重建索引 |
| `POST` | `/api/knowledge/upload` | 上传文档 |
| `DELETE` | `/api/knowledge/{filename}` | 删除文档 |
| `GET` | `/coding/{path}` | 生成文件访问 |
| `GET` | `/static/{path}` | 静态资源（CSS/JS） |

---

## 8 工具速查

| 工具 | 功能 |
|------|------|
| `search_knowledge` | 查询 ChromaDB 知识库 |
| `read_file` | 读取 coding/ 目录文件 |
| `write_file` | 写入 coding/ 目录文件 |
| `calculate` | AST 安全数学表达式求值 |
| `analyze_data` | CSV/Excel 分组聚合分析 |
| `visualize_data` | Pillow 绑图（柱状图/折线图） |
| `ocr_image` | Tesseract 中英文图片 OCR |

---

## 9 版本历史

| 版本 | 日期 | 关键变化 |
|------|------|---------|
| v1.0 | 2026-06-11 | 4 角色 AG2，仅编程，控制台 |
| v2.0 | 2026-06-14 | 8 Agent + Router，Streamlit，RAG |
| v2.1 | 2026-06-17 | UI/UX 优化，非 Python 拦截 |
| v3.0 | 2026-06-22 | LangGraph+LangChain，Tesseract OCR，手动车道 |
| **v3.1** | **2026-06-23** | **Streamlit→FastAPI Web，Router 恢复，5 类型，exitcode 分支，自动/手动车道，UI 折叠** |
