# Phase 2: SSE 流式引擎 + daisyUI 迁移 — 设计规格书

> 日期: 2026-06-26
> 版本: 1.0
> 状态: 已确认，待实施
> 参考:
> - `stream_frontend` 分支 (SSE 流式引擎)
> - `frontend-ui-fix` 分支 (UI 设计语言)
> - Phase 1 当前代码库 (RBAC + 工作空间/项目)

---

## 1. 目标

将 `stream_frontend` 分支的 SSE 流式聊天引擎移植到 Phase 1 后端，将前端从 shadcn/ui 迁移到 daisyUI（采用 `frontend-ui-fix` 的设计语言），清理所有冗余文件。

## 2. UI 设计 Token

| Token | 值 | 用途 |
|-------|-----|------|
| `--brand-primary` | `#4f8cff` | 主色、focus ring、发送按钮 |
| `--brand-primary-hover` | `#3d7ae8` | hover 状态 |
| `--bg-chat` | `#FFFFFF` | 聊天区背景 |
| `--bg-sidebar` | `#F9FAFB` | 侧栏背景 |
| `--text-primary` | `#1d1d1f` | 主文字 |
| `--text-secondary` | `#81858c` | 辅助文字 |
| `--bubble-user` | `#EDF3FE` | 用户气泡 |
| `--radius-input` | `24px` | 输入框圆角 |
| `--radius-bubble` | `14px` | 气泡圆角 |
| `--radius-btn` | `50px` | 胶囊按钮 |

## 3. 架构变更

### 3.1 新增文件

```
router/                          ← 从 stream_frontend 移植
├── __init__.py
├── classify.py                  ← 改进版意图分类器
├── stream_state.py              ← SSE 会话状态
├── stream_graph.py              ← 流式 LangGraph
├── stream.py                    ← 后台线程引擎
└── router.py                    ← SSE API 端点

frontend/src/
├── api/stream.ts                ← SSE 客户端
├── hooks/useStreamChat.ts       ← 流式聊天 hook
├── components/shared/
│   ├── StreamingBubble.tsx      ← 流式消息气泡
│   ├── AgentCard.tsx            ← Agent 卡片
│   ├── ThinkingPanel.tsx        ← 思考折叠面板
│   ├── ChatInput.tsx            ← 输入框组件
│   ├── WelcomeScreen.tsx        ← 欢迎页
│   ├── ModeSelector.tsx         ← 模式选择器
│   └── CodeBlock.tsx            ← 代码块（含复制）
├── components/layout/
│   ├── AppShell.tsx             ← 重写 (daisyUI drawer)
│   ├── Sidebar.tsx              ← 重写 (daisyUI menu)
│   └── Header.tsx               ← 重写 (daisyUI navbar)
└── pages/
    ├── auth/LoginPage.tsx       ← 重写 (daisyUI)
    ├── auth/RegisterPage.tsx    ← 重写 (daisyUI)
    ├── workspace/
    │   ├── WorkspaceOverview.tsx← 重写 (daisyUI card)
    │   └── WorkspaceDetail.tsx  ← 重写 (daisyUI card + modal)
    ├── project/ChatPage.tsx     ← 重写 (SSE 流式)
    └── settings/SettingsPage.tsx← 重写 (daisyUI)
```

### 3.2 修改文件

```
main.py                          ← 注册 router 路由，移除 Jinja2 挂载
agents.py                        ← 增加 _stream_llm 支持 (如需要)
frontend/src/index.css           ← daisyUI + 设计 token
frontend/package.json            ← 移除 shadcn 依赖，添加 daisyui
frontend/vite.config.ts          ← 移除 @tailwindcss/vite (daisyUI 自带)
```

### 3.3 删除文件

```
templates/                       ← 旧 Jinja2 前端（整个目录）
static/                          ← 旧静态资源（整个目录）
frontend/src/components/ui/      ← shadcn/ui 组件（整个目录，保留 sonner.tsx）
frontend/components.json         ← shadcn 配置
```

## 4. SSE API 协议

### 4.1 端点

