# 多智能体协作系统 v3.2

基于 **LangGraph + LangChain** 的七角色多智能体协作系统，支持编程 / 写作 / 分析 / 问答 / 闲聊 5 种任务，集成 Router 意图分类、ChromaDB RAG 知识库、Tesseract OCR、exitcode 驱动修复循环、SQLite 用户会话持久化，前端采用 **FastAPI + Jinja2 + daisyUI + Tailwind CSS** 技术栈。

---

## 1 项目概述

用户输入任务 → **Router LLM** 自动分类意图（5 类型 + 轻/重复杂度）→ 系统通过 **LangGraph StateGraph** 编排 **7 个专业 Agent** 协作完成。快车道 Bot 秒级回复，慢车道多 Agent 流水线含 exitcode 分支和 ≤2 轮修复循环。

### 1.1 角色列表

| 角色 | 图标 | 职责 | 工具 |
|------|:----:|------|------|
| **Router** | 🧠 | 意图分类（编程/写作/分析/问答/闲聊 + 轻/重） | 独立 LLM 调用 |
| **Bot** | 🤖 | 快车道直接回复 | 无 |
| **Planner** | 📋 | 拆解任务，制定步骤 | 无 |
| **Retriever** | 🔍 | 搜索知识库 | `search_knowledge` |
| **Coder** | 💻 | 编写 Python 代码 / 数据分析 | `write_file`, `read_file`, `calculate`, `analyze_data`, `visualize_data` |
| **Writer** | ✍️ | 撰写报告/方案/文章 | `write_file`, `read_file`, `search_knowledge` |
| **Tester** | ✅ | 审查代码/文档 | `read_file` |
| **Summarizer** | 📊 | 汇总为结构化报告 | 无 |

> Router 是独立轻量 LLM 调用（非 Agent），通过 `urllib` 直接调 DeepSeek API。7 个 Agent 统一使用 DeepSeek API，通过 LangChain ChatDeepSeek 接入。

### 1.2 支持的任务

| 类型 | 示例 | Router 判定 |
|------|------|:------:|
| 编程 | "写一个快排" / "实现 LRU Cache" | 编程\|重 |
| 写作 | "写一份市场分析报告" | 写作\|重 |
| 分析 | "分析 CSV 销售数据" | 分析\|重 |
| 问答 | "什么是机器学习" | 问答\|轻 |
| 闲聊 | "你好" / "你是谁" | 闲聊\|轻 |

### 1.3 关键词覆写

Router 分类后，系统通过正则检测做二次修正：

| 优先级 | 检测 | 触发词 | 覆写效果 |
|:------:|------|--------|---------|
| 1 | 搜索关键词 | 搜索/查资料/检索/基于知识库 | 强制慢车道（重） |
| 2 | 分析关键词 | 以"分析"开头 | 强制慢车道 + 分析类型 |
| 3 | 非 Python 语言 | C语言/Java/Rust/Go/C++/C# | 降级为问答 + 快车道 |

---

## 2 快速开始

### 2.1 前提条件

- Python 3.11+
- DeepSeek API Key（设环境变量 `DEEPSEEK_API_KEY`）
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

编辑 `config.py` 的 `MODEL_POOL` 添加新模型，`ROLE_MODEL` 指定各角色使用的模型。支持通过前端 UI 动态添加自定义模型（localStorage 持久化）。

---

## 3 快慢车道

### 3.1 三种模式

侧边栏 **执行模式** 区域选择：

| 模式 | 图标 | 行为 | 适用场景 |
|------|:----:|------|------|
| **自动** | 🧠 | Router LLM 分类 + 关键词覆写 → 自动选车道 | 日常使用（默认） |
| **快车道** | 🚀 | Bot 直接回复，<3s | 强制快速回复 |
| **慢车道** | 🔄 | 7 Agent 协作流水线 | 强制完整流程 |

### 3.2 Router 意图分类

Router 是一次独立 LLM 调用（非 Agent），返回 `(任务类型, 复杂度)`：

- 5 种类型：编程 / 写作 / 分析 / 问答 / 闲聊
- 2 种复杂度：轻 → 快车道 / 重 → 慢车道
- 实现：`router.py`，temperature=0，max_tokens=50，thinking disabled

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
- Agent 通过 `search_knowledge` 工具检索相关内容（min_score=0.40）
- 嵌入模型：BAAI/bge-small-zh-v1.5（离线加载，首次 ~10s）
- 支持按文件名删除文档、重建全量索引

### 图片 OCR

- 上传 PNG/JPG → 自动 Tesseract OCR → 文字存入知识库（`_ocr.txt`）
- `ocr_image` 工具可供 Agent 在任务中调用
- 支持中英文混合识别（chi_sim+eng）

> ⚠️ 需要安装 Tesseract-OCR：https://github.com/UB-Mannheim/tesseract/wiki

---

## 5 用户与会话管理

### 5.1 用户系统

- 用户名弹窗设置，幂等创建（同一用户名多次注册返回同一 ID）
- 用户信息缓存在 localStorage，服务端存储在 SQLite `users` 表

### 5.2 会话持久化

- 每次对话自动保存到 SQLite `sessions` 表
- 侧边栏历史对话列表，点击恢复完整上下文
- 支持"开启新对话"清空当前会话
- SQLite WAL 模式，支持多用户并发读写

---

## 6 技术栈

