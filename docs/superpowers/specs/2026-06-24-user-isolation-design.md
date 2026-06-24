# 用户隔离与认证系统 设计方案

## 目标

建立轻量实用的用户体系，实现注册用户的认证安全、会话隔离和知识库隔离。游客保持现有 sessionStorage 方案不变。

## 用户类型

| 类型 | 认证方式 | 会话存储 | 知识库 |
|------|----------|----------|--------|
| 游客 | 无 | sessionStorage | 无权限访问 |
| 注册用户 | bcrypt 密码 + UUID Token | SQLite | `rag/documents/<user_id>/` + `rag/chroma_db/<user_id>/` |

## 数据库改造

### users 表（修改）

```sql
CREATE TABLE users (
    id         TEXT PRIMARY KEY,           -- UUID
    name       TEXT NOT NULL UNIQUE,        -- 用户名（注册时输入）
    email      TEXT UNIQUE,                -- 邮箱
    password   TEXT NOT NULL,              -- bcrypt 哈希
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
```

### auth_tokens 表（新增）

```sql
CREATE TABLE auth_tokens (
    token      TEXT PRIMARY KEY,           -- UUID
    user_id    TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

Token 在注册/登录时生成，退出登录时删除。

## API 改造

### 现有 API 鉴权升级

| API | 当前 | 改造后 |
|-----|------|--------|
| `POST /api/sessions` | 信任前端传的 `user_id` | 从 Header `Authorization: Bearer <token>` 解析 user_id |
| `GET /api/sessions?user_id=` | 信任 query 参数 | 从 Token 解析 |
| `GET /api/sessions/{id}` | 无校验 | 从 Token 解析，校验归属 |
| `DELETE /api/sessions/{id}` | 无校验 | 从 Token 解析，校验归属 |

### 新增 API

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/auth/register` | 注册（用户名 + 邮箱 + 密码）→ 返回 token |
| POST | `/api/auth/login` | 登录（用户名 + 密码）→ 返回 token |
| POST | `/api/auth/logout` | 退出（删除 token） |
| GET | `/api/auth/me` | 获取当前用户信息（从 token 解析） |

### 知识库 API 鉴权

所有 `/api/knowledge/*` 添加 Token 校验，游客返回 401。

## 数据流

### 注册流程

```
前端 → POST /api/auth/register {name, email, password}
  → bcrypt 哈希密码
  → INSERT INTO users
  → 生成 UUID token → INSERT INTO auth_tokens
  → 创建知识库目录 rag/documents/<user_id>/, rag/chroma_db/<user_id>/
  → 返回 {token, user_id, name}
前端 → 存储 token 到 localStorage("auth_token")
     → 存储 user_name 到 localStorage("mc_uname")
```

### 登录流程

```
前端 → POST /api/auth/login {name, password}
  → SELECT FROM users WHERE name = ?
  → bcrypt 验证密码
  → 生成 UUID token → INSERT INTO auth_tokens
  → 返回 {token, user_id, name}
前端 → 存储 token → 自动加载历史 → 迁移游客会话
```

### 鉴权中间件

```python
def get_current_user(request: Request) -> str | None:
    """从 Authorization Header 提取 token，返回 user_id 或 None"""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    row = db.execute("SELECT user_id FROM auth_tokens WHERE token = ?", (token,))
    return row["user_id"] if row else None
```

### 知识库隔离

```
知识库操作（上传/检索/统计/删除）→ 从 Token 获取 user_id → 操作 rag/documents/<user_id>/
ChromaDB 持久化目录 → rag/chroma_db/<user_id>/
```

## 前端改造

| 文件 | 改动 |
|------|------|
| `templates/components/sidebar.html` | 注册/登录表单改为调用 `/api/auth/register` 和 `/api/auth/login`；去掉 localStorage 存密码 |
| `templates/components/sidebar.html` | 退出登录调用 `/api/auth/logout` 删除服务端 token |
| `static/js/chat.js` | 所有 `/api/sessions` 和 `/api/knowledge` 请求添加 `Authorization: Bearer <token>` Header |
| `static/js/chat.js` | `ensureUserId()` 不再需要（用 token 替代） |
| `static/js/chat.js` | `isGuest()` 改为 `!localStorage.getItem("auth_token")` |

## 游客行为（不变）

- 游客判定：`!localStorage.getItem("auth_token")`
- 会话存储：sessionStorage（已有）
- 知识库：不显示（或不调用 API）
- 游客升级为注册用户：对话迁移到数据库（登录时触发）
- 退出登录：清空聊天区 + 侧栏 + 删除 token

## 不变项

- Chat API（`/api/chat`）不要求鉴权（游客也要用）
- Report API（`/api/report`）不要求鉴权
- 模型配置 API 不要求鉴权
- 聊天消息收发逻辑不变
- 前端 UI 布局不变

## 不涉及

- OAuth / 第三方登录
- 密码重置 / 邮箱验证
- 多设备 token 管理（每个登录生成一个新 token，旧的不删除）
- 用户角色/权限分级
