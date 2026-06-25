# 用户管理体系重构 设计方案

## 目标

清理遗留代码，将用户管理重构为清晰的 `user/` 包，消除前后端配置标识不一致。

## user/ 包职责划分

| 文件 | 职责 | 有无状态 |
|------|------|---------|
| `__init__.py` | 空包标记 | — |
| `auth.py` | bcrypt 密码哈希 + HS256 JWT 编解码 | 无状态纯函数 |
| `db.py` | SQLite CRUD，三张表（users/sessions/user_configs） | 纯增删改查 |
| `helpers.py` | `require_auth`（JWT → user）、`_get_db`（请求→数据库实例） | FastAPI 依赖注入 |
| `routes.py` | 所有 API 路由 + 业务校验 | 有状态（限流器已移除） |

## 数据库设计

### users 表

```sql
CREATE TABLE users (
    id         TEXT PRIMARY KEY,        -- uuid[:8]
    name       TEXT NOT NULL UNIQUE,    -- 用户名
    password   TEXT NOT NULL DEFAULT '',-- bcrypt 哈希
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
```

变更：去掉 `email` 列。

### sessions 表（不变）

```sql
CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    title      TEXT DEFAULT '',
    messages   TEXT DEFAULT '[]',       -- JSON 数组
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### user_configs 表（格式变更）

```sql
CREATE TABLE user_configs (
    user_id    TEXT PRIMARY KEY,
    roles      TEXT DEFAULT '{}',        -- JSON: {"Planner": "a-deepseek", ...}
    models     TEXT DEFAULT '[]',        -- JSON: [{"key": "my-gpt4", "model": "...", "base_url": "...", "api_key": "..."}]
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

自定义模型格式由 `{"name": ...}` 改为 `{"key": ..., "model": ..., "base_url": ..., "api_key": ...}`，与 `config.py` 的 `MODEL_POOL` 值结构对齐。

## 认证流程

```
register → bcrypt hash → insert user → create_jwt → 返回 token
login    → get_user → verify_password → create_jwt → 返回 token
require_auth (Depends) → decode_jwt → get_user_by_id → 返回 {user_id, user_name}
```

JWT 配置：HS256，7 天过期，secret 来自 `JWT_SECRET` 环境变量（开发默认值）。

## 配置系统三层模型

```
config.py (ROLE_MODEL + MODEL_POOL)   ← 系统默认（唯一数据源）
    │
    ├── 前端 systemConfig (Jinja2 注入)  ← 渲染用
    │
    ├── 游客 → localStorage (mc_roles, mc_custom)
    │
    └── 注册用户 → DB user_configs + 后端 API 同步
```

### 新增 API

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/auth/system-config` | 返回 `ROLE_MODEL` + `MODEL_POOL` | 否 |

### 修改 API

| 方法 | 路径 | 改动 |
|------|------|------|
| GET | `/api/user/config` | 合并系统默认 `ROLE_MODEL` + 用户覆盖 roles，返回 `system_models` |
| POST | `/api/user/custom-models` | 接收 `{key, model, base_url, api_key}`，按 key 查重 |
| DELETE | `/api/user/custom-models/{model_key}` | 按 key 删除 |

## 前端 key 统一

| 层级 | 之前（display_name） | 之后（key） |
|------|-------------------|------------|
| `currentRoles[role]` | `"deepseek-v4-flash"` | `"a-deepseek"` |
| `<option value>` | 显示名 | key |
| `<option text>` | 显示名 | 显示名（不变） |
| `mc_roles` 存储 | `{role: 显示名}` | `{role: key}` |
| `mc_custom` 存储 | `{name, url, key}` | `{key, model, base_url, api_key}` |

## 注册用户配置同步

- 登录/注册后 → `loadUserConfig()` 从后端拉取合并配置 → 写入 `currentRoles` + `customModels` + localStorage
- 修改角色 → `updateRole()` → localStorage + `_syncRolesToServer()` → `PUT /api/user/config`
- 添加/删除自定义模型 → localStorage + `_syncCustomModelToServer` / `_deleteCustomModelOnServer`
- 退出登录 → 清 `mc_roles`/`mc_custom`，重置为系统默认
- 页面加载时已登录用户 → 自动调用 `loadUserConfig()` 从后端同步

## 数据库追踪

`watch_db.py`：检测 `data.db` 的 mtime，有变化则调用 `db.dump_all()` 追加到 `db_debug.log`。
新终端手动运行 `python watch_db.py`，`Ctrl+C` 停止。
`dump_all()` 输出三张表的全部内容，带时间戳。
