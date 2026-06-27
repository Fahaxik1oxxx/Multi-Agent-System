# 多智能体协作系统 — API 接口文档 v4.0

> 后端 FastAPI · 前端 React → 所有接口按模块分组
> 更新日期：2026-06-27

---

## 目录

1. [聊天接口](#1-聊天接口)
2. [SSE 流式接口](#2-sse-流式接口)
3. [报告生成](#3-报告生成)
4. [认证](#4-认证)
5. [用户配置](#5-用户配置)
6. [会话管理](#6-会话管理)
7. [知识库](#7-知识库)
8. [工作空间](#8-工作空间)
9. [项目管理](#9-项目管理)
10. [组织管理](#10-组织管理)
11. [团队聊天](#11-团队聊天)
12. [评估日志](#12-评估日志)
13. [管理后台](#13-管理后台)
14. [系统](#14-系统)

---

## 1. 聊天接口

### POST /api/chat

处理用户消息，返回 Agent 协作结果（需认证）。

**请求体：**

```json
{
  "message": "分析各产品销售额占比",
  "lane_mode": "auto",
  "history": [],
  "model_config": null
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | str | 是 | 用户输入 |
| `lane_mode` | str | 否 | `auto` / `fast` / `slow`，默认 `auto` |
| `history` | list | 否 | 历史消息，用于上下文摘要 |
| `model_config` | dict\|null | 否 | 角色→模型映射覆盖 |

**响应：**

```json
{
  "reply": "分析完成！",
  "thinking": [
    {"name": "Planner", "content": "## 执行计划\n1. 读取数据..."},
    {"name": "Coder", "content": "```python\nimport pandas...```"},
    {"name": "Tester", "content": "✅ 代码正确"},
    {"name": "Summarizer", "content": "## 分析报告..."}
  ],
  "task_type": "分析",
  "generated_files": []
}
```

### POST /api/chat/guest

游客免认证聊天端点。参数同 `/api/chat`，但不持久化会话，使用系统默认 API Key。

---

## 2. SSE 流式接口

### POST /api/chat/start

发起流式会话。

**请求体：** 同 `/api/chat`

**响应：**
```json
{"session_id": "abc123-def456"}
```

### GET /api/chat/stream/{session_id}

连接 SSE 流，实时接收 Agent 输出。

**事件类型：**

| event.type | 字段 | 说明 |
|-----------|------|------|
| `agent_start` | `name` | Agent 开始执行 |
| `token` | `name`, `content` | Agent 输出流式 token |
| `agent_end` | `name`, `content`, `elapsed_ms`, `token_count` | Agent 执行完成 |
| `done` | `reply`, `thinking`, `task_type` | 全部完成 |
| `error` | `content` | 错误信息 |
| `cancelled` | — | 用户取消 |

**示例：**
```
data: {"type":"agent_start","name":"Planner"}
data: {"type":"token","name":"Planner","content":"#"}
data: {"type":"token","name":"Planner","content":" 执行计划"}
data: {"type":"agent_end","name":"Planner","content":"# 执行计划\n1. ...","elapsed_ms":2340,"token_count":145}
data: {"type":"done","reply":"分析完成","thinking":[...],"task_type":"分析"}
```

### POST /api/chat/cancel/{session_id}

取消正在进行的流式会话。

---

## 3. 报告生成

### POST /api/report

从 thinking 记录生成 Markdown 报告。

**请求体：**
```json
{
  "thinking": [
    {"name": "Planner", "content": "..."},
    {"name": "Coder", "content": "..."}
  ]
}
```

**响应：**
```json
{
  "content": "# 报告标题\n## ...",
  "path": "reports/report_1719130000.md"
}
```

---

## 4. 认证

### POST /api/auth/register

注册新用户。

```json
// Request
{"name": "alice", "password": "secret123"}
// Response 201
{"token": "<jwt>", "user_id": "abc12345", "name": "alice"}
```

### POST /api/auth/login

登录。

```json
// Request
{"name": "alice", "password": "secret123"}
// Response
{"token": "<jwt>", "user_id": "abc12345", "name": "alice"}
```

### POST /api/auth/logout

退出登录。返回 `{"status": "ok"}`。

### GET /api/auth/me

获取当前用户信息（需 Authorization: Bearer \<token\>）。

```json
{"user_id": "abc12345", "user_name": "alice"}
```

### GET /api/auth/verify

校验 JWT 是否有效。

```json
{"valid": true, "user_id": "abc12345", "user_name": "alice"}
```

### GET /api/auth/system-config

获取系统默认模型配置（无需认证）。

```json
{
  "default_roles": {"Planner": "a-deepseek", "Coder": "a-deepseek", ...},
  "model_pool": {"a-deepseek": {"model": "deepseek-v4-flash", "api_key": "...", "base_url": "https://api.deepseek.com/v1"}}
}
```

---

## 5. 用户配置

> 以下接口均需认证。

### GET /api/user/config

获取用户角色配置和模型池。

```json
{
  "roles": {"Planner": "a-deepseek", ...},
  "models": [{"key": "my-gpt", "model": "gpt-4o", ...}],
  "system_models": {"a-deepseek": {"model": "deepseek-v4-flash", ...}}
}
```

### PUT /api/user/config

保存角色映射配置。

```json
// Request
{"roles": {"Planner": "a-deepseek", "Coder": "my-gpt"}}
// Response
{"status": "ok"}
```

### POST /api/user/custom-models

添加自定义模型。

```json
// Request
{"key": "my-gpt", "model": "gpt-4o", "base_url": "https://api.openai.com/v1", "api_key": "sk-..."}
// Response 200
{"status": "ok"}
```

### DELETE /api/user/custom-models/{model_key}

删除自定义模型。

### GET /api/user/profile

获取用户 Profile。

```json
{"user_id": "abc12345", "user_name": "alice", "is_admin": false, "created_at": "2026-06-27 10:00"}
```

### PUT /api/user/profile

更新用户名或密码。

```json
// Request
{"name": "new_name", "password": "new_password"}
```

### GET /api/user/api-key

获取 API Key 状态（不返回完整 Key）。

```json
{"has_custom_key": true, "key_prefix": "sk-bdcb..."}
```

### PUT /api/user/api-key

设置自定义 DeepSeek API Key。

```json
// Request
{"api_key": "sk-bdcb0b2e86d140248d0d65caf2fa3a54"}
```

### DELETE /api/user/api-key

删除自定义 API Key，回退到系统默认。

---

## 6. 会话管理

> 需认证，SQLite 持久化 + FTS5 全文索引，按用户隔离。

### GET /api/sessions

列出当前用户的所有会话摘要。

```json
[
  {"id": "1719130000000", "title": "分析销售额", "count": 6, "updated": "2026-06-27 15:30"}
]
```

### GET /api/sessions/search?q=xxx&limit=20&offset=0

FTS5 全文检索会话消息，返回带高亮标记的结果。

```json
[
  {"session_id": "1719130000000", "msg_index": 3, "role": "assistant", "snippet": "...<mark>爬虫</mark>..."}
]
```

### POST /api/sessions

保存/创建会话。

```json
// Request
{"id": "1719130000000", "title": "标题", "messages": [...]}
// Response
{"id": "1719130000000", "status": "ok"}
```

### GET /api/sessions/{session_id}

获取单个会话完整消息。

### DELETE /api/sessions/{session_id}

删除会话。

---

## 7. 知识库

> 路由前缀 `/api/knowledge`，需认证。

### GET /api/knowledge/files

列出用户知识库文件。

```json
[{"name": "data.csv", "size": 1024}]
```

### GET /api/knowledge/stats

获取向量索引统计。

### POST /api/knowledge/upload

上传文件（multipart/form-data，字段名 `file`）。

支持格式：PDF · TXT · PNG · JPG（≤5MB）

PNG/JPG 自动 OCR 提取文字并返回 `.txt`。

上传的 TXT/PDF 文件同时复制到 `coding/` 目录，Agent 的 `read_file` 工具可直接读取。

### POST /api/knowledge/rebuild

重建 ChromaDB 向量索引。

### DELETE /api/knowledge/{filename}

删除知识库文件。

---

## 8. 工作空间

> 路由前缀 `/api/workspaces`，需认证。

### GET /api/workspaces

列出我的工作空间。

### POST /api/workspaces

创建工作空间。

```json
// Request
{"name": "我的空间", "description": ""}
// Response 201
{"id": "ws-abc", "name": "我的空间", "status": "ok"}
```

### GET /api/workspaces/{workspace_id}

获取工作空间详情（含成员列表、项目列表、我的角色）。

### PUT /api/workspaces/{workspace_id}

更新工作空间（需 owner）。

### DELETE /api/workspaces/{workspace_id}

删除工作空间（需 owner）。

### POST /api/workspaces/{workspace_id}/members

邀请成员（需 owner）。

```json
// Request
{"user_name": "bob", "role": "member"}
```

### DELETE /api/workspaces/{workspace_id}/members/{user_id}

移除成员（需 owner）。

---

## 9. 项目管理

> 需认证。

### GET /api/w/{workspace_id}/projects

列出工作空间下的项目。

### POST /api/w/{workspace_id}/projects

创建项目（需 member 以上）。

```json
// Request
{"name": "新项目", "description": ""}
// Response 201
{"id": "proj-abc", "name": "新项目", "status": "ok"}
```

### GET /api/projects/{project_id}

获取项目详情（校验 workspace 成员身份）。

### DELETE /api/projects/{project_id}

删除项目（需 owner/member）。

---

## 10. 组织管理

> 路由前缀 `/api/orgs`，需认证。

### GET /api/orgs

我的组织列表（含成员数和我的角色）。

### POST /api/orgs

创建组织。

```json
// Request
{"name": "软件工程小组", "description": ""}
// Response 201
{"id": "org-abc", "name": "软件工程小组", "status": "ok"}
```

### GET /api/orgs/{org_id}

组织详情 + 成员列表（需成员身份）。

### PUT /api/orgs/{org_id}

更新组织信息（需 owner）。

### DELETE /api/orgs/{org_id}

删除组织及所有关联数据（需 owner）。

### POST /api/orgs/{org_id}/members

邀请成员。

```json
// Request
{"user_name": "bob"}
```

### DELETE /api/orgs/{org_id}/members/{user_id}

移除成员（需 owner）。

### POST /api/orgs/join

通过 6 位邀请码加入组织。

```json
// Request
{"code": "A1B2C3"}
// Response
{"id": "org-abc", "name": "小组", "status": "ok"}
```

---

## 11. 团队聊天

> 路由前缀 `/api/orgs`，需认证 + 组织成员身份。

### GET /api/orgs/{org_id}/channels

频道列表（至少包含默认 "general" 频道）。

### POST /api/orgs/{org_id}/channels

创建频道。

```json
// Request
{"name": "开发讨论"}
```

### GET /api/orgs/{org_id}/channels/{channel_id}/messages

消息列表（最近 50 条）。

### POST /api/orgs/{org_id}/channels/{channel_id}/messages

发送消息。自动检测 `@agent` 命令前缀。

```json
// Request
{"content": "@agent 总结一下"}
```

**@agent 命令：**

| 命令 | 行为 |
|------|------|
| `@agent 总结一下` | LLM 总结最近 20 条消息 |
| `@agent 创建待办: xxx @user` | 创建待办并分配 |
| `@agent 搜索 xxx` | 搜索知识库 |

### GET /api/orgs/{org_id}/stream

SSE 推送端点 — 实时接收新消息（限制 5 并发连接）。

**事件类型：** `connected` · `message` · `heartbeat`

### GET /api/orgs/{org_id}/todos

待办列表。

### POST /api/orgs/{org_id}/todos

创建待办。

```json
// Request
{"content": "修复登录 bug", "assignee_id": "user-abc"}
```

### PUT /api/orgs/{org_id}/todos/{todo_id}

更新待办（完成/取消）。

```json
// Request
{"completed": 1}
```

---

## 12. 评估日志

### POST /api/eval/log

记录评估日志（需认证）。

```json
// Request
{
  "project_id": "proj-abc",
  "session_id": "sess-xyz",
  "task_type": "编程",
  "complexity": "中",
  "agent_count": 5,
  "total_tokens": 3456,
  "elapsed_ms": 28900,
  "has_error": false
}
```

### GET /api/eval/stats/{project_id}

获取项目评估统计数据（需 workspace 成员身份）。

---

## 13. 管理后台

> 路由前缀 `/api/admin`，需管理员身份。

### GET /api/admin/users

列出所有用户。

### PUT /api/admin/users/{user_id}/admin

切换管理员权限。

```json
// Request
{"is_admin": true}
```

---

## 14. 系统

### GET /api/health

健康检查。

```json
{"status": "ok", "version": "3.5"}
```

### GET /scalar

Scalar API 交互式文档 UI（浏览器直接访问）。

### 静态文件

| 路由 | 说明 |
|------|------|
| `/coding/*` | 生成的代码和图表文件 |

---

## 认证说明

除特别标注外，所有接口需在请求头中携带 JWT：

```
Authorization: Bearer <token>
```

游客模式使用 `POST /api/chat/guest` 免认证端点，不需要 JWT。

---

## 错误响应格式

```json
{
  "error": "错误描述信息"
}
```

HTTP 状态码：400（参数错误）、401（未认证）、403（无权限）、404（资源不存在）、409（冲突）、429（限流）、500（服务端错误）。
