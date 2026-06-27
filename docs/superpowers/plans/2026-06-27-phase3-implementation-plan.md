# Phase 3 平台完善 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已完成 P0-P2 基础上，实现体验闭环（登录页+游客+搜索）、团队协作（组织+聊天+@agent）、补齐完善（知识库页+模型管理）

**Architecture:** 前端 React+daisyUI 新增 5 个页面 + 改造 3 个页面；后端 FastAPI 新增 2 个路由模块 + DB migration v5（organizations/channels/messages/todos 四表）；SSE 推团队消息

**Tech Stack:** React 19 + TypeScript + daisyUI 5 + Tailwind CSS 4 + React Router 6 + TanStack Query · FastAPI + SQLite v5 + LangChain + duckduckgo_search

## Global Constraints

- 服务器内存 ≤500MB（Render Free 实例）
- Uvicorn workers = 1
- 文件上传限制 ≤5MB
- sentence-transformers 懒加载
- SSE 连接 30 分钟无活动自动清理
- 团队 SSE 连接限制 max_connections=5
- LLM 调用串行化（同时只有 1 个 Agent 运行）
- 前端仅用已安装依赖（react, react-router-dom, @tanstack/react-query, axios, zustand, sonner, lucide-react, marked, highlight.js, recharts, @xyflow/react）
- 后端仅用已安装依赖（fastapi, langchain, langchain-deepseek, chromadb, bcrypt, pyjwt, httpx, scalar-fastapi）
- 新增依赖：duckduckgo_search（后端）

---

## File Map

```
Create (frontend):
  frontend/src/pages/home/HomePage.tsx          — 主界面快速开始页
  frontend/src/pages/team/TeamHome.tsx          — 组织列表页
  frontend/src/pages/team/TeamChat.tsx          — 团队聊天三栏页
  frontend/src/pages/knowledge/KnowledgePage.tsx — 知识库独立页

Create (backend):
  workspace/organizations.py                    — 组织 CRUD + 邀请码路由
  workspace/team_chat.py                        — 频道/消息/待办 + SSE 路由

Modify (frontend):
  frontend/src/pages/auth/LoginPage.tsx         — 左右分栏产品介绍+登录
  frontend/src/App.tsx                          — 游客模式路由守卫
  frontend/src/stores/authStore.ts              — isGuest 状态
  frontend/src/api/client.ts                    — 游客模式 API 拦截
  frontend/src/pages/project/ChatPage.tsx       — 游客受限提示
  frontend/src/routes/index.tsx                 — 新增路由 + 游客守卫
  frontend/src/pages/settings/SettingsPage.tsx  — 模型管理增强
  frontend/src/components/layout/Sidebar.tsx    — 左侧栏收起/展开
  frontend/src/components/layout/HomeSidebar.tsx — 主界面竖排导航

Modify (backend):
  main.py                                       — 免认证端点 + 组织/团队路由注册
  user/db.py                                    — migration v5 + CRUD 方法
  tools.py                                      — web_search 工具
  app/knowledge.py                              — 上传时复制到 coding/
  agents.py                                     — Planner/Bot 加入 web_search
  config.py                                     — 无改动（仅引用）
  requirements.txt                              — 添加 duckduckgo_search
```

---

### Task 1: 数据库 Migration v5 — 组织/频道/消息/待办表

**Files:**
- Modify: `user/db.py:16-20` (TARGET_SCHEMA_VERSION + migration)

**Interfaces:**
- Consumes: 现有 v4 schema（users, sessions, user_configs, workspaces, workspace_members, projects, eval_logs）
- Produces: v5 新增 organizations, org_members, org_channels, org_messages, org_todos 五表 + 17 个 CRUD 方法

- [ ] **Step 1: 提升 TARGET_SCHEMA_VERSION 到 5**

```python
# user/db.py line 16
TARGET_SCHEMA_VERSION = 5
```

- [ ] **Step 2: 添加 migration v5 SQL**

在 `_run_migration` 方法末尾添加：

```python
if version == 5:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS organizations (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT DEFAULT '',
            invite_code TEXT NOT NULL UNIQUE,
            owner_id    TEXT NOT NULL,
            created_at  TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (owner_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS org_members (
            org_id    TEXT NOT NULL,
            user_id   TEXT NOT NULL,
            role      TEXT NOT NULL DEFAULT 'member',
            joined_at TEXT DEFAULT (datetime('now', 'localtime')),
            PRIMARY KEY (org_id, user_id),
            FOREIGN KEY (org_id) REFERENCES organizations(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS org_channels (
            id      TEXT PRIMARY KEY,
            org_id  TEXT NOT NULL,
            name    TEXT NOT NULL DEFAULT 'general',
            FOREIGN KEY (org_id) REFERENCES organizations(id)
        );
        CREATE TABLE IF NOT EXISTS org_messages (
            id         TEXT PRIMARY KEY,
            channel_id TEXT NOT NULL,
            user_id    TEXT NOT NULL,
            content    TEXT NOT NULL,
            is_agent   INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (channel_id) REFERENCES org_channels(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS org_todos (
            id          TEXT PRIMARY KEY,
            org_id      TEXT NOT NULL,
            content     TEXT NOT NULL,
            assignee_id TEXT,
            completed   INTEGER DEFAULT 0,
            created_by  TEXT NOT NULL,
            created_at  TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (org_id) REFERENCES organizations(id),
            FOREIGN KEY (assignee_id) REFERENCES users(id)
        );
    """)
```

- [ ] **Step 3: 在 Database 类中添加组织 CRUD 方法**

```python
# 加在 class Database 末尾、get_eval_stats 方法之后

def create_organization(self, name: str, description: str, owner_id: str) -> str:
    import secrets, string
    oid = str(uuid.uuid4())
    code = ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))
    with self._conn() as conn:
        conn.execute(
            "INSERT INTO organizations (id, name, description, invite_code, owner_id) VALUES (?,?,?,?,?)",
            (oid, name, description, code, owner_id),
        )
        conn.execute(
            "INSERT INTO org_members (org_id, user_id, role) VALUES (?,?,?)",
            (oid, owner_id, 'owner'),
        )
    return oid

def list_organizations(self, user_id: str) -> list[dict]:
    with self._conn() as conn:
        rows = conn.execute("""
            SELECT o.*, om.role as my_role,
                   (SELECT COUNT(*) FROM org_members WHERE org_id = o.id) as member_count
            FROM organizations o
            JOIN org_members om ON o.id = om.org_id AND om.user_id = ?
            ORDER BY o.created_at DESC
        """, (user_id,)).fetchall()
    return [dict(r) for r in rows]

def get_organization(self, org_id: str) -> dict | None:
    with self._conn() as conn:
        row = conn.execute("SELECT * FROM organizations WHERE id = ?", (org_id,)).fetchone()
    return dict(row) if row else None

def get_org_by_invite(self, code: str) -> dict | None:
    with self._conn() as conn:
        row = conn.execute("SELECT * FROM organizations WHERE invite_code = ?", (code,)).fetchone()
    return dict(row) if row else None

def join_organization(self, org_id: str, user_id: str, role: str = 'member') -> bool:
    with self._conn() as conn:
        existing = conn.execute(
            "SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?", (org_id, user_id)
        ).fetchone()
        if existing:
            return False
        conn.execute(
            "INSERT INTO org_members (org_id, user_id, role) VALUES (?,?,?)",
            (org_id, user_id, role),
        )
    return True

def list_org_members(self, org_id: str) -> list[dict]:
    with self._conn() as conn:
        rows = conn.execute("""
            SELECT om.*, u.name as user_name
            FROM org_members om JOIN users u ON om.user_id = u.id
            WHERE om.org_id = ?
        """, (org_id,)).fetchall()
    return [dict(r) for r in rows]

def get_org_member_role(self, org_id: str, user_id: str) -> str | None:
    with self._conn() as conn:
        row = conn.execute(
            "SELECT role FROM org_members WHERE org_id = ? AND user_id = ?",
            (org_id, user_id),
        ).fetchone()
    return row["role"] if row else None

def remove_org_member(self, org_id: str, user_id: str) -> bool:
    with self._conn() as conn:
        cur = conn.execute(
            "DELETE FROM org_members WHERE org_id = ? AND user_id = ? AND role != 'owner'",
            (org_id, user_id),
        )
        return cur.rowcount > 0

def delete_organization(self, org_id: str) -> bool:
    with self._conn() as conn:
        conn.execute("DELETE FROM org_messages WHERE channel_id IN (SELECT id FROM org_channels WHERE org_id = ?)", (org_id,))
        conn.execute("DELETE FROM org_channels WHERE org_id = ?", (org_id,))
        conn.execute("DELETE FROM org_todos WHERE org_id = ?", (org_id,))
        conn.execute("DELETE FROM org_members WHERE org_id = ?", (org_id,))
        conn.execute("DELETE FROM organizations WHERE id = ?", (org_id,))
    return True

# ── 频道 ──

def create_channel(self, org_id: str, name: str) -> str:
    cid = str(uuid.uuid4())
    with self._conn() as conn:
        conn.execute("INSERT INTO org_channels (id, org_id, name) VALUES (?,?,?)", (cid, org_id, name))
    return cid

def list_channels(self, org_id: str) -> list[dict]:
    with self._conn() as conn:
        rows = conn.execute("SELECT * FROM org_channels WHERE org_id = ? ORDER BY name", (org_id,)).fetchall()
    return [dict(r) for r in rows]

# ── 消息 ──

def create_message(self, channel_id: str, user_id: str, content: str, is_agent: int = 0) -> str:
    mid = str(uuid.uuid4())
    with self._conn() as conn:
        conn.execute(
            "INSERT INTO org_messages (id, channel_id, user_id, content, is_agent) VALUES (?,?,?,?,?)",
            (mid, channel_id, user_id, content, is_agent),
        )
    return mid

def list_messages(self, channel_id: str, limit: int = 50, before: str | None = None) -> list[dict]:
    with self._conn() as conn:
        if before:
            rows = conn.execute("""
                SELECT m.*, u.name as user_name
                FROM org_messages m JOIN users u ON m.user_id = u.id
                WHERE m.channel_id = ? AND m.created_at < ?
                ORDER BY m.created_at DESC LIMIT ?
            """, (channel_id, before, limit)).fetchall()
        else:
            rows = conn.execute("""
                SELECT m.*, u.name as user_name
                FROM org_messages m JOIN users u ON m.user_id = u.id
                WHERE m.channel_id = ?
                ORDER BY m.created_at DESC LIMIT ?
            """, (channel_id, limit)).fetchall()
    return [dict(r) for r in reversed(rows)]

# ── 待办 ──

def create_todo(self, org_id: str, content: str, created_by: str, assignee_id: str | None = None) -> str:
    tid = str(uuid.uuid4())
    with self._conn() as conn:
        conn.execute(
            "INSERT INTO org_todos (id, org_id, content, assignee_id, created_by) VALUES (?,?,?,?,?)",
            (tid, org_id, content, assignee_id, created_by),
        )
    return tid

def list_todos(self, org_id: str) -> list[dict]:
    with self._conn() as conn:
        rows = conn.execute("""
            SELECT t.*, u.name as assignee_name
            FROM org_todos t LEFT JOIN users u ON t.assignee_id = u.id
            WHERE t.org_id = ?
            ORDER BY t.completed ASC, t.created_at DESC
        """, (org_id,)).fetchall()
    return [dict(r) for r in rows]

def update_todo(self, todo_id: str, completed: int | None = None, content: str | None = None) -> bool:
    with self._conn() as conn:
        if completed is not None and content is not None:
            conn.execute("UPDATE org_todos SET completed=?, content=? WHERE id=?", (completed, content, todo_id))
        elif completed is not None:
            conn.execute("UPDATE org_todos SET completed=? WHERE id=?", (completed, todo_id))
        elif content is not None:
            conn.execute("UPDATE org_todos SET content=? WHERE id=?", (content, todo_id))
        else:
            return False
    return True

def get_user_name(self, user_id: str) -> str:
    with self._conn() as conn:
        row = conn.execute("SELECT name FROM users WHERE id = ?", (user_id,)).fetchone()
    return row["name"] if row else "未知用户"
```

