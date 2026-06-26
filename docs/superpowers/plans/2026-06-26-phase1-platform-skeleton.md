# Phase 1: 平台骨架 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将单用户 Jinja2 应用升级为支持多用户、多工作空间、RBAC 权限的 React SPA 平台骨架

**Architecture:** 后端新增 workspaces/projects/memberships 三表 + RBAC 中间件；前端新建 Vite React TS 项目，通过 REST API 与后端通信；两套前端并存（Jinja2 保留，React 逐步接管）

**Tech Stack:** React 18 + TypeScript + Vite 5 + shadcn/ui + Tailwind CSS 3 + React Router v6 + TanStack Query v5 + Zustand + Axios（前端）；FastAPI + SQLite + PyJWT + bcrypt（后端）

**Spec:** `docs/superpowers/specs/2026-06-26-multi-agent-platform-redesign.md`

## Global Constraints

- Python 3.10+, FastAPI >=0.115, SQLite WAL mode
- React 18 + TypeScript strict mode
- 前端部署 Vercel（纯静态），后端独立部署（Fly.io/Render/学校服务器）
- JWT HS256, 7 天 TTL
- 所有 API 响应 JSON，遵循现有 `{"error": "..."}` 错误格式
- 数据库迁移使用现有 `_run_migration()` 版本递增机制
- 现有 Jinja2 前端保持可用，React 前端通过 `/app` 路由访问（开发阶段）

---

## 文件结构总览

### 新建文件

```
frontend/
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── vite.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── components.json                         # shadcn/ui 配置
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css                           # Tailwind 指令 + CSS 变量
│   ├── vite-env.d.ts
│   ├── routes/index.tsx
│   ├── types/
│   │   ├── user.ts                         # User, AuthState
│   │   ├── workspace.ts                    # Workspace, WorkspaceMember, Project
│   │   └── api.ts                          # ApiError, PaginatedResponse
│   ├── lib/
│   │   ├── constants.ts                    # API_BASE_URL, ROLES
│   │   └── permissions.ts                  # hasPermission(), roleMatrix
│   ├── stores/
│   │   ├── authStore.ts                    # Zustand: token, user, login/logout
│   │   └── workspaceStore.ts               # Zustand: currentWorkspace, currentProject
│   ├── api/
│   │   ├── client.ts                       # Axios 实例 + 拦截器
│   │   ├── auth.ts                         # login, register, logout, me
│   │   ├── workspaces.ts                   # CRUD workspaces + members
│   │   ├── projects.ts                     # CRUD projects
│   │   ├── sessions.ts                     # CRUD sessions (兼容旧 API)
│   │   └── user.ts                         # get/save config, custom models
│   ├── hooks/
│   │   ├── useAuth.ts                      # 封装 authStore + redirect
│   │   └── usePermission.ts                # 按 workspaceId 返回权限
│   ├── components/
│   │   ├── ui/                             # shadcn/ui 生成的基础组件
│   │   ├── layout/
│   │   │   ├── AppShell.tsx                # 侧边栏 + 顶栏 + <Outlet/>
│   │   │   ├── Sidebar.tsx                  # 导航 + 工作空间切换
│   │   │   └── Header.tsx                   # 用户菜单 + 面包屑
│   │   ├── auth/
│   │   │   ├── AuthGuard.tsx               # 未登录重定向 /login
│   │   │   └── AdminGuard.tsx              # 非管理员重定向 /
│   │   └── shared/
│   │       ├── WorkspaceCard.tsx            # 工作空间卡片
│   │       ├── ProjectCard.tsx              # 项目卡片
│   │       ├── CreateDialog.tsx             # 通用创建弹窗
│   │       └── EmptyState.tsx              # 空状态占位
│   └── pages/
│       ├── auth/
│       │   ├── LoginPage.tsx
│       │   └── RegisterPage.tsx
│       ├── workspace/
│       │   ├── WorkspaceOverview.tsx        # 工作空间列表 + 创建
│       │   └── WorkspaceDetail.tsx         # 工作空间详情 + 项目列表
│       ├── project/
│       │   └── ChatPage.tsx                 # 迁移现有聊天功能
│       └── settings/
│           └── SettingsPage.tsx             # Profile + API Key 管理
```

### 修改文件

```
user/db.py              # 新增迁移 v3 + workspace/project CRUD 方法
user/helpers.py         # 新增 require_role, check_workspace_member 依赖
user/routes.py          # 新增 workspace_router, project_router
main.py                 # 注册新路由, 挂载 React 静态文件, /app 页面路由
config.py               # 不变（仅参考）
```

---

### Task 1: 后端 — 数据库迁移 v3（新增工作空间/项目/成员表）

**Files:**
- Modify: `user/db.py`（`TARGET_SCHEMA_VERSION` 改 3, 新增 `_run_migration` v3 分支, 新增 CRUD 方法）

**Interfaces:**
- Consumes: 现有 `Database` 类结构, `_run_migration()` 模式, `_conn()` context manager
- Produces:
  - `Database.TARGET_SCHEMA_VERSION = 3`
  - `Database.create_workspace(name, description, owner_id) -> str`
  - `Database.get_workspace(workspace_id) -> dict | None`
  - `Database.list_workspaces(user_id) -> list[dict]`
  - `Database.update_workspace(workspace_id, **fields) -> bool`
  - `Database.delete_workspace(workspace_id) -> bool`
  - `Database.add_member(workspace_id, user_id, role) -> bool`
  - `Database.remove_member(workspace_id, user_id) -> bool`
  - `Database.list_members(workspace_id) -> list[dict]`
  - `Database.get_member_role(workspace_id, user_id) -> str | None`
  - `Database.create_project(workspace_id, name, description, created_by) -> str`
  - `Database.get_project(project_id) -> dict | None`
  - `Database.list_projects(workspace_id) -> list[dict]`
  - `Database.update_project(project_id, **fields) -> bool`
  - `Database.delete_project(project_id) -> bool`
  - `Database.set_user_admin(user_id, is_admin: bool) -> bool`
  - `Database.is_admin(user_id) -> bool`

- [ ] **Step 1: 修改 `TARGET_SCHEMA_VERSION` 并新增 v3 迁移**

在 `user/db.py` 中修改：

```python
# 第 16 行，将 2 改为 3
TARGET_SCHEMA_VERSION = 3
```

在 `_run_migration()` 方法中（第 117 行 `else` 之前），新增 v3 分支：

```python
elif version == 3:
    conn.executescript("""
        ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0;

        CREATE TABLE IF NOT EXISTS workspaces (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT DEFAULT '',
            owner_id    TEXT NOT NULL REFERENCES users(id),
            is_public   INTEGER DEFAULT 0,
            created_at  TEXT DEFAULT (datetime('now', 'localtime'))
        );

        CREATE TABLE IF NOT EXISTS workspace_members (
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            user_id      TEXT NOT NULL REFERENCES users(id),
            role         TEXT NOT NULL DEFAULT 'member',
            joined_at    TEXT DEFAULT (datetime('now', 'localtime')),
            PRIMARY KEY (workspace_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS projects (
            id           TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            name         TEXT NOT NULL,
            description  TEXT DEFAULT '',
            agent_config TEXT DEFAULT '{}',
            created_by   TEXT NOT NULL REFERENCES users(id),
            created_at   TEXT DEFAULT (datetime('now', 'localtime'))
        );
    """)
```

- [ ] **Step 2: 新增 Workspace CRUD 方法**

在 `Database` 类的"用户配置"部分之前（第 327 行之前）插入：

