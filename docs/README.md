# 多智能体协作平台 — Multi-Agent Platform v4.0

> 基于 LangGraph + React 的八角色多智能体协作平台
> 西北农林科技大学 · 2026 人工智能实训

---

## 项目简介

本平台构建了一个由 **8 个专业 Agent** 组成的多智能体协作系统：Planner（规划）、Retriever（检索）、Coder（编程）、Writer（写作）、Tester（评审）、Summarizer（总结）、Bot（对话）、Executor（执行）。

用户用自然语言描述需求，系统通过 Router 意图分类器自动识别任务类型，由 LangGraph 状态图编排多个 Agent 按流程协作，支持 SSE 实时流式输出。

---

## 核心功能

### Agent 协作引擎
- 8 Agent 角色 + 可自定义开关
- Router 意图分类（5 种任务类型 + 复杂度判断）
- LangGraph StateGraph 动态编排
- SSE 流式实时输出（agent_start/token/agent_end/done）
- 网络搜索（DuckDuckGo 免费）
- Agent 直接读取上传文件

### 前端界面
- React 19 + daisyUI 5 + Tailwind CSS 4
- 三栏布局（侧栏 + 聊天 + 右侧 Agent 面板）
- Markdown 渲染（语法高亮 + 一键复制）
- 思维链面板（Agent 执行过程展开/折叠）
- 左侧栏可收起（48px / 260px 切换）
- 游客模式（免认证试用）

### 编排画布
- React Flow 拖拽 DAG 编辑器
- 自定义节点（Agent / Router / Start）
- 自由连线 + Router 条件编辑
- 保存后动态编译 LangGraph

### 监控与评估
- SSE 监控页（Agent 流水线时间线）
- 评估仪表盘（recharts 图表）
- eval_logs 表 + API

### 团队协作
- 组织创建/加入（6 位邀请码）
- 多频道团队聊天 + SSE 实时推送
- @agent 命令（总结/创建待办/搜索知识库）
- 待办面板（创建/分配/完成）

### 知识库
- 文件上传（PDF/TXT/PNG/JPG）+ 拖拽
- ChromaDB 向量索引 + OCR 识别
- Agent 直接读取上传文件

### 开发者工具
- Agent 设计器（提示词编辑器）
- 模板市场（6 套预设模板）
- Scalar API 文档（/scalar）
- 管理后台 + 游客模式

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 · TypeScript · daisyUI 5 · Tailwind CSS 4 · React Router 6 · TanStack Query · Zustand · React Flow · Recharts |
| 后端 | FastAPI · LangChain · LangGraph · LangChain-DeepSeek · ChromaDB · SQLite v5 · PyJWT · bcrypt |
| 工具 | DuckDuckGo Search · Pandas · Pillow · pytesseract · marked · highlight.js |
| 部署 | Cloudflare Pages + Render |

---

## 快速开始

```bash
# 后端
pip install -r requirements.txt
uvicorn main:app --reload --port 8501

# 前端
cd frontend && npm install && npm run dev
```

访问 `http://localhost:5173` 使用前端，`http://localhost:8501/scalar` 查看 API 文档。

---

## 项目结构

```
Multi_Agent/
├── main.py                  # FastAPI 入口
├── config.py                # 模型与角色配置
├── agents.py                # Agent 定义 + System Prompts
├── tools.py                 # 工具系统（8 工具含 web_search）
├── router/                  # 路由 + SSE + LangGraph
├── app/                     # 聊天管道 + 知识库 + OCR
├── user/                    # 认证 + DB v5 + 权限
├── workspace/               # 工作空间 + 组织 + 团队聊天
├── rag/                     # ChromaDB 向量索引
├── frontend/                # React SPA (15 页面 + 20+ 组件)
└── docs/                    # 项目文档
```

---

## 许可证

MIT License