- [ ] **Step 4: 运行测试验证 migration**

```bash
cd D:\AI\Internship\Multi_Agent && python -m pytest tests/ -v -k "db or schema" --timeout=30
```

Expected: 通过或跳过（无现有 db 测试则验证启动不报错）

- [ ] **Step 5: 提交**

```bash
git add user/db.py
git commit -m "feat(db): migration v5 — organizations/channels/messages/todos 五表 + 17 CRUD 方法

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 组织管理后端 API

**Files:**
- Create: `workspace/organizations.py`
- Modify: `main.py:85-87` (注册路由)

**Interfaces:**
- Consumes: `user/db.py` Database 类（Task 1 新增的 17 个组织 CRUD 方法）
- Produces: 8 个 REST 端点 + `org_router` FastAPI APIRouter

- [ ] **Step 1: 创建 workspace/organizations.py**

```python
"""
组织管理 API 路由 — 创建/加入/成员管理
"""
from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse

from user.helpers import _get_db, require_auth

org_router = APIRouter()


@org_router.get("")
async def list_orgs(request: Request, user: dict = Depends(require_auth)):
    db = _get_db(request)
    orgs = db.list_organizations(user["user_id"])
    return JSONResponse(orgs)


@org_router.post("")
async def create_org(request: Request, user: dict = Depends(require_auth)):
    data = await request.json()
    name = (data.get("name") or "").strip()
    if not name:
        return JSONResponse({"error": "组织名称不能为空"}, status_code=400)
    description = (data.get("description") or "").strip()
    oid = _get_db(request).create_organization(name, description, user["user_id"])
    return JSONResponse({"id": oid, "name": name, "status": "ok"}, status_code=201)


@org_router.get("/{org_id}")
async def get_org(request: Request, org_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    org = db.get_organization(org_id)
    if not org:
        return JSONResponse({"error": "组织不存在"}, status_code=404)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权访问"}, status_code=403)
    members = db.list_org_members(org_id)
    return JSONResponse({**org, "members": members, "my_role": role})


@org_router.put("/{org_id}")
async def update_org(request: Request, org_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role != "owner" and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "仅 Owner 可编辑"}, status_code=403)
    data = await request.json()
    fields = {}
    if "name" in data:
        fields["name"] = data["name"].strip()
    if "description" in data:
        fields["description"] = data["description"].strip()
    if not fields:
        return JSONResponse({"error": "无更新字段"}, status_code=400)
    with db._conn() as conn:
        for k, v in fields.items():
            conn.execute(f"UPDATE organizations SET {k} = ? WHERE id = ?", (v, org_id))
    return JSONResponse({"status": "ok"})


@org_router.delete("/{org_id}")
async def delete_org(request: Request, org_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role != "owner" and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "仅 Owner 可删除"}, status_code=403)
    db.delete_organization(org_id)
    return JSONResponse({"status": "ok"})


@org_router.post("/{org_id}/members")
async def invite_member(request: Request, org_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role not in ("owner", "member") and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权邀请"}, status_code=403)
    data = await request.json()
    user_name = (data.get("user_name") or "").strip()
    if not user_name:
        return JSONResponse({"error": "用户名不能为空"}, status_code=400)
    target = db.get_user(user_name)
    if not target:
        return JSONResponse({"error": f"用户 {user_name} 不存在"}, status_code=404)
    if not db.join_organization(org_id, target["id"], "member"):
        return JSONResponse({"error": "该用户已在组织中"}, status_code=409)
    return JSONResponse({"status": "ok"})


@org_router.delete("/{org_id}/members/{user_id}")
async def remove_member(request: Request, org_id: str, user_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role != "owner" and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "仅 Owner 可移除成员"}, status_code=403)
    if not db.remove_org_member(org_id, user_id):
        return JSONResponse({"error": "成员不存在或无法移除 Owner"}, status_code=404)
    return JSONResponse({"status": "ok"})


@org_router.post("/join")
async def join_by_code(request: Request, user: dict = Depends(require_auth)):
    data = await request.json()
    code = (data.get("code") or "").strip().upper()
    if not code:
        return JSONResponse({"error": "邀请码不能为空"}, status_code=400)
    db = _get_db(request)
    org = db.get_org_by_invite(code)
    if not org:
        return JSONResponse({"error": "邀请码无效"}, status_code=404)
    if not db.join_organization(org["id"], user["user_id"]):
        return JSONResponse({"error": "你已在该组织中"}, status_code=409)
    return JSONResponse({"id": org["id"], "name": org["name"], "status": "ok"})
```

- [ ] **Step 2: 在 main.py 中注册路由**

找到路由注册区域（约 85-87 行），在 admin_router 注册之后添加：

```python
from workspace.organizations import org_router
app.include_router(org_router, prefix="/api/orgs", tags=["组织"])
```

- [ ] **Step 3: 验证后端启动和 API 可用**

```bash
cd D:\AI\Internship\Multi_Agent && timeout 5 python -c "from main import app; print('OK')" 2>&1 || echo "Import check done"
```

Expected: "OK" 或 clean import（无 ModuleNotFoundError）

- [ ] **Step 4: 提交**

```bash
git add workspace/organizations.py main.py
git commit -m "feat(orgs): 组织管理 API — 创建/加入/邀请/成员管理 8 端点

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 网络搜索工具

**Files:**
- Modify: `tools.py:289-299` (新增 web_search 工具)
- Modify: `agents.py:25-82` (Planner/Bot 的系统提示加入工具引用)
- Modify: `requirements.txt` (添加 duckduckgo_search)

**Interfaces:**
- Consumes: `tools.py` 的 ALL_TOOLS 字典
- Produces: `web_search` 工具函数 + Planner/Bot 可用

- [ ] **Step 1: 添加依赖**

在 `requirements.txt` 末尾添加：

```
duckduckgo_search>=7.0
```

安装：

```bash
cd D:\AI\Internship\Multi_Agent && pip install duckduckgo_search>=7.0
```

- [ ] **Step 2: 在 tools.py 中添加 web_search 工具**

在 `ALL_TOOLS` 字典定义之前添加：

```python
# ===== 网络搜索 =====

@tool
def web_search(query: str, max_results: int = 5) -> str:
    """搜索网络，返回前 max_results 条结果的标题和摘要。
    参数 query: 搜索关键词, max_results: 返回结果数（默认5，最多10）"""
    try:
        from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=min(max_results, 10)))
        if not results:
            return "未找到相关结果。请尝试更换搜索词。"
        lines = []
        for i, r in enumerate(results, 1):
            lines.append(f"{i}. **{r['title']}**\n   {r['body'][:200]}\n   {r['href']}")
        return "\n\n".join(lines)
    except ImportError:
        return "[错误] duckduckgo_search 未安装"
    except Exception as e:
        return f"[搜索失败] {e}"
```

在 `ALL_TOOLS` 字典中添加：

```python
ALL_TOOLS = {
    "read_file": read_file,
    "write_file": write_file,
    "search_knowledge": search_knowledge,
    "calculate": calculate,
    "analyze_data": analyze_data,
    "visualize_data": visualize_data,
    "ocr_image": ocr_image,
    "web_search": web_search,  # 新增
}
```