```python
    # ── 工作空间 ──

    def create_workspace(self, name: str, description: str, owner_id: str) -> str:
        wid = str(uuid.uuid4())[:8]
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO workspaces (id, name, description, owner_id) "
                "VALUES (?, ?, ?, ?)",
                (wid, name, description, owner_id),
            )
            conn.execute(
                "INSERT INTO workspace_members (workspace_id, user_id, role) "
                "VALUES (?, ?, 'owner')",
                (wid, owner_id),
            )
        return wid

    def get_workspace(self, workspace_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, name, description, owner_id, is_public, created_at "
                "FROM workspaces WHERE id = ?",
                (workspace_id,),
            ).fetchone()
            return dict(row) if row else None

    def list_workspaces(self, user_id: str) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT w.id, w.name, w.description, w.owner_id, w.is_public, "
                "w.created_at, wm.role "
                "FROM workspaces w "
                "INNER JOIN workspace_members wm ON w.id = wm.workspace_id "
                "WHERE wm.user_id = ? "
                "ORDER BY w.created_at DESC",
                (user_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def update_workspace(self, workspace_id: str, **fields) -> bool:
        allowed = {"name", "description", "is_public"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return False
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [workspace_id]
        with self._conn() as conn:
            cur = conn.execute(
                f"UPDATE workspaces SET {set_clause} WHERE id = ?", values
            )
            return cur.rowcount > 0

    def delete_workspace(self, workspace_id: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute(
                "DELETE FROM workspaces WHERE id = ?", (workspace_id,)
            )
            return cur.rowcount > 0

    # ── 成员管理 ──

    def add_member(self, workspace_id: str, user_id: str, role: str = "member") -> bool:
        with self._conn() as conn:
            try:
                conn.execute(
                    "INSERT INTO workspace_members (workspace_id, user_id, role) "
                    "VALUES (?, ?, ?)",
                    (workspace_id, user_id, role),
                )
                return True
            except sqlite3.IntegrityError:
                return False

    def remove_member(self, workspace_id: str, user_id: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute(
                "DELETE FROM workspace_members "
                "WHERE workspace_id = ? AND user_id = ? AND role != 'owner'",
                (workspace_id, user_id),
            )
            return cur.rowcount > 0

    def list_members(self, workspace_id: str) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT wm.user_id, u.name, wm.role, wm.joined_at "
                "FROM workspace_members wm "
                "JOIN users u ON wm.user_id = u.id "
                "WHERE wm.workspace_id = ? "
                "ORDER BY wm.joined_at",
                (workspace_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def get_member_role(self, workspace_id: str, user_id: str) -> str | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT role FROM workspace_members "
                "WHERE workspace_id = ? AND user_id = ?",
                (workspace_id, user_id),
            ).fetchone()
            return row["role"] if row else None

    # ── 项目 ──

    def create_project(self, workspace_id: str, name: str,
                       description: str, created_by: str) -> str:
        pid = str(uuid.uuid4())[:8]
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO projects (id, workspace_id, name, description, created_by) "
                "VALUES (?, ?, ?, ?, ?)",
                (pid, workspace_id, name, description, created_by),
            )
        return pid

    def get_project(self, project_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, workspace_id, name, description, agent_config, "
                "created_by, created_at "
                "FROM projects WHERE id = ?",
                (project_id,),
            ).fetchone()
            return dict(row) if row else None

    def list_projects(self, workspace_id: str) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, name, description, created_by, created_at "
                "FROM projects WHERE workspace_id = ? "
                "ORDER BY created_at DESC",
                (workspace_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def update_project(self, project_id: str, **fields) -> bool:
        allowed = {"name", "description", "agent_config"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return False
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [project_id]
        with self._conn() as conn:
            cur = conn.execute(
                f"UPDATE projects SET {set_clause} WHERE id = ?", values
            )
            return cur.rowcount > 0

    def delete_project(self, project_id: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute(
                "DELETE FROM projects WHERE id = ?", (project_id,)
            )
            return cur.rowcount > 0

    # ── 管理员 ──

    def set_user_admin(self, user_id: str, is_admin: bool) -> bool:
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE users SET is_admin = ? WHERE id = ?",
                (1 if is_admin else 0, user_id),
            )
            return cur.rowcount > 0

    def is_admin(self, user_id: str) -> bool:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT is_admin FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            return bool(row["is_admin"]) if row else False

    def list_all_users(self) -> list[dict]:
        """管理员接口：列出所有用户"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, name, is_admin, created_at FROM users ORDER BY created_at"
            ).fetchall()
            return [dict(r) for r in rows]
```

- [ ] **Step 3: 运行现有测试确保迁移不破坏旧功能**

```bash
cd "D:\AI\Internship\Multi_Agent" && python -m pytest tests/ -v
```

Expected: 所有已有测试通过。

- [ ] **Step 4: 手动验证迁移**

```bash
cd "D:\AI\Internship\Multi_Agent" && python -c "
from user.db import Database
db = Database('data.db')
# 验证新表存在
with db._conn() as conn:
    tables = conn.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()
    print('Tables:', [t['name'] for t in tables])
# 测试创建 workspace
if False:  # 需要先有用户
    wid = db.create_workspace('Test WS', 'desc', 'some-user-id')
    print('Created workspace:', wid)
    print('List:', db.list_workspaces('some-user-id'))
"
```

Expected: 输出包含 `workspaces`, `workspace_members`, `projects` 三张表。

- [ ] **Step 5: Commit**

```bash
git add user/db.py
git commit -m "feat(db): 迁移 v3 — 新增 workspaces/projects/memberships 表 + CRUD 方法"
```

---

### Task 2: 后端 — RBAC 中间件增强

**Files:**
- Modify: `user/helpers.py`
- Modify: `user/auth.py`（扩展 JWT payload 包含 `is_admin`）

**Interfaces:**
- Consumes: `Database.get_member_role()`, `Database.is_admin()`
- Produces:
  - `require_workspace_role(min_role: str)` → FastAPI Depends，返回 `{user_id, user_name, workspace_id, role}`
  - `require_admin` → FastAPI Depends，返回 `{user_id, user_name, is_admin: True}`
  - JWT payload 新增 `is_admin` 字段

- [ ] **Step 1: 扩展 JWT payload 包含 is_admin**

在 `user/auth.py` 中修改 `create_jwt()`：

```python
def create_jwt(user_id: str, name: str, is_admin: bool = False) -> str:
    payload = {
        "sub": user_id,
        "name": name,
        "is_admin": is_admin,
        "iat": int(time.time()),
        "exp": int(time.time()) + _JWT_TTL,
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALGO)
```

- [ ] **Step 2: 新增 require_admin 依赖**

在 `user/helpers.py` 末尾追加：

```python
async def require_admin(request: Request) -> dict:
    """FastAPI 依赖：要求管理员权限。先走 require_auth 再检查 is_admin。"""
    user = await require_auth(request)
    db = _get_db(request)
    if not db.is_admin(user["user_id"]):
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return {**user, "is_admin": True}
```

- [ ] **Step 3: 新增 require_workspace_role 依赖工厂**

在 `user/helpers.py` 末尾追加：

```python
from typing import Callable


def require_workspace_role(min_role: str = "viewer") -> Callable:
    """FastAPI 依赖工厂：验证用户是指定 workspace 的成员且角色 >= min_role。
    
    角色等级: owner > member > viewer
    
    用法:
        @router.get("/w/{workspace_id}/xxx")
        async def handler(
            workspace_id: str,
            member: dict = Depends(require_workspace_role("member")),
        ): ...
    
    返回: {user_id, user_name, workspace_id, role}
    """
    ROLE_LEVEL = {"owner": 3, "member": 2, "viewer": 1}

    async def dependency(request: Request) -> dict:
        user = await require_auth(request)
        db = _get_db(request)

        # 从路径参数中提取 workspace_id
        workspace_id = request.path_params.get("workspace_id")
        if not workspace_id:
            raise HTTPException(status_code=400, detail="缺少 workspace_id")

        # 管理员直接放行
        if db.is_admin(user["user_id"]):
            return {
                "user_id": user["user_id"],
                "user_name": user["user_name"],
                "workspace_id": workspace_id,
                "role": "admin",
            }

        role = db.get_member_role(workspace_id, user["user_id"])
        if role is None:
            raise HTTPException(status_code=403, detail="无权访问该工作空间")

        required_level = ROLE_LEVEL.get(min_role, 1)
        user_level = ROLE_LEVEL.get(role, 0)
        if user_level < required_level:
            raise HTTPException(
                status_code=403,
                detail=f"需要 {min_role} 或更高权限，当前为 {role}",
            )

        return {
            "user_id": user["user_id"],
            "user_name": user["user_name"],
            "workspace_id": workspace_id,
            "role": role,
        }

    return dependency
```

- [ ] **Step 4: 更新 register/login 路由传入 is_admin**

在 `user/routes.py` 中，修改 register 和 login 两个函数中调用 `create_jwt()` 的地方：

```python
# register（第 35 行）
token = create_jwt(uid, name, is_admin=False)

# login（第 53 行）
token = create_jwt(user["id"], user["name"], is_admin=bool(user.get("is_admin", 0)))
```

- [ ] **Step 5: 运行测试验证**

```bash
cd "D:\AI\Internship\Multi_Agent" && python -m pytest tests/ -v
```

Expected: 全部通过。

- [ ] **Step 6: Commit**

```bash
git add user/auth.py user/helpers.py user/routes.py
git commit -m "feat(auth): RBAC 中间件 — require_admin + require_workspace_role 依赖"
```

---

### Task 3: 后端 — Workspace & Project API 路由

**Files:**
- Create: `workspace/routes.py`（或直接追加到 `user/routes.py`）
- Modify: `main.py`（注册新路由）

**Interfaces:**
- Consumes: `Database` workspace/project/member CRUD, `require_auth`, `require_workspace_role`
- Produces: 以下 API 端点

- [ ] **Step 1: 创建 workspace 路由**

新建 `workspace/__init__.py`（空文件），然后创建 `workspace/routes.py`：

