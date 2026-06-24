# 多智能体协作系统 v3.2

<div align="center">

**基于 LangGraph + LangChain 的七角色多智能体协作系统**

[![Python](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-green.svg)](https://fastapi.tiangolo.com/)
[![LangGraph](https://img.shields.io/badge/LangGraph-0.2+-orange.svg)](https://langchain-ai.github.io/langgraph/)
[![daisyUI](https://img.shields.io/badge/daisyUI-5-purple.svg)](https://daisyui.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## 📖 项目简介

一个由 **7 个专业 AI Agent** 组成的多智能体协作系统。用户用自然语言描述需求，系统自动识别任务意图，通过 **LangGraph 状态图**编排多个 Agent 按流程协作，完成编程开发、报告撰写、数据分析、知识问答等复杂任务。

**核心特色：** Router 自动意图分类 → 快慢双车道 → 7 Agent 协作流水线 → exitcode 确定性分支 → 代码修复循环 → 结构化报告输出。

---

## ✨ 核心功能

### 🤖 七大专业 Agent

| Agent | 角色 | 能力 |
|:-----:|------|------|
| 📋 **Planner** | 规划师 | 拆解复杂任务为可执行步骤清单 |
| 🤖 **Bot** | 快车道接待 | 轻任务秒级直接回复 |
| 🔍 **Retriever** | 检索员 | 查询 ChromaDB 知识库获取背景信息 |
| 💻 **Coder** | 程序员 | Python 代码编写 + 数据分析 + 图表生成 |
| ✍️ **Writer** | 撰稿人 | 报告/方案/文章撰写，支持引用知识库 |
| ✅ **Tester** | 审查员 | 代码质量评审 + 文档内容检查 |
| 📊 **Summarizer** | 汇总师 | 汇总全流程，输出结构化 Markdown 报告 |

### 🧠 智能任务调度

- **自动意图分类**：Router LLM 识别 5 种任务类型（编程/写作/分析/问答/闲聊）+ 轻/重复杂度
- **快慢双车道**：轻任务 Bot 秒级回复，重任务 7 Agent 完整流水线
- **三层安全网**：关键词正则检测兜底 Router 误判（搜索/分析/非 Python 语言）
- **确定性路由**：exitcode（操作系统返回值）驱动代码修复分支，不受 LLM 幻觉影响
- **自动修复循环**：代码执行失败时自动重试修复（上限 2 轮）

### 🔧 工具链

| 工具 | 功能 |
|------|------|
| `search_knowledge` | ChromaDB 向量语义检索 |
| `read_file` / `write_file` | 文件读写 |
| `calculate` | AST 安全数学表达式计算 |
| `analyze_data` | Pandas 数据分析（CSV/Excel） |
| `visualize_data` | Pillow 图表生成（柱状图/折线图） |
| `ocr_image` | Tesseract 中英文图片 OCR |

### 💾 数据持久化

- **用户系统**：用户名注册，幂等设计，同一用户名多次注册返回同一 ID
- **会话管理**：对话自动保存到 SQLite，支持历史恢复，跨设备访问
- **WAL 模式**：读写并发，多 tab 同时访问不阻塞

---

## 🚀 快速开始

### 环境要求

- Python 3.11+
- DeepSeek API Key
- Tesseract-OCR（可选，使用 OCR 功能时需要）

### 安装

```bash
# 克隆仓库
git clone https://github.com/Uruzill/Multi-Agent-System.git
cd Multi-Agent-System

# 安装依赖
pip install -r requirements.txt
```

### 配置

设置环境变量：

```bash
# Windows PowerShell
$env:DEEPSEEK_API_KEY = "your-api-key"

# Linux / macOS
export DEEPSEEK_API_KEY="your-api-key"
```

### 启动

```bash
uvicorn main:app --reload --port 8501
```

浏览器打开 **http://localhost:8501** 即可使用。

### 可选：安装 Tesseract-OCR

如需使用图片 OCR 功能，请安装 Tesseract：

- **Windows**：[UB-Mannheim/tesseract](https://github.com/UB-Mannheim/tesseract/wiki)
- **macOS**：`brew install tesseract`
- **Linux**：`sudo apt install tesseract-ocr`

---

## 🏗️ 系统架构

```
用户输入（自然语言）
    │
    ▼
┌──────────────────────────────────────────┐
│           Router 意图分类器               │
│  编程/写作/分析/问答/闲聊 + 轻/重          │
│  + 关键词覆写安全网（三层正则检测）         │
└──────────────────────────────────────────┘
    │
    ├─ 轻任务 ──→ Bot 快车道（< 3s 回复）
    │
    └─ 重任务 ──→ 慢车道 7 Agent 流水线
                  │
    ┌─────────────┴─────────────────────────┐
    │  Planner → Retriever → Coder/Writer   │
    │     → Executor → Tester → Summarizer  │
    │         ↑          │                   │
    │         └─ 修复(≤2轮) ← exitcode ≠ 0  │
    └──────────────────────────────────────────┘
                  │
                  ▼
          结构化 Markdown 报告 + 执行日志
```

### 慢车道流水线详解

| 步骤 | Agent | 动作 |
|:----:|-------|------|
| 1 | 📋 Planner | 拆解任务为步骤清单，输出 task_type |
| 2 | 🔍 Retriever | 从 ChromaDB 知识库检索相关资料 |
| 3 | 💻/✍️ Coder/Writer | 根据任务类型编写代码或撰写文稿 |
| 4 | ⚙️ Executor | subprocess 沙箱执行代码，返回 exitcode + stdout/stderr |
| 5 | ✅ Tester | 评审代码/文档质量，输出 ✅ 或 ❌ |
| 6 | 📊 Summarizer | 汇总全流程，生成结构化报告 |

**exitcode 分支逻辑：**
- `exitcode = 0` → 进入 Tester 评审
- `exitcode ≠ 0` → 返回 Coder 修复（含 stderr 错误信息），上限 2 轮
- 修复超过 2 轮 → 强制进入 Summarizer，不再重试

---

## 📁 项目结构

```
Multi-Agent-System/
├── main.py                  # FastAPI 入口，18 个 API 端点
├── db.py                    # SQLite 数据库（用户 + 会话持久化）
├── router.py                # Router 意图分类器
├── config.py                # LLM 模型配置
├── workflow.py              # LangGraph 工作流编排
├── executor.py              # subprocess 代码执行沙箱
├── agents.py                # 7 个 Agent System Prompt 定义
├── tools.py                 # 7 个 LangChain 工具
├── requirements.txt         # Python 依赖清单
│
├── app/
│   ├── chat.py              # 聊天管道（Router + 关键词覆写 + 90s 超时）
│   ├── knowledge.py         # 知识库管理 API
│   └── ocr.py               # Tesseract OCR 模块
│
├── templates/               # Jinja2 模板（daisyUI + Tailwind CSS）
│   ├── base.html            # 布局骨架（drawer 抽屉式侧栏）
│   ├── index.html           # 聊天主页面
│   └── components/
│       └── sidebar.html     # 侧边栏组件
│
├── static/
│   ├── css/custom.css       # 自定义样式
│   └── js/chat.js           # 前端交互逻辑
│
├── rag/
│   ├── knowledge_base.py    # ChromaDB 向量数据库封装
│   ├── documents/           # 上传的知识文档（PDF/TXT/图片）
│   └── chroma_db/           # 向量数据库持久化目录
│
├── tests/
│   └── test_knowledge_routes.py  # 知识库 API 测试（6 个用例）
│
├── coding/                  # 代码执行工作目录
├── reports/                 # 报告输出目录
│
├── 答辩报告.md               # 项目答辩报告
└── 最终任务项目要求.txt       # 实训任务书
```

---

## 🌐 API 接口

### 聊天与报告

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/` | 聊天页面 |
| `POST` | `/api/chat` | 发送消息 |
| `POST` | `/api/report` | 生成 Markdown 报告 |

### 知识库管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/knowledge/stats` | 文档数 + 切片数统计 |
| `POST` | `/api/knowledge/rebuild` | 重建全量索引 |
| `POST` | `/api/knowledge/upload` | 上传文档（PDF/TXT/PNG/JPG） |
| `DELETE` | `/api/knowledge/{filename}` | 删除指定文档 |

### 用户管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/users` | 创建用户（幂等） |
| `GET` | `/api/users?name=` | 按名称查找用户 |

### 会话管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/sessions?user_id=` | 列出用户会话摘要 |
| `POST` | `/api/sessions` | 保存/创建会话 |
| `GET` | `/api/sessions/{id}` | 获取会话完整消息 |
| `DELETE` | `/api/sessions/{id}` | 删除会话 |

### 配置管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/config/roles` | 获取角色→模型映射 |
| `POST` | `/api/config/roles` | 保存角色→模型映射 |
| `POST` | `/api/config/models` | 添加自定义模型 |
| `DELETE` | `/api/config/models/{name}` | 删除自定义模型 |

### 静态资源

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/coding/{path}` | 访问生成文件（代码/图片/文档） |
| `GET` | `/static/{path}` | 静态资源（CSS/JS） |

---

## 🧪 运行测试

```bash
pytest tests/ -v
```

6 个测试用例覆盖知识库 CRUD 全流程：

- ✅ 统计查询
- ✅ 索引重建
- ✅ 文件上传
- ✅ 非法类型拦截
- ✅ 文档删除
- ✅ 删除不存在的文档

---

## 📊 版本历史

| 版本 | 日期 | 关键变化 |
|------|------|---------|
| v1.0 | 2026-06-11 | 4 角色 AG2 协作，仅编程任务，控制台交互 |
| v2.0 | 2026-06-14 | 8 Agent + Router 意图分类，Streamlit 前端，ChromaDB RAG |
| v2.1 | 2026-06-17 | UI/UX 优化，非 Python 语言拦截，90s 软超时 |
| v3.0 | 2026-06-22 | AG2 → LangGraph+LangChain 全面迁移，Tesseract OCR，手动快慢车道 |
| v3.1 | 2026-06-23 | Streamlit → FastAPI Web 迁移，Router 恢复，5 任务类型，exitcode 分支 |
| **v3.2** | **2026-06-24** | **daisyUI + Tailwind CSS 前端重构，SQLite 用户/会话持久化，lifespan 启动** |

---

## 🛠️ 技术栈

| 领域 | 技术 |
|------|------|
| Agent 编排 | LangGraph ≥0.2（StateGraph + 条件路由） |
| Agent 实现 | LangChain ≥0.3（ChatDeepSeek + @tool） |
| 大语言模型 | DeepSeek V4 Flash |
| Web 框架 | FastAPI ≥0.115 + Jinja2 ≥3.1 |
| CSS 框架 | daisyUI 5 + Tailwind CSS 4 |
| 前端交互 | 原生 JavaScript（fetch + DOM） |
| 数据库 | SQLite（标准库 sqlite3，WAL 模式） |
| 向量数据库 | ChromaDB ≥1.5 |
| 嵌入模型 | BAAI/bge-small-zh-v1.5（33MB，离线加载） |
| OCR | Tesseract + Pillow |
| 数据分析 | Pandas ≥2.0 |
| 代码执行 | subprocess（60s 超时沙箱） |
| 测试 | pytest + FastAPI TestClient |

---

## 📄 项目任务书对标

本项目基于《最终任务项目要求》中 **"2.13 大模型多智能体协作系统"** 开发，难度系数 ★★★★★，所有需求项均已实现并超预期扩展：

- ✅ 使用 LangGraph 搭建多智能体框架
- ✅ 定义 7 个角色的分工（规划、检索、编程、写作、评审、执行、汇总）
- ✅ 集成 ChromaDB RAG 知识库，支持任务相关资料检索
- ✅ 实现任务拆解 → 步骤执行 → 结果校验的完整闭环
- ✅ 接入 7 个工具（搜索、计算、文件读写、数据分析、可视化、OCR）
- ✅ 输出结构化任务报告与 speaking_log 执行日志
- ✅ 技术栈：Python, LangGraph, LangChain, LLM, RAG, Function Calling, FastAPI（Streamlit 升级）

---

## 📝 许可

MIT License

---

*西北农林科技大学 · 2026 人工智能实训 · 独立拓展项目*