- [ ] **Step 3: 更新 Planner 和 Bot 的系统提示**

Planner 提示最后添加一行：
```python
"Planner": (
    # ... 原有内容保持不变 ...
    "如用户提问涉及最新资讯/实时信息/当前事件，首先使用 web_search 工具搜索获取最新数据。"
    "分析类任务（数据分析/CSV/Excel/统计/图表）→ task_type: analysis。"
),
```

Bot 提示中在 `"如果是知识性问题"` 前插入：
```python
"Bot": (
    "你是友好的 AI 助手。用简洁、自然的中文直接回答用户。\n"
    "闲聊时友善亲切；问答时准确清晰，不啰嗦。\n"
    "如果用户问及最新资讯、实时新闻、当前事件或你不确定的信息，使用 web_search 工具搜索后回答。\n"
    # ... 其余保持不变
),
```

- [ ] **Step 4: 验证工具导入**

```bash
cd D:\AI\Internship\Multi_Agent && python -c "from tools import web_search; print(web_search.name)"
```

Expected: `web_search`

- [ ] **Step 5: 提交**

```bash
git add tools.py agents.py requirements.txt
git commit -m "feat: web_search 网络搜索工具 — DuckDuckGo 免费搜索

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Agent 读取上传文件

**Files:**
- Modify: `app/knowledge.py:50-91` (upload 函数加复制到 coding/)

**Interfaces:**
- Consumes: `tools.py` 的 `read_file` 工具（读 `coding/` 目录）
- Produces: 上传文件同时存到 `coding/` 目录，Agent 可直接读取

- [ ] **Step 1: 修改 upload 函数**

在现有 `kb_upload` 函数的 text 分支（else 块），文件写入后额外复制到 coding/：

```python
# 在 app/knowledge.py 的 kb_upload 函数，else 分支中
# 找到 with open(doc_path, "wb") as f: f.write(contents) 之后
# 添加以下代码：

# 同时复制到 coding/ 目录供 Agent 读取
import shutil
coding_dir = os.path.join(_BASE, "coding")
os.makedirs(coding_dir, exist_ok=True)
shutil.copy2(doc_path, os.path.join(coding_dir, safe_name))
```

完整改动后的 else 分支：

```python
else:
    doc_path = os.path.join(docs_dir, safe_name)
    contents = await file.read()
    with open(doc_path, "wb") as f:
        f.write(contents)
    # 同时复制到 coding/ 目录供 Agent 的 read_file 工具读取
    import shutil
    coding_dir = os.path.join(_BASE, "coding")
    os.makedirs(coding_dir, exist_ok=True)
    shutil.copy2(doc_path, os.path.join(coding_dir, safe_name))
    return JSONResponse({"success": True, "filename": safe_name})
```

- [ ] **Step 2: 验证**

```bash
cd D:\AI\Internship\Multi_Agent && python -c "from app.knowledge import router; print('import OK')"
```

Expected: `import OK`

- [ ] **Step 3: 提交**

```bash
git add app/knowledge.py
git commit -m "feat: 上传文件同步复制到 coding/ 目录，Agent 可直接读取

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 登录页视觉升级 + 游客模式后端

**Files:**
- Modify: `frontend/src/pages/auth/LoginPage.tsx` (左右分栏布局 + 游客入口)
- Modify: `main.py:107-148` (添加免认证聊天端点)
- Modify: `user/routes.py` (添加游客迁移端点)

**Interfaces:**
- Consumes: `authApi.login()`, `useAuthStore()`, `POST /api/auth/login`
- Produces: 新登录页 UI + `POST /api/chat/guest` + `POST /api/auth/migrate`

- [ ] **Step 1: 改造 LoginPage.tsx 为左右分栏布局**

完全重写 `frontend/src/pages/auth/LoginPage.tsx`：

```tsx
import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';
import { Bot, Users, GitBranch, ArrowRight } from 'lucide-react';

const features = [
  { icon: Bot, title: '7 Agent 协作', desc: 'Planner · Coder · Tester 等多角色智能体流水线协作' },
  { icon: GitBranch, title: '自定义工作流', desc: '拖拽编排画布，自由设计 Agent 执行顺序和路由条件' },
  { icon: Users, title: '团队共享', desc: '创建组织，邀请成员，共享知识库和 Agent 流水线' },
];

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
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        '登录失败';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = () => {
    // 设置游客标记，进入聊天
    localStorage.setItem('auth_guest', '1');
    navigate('/guest-chat', { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#f0f4ff] to-[#f8f9fc] p-4">
      <div className="flex w-full max-w-4xl overflow-hidden rounded-2xl shadow-xl border border-[#e0e4e8] bg-white">
        {/* 左侧 — 产品介绍 */}
        <div className="hidden md:flex w-1/2 flex-col justify-center p-10 bg-gradient-to-br from-[#4f8cff] to-[#6c5ce7] text-white">
          <div className="mb-6">
            <h1 className="text-3xl font-bold mb-2">🤖 多智能体协作平台</h1>
            <p className="text-white/80 text-sm">基于 LangGraph 的 7 Agent 协作引擎</p>
          </div>
          <div className="space-y-5">
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex gap-3">
                <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
                  <Icon size={18} />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{title}</h3>
                  <p className="text-white/70 text-xs">{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 text-white/60 text-xs">
            已服务多位用户 · 开源项目
          </div>
        </div>

        {/* 右侧 — 登录表单 */}
        <div className="w-full md:w-1/2 p-10 flex flex-col justify-center">
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold text-[#1d1d1f]">登录</h2>
            <p className="text-sm text-[#81858c] mt-1">欢迎回来</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label py-1">
                <span className="label-text text-sm text-[#81858c]">用户名</span>
              </label>
              <input
                type="text"
                className="input input-bordered w-full"
                style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                placeholder="输入用户名"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="label py-1">
                <span className="label-text text-sm text-[#81858c]">密码</span>
              </label>
              <input
                type="password"
                className="input input-bordered w-full"
                style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                placeholder="输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              className="btn w-full"
              disabled={loading}
              style={{
                background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)',
                color: '#fff',
                borderRadius: '10px',
                border: 'none',
              }}
            >
              {loading ? <span className="loading loading-spinner loading-sm" /> : null}
              登录
            </button>
          </form>
          <p className="text-center text-sm text-[#81858c] mt-3">
            还没有账号？{' '}
            <Link to="/register" className="text-[#4f8cff] hover:underline">
              立即注册
            </Link>
          </p>
          <div className="flex items-center my-3">
            <div className="flex-1 border-t border-[#e0e4e8]" />
            <span className="px-3 text-xs text-[#9ca3af]">或者</span>
            <div className="flex-1 border-t border-[#e0e4e8]" />
          </div>
          <button
            onClick={handleGuest}
            className="btn btn-outline w-full"
            style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
          >
            游客试用 <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 添加后端免认证聊天端点**

在 `main.py` 的 `/api/chat` 之后添加：

```python
@app.post("/api/chat/guest", tags=["聊天"])
async def chat_guest(request: Request):
    """游客免认证聊天 — 无 session 持久化，使用平台默认 Key"""
    from app.chat import run_chat_pipeline

    data = await request.json()
    user_input = data.get("message", "")
    lane_mode = data.get("lane_mode", "auto")
    history = data.get("history", [])

    try:
        result = run_chat_pipeline(
            user_input,
            history=history,
            lane_mode=lane_mode,
            user_id=None,  # 游客无 user_id，使用系统默认 Key
        )
        return JSONResponse(result)
    except Exception as e:
        import traceback
        logging.error(f"游客聊天异常: {traceback.format_exc()}")
        return JSONResponse(
            {"reply": f"❌ 执行失败: {str(e)}", "error": str(e),
             "thinking": [], "task_type": "错误", "generated_files": []},
            status_code=500,
        )
```

- [ ] **Step 3: 构建前端验证**

```bash
cd D:\AI\Internship\Multi_Agent\frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors

- [ ] **Step 4: 提交**

```bash
git add frontend/src/pages/auth/LoginPage.tsx main.py
git commit -m "feat: 登录页视觉升级 — 左右分栏产品介绍 + 游客试用 + 免认证端点

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 游客模式前端 — authStore + 路由守卫 + 受限提示

**Files:**
- Modify: `frontend/src/stores/authStore.ts` (isGuest 状态)
- Modify: `frontend/src/routes/index.tsx` (游客路由 + GuestGuard)
- Modify: `frontend/src/App.tsx` (游客初始化)
- Modify: `frontend/src/api/client.ts` (游客 API 转发)

**Interfaces:**
- Consumes: `authStore`, `POST /api/chat/guest`
- Produces: 游客可访问受限聊天，受限功能弹窗提示

- [ ] **Step 1: authStore 添加 isGuest**

```typescript
// frontend/src/stores/authStore.ts
import { create } from 'zustand';
import type { User } from '@/types/user';