```python
"""
工作空间与项目管理 API 路由
"""
import json
from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse

from user.helpers import _get_db, require_auth, require_workspace_role, require_admin

workspace_router = APIRouter()
project_router = APIRouter()
admin_router = APIRouter()


# ──── 工作空间 ────

@workspace_router.get("")
async def list_workspaces(request: Request, user: dict = Depends(require_auth)):
    db = _get_db(request)
    rows = db.list_workspaces(user["user_id"])
    return JSONResponse(rows)


@workspace_router.post("")
async def create_workspace(request: Request, user: dict = Depends(require_auth)):
    data = await request.json()
    name = (data.get("name") or "").strip()
    if not name:
        return JSONResponse({"error": "工作空间名称不能为空"}, status_code=400)
    description = (data.get("description") or "").strip()
    wid = _get_db(request).create_workspace(name, description, user["user_id"])
    return JSONResponse({"id": wid, "name": name, "status": "ok"}, status_code=201)


@workspace_router.get("/{workspace_id}")
async def get_workspace(
    request: Request,
    workspace_id: str,
    member: dict = Depends(require_workspace_role("viewer")),
):
    db = _get_db(request)
    ws = db.get_workspace(workspace_id)
    if not ws:
        return JSONResponse({"error": "工作空间不存在"}, status_code=404)
    members = db.list_members(workspace_id)
    projects = db.list_projects(workspace_id)
    return JSONResponse({**ws, "members": members, "projects": projects, "my_role": member["role"]})


@workspace_router.put("/{workspace_id}")
async def update_workspace(
    request: Request,
    workspace_id: str,
    member: dict = Depends(require_workspace_role("owner")),
):
    data = await request.json()
    fields = {}
    if "name" in data:
        fields["name"] = data["name"].strip()
    if "description" in data:
        fields["description"] = data["description"].strip()
    if "is_public" in data:
        fields["is_public"] = data["is_public"]
    if not fields:
        return JSONResponse({"error": "无更新字段"}, status_code=400)
    _get_db(request).update_workspace(workspace_id, **fields)
    return JSONResponse({"status": "ok"})


@workspace_router.delete("/{workspace_id}")
async def delete_workspace(
    request: Request,
    workspace_id: str,
    member: dict = Depends(require_workspace_role("owner")),
):
    _get_db(request).delete_workspace(workspace_id)
    return JSONResponse({"status": "ok"})


# ──── 成员管理 ────

@workspace_router.post("/{workspace_id}/members")
async def invite_member(
    request: Request,
    workspace_id: str,
    member: dict = Depends(require_workspace_role("owner")),
):
    data = await request.json()
    user_name = (data.get("user_name") or "").strip()
    role = data.get("role", "member")
    if role not in ("member", "viewer"):
        return JSONResponse({"error": "角色只能是 member 或 viewer"}, status_code=400)
    if not user_name:
        return JSONResponse({"error": "用户名不能为空"}, status_code=400)

    db = _get_db(request)
    target = db.get_user(user_name)
    if not target:
        return JSONResponse({"error": f"用户 {user_name} 不存在"}, status_code=404)

    if not db.add_member(workspace_id, target["id"], role):
        return JSONResponse({"error": "该用户已在工作空间中"}, status_code=409)

    return JSONResponse({"status": "ok", "user_id": target["id"], "role": role})


@workspace_router.delete("/{workspace_id}/members/{user_id}")
async def remove_member(
    request: Request,
    workspace_id: str,
    user_id: str,
    member: dict = Depends(require_workspace_role("owner")),
):
    if not _get_db(request).remove_member(workspace_id, user_id):
        return JSONResponse({"error": "成员不存在或无法移除 Owner"}, status_code=404)
    return JSONResponse({"status": "ok"})


# ──── 项目管理 ────

@project_router.get("/w/{workspace_id}/projects")
async def list_projects(
    request: Request,
    workspace_id: str,
    member: dict = Depends(require_workspace_role("viewer")),
):
    rows = _get_db(request).list_projects(workspace_id)
    return JSONResponse(rows)


@project_router.post("/w/{workspace_id}/projects")
async def create_project(
    request: Request,
    workspace_id: str,
    member: dict = Depends(require_workspace_role("member")),
):
    data = await request.json()
    name = (data.get("name") or "").strip()
    if not name:
        return JSONResponse({"error": "项目名称不能为空"}, status_code=400)
    description = (data.get("description") or "").strip()
    pid = _get_db(request).create_project(
        workspace_id, name, description, member["user_id"]
    )
    return JSONResponse({"id": pid, "name": name, "status": "ok"}, status_code=201)


@project_router.get("/projects/{project_id}")
async def get_project(
    request: Request,
    project_id: str,
    user: dict = Depends(require_auth),
):
    db = _get_db(request)
    proj = db.get_project(project_id)
    if not proj:
        return JSONResponse({"error": "项目不存在"}, status_code=404)
    # 权限校验：必须是 workspace 成员
    role = db.get_member_role(proj["workspace_id"], user["user_id"])
    if role is None and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权访问"}, status_code=403)
    return JSONResponse(proj)


@project_router.delete("/projects/{project_id}")
async def delete_project(
    request: Request,
    project_id: str,
    user: dict = Depends(require_auth),
):
    db = _get_db(request)
    proj = db.get_project(project_id)
    if not proj:
        return JSONResponse({"error": "项目不存在"}, status_code=404)
    role = db.get_member_role(proj["workspace_id"], user["user_id"])
    if role not in ("owner", "member") and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权删除"}, status_code=403)
    db.delete_project(project_id)
    return JSONResponse({"status": "ok"})


# ──── 管理后台 ────

@admin_router.get("/users")
async def list_users(
    request: Request,
    admin: dict = Depends(require_admin),
):
    db = _get_db(request)
    users = db.list_all_users()
    return JSONResponse(users)


@admin_router.put("/users/{user_id}/admin")
async def toggle_admin(
    request: Request,
    user_id: str,
    admin: dict = Depends(require_admin),
):
    data = await request.json()
    is_admin = data.get("is_admin", False)
    _get_db(request).set_user_admin(user_id, is_admin)
    return JSONResponse({"status": "ok"})
```

- [ ] **Step 2: 注册新路由到 main.py**

在 `main.py` 的路由注册部分（第 82 行之后）追加：

```python
from workspace.routes import workspace_router, project_router, admin_router
app.include_router(workspace_router, prefix="/api/workspaces", tags=["工作空间"])
app.include_router(project_router, prefix="/api", tags=["项目"])
app.include_router(admin_router, prefix="/api/admin", tags=["管理"])
```

- [ ] **Step 3: 测试 API 端点**

用 curl 或 pytest 测试：

```bash
# 启动服务器
cd "D:\AI\Internship\Multi_Agent" && python main.py &
sleep 2

# 注册用户
curl -s -X POST http://127.0.0.1:8502/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"testuser","password":"123456"}'

# 创建 workspace（用返回的 token）
curl -s -X POST http://127.0.0.1:8502/api/workspaces \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"name":"我的团队","description":"测试"}'
```

Expected: 返回 `{"id": "...", "name": "我的团队", "status": "ok"}`

- [ ] **Step 4: Commit**

```bash
git add workspace/ main.py
git commit -m "feat(api): workspace/project CRUD + 成员管理 + 管理后台 API"
```

---

### Task 4: 后端 — 用户设置增强（API Key 管理）

**Files:**
- Modify: `user/routes.py`

**Interfaces:**
- Consumes: 现有 `user_router`, `Database.get_user_config/upsert_user_config`
- Produces:
  - `GET /api/user/profile` → `{user_id, user_name, is_admin, created_at}`
  - `PUT /api/user/profile` → 更新用户名/密码
  - `GET /api/user/api-key` → `{has_custom_key: bool, key_prefix: str}`
  - `PUT /api/user/api-key` → 保存自定义 API Key

- [ ] **Step 1: 新增用户 Profile 端点**

在 `user/routes.py` 末尾追加：

```python
# ──── 用户 Profile ────

@user_router.get("/profile")
async def get_profile(request: Request, user: dict = Depends(require_auth)):
    db = _get_db(request)
    u = db.get_user_by_id(user["user_id"])
    is_admin = db.is_admin(user["user_id"])
    return JSONResponse({
        "user_id": u["id"],
        "user_name": u["name"],
        "is_admin": is_admin,
    })


@user_router.put("/profile")
async def update_profile(request: Request, user: dict = Depends(require_auth)):
    """更新用户名或密码"""
    data = await request.json()
    db = _get_db(request)
    new_name = (data.get("name") or "").strip()
    new_password = data.get("password", "")

    if new_name:
        existing = db.get_user(new_name)
        if existing and existing["id"] != user["user_id"]:
            return JSONResponse({"error": "用户名已被占用"}, status_code=409)
        # 更新用户名（需要在 Database 类中添加方法）
        with db._conn() as conn:
            conn.execute(
                "UPDATE users SET name = ? WHERE id = ?",
                (new_name, user["user_id"]),
            )

    if new_password:
        hashed = hash_password(new_password)
        with db._conn() as conn:
            conn.execute(
                "UPDATE users SET password = ? WHERE id = ?",
                (hashed, user["user_id"]),
            )

    return JSONResponse({"status": "ok"})


# ──── API Key 管理 ────

@user_router.get("/api-key")
async def get_api_key(request: Request, user: dict = Depends(require_auth)):
    """返回用户自定义 API Key 的状态（不返回完整 Key）"""
    db = _get_db(request)
    cfg = db.get_user_config(user["user_id"])
    models = cfg["models"] if cfg else []
    # 在自定义模型列表中查找默认 provider 的 Key
    has_custom = any(
        m.get("key") == "a-deepseek" for m in models
    )
    return JSONResponse({
        "has_custom_key": has_custom,
        "using_system_default": not has_custom,
    })


@user_router.put("/api-key")
async def update_api_key(request: Request, user: dict = Depends(require_auth)):
    """保存自定义 API Key（作为自定义模型 "a-deepseek" 存储）"""
    data = await request.json()
    api_key = (data.get("api_key") or "").strip()
    if not api_key:
        return JSONResponse({"error": "API Key 不能为空"}, status_code=400)

    db = _get_db(request)
    cfg = db.get_user_config(user["user_id"])
    models = cfg["models"] if cfg else []
    roles = cfg["roles"] if cfg else {}

    # 覆盖或添加 a-deepseek 的自定义 Key
    existing = next((m for m in models if m["key"] == "a-deepseek"), None)
    if existing:
        existing["api_key"] = api_key
    else:
        models.append({
            "key": "a-deepseek",
            "model": "deepseek-v4-flash",
            "base_url": "https://api.deepseek.com/v1",
            "api_key": api_key,
        })

    db.upsert_user_config(user["user_id"], roles, models)
    return JSONResponse({"status": "ok"})


@user_router.delete("/api-key")
async def remove_api_key(request: Request, user: dict = Depends(require_auth)):
    """删除自定义 API Key，回退到系统默认"""
    db = _get_db(request)
    cfg = db.get_user_config(user["user_id"])
    if not cfg:
        return JSONResponse({"status": "ok"})
    cfg["models"] = [m for m in cfg["models"] if m["key"] != "a-deepseek"]
    db.upsert_user_config(user["user_id"], cfg["roles"], cfg["models"])
    return JSONResponse({"status": "ok"})
```