| 领域 | 技术 |
|------|------|
| Agent 框架 | **LangGraph ≥0.2**（StateGraph 编排 + 条件路由） |
| Agent 实现 | **LangChain ≥0.3**（ChatDeepSeek + @tool） |
| LLM | DeepSeek V4 Flash |
| Web 框架 | **FastAPI** + **Jinja2** + **daisyUI 5** + **Tailwind CSS 4** |
| 意图分类 | **Router**（独立 LLM 调用，urllib） |
| 代码执行 | subprocess 沙箱（`executor.py`） |
| 知识库 | ChromaDB + BAAI/bge-small-zh-v1.5 |
| OCR | Tesseract + Pillow |
| 数据分析 | Pandas + Pillow |
| 数据库 | SQLite（WAL 模式，标准库 sqlite3） |
| 前端交互 | 原生 JavaScript（fetch + DOM 渲染） |

---

## 7 项目结构

```
├── main.py              # FastAPI 入口 + 路由（页面/聊天/报告/配置/用户/会话）
├── db.py                # SQLite 数据库封装（用户 + 会话两张表）
├── router.py            # Router 意图分类器（独立 LLM 调用）
├── config.py            # 模型配置（MODEL_POOL + ROLE_MODEL）
├── workflow.py          # LangGraph 工作流（exitcode 分支 + speaking_log）
├── executor.py          # 代码执行沙箱（subprocess 隔离）
├── agents.py            # 7 个 Agent System Prompts + LLM 缓存
├── tools.py             # 7 个 LangChain Tool（含 OCR）
├── requirements.txt     # 依赖清单
│
├── app/
│   ├── chat.py          # 聊天管道（Router + 关键词覆写 + 90s 超时守护）
│   ├── knowledge.py     # 知识库 API 路由（FastAPI Router）
│   └── ocr.py           # Tesseract OCR 模块
│
├── templates/
│   ├── base.html        # Jinja2 布局骨架（daisyUI drawer 布局）
│   ├── index.html       # 聊天主页面
│   └── components/
│       └── sidebar.html # 侧边栏（模式/角色/模型/知识库/用户/历史）
│
├── static/
│   ├── css/custom.css   # 自定义样式（气泡 + 折叠动画）
│   └── js/chat.js       # 聊天交互（fetch + 会话管理 + 报告生成）
│
├── tests/
│   └── test_knowledge_routes.py  # 知识库 API 自动化测试（6 个用例）
│
├── rag/
│   ├── knowledge_base.py  # ChromaDB 封装（离线加载优化）
│   ├── documents/         # 上传的知识文档
│   └── chroma_db/         # 向量数据库持久化
│
├── coding/              # 代码执行工作目录
├── reports/             # 报告输出目录
└── data.db              # SQLite 数据库文件（用户 + 会话）
```

---

## 8 API 路由

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/` | 聊天页面（Jinja2 渲染） |
| `POST` | `/api/chat` | 发送消息 `{message, lane_mode, history, model_config}` |
| `POST` | `/api/report` | 从 thinking 记录生成 Markdown 报告 |
| `GET` | `/api/knowledge/stats` | 文档数 + 切片数 |
| `POST` | `/api/knowledge/rebuild` | 重建 ChromaDB 索引 |
| `POST` | `/api/knowledge/upload` | 上传文档（PDF/TXT/PNG/JPG） |
| `DELETE` | `/api/knowledge/{filename}` | 删除文档 |
| `POST` | `/api/users` | 创建用户（幂等） |
| `GET` | `/api/users?name=` | 按名称查找用户 |
| `GET` | `/api/sessions?user_id=` | 列出用户会话摘要 |
| `POST` | `/api/sessions` | 保存/创建会话 |
| `GET` | `/api/sessions/{id}` | 获取会话完整消息 |
| `DELETE` | `/api/sessions/{id}` | 删除会话 |
| `POST` | `/api/config/roles` | 保存角色→模型映射 |
| `GET` | `/api/config/roles` | 获取角色→模型映射 |
| `POST` | `/api/config/models` | 添加自定义模型 |
| `DELETE` | `/api/config/models/{name}` | 删除自定义模型 |
| `GET` | `/coding/{path}` | 生成文件访问（图片/代码/文档） |
| `GET` | `/static/{path}` | 静态资源（CSS/JS） |

---

## 9 工具速查

| 工具 | 功能 |
|------|------|
| `search_knowledge` | 查询 ChromaDB 知识库（min_score=0.40） |
| `read_file` | 读取 coding/ 目录文件 |
| `write_file` | 写入 coding/ 目录文件 |
| `calculate` | AST 安全数学表达式求值 |
| `analyze_data` | CSV/Excel 分组聚合分析（Pandas） |
| `visualize_data` | Pillow 绑图（柱状图/折线图，CJK 字体） |
| `ocr_image` | Tesseract 中英文图片 OCR |

---

## 10 版本历史

| 版本 | 日期 | 关键变化 |
|------|------|---------|
| v1.0 | 2026-06-11 | 4 角色 AG2，仅编程，控制台 |
| v2.0 | 2026-06-14 | 8 Agent + Router，Streamlit，RAG |
| v2.1 | 2026-06-17 | UI/UX 优化，非 Python 拦截 |
| v3.0 | 2026-06-22 | LangGraph+LangChain，Tesseract OCR，手动车道 |
| v3.1 | 2026-06-23 | Streamlit→FastAPI Web，Router 恢复，5 类型，exitcode 分支 |
| **v3.2** | **2026-06-24** | **daisyUI 重构前端，SQLite 用户/会话持久化，lifespan 启动，会话历史恢复** |