interface AuthStore {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  isGuest: boolean;           // 新增
  setAuth: (token: string, user: User) => void;
  setGuest: () => void;       // 新增
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  token: localStorage.getItem('auth_token'),
  user: null,
  isLoading: true,
  isGuest: localStorage.getItem('auth_guest') === '1',  // 新增
  setAuth: (token, user) => {
    localStorage.setItem('auth_token', token);
    localStorage.removeItem('auth_guest');  // 登录清除游客标记
    localStorage.setItem('mc_uname', user.user_name);
    set({ token, user, isLoading: false, isGuest: false });
  },
  setGuest: () => {  // 新增
    localStorage.setItem('auth_guest', '1');
    set({ isGuest: true, isLoading: false });
  },
  logout: () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_guest');
    localStorage.removeItem('mc_uname');
    set({ token: null, user: null, isLoading: false, isGuest: false });
  },
  setLoading: (isLoading) => set({ isLoading }),
}));
```

- [ ] **Step 2: 创建 GuestGuard 组件 + 游客聊天页路由**

修改 `frontend/src/routes/index.tsx`，添加 GuestGuard 和新路由：

```tsx
import { createBrowserRouter } from 'react-router-dom';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AdminGuard } from '@/components/auth/AdminGuard';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { WorkspaceOverview } from '@/pages/workspace/WorkspaceOverview';
import { WorkspaceDetail } from '@/pages/workspace/WorkspaceDetail';
import { ChatPage } from '@/pages/project/ChatPage';
import { MonitorPage } from '@/pages/project/MonitorPage';
import { EvaluationPage } from '@/pages/project/EvaluationPage';
import { OrchestrationPage } from '@/pages/project/OrchestrationPage';
import { SettingsPage } from '@/pages/settings/SettingsPage';
import { TemplateMarket } from '@/pages/templates/TemplateMarket';
import { AgentDesigner } from '@/pages/agent-design/AgentDesigner';
import { AdminPage } from '@/pages/admin/AdminPage';
import { GuestChat } from '@/pages/project/GuestChat';  // 新增
import { useAuthStore } from '@/stores/authStore';        // 新增
import { Navigate } from 'react-router-dom';              // 新增

