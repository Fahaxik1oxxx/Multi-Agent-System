# 多智能体协作系统 v3.0

基于 **LangGraph + LangChain** 的八角色多智能体协作系统，支持编程/写作/分析/问答/闲聊 5 种任务，集成 RAG 知识库、Tesseract OCR、手动快慢车道切换与 FastAPI + Bootstrap 5 专业仪表盘界面。

---

## 1 项目概述

用户输入任务 → 系统通过 **LangGraph StateGraph** 编排 **7 个专业 Agent** 协作完成。

### 1.1 角色列表

| 角色 | 职责 | 工具 |
|------|------|------|
| 🤖 **Bot** | 快车道直接回复 | 无 |
| 📋 **Planner** | 拆解任务，制定步骤 | 无 |
| 🔍 **Retriever** | 搜索知识库 | `search_knowledge` |
| 💻 **Coder** | 编写 Python 代码 | `write_file`, `read_file`, `calculate` |
| ✍️ **Writer** | 撰写报告/方案/文章 | `write_file`, `read_file`, `search_knowledge` |
| ✅ **Tester** | 审查代码/文档 | `read_file` |
| 📊 **Summarizer** | 汇总为结构化报告 | 无 |

> 所有角色统一使用 DeepSeek API，无需本地模型。

### 1.2 支持的任务

| 类型 | 示例 | 建议车道 |
|------|------|:------:|
| 编程 | "写一个快排" / "实现 LRU Cache" | 🔄 慢车道 |
| 写作 | "写一份市场分析报告" | 🔄 慢车道 |
| 分析 | "分析 CSV 销售数据" | 🔄 慢车道 |
| 问答 | "什么是机器学习" | 🚀 快车道 |
| 闲聊 | "你好" / "你是谁" | 🚀 快车道 |

---

## 2 快速开始

### 2.1 前提条件

- Python 3.11+
- DeepSeek API Key（设环境变量 `MULTI_DEEPSEEK_API_KEY`）

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

侧边栏顶部 **⚡ 执行模式** 切换：

| 车道 | 图标 | 行为 | 适用场景 |
|------|:--:|------|------|
| **快车道** | 🚀 | Bot 直接回复，<3s | 闲聊、问答、简单编程 |
| **慢车道** | 🔄 | 7 Agent 协作流水线 | 编程、写作、数据分析 |

> 切换即时生效，系统强制执行你的选择。

### 慢车道流水线

```
Planner → Retriever → [Coder|Writer] → Executor → Tester → Summarizer
                        ↑       │
                        └───────┘ (≤2轮修复循环)
```

---

## 4 知识库 + OCR

### 知识库管理

- 侧边栏 📚 知识库 → 上传 PDF/TXT → 自动切分索引
- Agent 通过 `search_knowledge` 工具检索相关内容

### 🆕 图片 OCR

- 上传 PNG/JPG → 自动 Tesseract OCR → 文字存入知识库
- `ocr_image` 工具可供 Agent 在任务中调用
- 支持中英文混合识别

> ⚠️ 需要安装 Tesseract-OCR：https://github.com/UB-Mannheim/tesseract/wiki

---

## 5 技术栈

| 领域 | 技术 |
|------|------|
| Agent 框架 | **LangGraph ≥0.2**（StateGraph 编排） |
| Agent 实现 | **LangChain ≥0.3**（create_agent + @tool） |
| LLM | DeepSeek V4 Flash |
| 前端 | FastAPI + Jinja2 + Bootstrap 5 |
| 知识库 | ChromaDB + BAAI/bge-small-zh-v1.5 |
| OCR | Tesseract + Pillow |
| 数据分析 | Pandas + Pillow |

---

## 6 项目结构

```
├── main.py              # FastAPI 入口 + 路由 + 启动
├── config.py            # 模型配置（MODEL_POOL + ROLE_MODEL）
├── workflow.py          # LangGraph 工作流（快/慢车道）
├── executor.py          # 代码执行沙箱
├── agents.py            # Agent System Prompts + LLM 创建
├── tools.py             # 7 个 LangChain Tool（含 OCR）
│
├── app/
│   ├── chat.py          # 聊天管道 + 报告生成
│   ├── knowledge.py     # 知识库路由 + 管理
│   └── ocr.py           # Tesseract OCR 模块
│
├── templates/
│   ├── base.html        # Jinja2 基础模板（侧边栏 + 布局）
│   ├── index.html       # 首页聊天界面
│   └── components/      # 可复用模板组件
│
├── static/
│   ├── css/             # 自定义 CSS 样式
│   └── js/              # 前端 JS 交互逻辑
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

## 7 工具速查

| 工具 | 功能 |
|------|------|
| `search_knowledge` | 查询 ChromaDB 知识库 |
| `read_file` | 读取 coding/ 目录文件 |
| `write_file` | 写入 coding/ 目录文件 |
| `calculate` | 安全数学表达式求值 |
| `analyze_data` | CSV/Excel 分组聚合分析 |
| `visualize_data` | Pillow 绑定图表（柱状图/折线图） |
| `ocr_image` | Tesseract 中英文图片 OCR |

---

## 8 常见问题

| 问题 | 解决 |
|------|------|
| 首次启动慢 | 正常——嵌入模型首次加载 ~10s，后续 <5s |
| OCR 报错 "tesseract not installed" | 安装 Tesseract-OCR 并确保在 PATH 中 |
| 知识库搜索无结果 | 侧边栏上传文档 → 点击「重建索引」 |
| DeepSeek API 报错 | 检查 `MULTI_DEEPSEEK_API_KEY` 环境变量 |

---

## 9 版本历史

| 版本 | 日期 | 关键变化 |
|------|------|---------|
| v1.0 | 2026-06-11 | 4 角色 AG2，仅编程，控制台 |
| v2.0 | 2026-06-14 | 8 Agent + Router，Streamlit，RAG |
| v2.1 | 2026-06-17 | UI/UX 优化，非 Python 拦截 |
| **v3.0** | **2026-06-22** | **LangGraph+LangChain，Tesseract OCR，手动车道，UI 美化** |