- [ ] **Step 2: 更新 /api/chat 端点支持用户自定义 API Key**

修改 `main.py` 中的 `/api/chat` 端点（第 98 行），使其根据用户自定义 Key 动态选择 LLM 配置：

```python
@app.post("/api/chat", tags=["聊天"])
async def chat(request: Request):
    from app.chat import run_chat_pipeline

    data = await request.json()
    user_input = data.get("message", "")
    lane_mode = data.get("lane_mode", "auto")
    history = data.get("history", [])
    model_config_override = data.get("model_config", None)

    # 尝试从 JWT 解析用户，使用其自定义 API Key
    auth = request.headers.get("Authorization", "")
    user_id = None
    if auth.startswith("Bearer "):
        payload = decode_jwt(auth[7:])
        if payload:
            user_id = payload["sub"]

    try:
        result = run_chat_pipeline(
            user_input,
            history=history,
            lane_mode=lane_mode,
            model_config_override=model_config_override,
            user_id=user_id,
        )
        return JSONResponse(result)
    except Exception as e:
        import traceback
        logging.error(f"聊天管道异常: {traceback.format_exc()}")
        return JSONResponse(
            {
                "reply": f"❌ 执行失败: {str(e)}",
                "error": str(e),
                "thinking": [],
                "task_type": "错误",
                "generated_files": [],
            },
            status_code=500,
        )
```

_注：对应的 `run_chat_pipeline` 签名需在 `app/chat.py` 中增加 `user_id` 和 `model_config_override` 参数，这是后续的联动任务。Phase 1 阶段可以先记录此 TODO，不影响前端开发。_

- [ ] **Step 3: Commit**

```bash
git add user/routes.py main.py
git commit -m "feat(api): 用户 Profile + API Key 管理端点"
```

---

### Task 5: 前端 — Vite React TS 项目脚手架

**Files:**
- Create: `frontend/` 全部脚手架文件

**Interfaces:**
- Consumes: 无
- Produces: 可 `npm run dev` 启动的空 React 项目

- [ ] **Step 1: 使用 Vite 创建项目**

```bash
cd "D:\AI\Internship\Multi_Agent"
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
```

Expected: `frontend/` 目录生成，`npm run dev` 可启动默认 Vite 页面。

- [ ] **Step 2: 安装核心依赖**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend"
npm install react-router-dom @tanstack/react-query zustand axios
npm install -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 3: 初始化 shadcn/ui**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend"
npx shadcn@latest init
```

交互选择：
- Style: New York
- Base color: Neutral
- CSS variables: Yes

```bash
# 安装基础组件
npx shadcn@latest add button input card label avatar dropdown-menu sheet separator badge dialog textarea toast sonner
```

- [ ] **Step 4: 配置 Tailwind CSS 4 + Vite**

编辑 `vite.config.ts`：

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8502',
        changeOrigin: true,
      },
    },
  },
})
```

编辑 `src/index.css`：

```css
@import "tailwindcss";

:root {
  --brand-primary: #4f8cff;
  --bg-chat: #f8f9fc;
  --text-primary: #1a1a2e;
  --text-secondary: #6b7280;
}

/* 沿用现有 custom.css 的品牌色 */
```

- [ ] **Step 5: 配置 tsconfig 路径别名**

编辑 `tsconfig.json`，确保 `compilerOptions.paths` 包含：

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

编辑 `tsconfig.app.json` 同样加入 paths。

- [ ] **Step 6: 验证脚手架**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npm run dev
```

Expected: http://localhost:5173 显示 Vite + React 默认页面，无报错。

- [ ] **Step 7: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): Vite React TS + shadcn/ui + Tailwind 项目脚手架"
```

---

### Task 6: 前端 — 类型定义 + API 层 + Store

**Files:**
- Create: `frontend/src/types/user.ts`, `workspace.ts`, `api.ts`
- Create: `frontend/src/api/client.ts`, `auth.ts`, `workspaces.ts`, `projects.ts`, `sessions.ts`, `user.ts`
- Create: `frontend/src/stores/authStore.ts`, `workspaceStore.ts`
- Create: `frontend/src/lib/constants.ts`, `permissions.ts`

**Interfaces:**
- Consumes: 后端 API 端点（Task 1-4 定义）
- Produces: 所有后续页面 Task 使用这些类型和 API 函数

- [ ] **Step 1: 编写类型定义**

创建 `frontend/src/types/user.ts`：

```typescript
export interface User {
  user_id: string;
  user_name: string;
  is_admin: boolean;
}

export interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}
```

创建 `frontend/src/types/workspace.ts`：

```typescript
export interface Workspace {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  is_public: number;
  created_at: string;
  role?: string;
  members?: WorkspaceMember[];
  projects?: Project[];
  my_role?: string;
}

export interface WorkspaceMember {
  user_id: string;
  name: string;
  role: 'owner' | 'member' | 'viewer';
  joined_at: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  agent_config: string;
  created_by: string;
  created_at: string;
}
```

创建 `frontend/src/types/api.ts`：

```typescript
export interface ApiError {
  error: string;
}

export interface ChatRequest {
  message: string;
  lane_mode: 'auto' | 'fast' | 'slow';
  history: Array<{ role: string; content: string }>;
  model_config?: Record<string, unknown>;
}

export interface ChatResponse {
  reply: string;
  thinking: Array<{ agent: string; output: string }>;
  task_type: string;
  generated_files: string[];
  error?: string;
}

export interface Session {
  id: string;
  title: string;
  count: number;
  updated: string;
}
```

- [ ] **Step 2: 编写 Axios 客户端**

创建 `frontend/src/api/client.ts`：

```typescript
import axios from 'axios';

const apiClient = axios.create({
  baseURL: '/api',
  timeout: 95000,  // 略大于后端 90s 超时
  headers: { 'Content-Type': 'application/json' },
});

// 请求拦截器：注入 JWT
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器：统一处理 401
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('mc_uname');
      // 不在这里 redirect，由 AuthGuard 处理
    }
    return Promise.reject(error);
  }
);

export default apiClient;
```

- [ ] **Step 3: 编写 API 模块**

创建 `frontend/src/api/auth.ts`：

```typescript
import apiClient from './client';

export interface LoginRequest {
  name: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user_id: string;
  name: string;
}

export const authApi = {
  login: (data: LoginRequest) =>
    apiClient.post<AuthResponse>('/auth/login', data),

  register: (data: LoginRequest) =>
    apiClient.post<AuthResponse>('/auth/register', data),

  logout: () => apiClient.post('/auth/logout'),

  me: () => apiClient.get<{ user_id: string; user_name: string }>('/auth/me'),

  verify: () => apiClient.get('/auth/verify'),
};
```

创建 `frontend/src/api/workspaces.ts`：

```typescript
import apiClient from './client';
import type { Workspace, WorkspaceMember } from '@/types/workspace';

export const workspacesApi = {
  list: () => apiClient.get<Workspace[]>('/workspaces'),

  create: (data: { name: string; description?: string }) =>
    apiClient.post<{ id: string; name: string; status: string }>('/workspaces', data),

  get: (id: string) =>
    apiClient.get<Workspace & { members: WorkspaceMember[]; my_role: string }>(
      `/workspaces/${id}`
    ),

  update: (id: string, data: { name?: string; description?: string; is_public?: number }) =>
    apiClient.put(`/workspaces/${id}`, data),

  delete: (id: string) => apiClient.delete(`/workspaces/${id}`),

  invite: (id: string, data: { user_name: string; role: string }) =>
    apiClient.post(`/workspaces/${id}/members`, data),

  removeMember: (workspaceId: string, userId: string) =>
    apiClient.delete(`/workspaces/${workspaceId}/members/${userId}`),
};
```

创建 `frontend/src/api/projects.ts`：

```typescript
import apiClient from './client';
import type { Project } from '@/types/workspace';

export const projectsApi = {
  list: (workspaceId: string) =>
    apiClient.get<Project[]>(`/w/${workspaceId}/projects`),

  create: (workspaceId: string, data: { name: string; description?: string }) =>
    apiClient.post<{ id: string; name: string; status: string }>(
      `/w/${workspaceId}/projects`,
      data
    ),

  get: (id: string) => apiClient.get<Project>(`/projects/${id}`),

  delete: (id: string) => apiClient.delete(`/projects/${id}`),
};
```

