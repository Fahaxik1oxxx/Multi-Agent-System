# 用户管理体系 — 设计文档 v4.0

## 一、设计思路

**核心原则：用户身份与会话分离，前端信任逐级降级**

```
用户状态分层:
  1. JWT 本地存在 → 信任标记
  2. JWT 本地解码 → 校验是否过期
  3. JWT 后端验证 → 校验用户是否在 DB 中存在
  4. 降级 → 游客模式
```

**游客与注册用户双轨制：**
- **游客**：无 JWT，调用 `/api/chat/guest` 免认证端点。受限功能弹窗提示"注册后可用"（编排画布、模板市场、Agent 设计器、知识库上传、团队模式）。会话不持久化，刷新即丢（sessionStorage）。注册后可迁移游客会话到账号。
- **注册用户**：JWT 鉴权，会话和配置持久化到 SQLite，完整功能访问。

**配置归属：**
- 系统模型（`config.py` 的 `MODEL_POOL`）— 全局共享，所有人可见
- 角色分配（`ROLE_MODEL`）— 全局默认值，登录用户可覆盖（存 `user_configs`）
- 自定义模型（用户添加的 API 模型）— 仅登录用户可管理
- API Key — 用户可覆盖系统默认 DeepSeek Key

## 二、后端架构

**文件结构：**
```
user/
├── __init__.py           # 包标识
├── auth.py               # 密码哈希 + JWT 创建/解码（纯函数，无状态）
├── db.py                 # SQLite 数据库 v5 — 8 表 + CRUD
├── helpers.py            # FastAPI 依赖注入 + 权限校验
└── routes.py             # 认证/会话/用户配置/API Key 路由
```

### 认证流程 (auth.py)

```python
hash_password(pw: str) -> str        # bcrypt 哈希
verify_password(pw: str, hash: str) -> bool  # bcrypt 验证
create_jwt(uid: str, name: str, is_admin: bool) -> str  # 生成 JWT
decode_jwt(token: str) -> dict | None  # 解码验证 JWT
```

### 权限层级 (helpers.py)

```python
require_auth(request) -> dict         # 基础认证（含游客检查）
require_admin(request) -> dict        # 管理员认证
require_workspace_role(role)(...)     # 工作空间角色校验
```

**权限模型：** Admin > Owner > Member > Viewer > Guest

### 数据库 (db.py) — v5 Schema

8 张表：

| 表 | 说明 |
|----|------|
| `users` | 用户（id, name, password, is_admin, created_at） |
| `sessions` | 会话（id, user_id, title, messages, updated_at） |
| `messages_fts` | FTS5 全文索引（session_id, msg_index, role, content） |
| `user_configs` | 用户配置（roles JSON, models JSON） |
| `workspaces` | 工作空间（id, name, description, owner_id, is_public） |
| `workspace_members` | 工作空间成员（workspace_id, user_id, role） |
| `projects` | 项目（id, workspace_id, name, description, created_by） |
| `eval_logs` | 评估日志（project_id, session_id, task_type, complexity, agent_count, total_tokens, elapsed_ms, has_error） |
| `organizations` | 组织（id, name, invite_code, owner_id） |
| `org_members` | 组织成员（org_id, user_id, role） |
| `org_channels` | 频道（id, org_id, name） |
| `org_messages` | 频道消息（id, channel_id, user_id, content, is_agent） |
| `org_todos` | 待办（id, org_id, content, assignee_id, completed） |
| `schema_version` | 迁移版本追踪 |

## 三、前端架构

### Auth Store (Zustand)

```typescript
interface AuthStore {
  token: string | null;       // JWT (localStorage)
  user: User | null;          // 当前用户
  isLoading: boolean;         // 初始化加载
  isGuest: boolean;           // 游客标记 (localStorage 'auth_guest')
  setAuth(token, user): void; // 登录设置（清除游客标记）
  setGuest(): void;           // 游客模式设置
  logout(): void;             // 登出（清除所有标记）
}
```

### 路由守卫

| 组件 | 权限 | 未通过行为 |
|------|------|-----------|
| `AuthGuard` | 已登录 | 重定向到 /login |
| `GuestOnly` | 未登录 | 重定向到 / |
| `AdminGuard` | 管理员 | 显示 403 |
| 游客模式 | `isGuest=true` | 受限功能弹窗"注册后可用" |

### 受限功能列表（游客不可用）

- 编排画布（/w/:wid/p/:pid/orchestra）
- 模板市场（/templates）
- Agent 设计器（/agents）
- 知识库上传
- 团队模式（/team）

## 四、API Key 管理

用户可在设置页覆盖系统默认的 DeepSeek API Key：

```
系统默认 Key (.env DEEPSEEK_API_KEY)
    ↓ 用户设置自定义 Key
用户自定义 Key (存入 user_configs.models[].api_key)
    ↓ 用户删除自定义 Key
回退到系统默认 Key
```

`create_llm()` 函数按优先级查找：用户自定义 > 系统 MODEL_POOL 默认。

## 五、安全措施

- JWT Token 无过期时间（存储在用户本地环境，安全可控）
- 密码 bcrypt 哈希，永不明文存储
- SQLite WAL 模式 + foreign_keys 启用
- 文件名 sanitize 防路径穿越
- 文件上传限制 5MB + 扩展名白名单
- API 请求限流（登录接口防暴力破解）
- 团队 SSE 连接限制 max_connections=5
