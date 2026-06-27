# 多智能体协作平台 — Multi-Agent Platform v4.0

> 基于 LangGraph + React 的七角色多智能体协作系统
> 西北农林科技大学 · 2026 人工智能实训

---

## 🚀 项目简介

本平台构建了一个由 **8 个专业 Agent** 组成的多智能体协作系统：Planner（规划）、Retriever（检索）、Coder（编程）、Writer（写作）、Tester（评审）、Summarizer（总结）、Bot（对话）、Executor（执行）。

用户用自然语言描述需求，系统通过 Router 意图分类器自动识别任务类型，由 LangGraph 状态图编排多个 Agent 按流程协作，支持 SSE 实时流式输出。

---

## ✨ 核心功能

### 🤖 Agent 协作引擎
- 8 Agent 角色 + 可自定义开关
- Router 意图分类（5 种任务类型 + 复杂度判断）
- LangGraph StateGraph 动态编排
- SSE 流式实时输出（agent_start/token/agent_end/done）

### 🎨 前端界面
- React 19 + daisyUI 5 + Tailwind CSS 4
- 三栏布局（左侧会话历史 + 中间聊天 + 右侧 Agent 面板）
- Markdown 渲染（语法高亮 + 一键复制）
- 思维链面板（Agent 执行过程展开/折叠）
- 智能滚动（距底部 60px 内自动滚动）
- 游客模式（免认证试用，会话迁移）

### 🔧 编排画布
- React Flow 拖拽 DAG 编辑器
- 11 节点模板（开始 + 8 Agent + Router 条件分支）
- 自定义节点拖入、连线、保存
- Router 条件编辑（双击节点弹窗）

### 📊 监控与评估
- SSE 监控页（Agent 流水线时间线 + Token/耗时统计）
- 评估仪表盘（recharts 饼图/折线图/柱状图）
- eval_logs 表 + API 自动记录

### 👥 团队协作
- 组织创建/加入（6 位邀请码）
- 团队聊天（频道切换 + 实时消息）
- @agent 命令（总结讨论/创建待办/搜索知识库）
- 待办面板（创建/分配/完成）

### 📚 知识库
- 文件上传（PDF/TXT/PNG/JPG）
- 拖拽上传 + 独立管理页面
- ChromaDB 向量索引（BAAI/bge-small-zh-v1.5）
- OCR 图片识别 + Agent 直接读取上传文件

### 🛠 开发者工具
- Agent 设计器（提示词编辑器）
- 模板市场（6 套预设模板，一键创建项目）
- Scalar API 文档（/scalar）
- 管理后台（用户管理 + 权限控制）

---

## 🏗 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 · TypeScript · daisyUI 5 · Tailwind CSS 4 · React Router 6 · TanStack Query · Zustand · React Flow · Recharts · Lucide |
| 后端 | FastAPI · LangChain · LangGraph · LangChain-DeepSeek · ChromaDB · SQLite · PyJWT · bcrypt |
| 部署 | Cloudflare Pages（前端）· Render（后端） |

---

## 📁 项目结构

```
Multi_Agent/
├── main.py                  # FastAPI 入口
├── config.py                # 模型与角色配置
├── agents.py                # Agent 定义 + System Prompts
├── tools.py                 # 工具系统（读文件/搜索/计算/图表/OCR/网络搜索）
├── executor.py              # Agent 执行器
├── workflow.py              # 工作流引擎
├── router/                  # 路由模块
│   ├── classify.py          # 意图分类
│   ├── router.py            # 聊天路由
│   ├── stream.py            # SSE 流式引擎
│   ├── stream_graph.py      # LangGraph 状态图
│   └── stream_state.py      # 流式状态定义
├── app/                     # 应用模块
│   ├── chat.py              # 聊天管道
│   ├── knowledge.py         # 知识库 API
│   └── ocr.py               # OCR 模块
├── user/                    # 用户模块
│   ├── auth.py              # 认证（JWT + bcrypt）
│   ├── db.py                # SQLite 数据库（v5 schema）
│   ├── helpers.py           # 依赖注入 + 权限校验
│   └── routes.py            # 用户/会话/配置 API
├── workspace/               # 工作空间模块
│   ├── routes.py            # 工作空间/项目/管理/eval API
│   ├── organizations.py     # 组织管理 API
│   └── team_chat.py         # 团队聊天 API + SSE 推送
├── rag/                     # RAG 检索增强
│   ├── knowledge_base.py    # ChromaDB 向量索引
│   └── documents/           # 用户文档存储
├── docs/                    # 项目文档
│   ├── README.md            # 项目总览
│   ├── api.md               # API 接口文档
│   ├── user.md              # 用户管理体系
│   └── 答辩报告.md           # 答辩报告
├── frontend/                # React 前端
│   └── src/
│       ├── pages/           # 15 个页面
│       ├── components/      # 20+ 组件
│       ├── api/             # 8 个 API 模块
│       ├── hooks/           # useAuth / useStreamChat
│       ├── stores/          # Zustand authStore
│       └── routes/          # React Router 配置
└── requirements.txt         # Python 依赖
```

---

## 🚦 快速开始

```bash
# 后端
pip install -r requirements.txt
uvicorn main:app --reload --port 8501

# 前端
cd frontend && npm install && npm run dev
```

访问 `http://localhost:8501/scalar` 查看 API 文档。

---

## 📜 许可证

MIT License