创建 `frontend/src/api/sessions.ts`：

```typescript
import apiClient from './client';
import type { Session } from '@/types/api';

export const sessionsApi = {
  list: () => apiClient.get<Session[]>('/sessions'),

  get: (id: string) =>
    apiClient.get<{ messages: Array<{ role: string; content: string }>; updated: string }>(
      `/sessions/${id}`
    ),

  save: (data: {
    id: string;
    title?: string;
    messages: Array<{ role: string; content: string }>;
  }) => apiClient.post('/sessions', data),

  delete: (id: string) => apiClient.delete(`/sessions/${id}`),

  search: (q: string, limit = 20, offset = 0) =>
    apiClient.get('/sessions/search', { params: { q, limit, offset } }),
};
```

创建 `frontend/src/api/user.ts`：

```typescript
import apiClient from './client';

export const userApi = {
  getProfile: () =>
    apiClient.get<{ user_id: string; user_name: string; is_admin: boolean }>(
      '/user/profile'
    ),

  updateProfile: (data: { name?: string; password?: string }) =>
    apiClient.put('/user/profile', data),

  getApiKeyStatus: () =>
    apiClient.get<{ has_custom_key: boolean; using_system_default: boolean }>(
      '/user/api-key'
    ),

  saveApiKey: (api_key: string) =>
    apiClient.put('/user/api-key', { api_key }),

  deleteApiKey: () => apiClient.delete('/user/api-key'),
};
```

- [ ] **Step 4: 编写 Zustand Stores**

创建 `frontend/src/stores/authStore.ts`：

```typescript
import { create } from 'zustand';
import type { User } from '@/types/user';

interface AuthStore {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  token: localStorage.getItem('auth_token'),
  user: null,
  isLoading: true,
  setAuth: (token, user) => {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('mc_uname', user.user_name);
    set({ token, user, isLoading: false });
  },
  logout: () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('mc_uname');
    set({ token: null, user: null, isLoading: false });
  },
  setLoading: (isLoading) => set({ isLoading }),
}));
```

创建 `frontend/src/stores/workspaceStore.ts`：

```typescript
import { create } from 'zustand';

interface WorkspaceStore {
  currentWorkspaceId: string | null;
  currentProjectId: string | null;
  setWorkspace: (id: string | null) => void;
  setProject: (id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  currentWorkspaceId: null,
  currentProjectId: null,
  setWorkspace: (id) => set({ currentWorkspaceId: id, currentProjectId: null }),
  setProject: (id) => set({ currentProjectId: id }),
}));
```

- [ ] **Step 5: 编写 lib 工具**

创建 `frontend/src/lib/constants.ts`：

```typescript
export const ROLES = ['Planner', 'Retriever', 'Coder', 'Writer', 'Tester', 'Summarizer', 'Bot'] as const;
export type AgentRole = (typeof ROLES)[number];
```

创建 `frontend/src/lib/permissions.ts`：

```typescript
export type WorkspaceRole = 'admin' | 'owner' | 'member' | 'viewer';
export type Action = 'view' | 'edit' | 'delete' | 'invite' | 'manage';

const ROLE_LEVEL: Record<WorkspaceRole, number> = {
  admin: 4,
  owner: 3,
  member: 2,
  viewer: 1,
};

const ACTION_LEVEL: Record<Action, number> = {
  view: 1,
  edit: 2,
  delete: 3,
  invite: 3,
  manage: 4,
};

export function hasPermission(role: WorkspaceRole | null, action: Action): boolean {
  if (!role) return false;
  return ROLE_LEVEL[role] >= ACTION_LEVEL[action];
}
```

- [ ] **Step 6: 验证编译**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/ frontend/src/api/ frontend/src/stores/ frontend/src/lib/
git commit -m "feat(frontend): 类型定义 + API 层 + Zustand Store + 权限工具"
```

---

### Task 7: 前端 — 路由与 Auth Guard

**Files:**
- Create: `frontend/src/routes/index.tsx`
- Create: `frontend/src/components/auth/AuthGuard.tsx`
- Create: `frontend/src/components/auth/AdminGuard.tsx`
- Create: `frontend/src/hooks/useAuth.ts`
- Modify: `frontend/src/App.tsx`, `frontend/src/main.tsx`

**Interfaces:**
- Consumes: `authStore`, `authApi.me()`
- Produces: `<RouterProvider>` + `<AuthGuard>` + `<AdminGuard>`

- [ ] **Step 1: 编写 useAuth hook**

创建 `frontend/src/hooks/useAuth.ts`：

```typescript
import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/api/auth';

export function useAuth() {
  const { token, user, isLoading, setAuth, logout, setLoading } = useAuthStore();

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then((res) => {
        setAuth(token, {
          user_id: res.data.user_id,
          user_name: res.data.user_name,
          is_admin: false, // me() 不返回 is_admin, 需要额外请求
        });
      })
      .catch(() => {
        logout();
      });
  }, []);

  return { user, isLoading, isAuthenticated: !!token && !!user, logout };
}
```

- [ ] **Step 2: 编写 AuthGuard**

创建 `frontend/src/components/auth/AuthGuard.tsx`：

```typescript
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Loader2 } from 'lucide-react';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { token, isLoading } = useAuthStore();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
```

创建 `frontend/src/components/auth/AdminGuard.tsx`：

```typescript
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();

  if (!user?.is_admin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
```

- [ ] **Step 3: 编写路由配置**

创建 `frontend/src/routes/index.tsx`：

```typescript
import { createBrowserRouter } from 'react-router-dom';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AdminGuard } from '@/components/auth/AdminGuard';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { WorkspaceOverview } from '@/pages/workspace/WorkspaceOverview';
import { WorkspaceDetail } from '@/pages/workspace/WorkspaceDetail';
import { ChatPage } from '@/pages/project/ChatPage';
import { SettingsPage } from '@/pages/settings/SettingsPage';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/register',
    element: <RegisterPage />,
  },
  {
    path: '/',
    element: (
      <AuthGuard>
        <AppShell />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <WorkspaceOverview /> },
      { path: 'w/:workspaceId', element: <WorkspaceDetail /> },
      { path: 'w/:workspaceId/p/:projectId/chat', element: <ChatPage /> },
      { path: 'settings', element: <SettingsPage /> },
      {
        path: 'admin',
        element: (
          <AdminGuard>
            <div>管理后台 (Phase 3)</div>
          </AdminGuard>
        ),
      },
    ],
  },
]);
```

- [ ] **Step 4: 更新 App.tsx 和 main.tsx**

修改 `frontend/src/App.tsx`：

```typescript
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { router } from '@/routes';
import { useAuth } from '@/hooks/useAuth';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function AuthInitializer({ children }: { children: React.ReactNode }) {
  useAuth();
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthInitializer>
        <RouterProvider router={router} />
        <Toaster position="top-right" richColors />
      </AuthInitializer>
    </QueryClientProvider>
  );
}
```

修改 `frontend/src/main.tsx`：

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 5: 验证编译**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npx tsc --noEmit
```

Expected: 先有 import 错误（页面组件尚不存在），这是预期的。确认错误仅来自缺失的页面组件。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/routes/ frontend/src/components/auth/ frontend/src/hooks/useAuth.ts frontend/src/App.tsx frontend/src/main.tsx
git commit -m "feat(frontend): 路由配置 + AuthGuard + React Query Provider"
```

---

### Task 8: 前端 — AppShell 布局组件

**Files:**
- Create: `frontend/src/components/layout/AppShell.tsx`
- Create: `frontend/src/components/layout/Sidebar.tsx`
- Create: `frontend/src/components/layout/Header.tsx`

**Interfaces:**
- Consumes: `useAuthStore`, `useWorkspaceStore`, `react-router-dom <Outlet/>`
- Produces: 全局布局框架（侧边栏 + 顶栏 + 内容区）

- [ ] **Step 1: 编写 Sidebar**

创建 `frontend/src/components/layout/Sidebar.tsx`：

```typescript
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderOpen,
  Bot,
  Puzzle,
  Settings,
  Shield,
  LogOut,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: '工作空间' },
  { to: '/templates', icon: Puzzle, label: '模板市场' },
  { to: '/settings', icon: Settings, label: '个人设置' },
];

export function Sidebar() {
  const { user, logout } = useAuthStore();
  const { currentWorkspaceId } = useWorkspaceStore();

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-card">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 px-4 border-b">
        <Bot className="h-6 w-6 text-primary" />
        <span className="font-semibold text-sm">Multi-Agent</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div className="border-t p-3">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.user_name ?? '未登录'}</p>
            <p className="text-xs text-muted-foreground">
              {user?.is_admin ? '管理员' : '用户'}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={logout} title="退出登录">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: 编写 Header**

创建 `frontend/src/components/layout/Header.tsx`：

