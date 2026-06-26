# Multi-Agent Platform 公共平台化重设计 — 设计规格书

> 日期: 2026-06-26
> 版本: 1.0
> 状态: 已确认，待实施

---

## 1. 背景与目标

### 1.1 现状

Multi-Agent Collaboration System v3.5 是一个基于 FastAPI + Jinja2 + LangGraph 的单用户多智能体协作实验平台。当前存在的主要差距：

- **前端**：服务端渲染 HTML + 原生 JS，无组件化架构，无法支撑复杂 UI
- **权限**：仅 guest/registered 二元模型，无 RBAC，无团队协作
- **部署**：仅本地运行，无法作为公共平台对外服务
- **开放**：无 API 文档 UI、无模板共享、无插件机制

### 1.2 目标

将项目升级为 **GitHub 开源公共平台**，使不同用户可以独立注册、创建团队空间、管理各自的智能体群组和环境，支持多人协作维护和二次开发。

### 1.3 核心设计原则

- **低门槛 + 灵活**：平台提供默认免费 API Key，用户可覆盖自己的 Key
- **渐进式改造**：保留后端 LangGraph 核心，前端逐步从 Jinja2 迁移到 React SPA
- **开源友好**：MIT 协议、清晰目录结构、可独立发布的组件库
- **免费部署优先**：Vercel (前端) + Fly.io/Railway (后端) + Supabase Vector (向量库)

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    GitHub 仓库 (Public, MIT)               │
│  ┌──────────────────┐  ┌──────────────────────────────┐  │
│  │   frontend/       │  │   backend/                    │  │
│  │   React + TS      │  │   FastAPI + LangGraph          │  │
│  │   Vite + shadcn   │  │   PostgreSQL + Supabase Vec   │  │
│  └────────┬───────────┘  └──────────────┬───────────────┘  │
└───────────│─────────────────────────────│───────────────────┘
            │                             │
    ┌───────▼──────┐              ┌───────▼──────┐
    │   Vercel     │              │  Fly.io       │
    │  (免费静态)   │  ──REST+WSS─▶│ (免费 VM)     │
    │  frontend    │              │  backend      │
    └──────────────┘              └───────────────┘
```

- **前端**：纯静态 SPA，部署 Vercel（免费 Hobby 层），自动 HTTPS，git push 自动部署
- **后端**：FastAPI 保留核心逻辑，增强 RBAC + WebSocket，部署 Fly.io（3×256MB 免费 VM，不休眠）
- **API Key 策略**：系统提供默认 `DEEPSEEK_API_KEY`，用户在个人设置中可覆盖，后端按 `user_id` 动态选择
- **数据库**：MVP 阶段保留 SQLite，Phase 2 迁移到 PostgreSQL
- **向量存储**：从本地 ChromaDB 迁移到 Supabase Vector（免费 500MB，独立于后端）

---

## 3. 功能模块规划（按优先级）

### P0 — 平台骨架（Phase 1，第 1-2 周）

| 模块 | 作用 | 后端变更 |
|------|------|---------|
| 用户认证与个人中心 | 注册/登录/JWT、个人设置页、API Key 管理 | 增强 auth 路由 |
| RBAC 权限体系 | 四级角色：平台管理员 / 空间 Owner / 项目成员 / 只读访客 | 新增 RBAC 中间件 |
| 团队空间 (Workspace) | 多人共享工作空间，成员邀请与角色分配 | 新增 workspaces 表 |
| 项目隔离 | 每个项目独立会话、知识库、Agent 配置 | 新增 projects 表，重构 sessions 归属 |

### P1 — 核心能力（Phase 2，第 3-4 周）

| 模块 | 作用 | 后端变更 |
|------|------|---------|
| 可视化智能体配置 | 可视化编辑 Agent 角色、System Prompt、工具绑定、模型选择 | 新增 agent_config CRUD |
| 智能体编排画布 | React Flow 拖拽式 DAG 画布，可视化设计 Agent 协作拓扑 | 动态 LangGraph 图构建 |
| 对话流监控与回放 | 实时查看 Agent 思考过程、工具调用、输出，支持历史回放 | WebSocket 推送端点 |
| 场景/环境模板 | 预置场景模板，一键创建项目 | 新增 templates 表 |

### P2 — 评估与开放（Phase 3，第 5-6 周）

| 模块 | 作用 |
|------|------|
| 评估指标仪表盘 | 对话质量评分、延迟、工具成功率、Token 消耗 |
| 实验报告导出 | Markdown/PDF 导出对话流 + 评估结果 |
| 内置 API 文档 | Scalar UI 替代 Swagger UI，内嵌`/docs`路由 |
| 智能体模板市场 | 用户可发布 Agent 配置模板，社区可复用 |

### P3 — 协作与生态（Phase 4，远期）

| 模块 | 作用 |
|------|------|
| 审计日志 | 操作记录、API 调用历史、权限变更追溯 |
| 评论与标注 | 对 Agent 输出进行人工评估（👍/👎+修正建议） |
| 实验 A/B 对比 | 同一输入对比不同 Agent 配置的输出差异 |
| 场景分享与复现 | 生成可分享链接，他人可一键复现完整对话 |
| 插件系统 | 定义 Tool 接口规范，用户可通过 Web UI 注册自定义 HTTP API Tool |

---

## 4. 权限体系设计

### 4.1 四级角色模型

```
Platform Admin (平台管理员)
  └─ 管理所有 Workspace、用户列表、系统配置
     │
     └── Workspace A
         ├── Owner    → 管理成员、修改空间设置、删除空间
         ├── Member   → 创建/编辑项目、配置 Agent、运行实验
         └── Viewer   → 只读查看对话流与评估结果