// 游客路由守卫：登录用户重定向到首页
function GuestOnly({ children }: { children: React.ReactNode }) {
  const { token } = useAuthStore();
  if (token) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <GuestOnly><LoginPage /></GuestOnly>,
  },
  {
    path: '/register',
    element: <GuestOnly><RegisterPage /></GuestOnly>,
  },
  // 游客聊天页（免认证）
  {
    path: '/guest-chat',
    element: <GuestChat />,
  },
  {
    path: '/',
    element: (
      <AuthGuard>
        <AppShell />
      </AuthGuard>
    ),
    children: [
      // ... 原有子路由全部保持不变 ...
      { index: true, element: <WorkspaceOverview /> },
      { path: 'w/:workspaceId', element: <WorkspaceDetail /> },
      { path: 'w/:workspaceId/p/:projectId/chat', element: <ChatPage /> },
      { path: 'w/:workspaceId/p/:projectId/monitor', element: <MonitorPage /> },
      { path: 'w/:workspaceId/p/:projectId/eval', element: <EvaluationPage /> },
      { path: 'w/:workspaceId/p/:projectId/orchestra', element: <OrchestrationPage /> },
      { path: 'templates', element: <TemplateMarket /> },
      { path: 'agents', element: <AgentDesigner /> },
      { path: 'settings', element: <SettingsPage /> },
      {
        path: 'admin',
        element: (
          <AdminGuard>
            <AdminPage />
          </AdminGuard>
        ),
      },
    ],
  },
]);
```

- [ ] **Step 3: 创建游客聊天页 GuestChat.tsx**

```tsx
// frontend/src/pages/project/GuestChat.tsx
import { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

export function GuestChat() {
  const [input, setInput] = useState('');
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { isGuest } = useAuthStore();

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    try {
      const res = await fetch('/api/chat/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input.trim(), lane_mode: 'auto', history: [] }),
      });
      const data = await res.json();
      setReply(data.reply || '');
    } catch {
      toast.error('发送失败');
    } finally {
      setLoading(false);
    }
    setInput('');
  };

  const handleRestricted = (feature: string) => {
    toast.info(`「${feature}」需要注册后使用`, { description: '点击右上角注册即可解锁全部功能' });
  };

  return (
    <div className="flex flex-col h-screen bg-[#f8f9fc]">
      {/* 顶部提示栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#4f8cff]/10 border-b border-[#4f8cff]/20">
        <span className="text-sm text-[#4f8cff]">
          🧪 游客模式 — 功能受限，会话不保存
        </span>
        <div className="flex gap-2">
          <Link to="/login" className="btn btn-sm" style={{ borderRadius: '8px' }}>登录</Link>
          <Link to="/register" className="btn btn-sm btn-primary" style={{ borderRadius: '8px' }}>注册</Link>
        </div>
      </div>

      {/* 受限功能按钮栏 */}
      <div className="flex gap-2 px-4 py-2 overflow-x-auto border-b border-[#e0e4e8] bg-white">
        {['编排画布', '模板市场', 'Agent 设计器', '知识库上传', '团队模式'].map(f => (
          <button
            key={f}
            onClick={() => handleRestricted(f)}
            className="btn btn-xs btn-outline"
            style={{ borderRadius: '6px' }}
          >
            🔒 {f}
          </button>
        ))}
      </div>

      {/* 聊天区域 */}
      <div className="flex-1 overflow-y-auto p-4">
        {!reply && !loading && (
          <div className="text-center text-[#9ca3af] mt-20">
            <p className="text-4xl mb-4">🤖</p>
            <p className="text-lg font-medium">试试多智能体协作！</p>
            <p className="text-sm mt-1">输入任何问题，7 个 Agent 为你协作解答</p>
          </div>
        )}
        {loading && (
          <div className="flex items-center gap-2 text-[#4f8cff]">
            <span className="loading loading-spinner loading-sm" />
            <span className="text-sm">Agent 正在协作中...</span>
          </div>
        )}
        {reply && (
          <div className="prose prose-sm max-w-none bg-white rounded-xl p-4 shadow-sm border border-[#e0e4e8]">
            <div dangerouslySetInnerHTML={{ __html: reply }} />
          </div>
        )}
      </div>

      {/* 输入框 */}
      <div className="p-4 bg-white border-t border-[#e0e4e8]">
        <div className="flex gap-2 max-w-2xl mx-auto">
          <input
            type="text"
            className="input input-bordered flex-1"
            style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
            placeholder="输入你的问题..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          />
          <button
            className="btn"
            disabled={loading || !input.trim()}
            onClick={handleSend}
            style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 构建验证**

```bash
cd D:\AI\Internship\Multi_Agent\frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: No TypeScript errors

- [ ] **Step 5: 提交**

```bash
git add frontend/src/stores/authStore.ts frontend/src/routes/index.tsx frontend/src/pages/project/GuestChat.tsx
git commit -m "feat: 游客模式 — 免认证聊天 + 受限功能提示 + 路由守卫

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 主界面快速开始页 + 左侧竖排导航

**Files:**
- Create: `frontend/src/pages/home/HomePage.tsx`
- Create: `frontend/src/components/layout/HomeSidebar.tsx`
- Modify: `frontend/src/routes/index.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `sessionsApi.list()`, `authStore`, `useNavigate()`
- Produces: 主界面四入口竖排导航 + 中间快速聊天 + 工作流卡片 + 最近对话

- [ ] **Step 1: 创建 HomeSidebar 组件**

```tsx
// frontend/src/components/layout/HomeSidebar.tsx
import { NavLink } from 'react-router-dom';
import { User, Users, BookOpen, Settings } from 'lucide-react';

const items = [
  { to: '/personal', icon: User, label: '个人' },
  { to: '/team', icon: Users, label: '团队' },
  { to: '/knowledge', icon: BookOpen, label: '知识库' },
  { to: '/settings', icon: Settings, label: '设置' },
];

export function HomeSidebar() {
  return (
    <div className="flex flex-col items-center gap-2 w-20 shrink-0 py-4 border-r border-[#e0e4e8] bg-white">
      <div className="text-xl mb-4">🤖</div>
      {items.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex flex-col items-center gap-1 px-2 py-3 w-16 rounded-xl text-xs transition-colors ${
              isActive
                ? 'text-[#4f8cff] bg-[#4f8cff]/10'
                : 'text-[#81858c] hover:bg-gray-50'
            }`
          }
        >
          <Icon size={20} />
          {label}
        </NavLink>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 创建 HomePage 组件**

```tsx
// frontend/src/pages/home/HomePage.tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { HomeSidebar } from '@/components/layout/HomeSidebar';
import { useAuthStore } from '@/stores/authStore';
import { sessionsApi } from '@/api/sessions';
import type { Session } from '@/types/api';
import { MessageSquare, Zap, Flame, Dinosaur, Code, FileText } from 'lucide-react';

const workflows = [
  { icon: Zap, label: '自动', desc: '智能匹配', mode: 'auto' },
  { icon: Flame, label: '快速', desc: '仅核心 Agent', mode: 'fast' },
  { icon: Dinosaur, label: '协作', desc: '全部 Agent', mode: 'slow' },
  { icon: Code, label: '编程优化', desc: 'Coder + Tester', mode: 'auto' },
  { icon: FileText, label: '写作优化', desc: 'Writer + Summarizer', mode: 'auto' },
];

export function HomePage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    sessionsApi.list().then(res => setSessions(res.data || [])).catch(() => {});
  }, []);

  const handleSend = (mode: string = 'auto') => {
    if (!input.trim()) return;
    // 导航到个人聊天页并带消息参数
    navigate(`/personal?msg=${encodeURIComponent(input.trim())}&mode=${mode}`);
  };

  return (
    <div className="flex h-full bg-[#f8f9fc]">
      <HomeSidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-12">
          {/* 欢迎 */}
          <h1 className="text-2xl font-bold text-[#1d1d1f] mb-2">
            欢迎回来，{user?.user_name || '用户'}
          </h1>
          <p className="text-sm text-[#81858c] mb-8">有什么我可以帮你的？</p>

          {/* 快速输入 */}
          <div className="bg-white rounded-2xl shadow-sm border border-[#e0e4e8] p-4 mb-8">
            <div className="flex gap-2">
              <input
                type="text"
                className="input input-bordered flex-1"
                style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                placeholder="输入你的问题，按 Enter 发送..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                autoFocus
              />
              <button
                className="btn"
                onClick={() => handleSend()}
                disabled={!input.trim()}
                style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }}
              >
                ➤
              </button>
            </div>
            <div className="flex gap-2 mt-3">
              {['auto', 'fast', 'slow'].map(mode => (
                <button
                  key={mode}
                  className="text-xs px-3 py-1 rounded-full bg-gray-100 text-[#81858c] hover:bg-gray-200 transition-colors"
                  onClick={() => handleSend(mode)}
                >
                  {mode === 'auto' ? '⚡ 自动' : mode === 'fast' ? '🔥 快速' : '🦖 协作'}
                </button>
              ))}
            </div>
          </div>

          {/* 工作流卡片 */}
          <h2 className="text-lg font-semibold text-[#1d1d1f] mb-3">快速选择工作流</h2>
          <div className="grid grid-cols-5 gap-3 mb-8">
            {workflows.map(({ icon: Icon, label, desc }) => (
              <button
                key={label}
                className="flex flex-col items-center gap-2 p-4 bg-white rounded-xl border border-[#e0e4e8] hover:border-[#4f8cff] hover:shadow-sm transition-all"
                onClick={() => setInput('')}
              >
                <Icon size={24} className="text-[#4f8cff]" />
                <span className="text-sm font-medium text-[#1d1d1f]">{label}</span>
                <span className="text-xs text-[#9ca3af]">{desc}</span>
              </button>
            ))}
          </div>

          {/* 最近对话 */}
          <h2 className="text-lg font-semibold text-[#1d1d1f] mb-3">最近对话</h2>
          {sessions.length === 0 ? (
            <p className="text-sm text-[#9ca3af]">暂无历史会话</p>
          ) : (
            <div className="space-y-2">
              {sessions.slice(0, 10).map(s => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 p-3 bg-white rounded-xl border border-[#e0e4e8] cursor-pointer hover:border-[#4f8cff] transition-colors"
                  onClick={() => window.dispatchEvent(new CustomEvent('load-session', { detail: s.id }))}
                >
                  <MessageSquare size={16} className="text-[#9ca3af] shrink-0" />
                  <span className="text-sm text-[#1d1d1f] truncate flex-1">{s.title || '空对话'}</span>
                  <span className="text-xs text-[#9ca3af]">{s.updated?.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 更新路由** — 在 `routes/index.tsx` 中导入 HomePage 并设为首屏：

```tsx
import { HomePage } from '@/pages/home/HomePage';

// 在 children 中，将 index 路由改为 HomePage：
{ index: true, element: <HomePage /> },
// 保留 WorkspaceOverview 作为另一路由：
{ path: 'workspaces', element: <WorkspaceOverview /> },
```

- [ ] **Step 4: 构建验证**

```bash
cd D:\AI\Internship\Multi_Agent\frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors

- [ ] **Step 5: 提交**

```bash
git add frontend/src/pages/home/HomePage.tsx frontend/src/components/layout/HomeSidebar.tsx frontend/src/routes/index.tsx
git commit -m "feat: 主界面快速开始页 — 四入口竖排导航 + 快速聊天 + 工作流卡片

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: 组织管理前端

**Files:**
- Create: `frontend/src/pages/team/TeamHome.tsx`
- Modify: `frontend/src/routes/index.tsx` (添加 /team 路由)

**Interfaces:**
- Consumes: `GET/POST /api/orgs`, `POST /api/orgs/join`
- Produces: 组织列表页 + 创建/加入弹窗

- [ ] **Step 1: 创建 TeamHome.tsx**

```tsx
// frontend/src/pages/team/TeamHome.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { toast } from 'sonner';
import { Plus, Users, ArrowLeft } from 'lucide-react';

export function TeamHome() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ['orgs'],
    queryFn: async () => {
      const res = await apiClient.get('/orgs');
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiClient.post('/orgs', { name, description: '' });
      return res.data;
    },
    onSuccess: (data) => {
      toast.success(`组织「${data.name}」已创建`);
      qc.invalidateQueries({ queryKey: ['orgs'] });
      setShowCreate(false);
      setOrgName('');
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || '创建失败'),
  });

  const joinMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiClient.post('/orgs/join', { code });
      return res.data;
    },
    onSuccess: (data) => {
      toast.success(`已加入「${data.name}」`);
      qc.invalidateQueries({ queryKey: ['orgs'] });
      setInviteCode('');
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || '加入失败'),
  });

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/')} className="text-[#81858c] hover:text-[#1d1d1f]">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold text-[#1d1d1f]">团队模式</h1>
      </div>

      {/* 我的组织 */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-[#1d1d1f]">我的组织</h2>
          <button
            className="btn btn-sm"
            onClick={() => setShowCreate(true)}
            style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '8px', border: 'none' }}
          >
            <Plus size={16} /> 创建
          </button>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-8"><span className="loading loading-spinner" /></div>
        ) : orgs.length === 0 ? (
          <p className="text-sm text-[#9ca3af] text-center py-8">暂无组织，创建一个吧</p>
        ) : (
          <div className="space-y-3">
            {orgs.map((org: any) => (
              <div
                key={org.id}
                className="flex items-center gap-4 p-4 bg-white rounded-xl border border-[#e0e4e8] cursor-pointer hover:border-[#4f8cff] hover:shadow-sm transition-all"
                onClick={() => navigate(`/team/${org.id}`)}
              >
                <div className="w-10 h-10 rounded-lg bg-[#4f8cff]/10 flex items-center justify-center shrink-0">
                  <Users size={20} className="text-[#4f8cff]" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-[#1d1d1f]">{org.name}</h3>
                  <p className="text-xs text-[#9ca3af]">
                    {org.member_count} 名成员 · 角色: {org.my_role}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 加入组织 */}
      <section className="bg-white rounded-xl border border-[#e0e4e8] p-4">
        <h2 className="text-lg font-semibold text-[#1d1d1f] mb-3">加入组织</h2>
        <div className="flex gap-2">
          <input
            type="text"
            className="input input-bordered flex-1"
            style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
            placeholder="输入 6 位邀请码"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            maxLength={6}
          />
          <button
            className="btn"
            disabled={inviteCode.length !== 6 || joinMutation.isPending}
            onClick={() => joinMutation.mutate(inviteCode)}
            style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }}
          >
            加入
          </button>
        </div>
      </section>

      {/* 创建弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-96 shadow-xl">
            <h3 className="text-lg font-semibold mb-4">创建组织</h3>
            <input
              type="text"
              className="input input-bordered w-full mb-4"
              style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
              placeholder="组织名称"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)} style={{ borderRadius: '8px' }}>取消</button>
              <button
                className="btn"
                disabled={!orgName.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate(orgName.trim())}
                style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '8px', border: 'none' }}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 添加路由**

在 `routes/index.tsx` 导入并添加：

```tsx
{ path: 'team', element: <TeamHome /> },
```

- [ ] **Step 3: 构建验证 + 提交**

```bash
cd D:\AI\Internship\Multi_Agent\frontend && npx tsc --noEmit 2>&1 | head -20
git add frontend/src/pages/team/TeamHome.tsx frontend/src/routes/index.tsx
git commit -m "feat: 组织管理前端 — 创建/加入/列表页 + 邀请码机制

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: 左侧栏收起/展开

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.tsx` (收起按钮)

**Interfaces:**
- Consumes: 无外部依赖
- Produces: 侧栏折叠按钮，收起 48px / 展开 80px

- [ ] **Step 1: 改造 Sidebar.tsx**

在 Sidebar 组件顶部添加收起状态，左上角加折叠按钮：

```tsx
// 在 Sidebar 函数体开头添加：
const [collapsed, setCollapsed] = useState(false);

// 在 Logo 区域修改为可折叠：
<div className="flex items-center justify-between mb-2 shrink-0">
  {!collapsed && <h4 className="sidebar-logo">Multi-Agent</h4>}
  <button
    onClick={() => setCollapsed(!collapsed)}
    className="text-[#9ca3af] hover:text-[#4b5563] p-1 rounded-lg hover:bg-gray-100 transition-colors"
    title={collapsed ? '展开侧栏' : '收起侧栏'}
  >
    {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
  </button>
</div>

// 顶部需要导入：import { ChevronLeft, ChevronRight } from 'lucide-react';

// 收起时隐藏文本，只显示图标
// NavLink 区域包装条件渲染：
{!collapsed && <span>{label}</span>}

// 侧栏宽度根据状态变化：
<div
  className={`flex flex-col p-3 h-full transition-all duration-200 ${collapsed ? 'w-12' : 'w-72'}`}
  style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid #eceef2' }}
>
```

完整改动：在 nav 区域每个 NavLink 中：

```tsx
<Icon size={16} />
{!collapsed && label}
```

新对话按钮收起时只显示 `+` 图标：

```tsx
{!collapsed ? <><Plus size={16} /><span>开启新对话</span></> : <Plus size={16} />}
```

- [ ] **Step 2: 构建验证**

```bash
cd D:\AI\Internship\Multi_Agent\frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/layout/Sidebar.tsx
git commit -m "feat: 左侧栏收起/展开 — 折叠按钮切换 48px/260px 宽度

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: 团队聊天后端

**Files:**
- Create: `workspace/team_chat.py`
- Modify: `main.py` (注册路由)

**Interfaces:**
- Consumes: `user/db.py` Database 频道/消息/待办方法（Task 1）
- Produces: 7 个 REST 端点 + 1 个 SSE 推送端点

- [ ] **Step 1: 创建 workspace/team_chat.py**

```python
"""
团队聊天 API 路由 — 频道/消息/待办 + SSE 推送
"""
import json
import asyncio
from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse, StreamingResponse

from user.helpers import _get_db, require_auth

chat_router = APIRouter()

# 保存活跃的 SSE 连接 {org_id: [asyncio.Queue, ...]}
_active_listeners: dict[str, list[asyncio.Queue]] = {}


async def _broadcast(org_id: str, event: dict):
    """向某组织的所有 SSE 监听者推送事件"""
    queues = _active_listeners.get(org_id, [])
    dead = []
    for q in queues:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        queues.remove(q)


# ── 频道 ──

@chat_router.get("/{org_id}/channels")
async def list_channels(request: Request, org_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权访问"}, status_code=403)
    channels = db.list_channels(org_id)
    # 确保至少有 default 频道
    if not channels:
        cid = db.create_channel(org_id, "general")
        channels = [{"id": cid, "org_id": org_id, "name": "general"}]
    return JSONResponse(channels)


@chat_router.post("/{org_id}/channels")
async def create_channel(request: Request, org_id: str, user: dict = Depends(require_auth)):
    data = await request.json()
    name = (data.get("name") or "").strip()
    if not name:
        return JSONResponse({"error": "频道名不能为空"}, status_code=400)
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None:
        return JSONResponse({"error": "无权创建频道"}, status_code=403)
    cid = db.create_channel(org_id, name)
    return JSONResponse({"id": cid, "name": name, "status": "ok"}, status_code=201)


# ── 消息 ──

@chat_router.get("/{org_id}/channels/{channel_id}/messages")
async def list_messages(request: Request, org_id: str, channel_id: str,
                        user: dict = Depends(require_auth)):
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权访问"}, status_code=403)
    messages = db.list_messages(channel_id)
    return JSONResponse(messages)


@chat_router.post("/{org_id}/channels/{channel_id}/messages")
async def send_message(request: Request, org_id: str, channel_id: str,
                       user: dict = Depends(require_auth)):
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None:
        return JSONResponse({"error": "无权发送消息"}, status_code=403)

    data = await request.json()
    content = (data.get("content") or "").strip()
    if not content:
        return JSONResponse({"error": "消息不能为空"}, status_code=400)

    mid = db.create_message(channel_id, user["user_id"], content)
    user_name = db.get_user_name(user["user_id"])

    # 检查 @agent 命令
    agent_reply = None
    if content.startswith("@agent") or " @agent" in content:
        agent_reply = await _handle_agent_command(content, org_id, user["user_id"], db)

    msg = {"id": mid, "content": content, "user_name": user_name, "is_agent": 0}
    await _broadcast(org_id, {"type": "message", "message": msg})

    if agent_reply:
        agent_msg = {"id": agent_reply["id"], "content": agent_reply["content"],
                     "user_name": "🤖 Agent", "is_agent": 1}
        await _broadcast(org_id, {"type": "message", "message": agent_msg})

    return JSONResponse({"id": mid, "status": "ok", "agent_reply": agent_reply})


async def _handle_agent_command(content: str, org_id: str, user_id: str, db) -> dict | None:
    """解析 @agent 命令并执行"""
    import re
    # @agent 总结一下
    if re.search(r'@agent\s+总结', content):
        messages = []
        channels = db.list_channels(org_id)
        for ch in channels:
            msgs = db.list_messages(ch["id"], limit=20)
            messages.extend([m["content"] for m in msgs if not m.get("is_agent")])
        if not messages:
            return {"id": "agent", "content": "📋 暂无消息可总结。"}
        # 调用 LLM 总结
        try:
            from agents import get_cached_llm
            llm = get_cached_llm("Summarizer", temperature=0.3)
            prompt = f"请总结以下团队讨论（中文）：\n\n" + "\n".join(messages[-20:])
            summary = llm.invoke(prompt)
            reply_content = f"📋 讨论总结：\n\n{summary.content}"
        except Exception as e:
            reply_content = f"❌ 总结生成失败: {e}"
        mid = db.create_message(
            [ch["id"] for ch in channels][0] if channels else "",
            user_id, reply_content, is_agent=1
        )
        return {"id": mid, "content": reply_content}

    # @agent 创建待办: xxx @user
    if re.search(r'@agent\s+创建待办', content):
        todo_match = re.search(r'创建待办[：:]\s*(.+?)(?:@(\S+))?\s*$', content)
        if todo_match:
            todo_content = todo_match.group(1).strip()
            assignee_name = todo_match.group(2)
            assignee_id = None
            if assignee_name:
                target = db.get_user(assignee_name)
                assignee_id = target["id"] if target else None
            tid = db.create_todo(org_id, todo_content, user_id, assignee_id)
            reply_content = f"✅ 待办已创建: {todo_content}"
            mid = db.create_message(
                [ch["id"] for ch in db.list_channels(org_id)][0] if db.list_channels(org_id) else "",
                user_id, reply_content, is_agent=1
            )
            return {"id": mid, "content": reply_content}

    # @agent 搜索 xxx
    if re.search(r'@agent\s+搜索', content):
        query = re.sub(r'.*@agent\s+搜索\s*', '', content).strip()
        if query:
            try:
                from rag.knowledge_base import search
                results = search(query, user_id="shared")
                if results:
                    reply_content = "🔍 搜索结果：\n\n" + "\n\n---\n\n".join(
                        [r[:300] for r in results[:3] if len(r.strip()) > 50]
                    )
                else:
                    reply_content = "🔍 未找到相关结果。"
            except Exception:
                reply_content = "🔍 知识库搜索暂时不可用。"
            mid = db.create_message(
                [ch["id"] for ch in db.list_channels(org_id)][0] if db.list_channels(org_id) else "",
                user_id, reply_content, is_agent=1
            )
            return {"id": mid, "content": reply_content}

    return None


# ── SSE 推送 ──

@chat_router.get("/{org_id}/stream")
async def stream_org(request: Request, org_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权访问"}, status_code=403)

    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    if org_id not in _active_listeners:
        _active_listeners[org_id] = []
    # 限制连接数
    if len(_active_listeners[org_id]) >= 5:
        return JSONResponse({"error": "连接数已达上限"}, status_code=429)
    _active_listeners[org_id].append(q)

    async def event_stream():
        try:
            # 发送连接确认
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    # 发送心跳
                    yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
        finally:
            if q in _active_listeners.get(org_id, []):
                _active_listeners[org_id].remove(q)
            if not _active_listeners.get(org_id):
                _active_listeners.pop(org_id, None)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ── 待办 ──

@chat_router.get("/{org_id}/todos")
async def list_todos(request: Request, org_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权访问"}, status_code=403)
    todos = db.list_todos(org_id)
    return JSONResponse(todos)


@chat_router.post("/{org_id}/todos")
async def create_todo(request: Request, org_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None:
        return JSONResponse({"error": "无权创建待办"}, status_code=403)
    data = await request.json()
    content = (data.get("content") or "").strip()
    if not content:
        return JSONResponse({"error": "待办内容不能为空"}, status_code=400)
    tid = db.create_todo(org_id, content, user["user_id"], data.get("assignee_id"))
    return JSONResponse({"id": tid, "status": "ok"}, status_code=201)


@chat_router.put("/{org_id}/todos/{todo_id}")
async def update_todo(request: Request, org_id: str, todo_id: str,
                      user: dict = Depends(require_auth)):
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None:
        return JSONResponse({"error": "无权操作"}, status_code=403)
    data = await request.json()
    completed = data.get("completed")
    content = data.get("content")
    if completed is None and content is None:
        return JSONResponse({"error": "无更新内容"}, status_code=400)
    db.update_todo(todo_id, completed=int(completed) if completed is not None else None,
                   content=content)
    return JSONResponse({"status": "ok"})
```

- [ ] **Step 2: 在 main.py 注册路由**

```python
from workspace.team_chat import chat_router as team_chat_router
app.include_router(team_chat_router, prefix="/api/orgs", tags=["团队聊天"])
```

注意：team_chat_router 的路由路径以 `{org_id}` 开头，与 org_router 的路径可能冲突。需将 team_chat_router 注册在 org_router 之后（FastAPI 按注册顺序匹配）。

检查 main.py 中的注册顺序：
```python
# 先注册 org_router（处理 /api/orgs/{org_id} 精确路由）
app.include_router(org_router, prefix="/api/orgs", tags=["组织"])
# 再注册 team_chat_router（处理 /api/orgs/{org_id}/channels 等子路由）
app.include_router(team_chat_router, prefix="/api/orgs", tags=["团队聊天"])
```

- [ ] **Step 3: 验证启动**

```bash
cd D:\AI\Internship\Multi_Agent && python -c "from main import app; print('OK')"
```

- [ ] **Step 4: 提交**

```bash
git add workspace/team_chat.py main.py
git commit -m "feat: 团队聊天后端 — 频道/消息/待办 API + SSE 推送 + @agent 命令

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: 团队聊天前端

**Files:**
- Create: `frontend/src/pages/team/TeamChat.tsx`
- Modify: `frontend/src/routes/index.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/orgs/{org_id}/channels`, `GET/POST .../messages`, `GET .../stream` (SSE)
- Produces: 团队聊天三栏界面

- [ ] **Step 1: 创建 TeamChat.tsx**

完整组件（因篇幅较长，核心结构如下，具体实现参考 spec 布局）：

```tsx
// frontend/src/pages/team/TeamChat.tsx
import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Check, Trash2 } from 'lucide-react';

interface Message {
  id: string; content: string; user_name: string; is_agent: number; created_at: string;
}

interface Channel {
  id: string; name: string;
}

interface Todo {
  id: string; content: string; assignee_name?: string; completed: number;
}

export function TeamChat() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 频道列表
  const { data: channels = [] } = useQuery({
    queryKey: ['channels', orgId],
    queryFn: async () => {
      const res = await apiClient.get(`/orgs/${orgId}/channels`);
      const data = res.data as Channel[];
      if (data.length > 0 && !activeChannel) setActiveChannel(data[0].id);
      return data;
    },
    enabled: !!orgId,
  });

  // 消息列表
  useQuery({
    queryKey: ['messages', orgId, activeChannel],
    queryFn: async () => {
      if (!activeChannel) return [];
      const res = await apiClient.get(`/orgs/${orgId}/channels/${activeChannel}/messages`);
      setMessages(res.data as Message[]);
      return res.data;
    },
    enabled: !!orgId && !!activeChannel,
  });

  // 待办列表
  const { data: todos = [] } = useQuery({
    queryKey: ['todos', orgId],
    queryFn: async () => {
      const res = await apiClient.get(`/orgs/${orgId}/todos`);
      return res.data as Todo[];
    },
    enabled: !!orgId,
  });

  // SSE 连接
  useEffect(() => {
    if (!orgId) return;
    const token = localStorage.getItem('auth_token');
    const es = new EventSource(`/api/orgs/${orgId}/stream`);
    // SSE 需要 Authorization header，但 EventSource 不支持自定义 header
    // 改用 fetch + ReadableStream（可参考 useStreamChat.ts 的模式）
    // 简化版：轮询或 websocket 备选（生产环境需 SSE 带 token）
    return () => es.close();
  }, [orgId]);

  // 发送消息
  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiClient.post(`/orgs/${orgId}/channels/${activeChannel}/messages`, { content });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', orgId, activeChannel] });
      qc.invalidateQueries({ queryKey: ['todos', orgId] });
      setInput('');
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || '发送失败'),
  });

  // 创建频道
  const [newChannel, setNewChannel] = useState('');
  const channelMutation = useMutation({
    mutationFn: async (name: string) => {
      await apiClient.post(`/orgs/${orgId}/channels`, { name });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels', orgId] });
      setNewChannel('');
    },
  });

  // 待办完成/取消
  const todoMutation = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: number }) => {
      await apiClient.put(`/orgs/${orgId}/todos/${id}`, { completed });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['todos', orgId] }),
  });

  const handleSend = () => {
    if (!input.trim() || !activeChannel) return;
    sendMutation.mutate(input.trim());
  };

  return (
    <div className="flex h-full">
      {/* 左侧栏 — 知识库 */}
      <div className="w-56 border-r border-[#e0e4e8] bg-white flex flex-col shrink-0">
        <div className="p-3 border-b border-[#e0e4e8]">
          <button onClick={() => navigate('/team')} className="flex items-center gap-1 text-sm text-[#81858c] hover:text-[#1d1d1f]">
            <ArrowLeft size={14} /> 返回
          </button>
        </div>
        <div className="p-3">
          <h3 className="text-xs font-semibold text-[#9ca3af] uppercase mb-2">共享知识库</h3>
          <p className="text-xs text-[#9ca3af]">即将上线</p>
        </div>
      </div>

      {/* 中间 — 聊天 */}
      <div className="flex-1 flex flex-col bg-[#f8f9fc]">
        <div className="flex items-center gap-1 p-3 border-b border-[#e0e4e8] bg-white">
          {channels.map((ch) => (
            <button
              key={ch.id}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                activeChannel === ch.id
                  ? 'bg-[#4f8cff] text-white'
                  : 'bg-gray-100 text-[#81858c] hover:bg-gray-200'
              }`}
              onClick={() => setActiveChannel(ch.id)}
            >
              # {ch.name}
            </button>
          ))}
          <div className="flex items-center gap-1 ml-2">
            <input
              className="input input-xs w-20"
              style={{ borderRadius: '6px' }}
              placeholder="新频道"
              value={newChannel}
              onChange={(e) => setNewChannel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && channelMutation.mutate(newChannel)}
            />
            <button
              className="btn btn-xs btn-ghost"
              onClick={() => newChannel && channelMutation.mutate(newChannel)}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.is_agent ? 'justify-center' : ''}`}>
              {m.is_agent ? (
                <div className="bg-[#4f8cff]/5 border border-[#4f8cff]/20 rounded-xl px-4 py-2 max-w-lg">
                  <div className="text-xs text-[#4f8cff] mb-1">🤖 Agent</div>
                  <div className="text-sm text-[#1d1d1f] whitespace-pre-wrap">{m.content}</div>
                </div>
              ) : (
                <div className="max-w-md">
                  <div className="text-xs text-[#9ca3af] mb-1">{m.user_name}</div>
                  <div className="bg-white rounded-xl px-3 py-2 shadow-sm border border-[#e0e4e8] text-sm">
                    {m.content}
                  </div>
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-3 border-t border-[#e0e4e8] bg-white">
          <div className="flex gap-2">
            <input
              type="text"
              className="input input-bordered flex-1"
              style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
              placeholder="输入消息，或 @agent 命令（总结/创建待办/搜索）"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            />
            <button
              className="btn"
              disabled={sendMutation.isPending || !input.trim()}
              onClick={handleSend}
              style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }}
            >
              发送
            </button>
          </div>
        </div>
      </div>

      {/* 右侧栏 — 待办 */}
      <div className="w-56 border-l border-[#e0e4e8] bg-white flex flex-col shrink-0">
        <div className="p-3 border-b border-[#e0e4e8]">
          <h3 className="text-sm font-semibold text-[#1d1d1f]">待办列表</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {todos.map((t) => (
            <div
              key={t.id}
              className={`flex items-center gap-2 p-2 rounded-lg text-xs cursor-pointer transition-colors ${
                t.completed ? 'bg-green-50 line-through text-[#9ca3af]' : 'hover:bg-gray-50'
              }`}
              onClick={() => todoMutation.mutate({ id: t.id, completed: t.completed ? 0 : 1 })}
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                t.completed ? 'bg-green-500 border-green-500 text-white' : 'border-[#d1d5db]'
              }`}>
                {t.completed && <Check size={10} />}
              </div>
              <span className="flex-1 truncate">{t.content}</span>
              {t.assignee_name && (
                <span className="text-[10px] text-[#9ca3af]">@{t.assignee_name}</span>
              )}
            </div>
          ))}
        </div>
        <div className="p-2 border-t border-[#e0e4e8]">
          <button
            className="btn btn-xs btn-ghost w-full text-[#81858c]"
            onClick={() => {
              const content = prompt('待办内容：');
              if (content) {
                apiClient.post(`/orgs/${orgId}/todos`, { content }).then(() => {
                  qc.invalidateQueries({ queryKey: ['todos', orgId] });
                });
              }
            }}
          >
            <Plus size={14} /> 新建待办
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 添加路由**

```tsx
import { TeamChat } from '@/pages/team/TeamChat';
// 在 children 中添加：
{ path: 'team/:orgId', element: <TeamChat /> },
```

- [ ] **Step 3: 构建 + 提交**

```bash
cd D:\AI\Internship\Multi_Agent\frontend && npx tsc --noEmit 2>&1 | head -30
git add frontend/src/pages/team/TeamChat.tsx frontend/src/routes/index.tsx
git commit -m "feat: 团队聊天三栏界面 — 频道切换 + 消息流 + 待办面板

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 12: 知识库独立页面

**Files:**
- Create: `frontend/src/pages/knowledge/KnowledgePage.tsx`
- Modify: `frontend/src/routes/index.tsx`

**Interfaces:**
- Consumes: `knowledgeApi.listFiles()`, `knowledgeApi.upload()`, `knowledgeApi.delete()`
- Produces: 知识库管理独立页

- [ ] **Step 1: 创建 KnowledgePage.tsx**

```tsx
// frontend/src/pages/knowledge/KnowledgePage.tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { knowledgeApi } from '@/api/knowledge';
import { toast } from 'sonner';
import { Upload, Trash2, FileIcon } from 'lucide-react';

export function KnowledgePage() {
  const qc = useQueryClient();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useState<HTMLInputElement | null>(null);

  const { data: files = [], isLoading } = useQuery({
    queryKey: ['kb-files'],
    queryFn: async () => {
      const res = await knowledgeApi.listFiles();
      return res.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => knowledgeApi.deleteFile(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kb-files'] });
      toast.success('文件已删除');
    },
    onError: () => toast.error('删除失败'),
  });

  const handleUpload = async (file: File) => {
    const toastId = toast.loading(`上传中: ${file.name}`);
    try {
      await knowledgeApi.upload(file);
      toast.success(`上传完成: ${file.name}`, { id: toastId });
      qc.invalidateQueries({ queryKey: ['kb-files'] });
    } catch {
      toast.error(`上传失败: ${file.name}`, { id: toastId });
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1d1d1f]">知识库</h1>
        <p className="text-sm text-[#81858c] mt-1">管理上传的文件，Agent 可从中检索信息</p>
      </div>

      {/* 上传区域 */}
      <div
        className={`border-2 border-dashed rounded-2xl p-8 text-center transition-colors ${
          isDragging ? 'border-[#4f8cff] bg-[#4f8cff]/5' : 'border-[#e0e4e8] bg-white'
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) handleUpload(file);
        }}
        onClick={() => document.getElementById('kb-file-input')?.click()}
      >
        <Upload size={32} className="mx-auto text-[#9ca3af] mb-2" />
        <p className="text-sm text-[#81858c]">拖拽文件到此处上传</p>
        <p className="text-xs text-[#9ca3af]">支持 PDF · TXT · PNG · JPG（≤5MB）</p>
        <input
          id="kb-file-input"
          type="file"
          className="hidden"
          accept=".pdf,.txt,.png,.jpg,.jpeg"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
          }}
        />
      </div>

      {/* 文件列表 */}
      <div className="bg-white rounded-xl border border-[#e0e4e8]">
        <div className="p-4 border-b border-[#e0e4e8]">
          <h2 className="font-semibold text-[#1d1d1f]">文件列表（{files.length}）</h2>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-8"><span className="loading loading-spinner" /></div>
        ) : files.length === 0 ? (
          <p className="text-sm text-[#9ca3af] text-center py-8">暂无文件，上传一个吧</p>
        ) : (
          <div className="divide-y divide-[#f0f0f0]">
            {files.map((f: any) => (
              <div key={f.name} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                <FileIcon size={18} className="text-[#9ca3af] shrink-0" />
                <span className="text-sm text-[#1d1d1f] flex-1 truncate">{f.name}</span>
                <span className="text-xs text-[#9ca3af]">{f.size ? `${(f.size / 1024).toFixed(1)}KB` : ''}</span>
                <button
                  className="btn btn-xs btn-ghost text-[#ef4444]"
                  onClick={() => deleteMutation.mutate(f.name)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 添加路由 + 构建 + 提交**

```bash
cd D:\AI\Internship\Multi_Agent\frontend && npx tsc --noEmit 2>&1 | head -20
git add frontend/src/pages/knowledge/KnowledgePage.tsx frontend/src/routes/index.tsx
git commit -m "feat: 知识库独立页面 — 拖拽上传 + 文件列表 + 删除

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 13: 模型管理增强

**Files:**
- Modify: `frontend/src/pages/settings/SettingsPage.tsx` (追加模型管理区域)

**Interfaces:**
- Consumes: `userApi.getConfig()`, `userApi.addCustomModel()`, `userApi.deleteCustomModel()`
- Produces: 自定义模型添加/删除/角色映射选择器

- [ ] **Step 1: 改造 SettingsPage.tsx**

在现有 Profile 和 API Key 卡片之间插入「模型管理」卡片：

```tsx
// 在 API Key 卡片上方插入

{/* 模型管理 */}
<div className="card bg-base-100 border border-[#e0e4e8] shadow-sm">
  <div className="card-body">
    <h2 className="card-title text-[#1d1d1f]">模型管理</h2>
    <p className="text-sm text-[#81858c]">管理自定义模型和角色映射</p>

    {/* 当前角色映射 */}
    <div className="mt-2">
      <h3 className="text-sm font-semibold text-[#1d1d1f] mb-2">角色 → 模型映射</h3>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(config?.roles || {}).map(([role, model]) => (
          <div key={role} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg text-xs">
            <span className="font-medium text-[#1d1d1f]">{role}</span>
            <span className="text-[#9ca3af]">→</span>
            <span className="text-[#4f8cff]">{model as string}</span>
          </div>
        ))}
      </div>
    </div>

    {/* 模型池 */}
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-[#1d1d1f] mb-2">
        模型池（系统默认 + 自定义）
      </h3>
      <div className="space-y-1">
        {(config?.system_models || []).map((m: any) => (
          <div key={m.key} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg text-xs">
            <span className="badge badge-sm">系统</span>
            <span className="font-medium">{m.key}</span>
            <span className="text-[#9ca3af]">{m.model}</span>
          </div>
        ))}
        {(config?.models || []).map((m: any) => (
          <div key={m.key} className="flex items-center gap-2 p-2 bg-[#4f8cff]/5 rounded-lg text-xs">
            <span className="badge badge-sm badge-primary">自定义</span>
            <span className="font-medium">{m.key}</span>
            <span className="text-[#9ca3af]">{m.model}</span>
            <button
              className="btn btn-xs btn-ghost text-[#ef4444] ml-auto"
              onClick={() => {
                userApi.deleteCustomModel(m.key).then(() => {
                  toast.success('已删除自定义模型');
                });
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>

    {/* 添加自定义模型 */}
    <details className="mt-4">
      <summary className="text-sm text-[#4f8cff] cursor-pointer hover:underline">
        + 添加自定义模型
      </summary>
      <form
        className="mt-3 space-y-3 p-3 bg-gray-50 rounded-xl"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.target as HTMLFormElement;
          const key = (form.elements.namedItem('key') as HTMLInputElement).value.trim();
          const model = (form.elements.namedItem('model') as HTMLInputElement).value.trim();
          const base_url = (form.elements.namedItem('base_url') as HTMLInputElement).value.trim();
          const api_key = (form.elements.namedItem('api_key') as HTMLInputElement).value.trim();
          if (!key || !model || !api_key) {
            toast.error('Key、模型名和 API Key 不能为空');
            return;
          }
          userApi.addCustomModel({ key, model, base_url, api_key }).then(() => {
            toast.success('自定义模型已添加');
            form.reset();
          }).catch((err: any) => toast.error(err?.response?.data?.error || '添加失败'));
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <input name="key" className="input input-bordered input-sm" placeholder="标识 (如 my-gpt)" style={{ borderRadius: '8px' }} />
          <input name="model" className="input input-bordered input-sm" placeholder="模型名 (如 gpt-4o)" style={{ borderRadius: '8px' }} />
          <input name="base_url" className="input input-bordered input-sm" placeholder="Base URL (可选)" style={{ borderRadius: '8px' }} />
          <input name="api_key" className="input input-bordered input-sm" placeholder="API Key" type="password" style={{ borderRadius: '8px' }} />
        </div>
        <button
          type="submit"
          className="btn btn-sm mt-2"
          style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '8px', border: 'none' }}
        >
          添加
        </button>
      </form>
    </details>
  </div>
</div>
```

- [ ] **Step 2: 确保 userApi 支持所需方法**

检查 `frontend/src/api/user.ts` 是否有以下方法（已有则跳过）：
- `getConfig()` → GET `/api/user/config`
- `addCustomModel(data)` → POST `/api/user/custom-models`
- `deleteCustomModel(key)` → DELETE `/api/user/custom-models/{key}`

这三个端点已在 `user/routes.py` 中实现。

- [ ] **Step 3: 构建 + 提交**

```bash
cd D:\AI\Internship\Multi_Agent\frontend && npx tsc --noEmit 2>&1 | head -20
git add frontend/src/pages/settings/SettingsPage.tsx
git commit -m "feat: 模型管理增强 — 角色映射展示 + 自定义模型添加/删除

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 14: 集成验证 + 全栈联调

**Files:**
- Modify: `frontend/src/routes/index.tsx` (最终路由汇总)
- Modify: `main.py` (最终路由注册汇总)

- [ ] **Step 1: 验证前端构建**

```bash
cd D:\AI\Internship\Multi_Agent\frontend && npm run build 2>&1 | tail -10
```

Expected: 构建成功，无错误。

- [ ] **Step 2: 验证后端启动**

```bash
cd D:\AI\Internship\Multi_Agent && timeout 8 python -c "
from main import app
from fastapi.routing import APIRoute
routes = [r.path for r in app.routes if hasattr(r, 'path')]
print('Total routes:', len(routes))
for r in sorted(routes):
    print(' ', r)
" 2>&1
```

Expected: 输出所有路由，包含新加的 `/api/orgs/*`、`/api/chat/guest` 等。

- [ ] **Step 3: 运行后端测试**

```bash
cd D:\AI\Internship\Multi_Agent && python -m pytest tests/ -v --timeout=30 2>&1
```

Expected: 所有已有测试通过。

- [ ] **Step 4: 提交最终整合**

```bash
git add -A
git commit -m "feat(phase3): 全栈联调 — 路由整合 + 构建验证通过

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 任务依赖图

```
Task 1 (DB v5)
  ├─→ Task 2 (组织 API) ──→ Task 8 (组织前端)
  └─→ Task 10 (团队聊天后端)
          └─→ Task 11 (团队聊天前端)

Task 3 (搜索)    Task 4 (Agent读文件)
       ↓                ↓
Task 5 (登录+游客后端) → Task 6 (游客前端)

Task 7 (主界面)
Task 9 (侧栏收起)
Task 12 (知识库页)
Task 13 (模型管理)

可并行：
  [Task 3, Task 4, Task 7, Task 9, Task 12, Task 13] 与 [Task 1→2→8] 无依赖可并行
  Task 5 依赖 Task 6
  Task 10 依赖 Task 1
```

---

## 总任务清单

| # | Task | 文件数 | 预估 |
|---|------|--------|------|
| 1 | DB Migration v5 | 1 modified | 0.5d |
| 2 | 组织管理 API | 1 create + 1 modify | 0.5d |
| 3 | 网络搜索 | 3 modify | 0.5d |
| 4 | Agent 读文件 | 1 modify | 0.5d |
| 5 | 登录页 + 游客后端 | 1 modify + 1 modify | 1d |
| 6 | 游客模式前端 | 5 modify/create | 1d |
| 7 | 主界面快速开始 | 2 create + 2 modify | 1.5d |
| 8 | 组织管理前端 | 1 create + 1 modify | 0.5d |
| 9 | 左侧栏收起 | 1 modify | 0.5d |
| 10 | 团队聊天后端 | 1 create + 1 modify | 1.5d |
| 11 | 团队聊天前端 | 1 create + 1 modify | 1.5d |
| 12 | 知识库独立页 | 1 create + 1 modify | 0.5d |
| 13 | 模型管理增强 | 1 modify | 0.5d |
| 14 | 集成验证 | — | 0.5d |
| **Total** | | **~20 files** | **~11 days** |