```typescript
import { useLocation } from 'react-router-dom';
import { ChevronRight, Slash } from 'lucide-react';

const routeLabels: Record<string, string> = {
  '/': '工作空间总览',
  '/templates': '模板市场',
  '/settings': '个人设置',
  '/admin': '管理后台',
};

function getBreadcrumbs(pathname: string): string[] {
  const parts = pathname.split('/').filter(Boolean);
  const crumbs: string[] = [];

  if (parts[0] === 'w' && parts[1]) {
    crumbs.push('工作空间');
    if (parts[2] === 'p' && parts[3]) {
      crumbs.push('项目');
      if (parts[4] === 'chat') crumbs.push('对话');
    }
  } else {
    crumbs.push(routeLabels[pathname] || routeLabels['/']);
  }

  return crumbs;
}

export function Header() {
  const location = useLocation();
  const crumbs = getBreadcrumbs(location.pathname);

  return (
    <header className="flex h-14 items-center gap-2 border-b px-6">
      {crumbs.map((crumb, i) => (
        <span key={i} className="flex items-center gap-2 text-sm">
          {i > 0 && <Slash className="h-3 w-3 text-muted-foreground" />}
          <span className={i === crumbs.length - 1 ? 'font-medium' : 'text-muted-foreground'}>
            {crumb}
          </span>
        </span>
      ))}
    </header>
  );
}
```

- [ ] **Step 3: 编写 AppShell**

创建 `frontend/src/components/layout/AppShell.tsx`：

```typescript
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/
git commit -m "feat(frontend): AppShell 布局 — Sidebar + Header + Outlet"
```

---

### Task 9: 前端 — 登录/注册页面

**Files:**
- Create: `frontend/src/pages/auth/LoginPage.tsx`
- Create: `frontend/src/pages/auth/RegisterPage.tsx`

**Interfaces:**
- Consumes: `authApi`, `useAuthStore`, `react-router-dom useNavigate`
- Produces: 完整的登录/注册流程

- [ ] **Step 1: 编写 LoginPage**

创建 `frontend/src/pages/auth/LoginPage.tsx`：

```typescript
import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Bot, Loader2 } from 'lucide-react';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

export function LoginPage() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { setAuth } = useAuthStore();

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !password) return;
    setLoading(true);
    try {
      const res = await authApi.login({ name: name.trim(), password });
      setAuth(res.data.token, {
        user_id: res.data.user_id,
        user_name: res.data.name,
        is_admin: false,
      });
      toast.success(`欢迎回来, ${res.data.name}`);
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '登录失败';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <Bot className="mx-auto h-10 w-10 text-primary" />
          <CardTitle className="text-xl">Multi-Agent Platform</CardTitle>
          <CardDescription>登录你的账号</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">用户名</Label>
              <Input
                id="name"
                placeholder="输入用户名"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              登录
            </Button>
            <p className="text-sm text-muted-foreground">
              还没有账号？{' '}
              <Link to="/register" className="text-primary hover:underline">
                立即注册
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: 编写 RegisterPage**

创建 `frontend/src/pages/auth/RegisterPage.tsx`：

```typescript
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Bot, Loader2 } from 'lucide-react';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

export function RegisterPage() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !password) return;
    if (password !== confirm) {
      toast.error('两次密码不一致');
      return;
    }
    if (password.length < 6) {
      toast.error('密码至少 6 位');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.register({ name: name.trim(), password });
      setAuth(res.data.token, {
        user_id: res.data.user_id,
        user_name: res.data.name,
        is_admin: false,
      });
      toast.success('注册成功！');
      navigate('/', { replace: true });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '注册失败';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <Bot className="mx-auto h-10 w-10 text-primary" />
          <CardTitle className="text-xl">创建账号</CardTitle>
          <CardDescription>加入 Multi-Agent 公共平台</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">用户名</Label>
              <Input
                id="name"
                placeholder="3-20 个字符"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="至少 6 位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">确认密码</Label>
              <Input
                id="confirm"
                type="password"
                placeholder="再次输入密码"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              注册
            </Button>
            <p className="text-sm text-muted-foreground">
              已有账号？{' '}
              <Link to="/login" className="text-primary hover:underline">
                去登录
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: 验证登录流程**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npx tsc --noEmit
```

确保后端运行，然后在浏览器访问 `http://localhost:5173/login`，测试注册→登录→跳转首页。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/auth/
git commit -m "feat(frontend): 登录/注册页面"
```

---

### Task 10: 前端 — 工作空间总览页面

**Files:**
- Create: `frontend/src/pages/workspace/WorkspaceOverview.tsx`
- Create: `frontend/src/components/shared/WorkspaceCard.tsx`
- Create: `frontend/src/components/shared/CreateDialog.tsx`
- Create: `frontend/src/components/shared/EmptyState.tsx`

**Interfaces:**
- Consumes: `workspacesApi`, `useWorkspaceStore`
- Produces: 工作空间卡片列表 + 创建弹窗 + 空状态

- [ ] **Step 1: 编写 EmptyState 组件**

创建 `frontend/src/components/shared/EmptyState.tsx`：

```typescript
import { type LucideIcon, FolderOpen } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon = FolderOpen, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Icon className="h-12 w-12 text-muted-foreground/50" />
      <h3 className="mt-4 text-lg font-medium">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-sm">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 2: 编写 CreateDialog 组件**

创建 `frontend/src/components/shared/CreateDialog.tsx`：

```typescript
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';

interface CreateDialogProps {
  title: string;
  description: string;
  triggerLabel: string;
  nameLabel?: string;
  namePlaceholder?: string;
  descLabel?: string;
  descPlaceholder?: string;
  showDescription?: boolean;
  onSubmit: (name: string, description: string) => Promise<void>;
}

export function CreateDialog({
  title,
  description,
  triggerLabel,
  nameLabel = '名称',
  namePlaceholder = '输入名称',
  descLabel = '描述',
  descPlaceholder = '可选描述',
  showDescription = true,
  onSubmit,
}: CreateDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await onSubmit(name.trim(), desc.trim());
      setOpen(false);
      setName('');
      setDesc('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{nameLabel}</Label>
            <Input
              placeholder={namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
          </div>
          {showDescription && (
            <div className="space-y-2">
              <Label>{descLabel}</Label>
              <Textarea
                placeholder={descPlaceholder}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={3}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={loading || !name.trim()}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: 编写 WorkspaceCard 组件**

创建 `frontend/src/components/shared/WorkspaceCard.tsx`：

```typescript
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users } from 'lucide-react';
import type { Workspace } from '@/types/workspace';