```

### 4.2 权限矩阵

| Action | Admin | Owner | Member | Viewer | Guest |
|--------|-------|-------|--------|--------|-------|
| view (查看) | ✅ | ✅ | ✅ | ✅ | 仅公开模板 |
| edit (编辑) | ✅ | ✅ | ✅ | ❌ | ❌ |
| delete (删除) | ✅ | ✅ | ❌ | ❌ | ❌ |
| invite (邀请) | ✅ | ✅ | ❌ | ❌ | ❌ |
| manage (管理) | ✅ | ❌ | ❌ | ❌ | ❌ |

### 4.3 数据库新增表

```sql
-- 工作空间
CREATE TABLE workspaces (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    owner_id    TEXT NOT NULL REFERENCES users(id),
    is_public   INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 空间成员
CREATE TABLE workspace_members (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    user_id      TEXT NOT NULL REFERENCES users(id),
    role         TEXT NOT NULL DEFAULT 'member',  -- owner | member | viewer
    joined_at    TEXT DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (workspace_id, user_id)
);

-- 项目
CREATE TABLE projects (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    name         TEXT NOT NULL,
    description  TEXT DEFAULT '',
    template     TEXT DEFAULT '',
    agent_config TEXT DEFAULT '{}',
    created_by   TEXT NOT NULL REFERENCES users(id),
    created_at   TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 用户表增加管理员标记
ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0;
```

### 4.4 前端权限控制

三层控制体系：
1. **路由层**：`<AuthGuard>` 检查登录，`<AdminGuard>` 检查管理员角色
2. **页面层**：`useWorkspacePermission(workspaceId)` hook 返回 `{ role, canEdit, canManage, isAdmin }`
3. **组件层**：`<Can action="edit" subject="agent">...</Can>` 包裹敏感操作

---

## 5. 前端架构重构

### 5.1 技术栈

| 类别 | 选择 | 引入阶段 |
|------|------|---------|
| 框架 | React 18 + TypeScript | Phase 1 |
| 构建 | Vite 5 | Phase 1 |
| UI 库 | shadcn/ui (Radix + Tailwind CSS 3) | Phase 1 |
| 路由 | React Router v6 | Phase 1 |
| 服务端状态 | TanStack Query v5 | Phase 1 |
| 客户端状态 | Zustand | Phase 1 |
| HTTP | Axios (拦截器: JWT注入/401处理) | Phase 1 |
| 编排画布 | React Flow | Phase 2 |
| 代码编辑器 | CodeMirror 6 | Phase 2 |
| 图表 | Recharts | Phase 3 |
| 通知 | Sonner | Phase 1 |

### 5.2 目录结构

```
frontend/
├── src/
│   ├── main.tsx
│   ├── App.tsx                     # 路由 + 全局 Provider
│   ├── routes/index.tsx            # createBrowserRouter
│   ├── pages/                      # 按路由对应
│   │   ├── auth/                   # Login, Register
│   │   ├── workspace/              # WorkspaceOverview, WorkspaceDetail
│   │   ├── project/                # ChatPage, OrchestrationPage, MonitorPage, EvaluationPage
│   │   ├── agent-design/           # AgentDesigner
│   │   ├── templates/              # TemplateMarket
│   │   ├── settings/               # SettingsPage
│   │   └── admin/                  # AdminPage
│   ├── components/
│   │   ├── ui/                     # shadcn/ui 基础组件
│   │   ├── layout/                 # AppShell, Sidebar, Header
│   │   └── shared/                 # 业务组件 (AgentCard, ModelSelect, Guard)
│   ├── hooks/                      # useAuth, usePermission, useWebSocket
│   ├── stores/                     # authStore, workspaceStore, uiStore
│   ├── api/                        # client.ts + 各模块 API
│   ├── lib/                        # permissions.ts, constants.ts
│   └── types/                      # 全局类型定义
```

### 5.3 路由设计

```typescript
const routes = [
  { path: '/login',    element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    path: '/',
    element: <AuthGuard><AppShell /></AuthGuard>,
    children: [
      { index: true,              element: <WorkspaceOverview /> },
      { path: 'w/:wid',           element: <WorkspaceDetail /> },
      { path: 'w/:wid/p/:pid/chat',       element: <ChatPage /> },
      { path: 'w/:wid/p/:pid/orchestra',  element: <OrchestrationPage /> },
      { path: 'w/:wid/p/:pid/monitor',    element: <MonitorPage /> },
      { path: 'w/:wid/p/:pid/eval',       element: <EvaluationPage /> },
      { path: 'agents',           element: <AgentDesigner /> },
      { path: 'templates',        element: <TemplateMarket /> },
      { path: 'settings',         element: <SettingsPage /> },
      { path: 'admin',            element: <AdminGuard><AdminPage /></AdminGuard> },
    ],
  },
];
```

### 5.4 页面清单

| # | 页面 | 路由 | 角色可见 | Phase |
|---|------|------|---------|-------|
| 1 | 工作空间总览 | `/` | 所有登录用户 | P1 |
| 2 | 项目对话页 | `/w/:wid/p/:pid/chat` | Member+ | P1 |
| 3 | 智能体设计器 | `/agents` | Member+ | P2 |
| 4 | 编排画布 | `/w/:wid/p/:pid/orchestra` | Member+ | P2 |
| 5 | 对话流监控 | `/w/:wid/p/:pid/monitor` | Viewer+ | P2 |
| 6 | 评估仪表盘 | `/w/:wid/p/:pid/eval` | Viewer+ | P3 |
| 7 | 模板市场 | `/templates` | 所有用户(含未登录) | P2 |
| 8 | 个人设置 | `/settings` | 所有登录用户 | P1 |
| 9 | 管理后台 | `/admin` | Admin only | P3 |
| 10 | 登录/注册 | `/login`, `/register` | 未登录 | P1 |

---

## 6. MVP 分阶段路线图

### Phase 1 — 平台骨架（第 1-2 周）

交付物：
- [ ] Vite + React + TS + shadcn/ui 项目脚手架
- [ ] 登录/注册页 + JWT 认证流程
- [ ] AppShell 布局（侧边栏 + 顶栏 + 内容区）
- [ ] 工作空间总览页（创建/列表/切换）
- [ ] 项目对话页（迁移现有聊天功能到 React）
- [ ] 个人设置页（Profile + API Key 管理）
- [ ] 后端：新增 workspaces / projects / memberships 表 + 迁移
- [ ] 后端：RBAC 中间件（`require_auth` 增强为 `require_role`）
- [ ] Vercel 首次部署前端

### Phase 2 — 核心能力（第 3-4 周）

交付物：
- [ ] 智能体设计器页（System Prompt 编辑 + 工具绑定）
- [ ] 编排画布页（React Flow 拖拽 DAG）
- [ ] 对话流监控页（WebSocket 实时推送）
- [ ] 模板市场页（基础版）
- [ ] 后端：WebSocket 端点（Agent 步骤推送）
- [ ] 后端：Agent 配置 CRUD API
- [ ] 后端：动态 LangGraph 图构建（从 JSON 配置生成 StateGraph）

### Phase 3 — 评估与开放（第 5-6 周）

交付物：
- [ ] 评估仪表盘页（Recharts 图表）
- [ ] 报告导出（Markdown/PDF）
- [ ] 内置 API 文档页（Scalar UI）
- [ ] 管理后台页
- [ ] 审计日志
- [ ] 后端：统计聚合 API + 导出管道

### Phase 4 — 协作与生态（远期）

- [ ] 评论与标注
- [ ] 实验 A/B 对比
- [ ] 场景分享与复现（share_id 机制）
- [ ] 插件系统（Tool JSON Schema 注册）
- [ ] 组件库独立发布 npm (`@multi-agent/ui`)

---

## 7. 协作与互动功能

### Phase 2-3 可实现

| 功能 | 描述 |
|------|------|
| 对话流实时围观 | WebSocket 推送 Agent 执行步骤到前端时间轴，团队成员可同时观看 |
| 输出标注与纠错 | 👍/👎 + 文字修正建议，存入 `annotations` 表 |
| 实验 A/B 对比 | 同一输入并行跑两个配置，输出并排对比 |
| 场景书签 | 对话中任意节点加书签 + 笔记，生成 share_id |

### Phase 4 远期

| 功能 | 描述 |
|------|------|
| 智能体挑战排行榜 | 标准化评测数据集排名各 Agent 配置 |
| 学习路径引导 | 新用户引导 Wizard：选身份→推荐模板→首条对话示例 |
| 协作白板 | 嵌入 Excalidraw，画 Agent 拓扑草图，一键导出 |
| GitHub App 集成 | PR 中 `@agent review` 触发智能体代码审查 |

---

## 8. 公共性与开放设计

| 特性 | 实现方式 |
|------|---------|
| 内置 API 文档 | FastAPI OpenAPI + Scalar UI，嵌入 `/docs` 路由 |
| 可复用组件库 | `@multi-agent/ui` 独立 npm 包，第三方可安装 |
| 模板市场 | Workspace `is_public=true` 发布配置，社区 Clone |
| 插件/工具扩展 | Tool JSON Schema 注册 + HTTP API Tool 模板 |
| 一键复现 | 每个对话流生成唯一 share_id，公开链接无须登录查看 |

---

## 9. 部署方案

### 推荐组合

| 组件 | 平台 | 免费额度 | 备注 |
|------|------|---------|------|
| 前端 | **Vercel** | 100GB 带宽/月, 自动 HTTPS | git push 自动部署 |
| 后端 | **Fly.io** | 3×256MB VM, 不休眠 | 需信用卡注册，用不完 |
| 数据库 | **Supabase** | 500MB PostgreSQL + Vector | 独立于后端，永久免费 |
| 域名 | **Vercel** | 自动分配 `*.vercel.app` | 可绑定自定义域名 |

### 替代方案

| 后端平台 | 免费额度 | 休眠 | 持久化 | 推荐度 |
|---------|---------|------|--------|--------|
| Fly.io | 3×256MB | 否 | 是 | ⭐⭐⭐⭐⭐ |
| Railway | $5/月 | 否 | 是 | ⭐⭐⭐⭐ |
| Render | 750h/月 | 15min 后 | 付费 | ⭐⭐⭐ |

---

## 10. 自检清单

- [x] 无 TBD/TODO 残留
- [x] 无内部矛盾：前端路由与权限矩阵一致
- [x] 范围适中：按 Phase 拆分，每阶段独立可交付
- [x] 不引入不必要依赖：Redux/AntD/Next.js/Socket.IO 明确排除
- [x] API Key 策略与 RBAC 模型统一：默认 Key + 用户可覆盖
- [x] 部署方案覆盖全栈：前端 Vercel + 后端 Fly.io + 数据库 Supabase
