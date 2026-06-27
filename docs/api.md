# 多智能体协作平台 — API 接口文档 v4.0

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
  "thinking": [{"name": "Planner", "content": "..."}],
  "task_type": "分析",
  "generated_files": []
}
```

### POST /api/chat/guest

游客免认证聊天。参数同 `/api/chat`，使用系统默认 Key，不持久化会话。

---

## 2. SSE 流式接口

### POST /api/chat/start

发起流式会话，返回 `{"session_id": "..."}`.

### GET /api/chat/stream/{session_id}

SSE 事件流。事件类型：`agent_start` | `token` | `agent_end` | `done` | `error` | `cancelled`.

### POST /api/chat/cancel/{session_id}

取消流式会话。

---

## 3. 报告生成

### POST /api/report

从 thinking 生成 Markdown 报告。返回 `{"content": "...", "path": "reports/..."}`。

---

## 4. 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册 `{name, password}` → `{token, user_id, name}` |
| POST | `/api/auth/login` | 登录 `{name, password}` → `{token, user_id, name}` |
| POST | `/api/auth/logout` | 退出 |
| GET | `/api/auth/me` | 当前用户信息（需认证） |
| GET | `/api/auth/verify` | JWT 校验 |
| GET | `/api/auth/system-config` | 系统默认模型配置（免认证） |

---

## 5. 用户配置

> 需认证

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/user/config` | 角色映射 + 模型池 |
| PUT | `/api/user/config` | 保存角色映射 `{roles: {...}}` |
| POST | `/api/user/custom-models` | 添加自定义模型 `{key, model, base_url, api_key}` |
| DELETE | `/api/user/custom-models/{key}` | 删除自定义模型 |
| GET | `/api/user/profile` | 用户信息 |
| PUT | `/api/user/profile` | 更新用户名/密码 |
| GET | `/api/user/api-key` | API Key 状态 |
| PUT | `/api/user/api-key` | 设置自定义 DeepSeek Key |
| DELETE | `/api/user/api-key` | 恢复系统默认 |

---

## 6. 会话管理

> 需认证，SQLite + FTS5

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/sessions` | 会话列表 |
| GET | `/api/sessions/search?q=...` | FTS5 全文搜索 |
| POST | `/api/sessions` | 保存会话 |
| GET | `/api/sessions/{id}` | 获取会话 |
| DELETE | `/api/sessions/{id}` | 删除会话 |

---

## 7. 知识库

> 前缀 `/api/knowledge`，需认证

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/files` | 文件列表 |
| GET | `/stats` | 索引统计 |
| POST | `/upload` | 上传文件（multipart） |
| POST | `/rebuild` | 重建索引 |
| DELETE | `/{filename}` | 删除文件 |

支持 PDF · TXT · PNG · JPG（≤5MB）。图片自动 OCR。上传文件同步到 `coding/` 目录供 Agent 读取。

---

## 8. 工作空间

> 前缀 `/api/workspaces`，需认证

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `` | 列表 |
| POST | `` | 创建 |
| GET | `/{ws_id}` | 详情 + 成员 + 项目 |
| PUT | `/{ws_id}` | 更新（需 owner） |
| DELETE | `/{ws_id}` | 删除（需 owner） |
| POST | `/{ws_id}/members` | 邀请成员 |
| DELETE | `/{ws_id}/members/{uid}` | 移除成员 |

---

## 9. 项目管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/w/{ws_id}/projects` | 项目列表 |
| POST | `/api/w/{ws_id}/projects` | 创建项目 |
| GET | `/api/projects/{id}` | 项目详情 |
| DELETE | `/api/projects/{id}` | 删除项目 |

---

## 10. 组织管理

> 前缀 `/api/orgs`，需认证

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `` | 我的组织列表 |
| POST | `` | 创建 `{name, description}` → 6 位邀请码 |
| GET | `/{org_id}` | 详情 + 成员 |
| PUT | `/{org_id}` | 更新（需 owner） |
| DELETE | `/{org_id}` | 删除（需 owner） |
| POST | `/{org_id}/members` | 邀请 `{user_name}` |
| DELETE | `/{org_id}/members/{uid}` | 移除成员 |
| POST | `/join` | 邀请码加入 `{code}` |

---

## 11. 团队聊天

> 前缀 `/api/orgs`，需组织成员身份

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/{org_id}/channels` | 频道列表 |
| POST | `/{org_id}/channels` | 创建频道 `{name}` |
| GET | `/{org_id}/channels/{ch_id}/messages` | 消息列表 |
| POST | `/{org_id}/channels/{ch_id}/messages` | 发送消息 `{content}` |
| GET | `/{org_id}/stream` | SSE 实时推送（限 5 连接） |
| GET | `/{org_id}/todos` | 待办列表 |
| POST | `/{org_id}/todos` | 创建待办 |
| PUT | `/{org_id}/todos/{id}` | 更新待办 |

**@agent 命令：** `@agent 总结一下` · `@agent 创建待办: xxx @user` · `@agent 搜索 xxx`

---

## 12. 评估日志

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/eval/log` | 记录评估 |
| GET | `/api/eval/stats/{pid}` | 项目统计 |

---

## 13. 管理后台

> 前缀 `/api/admin`，需管理员

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/users` | 用户列表 |
| PUT | `/users/{uid}/admin` | 切换管理员 `{is_admin}` |

---

## 14. 系统

| 路径 | 说明 |
|------|------|
| `GET /api/health` | `{"status":"ok","version":"3.5"}` |
| `GET /scalar` | Scalar API 交互文档 |
| `/coding/*` | 静态文件（生成代码/图表） |

---

## 认证

JWT: `Authorization: Bearer <token>`  
游客: `POST /api/chat/guest` 免认证  
错误: `{"error": "..."}` + HTTP 4xx/5xx