```
POST /api/chat/start          ← 创建流式会话，启动后台线程
                                 请求: {message, lane_mode, history}
                                 响应: {session_id}
                                 鉴权: require_auth

GET  /api/chat/stream/{id}    ← SSE 连接 (text/event-stream)
                                 鉴权: session 归属校验

POST /api/chat/cancel/{id}    ← 中断流式执行
                                 鉴权: session 归属校验

GET  /api/chat/sessions       ← 活跃会话列表
                                 鉴权: require_admin (debug)
```

### 4.2 事件类型

| type | 字段 | 说明 |
|------|------|------|
| `agent_start` | `name` | Agent 开始执行 |
| `token` | `name`, `content` | 逐 token 流式输出 |
| `agent_end` | `name`, `content` | Agent 完成，完整输出 |
| `done` | `reply`, `thinking`, `task_type` | 工作流全部完成 |
| `error` | `content` | 错误信息 |
| `cancelled` | — | 已被用户中断 |

## 5. 前端组件映射

### 5.1 chat.js → React 翻译

| 旧版函数/变量 | 新版 React 实现 |
|--------------|----------------|
| `messageHistory` (全局数组) | `useState<Message[]>([])` |
| `_streamSessionId` | `useRef<string \| null>(null)` |
| `_streamReader` | `useRef<ReadableStreamDefaultReader \| null>(null)` |
| `sendMessage()` | `useStreamChat().start()` |
| `abortStream()` | `useStreamChat().abort()` |
| `handleStreamEvent()` | `processEvent()` in useStreamChat |
| `createAssistantSkeleton()` | `<StreamingBubble>` 组件 |
| `appendUserMessage()` | `setMessages(prev => [...prev, msg])` |
| `markdownToHtml()` | `<ReactMarkdown>` 或 marked 包装 |
| `saveCurrentSession()` | `useEffect` 自动保存 |
| `regenerate()` | `handleRegenerate()` |

### 5.2 设计风格对应

| frontend-ui-fix 元素 | React 实现 |
|---------------------|-----------|
| `.chat-welcome` | `<WelcomeScreen>` 组件 |
| `.message-user .bubble` | `bg-[#EDF3FE] rounded-[14px]` |
| `.message-assistant .bubble` | `bg-transparent border-none shadow-none` |
| `.agent-card` | `<AgentCard>` 组件 |
| `.thinking-section` | `<ThinkingPanel>` 组件 |
| `.mode-bar` / `.mode-chip` | `<ModeSelector>` 组件 |
| `.code-block` | `<CodeBlock>` 组件 |
| `.new-chat-btn` | daisyUI `btn rounded-full` |
| `.config-input` | daisyUI `input input-bordered` |
| `.config-btn` | daisyUI `btn btn-primary` |

## 6. Phase 2A 任务清单

| # | 任务 | 文件 | 工作量 |
|---|------|------|--------|
| A1 | 移植 SSE 流式引擎 + RBAC | `router/` 全部 + `main.py` | 2h |
| A2 | 清理冗余文件 | 删除 `templates/`, `static/`, `frontend/src/components/ui/`, `components.json` | 0.5h |
| A3 | daisyUI 安装 + 布局组件重写 | `index.css`, `AppShell`, `Sidebar`, `Header`, `LoginPage`, `RegisterPage` | 4h |
| A4 | 流式聊天页 React 重写 | `ChatPage`, `useStreamChat`, `StreamingBubble`, `AgentCard`, `ThinkingPanel`, `ChatInput`, `WelcomeScreen`, `ModeSelector`, `CodeBlock` | 4h |
| A5 | 工作空间 + 设置页 daisyUI 重写 | `WorkspaceOverview`, `WorkspaceDetail`, `SettingsPage` | 2h |
| A6 | 联调 + 部署 | 全栈测试 + Cloudflare Pages | 2h |

## 7. 自检清单

- [x] 无 TBD/TODO 残留
- [x] 功能完整性：stream_frontend 全部功能 + Phase 1 全部功能 + frontend-ui-fix UI 设计
- [x] 冗余清理：旧 Jinja2 + shadcn/ui 全部删除
- [x] API 兼容：旧 `/api/chat` 端点保留向后兼容（新增 `/api/chat/start` 等）
- [x] 权限集成：SSE session 归属校验，require_auth
- [x] 无依赖冲突：daisyUI 5 + Tailwind CSS 4 兼容