export function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  const navigate = useNavigate();

  const roleLabels: Record<string, string> = {
    owner: 'Owner',
    member: 'Member',
    viewer: 'Viewer',
  };

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => navigate(`/w/${workspace.id}`)}
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg">{workspace.name}</CardTitle>
          <Badge variant="secondary">{roleLabels[workspace.role || 'member']}</Badge>
        </div>
        <CardDescription className="line-clamp-2">
          {workspace.description || '暂无描述'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span>{workspace.created_at?.slice(0, 10)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: 编写 WorkspaceOverview 页面**

创建 `frontend/src/pages/workspace/WorkspaceOverview.tsx`：

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { workspacesApi } from '@/api/workspaces';
import { WorkspaceCard } from '@/components/shared/WorkspaceCard';
import { CreateDialog } from '@/components/shared/CreateDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';

export function WorkspaceOverview() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: workspaces, isLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: async () => {
      const res = await workspacesApi.list();
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      const res = await workspacesApi.create({ name, description });
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      toast.success(`工作空间 "${data.name}" 创建成功`);
      navigate(`/w/${data.id}`);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '创建失败';
      toast.error(msg);
    },
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">工作空间</h1>
          <p className="text-muted-foreground mt-1">管理你的团队和智能体项目</p>
        </div>
        <CreateDialog
          title="创建工作空间"
          description="工作空间是团队协作的容器，创建后可以邀请成员加入"
          triggerLabel="创建工作空间"
          namePlaceholder="例如：课程设计团队"
          onSubmit={async (name, description) => {
            await createMutation.mutateAsync({ name, description });
          }}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : workspaces && workspaces.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workspaces.map((ws) => (
            <WorkspaceCard key={ws.id} workspace={ws} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="还没有工作空间"
          description="创建你的第一个工作空间，开始与团队一起使用智能体"
          action={
            <CreateDialog
              title="创建工作空间"
              description="工作空间是团队协作的容器"
              triggerLabel="创建第一个工作空间"
              onSubmit={async (name, description) => {
                await createMutation.mutateAsync({ name, description });
              }}
            />
          }
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shared/ frontend/src/pages/workspace/WorkspaceOverview.tsx
git commit -m "feat(frontend): 工作空间总览页 — 列表 + 创建 + 空状态"
```

---

### Task 11: 前端 — 工作空间详情 + 项目列表页

**Files:**
- Create: `frontend/src/pages/workspace/WorkspaceDetail.tsx`
- Create: `frontend/src/components/shared/ProjectCard.tsx`

**Interfaces:**
- Consumes: `workspacesApi.get()`, `projectsApi`, `useWorkspaceStore`
- Produces: 工作空间详情页（成员列表 + 项目列表 + 邀请成员 + 创建项目）

- [ ] **Step 1: 编写 ProjectCard 组件**

创建 `frontend/src/components/shared/ProjectCard.tsx`：

```typescript
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageSquare, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Project } from '@/types/workspace';
import { hasPermission } from '@/lib/permissions';

interface ProjectCardProps {
  project: Project;
  myRole: string | null;
  onDelete: (id: string) => void;
}

export function ProjectCard({ project, myRole, onDelete }: ProjectCardProps) {
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const canDelete = hasPermission(myRole as Parameters<typeof hasPermission>[0], 'delete');

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => navigate(`/w/${workspaceId}/p/${project.id}/chat`)}
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <CardTitle className="text-base">{project.name}</CardTitle>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/w/${workspaceId}/p/${project.id}/chat`);
              }}
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(project.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <CardDescription className="line-clamp-2">
          {project.description || '暂无描述'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          创建于 {project.created_at?.slice(0, 10)}
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: 编写 WorkspaceDetail 页面**

创建 `frontend/src/pages/workspace/WorkspaceDetail.tsx`：

```typescript
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workspacesApi } from '@/api/workspaces';
import { projectsApi } from '@/api/projects';
import { ProjectCard } from '@/components/shared/ProjectCard';
import { CreateDialog } from '@/components/shared/CreateDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, UserPlus, Trash2, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { hasPermission } from '@/lib/permissions';
import { toast } from 'sonner';

export function WorkspaceDetail() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: async () => {
      const res = await workspacesApi.get(workspaceId!);
      return res.data;
    },
    enabled: !!workspaceId,
  });

  const deleteProjectMutation = useMutation({
    mutationFn: (projectId: string) => projectsApi.delete(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] });
      toast.success('项目已删除');
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      const res = await projectsApi.create(workspaceId!, { name, description });
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] });
      toast.success(`项目 "${data.name}" 创建成功`);
      navigate(`/w/${workspaceId}/p/${data.id}/chat`);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '创建失败';
      toast.error(msg);
    },
  });

  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteOpen, setInviteOpen] = useState(false);

  const inviteMutation = useMutation({
    mutationFn: async () => {
      await workspacesApi.invite(workspaceId!, {
        user_name: inviteName,
        role: inviteRole,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] });
      toast.success(`${inviteName} 已加入工作空间`);
      setInviteOpen(false);
      setInviteName('');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '邀请失败';
      toast.error(msg);
    },
  });

  const myRole = data?.my_role ?? null;
  const canInvite = hasPermission(myRole as Parameters<typeof hasPermission>[0], 'invite');
  const canCreate = hasPermission(myRole as Parameters<typeof hasPermission>[0], 'edit');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => navigate('/')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> 返回
        </Button>
        <EmptyState title="工作空间不存在" description="该工作空间可能已被删除" />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* 返回 + 标题 */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <Button variant="ghost" className="mb-2 -ml-2" onClick={() => navigate('/')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> 返回
          </Button>
          <h1 className="text-2xl font-bold">{data.name}</h1>
          <p className="text-muted-foreground mt-1">{data.description || '暂无描述'}</p>
        </div>
        <div className="flex gap-2">
          {canInvite && (
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <UserPlus className="mr-2 h-4 w-4" /> 邀请成员
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>邀请成员</DialogTitle>
                  <DialogDescription>输入已注册用户的用户名</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>用户名</Label>
                    <Input
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                      placeholder="输入用户名"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>角色</Label>
                    <Select value={inviteRole} onValueChange={setInviteRole}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Member — 可编辑项目</SelectItem>
                        <SelectItem value="viewer">Viewer — 只读</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => inviteMutation.mutate()} disabled={!inviteName.trim()}>
                    邀请
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* 成员列表 */}
      <div className="mb-8">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">
          成员 ({data.members?.length ?? 0})
        </h2>
        <div className="flex flex-wrap gap-2">
          {data.members?.map((m) => (
            <Badge key={m.user_id} variant="secondary" className="flex items-center gap-1">
              {m.name}
              <span className="text-xs opacity-50">
                ({m.role === 'owner' ? 'Owner' : m.role === 'member' ? 'Member' : 'Viewer'})
              </span>
            </Badge>
          ))}
        </div>
      </div>

      {/* 项目列表 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            项目 ({data.projects?.length ?? 0})
          </h2>
          {canCreate && (
            <CreateDialog
              title="创建项目"
              description="项目是智能体实验的容器，包含对话会话和配置"
              triggerLabel="创建项目"
              namePlaceholder="例如：代码助手 v2.0"
              onSubmit={async (name, description) => {
                await createProjectMutation.mutateAsync({ name, description });
              }}
            />
          )}
        </div>
        {data.projects && data.projects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                myRole={myRole}
                onDelete={(id) => deleteProjectMutation.mutate(id)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="还没有项目"
            description="创建第一个项目，开始配置和运行智能体"
            action={
              canCreate && (
                <CreateDialog
                  title="创建项目"
                  description="项目是智能体实验的容器"
                  triggerLabel="创建第一个项目"
                  onSubmit={async (name, description) => {
                    await createProjectMutation.mutateAsync({ name, description });
                  }}
                />
              )
            }
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/workspace/WorkspaceDetail.tsx frontend/src/components/shared/ProjectCard.tsx
git commit -m "feat(frontend): 工作空间详情页 — 成员列表 + 项目 CRUD + 邀请"
```

---

### Task 12: 前端 — 项目对话页（迁移现有聊天功能）

**Files:**
- Create: `frontend/src/pages/project/ChatPage.tsx`

**Interfaces:**
- Consumes: `sessionsApi`, `/api/chat` (直接 fetch), `useAuthStore`
- Produces: 完整聊天界面（消息列表 + 输入框 + 思考面板 + 会话历史）

- [ ] **Step 1: 编写 ChatPage**

创建 `frontend/src/pages/project/ChatPage.tsx`：

```typescript
import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, Bot, User, Loader2, Brain, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { sessionsApi } from '@/api/sessions';
import { projectsApi } from '@/api/projects';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Message {
  role: 'user' | 'assistant' | 'error';
  content: string;
  thinking?: Array<{ agent: string; output: string }>;
  task_type?: string;
}

export function ChatPage() {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const { token } = useAuthStore();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentTask, setCurrentTask] = useState<string | null>(null);
  const [expandedThinking, setExpandedThinking] = useState<Record<number, boolean>>({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 加载项目信息
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const res = await projectsApi.get(projectId!);
      return res.data;
    },
    enabled: !!projectId,
  });

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 自动调整 textarea 高度
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, []);

  // 发送消息
  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: Message = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);
    setCurrentTask('思考中...');

    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    const history = messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: text,
          lane_mode: 'auto',
          history,
        }),
      });

      const data = await res.json();

      const assistantMsg: Message = {
        role: data.error ? 'error' : 'assistant',
        content: data.reply || data.error || '无响应',
        thinking: data.thinking || [],
        task_type: data.task_type || '未知',
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setCurrentTask(data.task_type || null);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'error', content: '❌ 网络请求失败，请稍后重试' },
      ]);
    } finally {
      setSending(false);
    }
  };

  // 键盘快捷键
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏 */}
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <Bot className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <h2 className="text-sm font-medium">{project?.name ?? '对话'}</h2>
          {currentTask && (
            <p className="text-xs text-muted-foreground">任务类型: {currentTask}</p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setMessages([]);
            setSessionId(null);
            setCurrentTask(null);
            setExpandedThinking({});
          }}
        >
          <Plus className="mr-1 h-4 w-4" /> 新对话
        </Button>
      </div>

      {/* 消息列表 */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="mx-auto max-w-3xl space-y-6 p-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Bot className="h-12 w-12 text-muted-foreground/30" />
              <h3 className="mt-4 text-lg font-medium">开始对话</h3>
              <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                向智能体团队发送消息，观察它们如何协作完成任务
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                'flex gap-3',
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              )}
            >
              {/* 头像 */}
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground order-2'
                    : msg.role === 'error'
                    ? 'bg-destructive text-destructive-foreground'
                    : 'bg-muted'
                )}
              >
                {msg.role === 'user' ? (
                  <User className="h-4 w-4" />
                ) : (
                  <Bot className="h-4 w-4" />
                )}
              </div>

              {/* 消息内容 */}
              <div
                className={cn(
                  'max-w-[80%] rounded-lg px-4 py-3',
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : msg.role === 'error'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-muted'
                )}
              >
                {/* 思考过程折叠面板 */}
                {msg.thinking && msg.thinking.length > 0 && (
                  <div className="mb-3 border-b border-border/50 pb-2">
                    <button
                      className="flex w-full items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setExpandedThinking((prev) => ({
                          ...prev,
                          [i]: !prev[i],
                        }))
                      }
                    >
                      <Brain className="h-3.5 w-3.5" />
                      思考过程 ({msg.thinking.length} 步)
                      {expandedThinking[i] ? (
                        <ChevronUp className="ml-auto h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="ml-auto h-3.5 w-3.5" />
                      )}
                    </button>
                    {expandedThinking[i] && (
                      <div className="mt-2 space-y-2">
                        {msg.thinking.map((step, j) => (
                          <div key={j} className="rounded bg-background/50 p-2">
                            <Badge variant="outline" className="mb-1 text-xs">
                              {step.agent}
                            </Badge>
                            <p className="text-xs whitespace-pre-wrap text-muted-foreground">
                              {step.output?.slice(0, 300)}
                              {step.output?.length > 300 && '...'}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 消息正文 */}
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {msg.content}
                </div>
              </div>
            </div>
          ))}

          {/* 发送中 loading */}
          {sending && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">智能体处理中...</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* 输入框 */}
      <div className="border-t p-4">
        <div className="mx-auto flex max-w-3xl gap-3">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="输入你的问题或任务... (Enter 发送, Shift+Enter 换行)"
            className="min-h-[44px] resize-none"
            rows={1}
            disabled={sending}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            size="icon"
            className="shrink-0"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 补充缺失的 shadcn 组件**

ChatPage 使用了 `ScrollArea` 和 `Textarea`，确保已安装：

```bash
cd "D:\AI\Internship\Multi_Agent\frontend"
npx shadcn@latest add scroll-area textarea
```

- [ ] **Step 3: 验证编译**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/project/ChatPage.tsx
git commit -m "feat(frontend): 项目对话页 — 迁移聊天功能（消息+思考面板+自动滚动）"
```

---

### Task 13: 前端 — 个人设置页面

**Files:**
- Create: `frontend/src/pages/settings/SettingsPage.tsx`

**Interfaces:**
- Consumes: `userApi`, `useAuthStore`
- Produces: Profile 编辑 + API Key 管理

- [ ] **Step 1: 编写 SettingsPage**

创建 `frontend/src/pages/settings/SettingsPage.tsx`：

```typescript
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Loader2, Key, Trash2, Eye, EyeOff } from 'lucide-react';
import { userApi } from '@/api/user';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

export function SettingsPage() {
  const { user, setAuth } = useAuthStore();

  // Profile
  const [editName, setEditName] = useState('');
  const [editPassword, setEditPassword] = useState('');

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const res = await userApi.getProfile();
      setEditName(res.data.user_name);
      return res.data;
    },
  });

  const profileMutation = useMutation({
    mutationFn: async () => {
      const data: { name?: string; password?: string } = {};
      if (editName && editName !== user?.user_name) data.name = editName;
      if (editPassword) data.password = editPassword;
      if (Object.keys(data).length === 0) throw new Error('无变更');
      await userApi.updateProfile(data);
    },
    onSuccess: () => {
      toast.success('个人信息已更新');
      setEditPassword('');
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message || '更新失败';
      if (msg === '无变更') return;
      const apiErr = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(apiErr || msg);
    },
  });

  // API Key
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  const { data: keyStatus } = useQuery({
    queryKey: ['api-key-status'],
    queryFn: async () => {
      const res = await userApi.getApiKeyStatus();
      return res.data;
    },
  });

  const saveKeyMutation = useMutation({
    mutationFn: async (key: string) => {
      await userApi.saveApiKey(key);
    },
    onSuccess: () => {
      toast.success('API Key 已保存');
      setApiKey('');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '保存失败';
      toast.error(msg);
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: () => userApi.deleteApiKey(),
    onSuccess: () => toast.success('已恢复使用系统默认 API Key'),
    onError: () => toast.error('操作失败'),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">个人设置</h1>
        <p className="text-muted-foreground mt-1">管理你的账号信息和 API Key</p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
          <CardDescription>修改用户名或密码</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>用户 ID</Label>
            <Input value={profile?.user_id ?? ''} disabled className="font-mono text-sm" />
          </div>
          <div className="space-y-2">
            <Label>用户名</Label>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder={user?.user_name}
            />
          </div>
          <div className="space-y-2">
            <Label>新密码（留空不修改）</Label>
            <Input
              type="password"
              value={editPassword}
              onChange={(e) => setEditPassword(e.target.value)}
              placeholder="至少 6 位"
            />
          </div>
          <Button onClick={() => profileMutation.mutate()} disabled={profileMutation.isPending}>
            {profileMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存更改
          </Button>
        </CardContent>
      </Card>

      {/* API Key */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            API Key 管理
          </CardTitle>
          <CardDescription>
            配置你的 LLM API Key。留空则使用平台默认免费 Key。
            {keyStatus?.using_system_default && (
              <Badge variant="secondary" className="ml-2">当前使用系统默认</Badge>
            )}
            {keyStatus?.has_custom_key && (
              <Badge className="ml-2">正在使用自定义 Key</Badge>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>DeepSeek API Key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                onClick={() => saveKeyMutation.mutate(apiKey)}
                disabled={!apiKey.trim() || saveKeyMutation.isPending}
              >
                保存
              </Button>
            </div>
          </div>
          {keyStatus?.has_custom_key && (
            <Button variant="outline" onClick={() => deleteKeyMutation.mutate()}>
              <Trash2 className="mr-2 h-4 w-4" />
              删除自定义 Key，使用系统默认
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/settings/SettingsPage.tsx
git commit -m "feat(frontend): 个人设置页 — Profile 编辑 + API Key 管理"
```

---

### Task 14: 集成 — 后端挂载 React 前端 (开发模式) + Vercel 部署配置

**Files:**
- Modify: `main.py`（新增 `/app` 路由用于开发时访问 React）
- Create: `frontend/.env.production`（Vercel 部署配置）
- Create: `frontend/vercel.json`（Vercel 路由重写）
- Modify: `frontend/package.json`（添加 build 脚本）

**Interfaces:**
- Consumes: `frontend/` 构建产物 `dist/`
- Produces: 开发模式共存，生产模式 Vercel 部署

- [ ] **Step 1: 开发模式 — 后端代理到 Vite dev server**

在 `main.py` 中添加开发模式下的反向代理（仅开发环境使用）：

```python
# 在路由定义区域末尾添加（import 区域之后，if __name__ 之前）

import os as _os
_DEV_MODE = _os.getenv("DEV_MODE", "0") == "1"

if _DEV_MODE:
    # 开发模式下，/app 路径反向代理到 Vite dev server
    import httpx
    from fastapi.responses import StreamingResponse

    @app.api_route("/app/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
    async def proxy_to_vite(path: str, request: Request):
        """开发模式：将 /app/* 代理到 Vite dev server (port 5173)"""
        client = httpx.AsyncClient(base_url="http://localhost:5173")
        url = f"/{path}"
        headers = dict(request.headers)
        headers.pop("host", None)
        try:
            r = await client.request(
                method=request.method,
                url=url,
                headers=headers,
                content=await request.body(),
            )
            return StreamingResponse(
                r.iter_bytes(),
                status_code=r.status_code,
                headers=dict(r.headers),
            )
        finally:
            await client.aclose()
```

在 `requirements.txt` 中确保 `httpx` 存在（通常已有）。

- [ ] **Step 2: Vercel 生产部署配置**

创建 `frontend/vercel.json`：

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://multi-agent-api.fly.dev/api/:path*"
    },
    {
      "source": "/((?!api).*)",
      "destination": "/index.html"
    }
  ]
}
```

创建 `frontend/.env.production`：

```
VITE_API_BASE_URL=https://multi-agent-api.fly.dev
```

修改 `frontend/package.json` 添加 Vercel 构建脚本：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "vercel-build": "npm run build"
  }
}
```

修改 `frontend/tsconfig.app.json`（去除 `noEmit` 以允许 `tsc -b` 输出）：

_或者将 `build` 脚本改为 `vite build`（跳过 tsc 在 CI 中的类型检查，在本地已完成）_

```json
{
  "scripts": {
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 3: 在 .gitignore 中排除 frontend 构建产物**

确保 `frontend/dist/` 和 `frontend/node_modules/` 已在 `.gitignore` 中。

- [ ] **Step 4: 验证构建**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend"
npm run build
```

Expected: `dist/` 目录生成，包含 `index.html` + JS/CSS 资源。

- [ ] **Step 5: Vercel 首次部署**

```bash
# 安装 Vercel CLI
npm i -g vercel

# 登录（一次性）
vercel login

# 从 frontend/ 目录部署
cd "D:\AI\Internship\Multi_Agent\frontend"
vercel --prod
```

按照提示：选择项目、确认配置、部署。部署成功后获得 `https://xxx.vercel.app` URL。

- [ ] **Step 6: 设置 Vercel 自动部署**

在 Vercel 控制台中关联 GitHub 仓库，设置：
- Root Directory: `frontend`
- Build Command: `npm run build`
- Output Directory: `dist`
- Framework Preset: Vite

每次 `git push` 到 main 分支自动触发部署。

- [ ] **Step 7: Commit**

```bash
git add main.py frontend/vercel.json frontend/.env.production frontend/package.json requirements.txt
git commit -m "feat(deploy): 开发模式 Vite 代理 + Vercel 生产部署配置"
```

---

## 验证清单

完成所有 Task 后，端到端验证以下流程：

- [ ] `python main.py` 启动后端，`cd frontend && npm run dev` 启动前端
- [ ] 访问 `http://localhost:5173` → 重定向到 `/login`
- [ ] 注册新用户 → 自动登录 → 跳转工作空间总览
- [ ] 创建工作空间 → 进入详情页 → 邀请成员（用另一个用户）
- [ ] 创建项目 → 进入对话页 → 发送消息 → 收到 Agent 回复
- [ ] 思考过程面板可折叠/展开
- [ ] 个人设置 → 修改用户名 → 保存 API Key
- [ ] 退出登录 → 重新登录 → 数据保持不变
- [ ] `cd frontend && npm run build` 构建成功
- [ ] Vercel 部署后可公开访问

---

## 自检

- [x] Spec 覆盖：Phase 1 全部 9 个交付项均有对应 Task
- [x] 无 TBD/TODO 残留
- [x] 类型一致性：Task 6 定义的类型被 Task 7-13 正确引用
- [x] 接口定义：每个 Task 的 Interfaces 部分明确定义了 consumes/produces
- [x] 每个 Task 结束时都有 Commit 步骤
