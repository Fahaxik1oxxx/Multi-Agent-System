# SQLite 数据库接入 + RAG Bug 修复 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 SQLite 持久化会话和用户数据，修复 RAG 知识库重建索引时切片数逐次翻倍 bug。

**Architecture:** 新增 `db.py` 封装 sqlite3 操作（WAL 模式 + contextmanager 连接管理），通过 `app.state.db` 依赖注入到 FastAPI 路由。前端登录弹窗简化为用户名输入，会话按 user_id 隔离。`rag/knowledge_base.py` 的 `build_index()` 在重建前删除旧 ChromaDB collection。

**Tech Stack:** Python sqlite3 (stdlib), FastAPI, LangChain Chroma wrapper, chromadb client, vanilla JS

## Global Constraints

- sqlite3 是 Python 标准库，不增加 `requirements.txt` 依赖
- API 响应格式与 `docs/api.md` 保持一致
- 现有 `sessions.json` 数据不自动迁移（开发阶段，手动处理即可）
- 模型/角色配置（内存 + localStorage）不做任何改动
- 用户系统为简易标识，无密码、无 JWT、无 session cookie

---

## 文件变更地图

| 文件 | 操作 | 职责 |
|------|------|------|
| `db.py` | **新建** | Database 类：建表、用户 CRUD、会话 CRUD |
| `main.py:160-228` | **修改** | 会话路由换用 DB；新增 `/api/users` 端点；startup 初始化 DB |
| `templates/components/sidebar.html` | **修改** | 登录弹窗 → 用户名弹窗 |
| `static/js/chat.js` | **修改** | 用户初始化；`loadSessions()` 携带 `user_id`；`saveSession()` 携带 `user_id` |
| `rag/knowledge_base.py:48-72` | **修改** | `build_index()` 删除旧 collection + 清除缓存 |

---

### Task 1: 创建 `db.py` 数据库模块

**Files:**
- Create: `db.py`

**Interfaces:**
- Produces: `Database` class with methods: `__init__(db_path)`, `create_user(name) → dict`, `get_user(name) → dict|None`, `list_sessions(user_id) → list[dict]`, `get_session(session_id) → dict|None`, `save_session(session_id, user_id, messages, title) → dict`, `delete_session(session_id) → bool`, `_conn()` contextmanager, `_init_db()`

- [ ] **Step 1: 创建 `db.py`**

```python
"""
SQLite 数据库模块 —— 用户与会话持久化。
使用标准库 sqlite3，WAL 模式，支持多用户并发。
"""

import json
import sqlite3
import uuid
from contextlib import contextmanager


class Database:
    """SQLite 数据库封装，管理用户和会话两张表。"""

    def __init__(self, db_path: str):
        self._path = db_path
        self._init_db()

    def _init_db(self):
        """初始化数据库：启用 WAL + 外键 + 建表"""
        with self._conn() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id         TEXT PRIMARY KEY,
                    name       TEXT NOT NULL UNIQUE,
                    created_at TEXT DEFAULT (datetime('now', 'localtime'))
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    id         TEXT PRIMARY KEY,
                    user_id    TEXT NOT NULL,
                    title      TEXT DEFAULT '',
                    messages   TEXT DEFAULT '[]',
                    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
                    FOREIGN KEY (user_id) REFERENCES users(id)
                );
            """)

    @contextmanager
    def _conn(self):
        """获取短期数据库连接，自动提交/关闭。异常时回滚。"""
        conn = sqlite3.connect(self._path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    # ── 用户 ──

    def create_user(self, name: str) -> dict:
        """创建用户。已存在则直接返回已有记录（幂等）。
        返回 {"id": str, "name": str}"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, name FROM users WHERE name = ?", (name,)
            ).fetchone()
            if row:
                return {"id": row["id"], "name": row["name"]}
            uid = str(uuid.uuid4())[:8]
            conn.execute(
                "INSERT INTO users (id, name) VALUES (?, ?)", (uid, name)
            )
            return {"id": uid, "name": name}

    def get_user(self, name: str) -> dict | None:
        """按名称查找用户。找到返回 {"id", "name"}，否则 None。"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, name FROM users WHERE name = ?", (name,)
            ).fetchone()
            if row:
                return {"id": row["id"], "name": row["name"]}
            return None

    # ── 会话 ──

    def list_sessions(self, user_id: str) -> list[dict]:
        """列出某用户的所有会话摘要，按更新时间倒序。
        返回 [{"id", "title", "count", "updated"}, ...]"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, title, messages, updated_at FROM sessions "
                "WHERE user_id = ? ORDER BY updated_at DESC",
                (user_id,),
            ).fetchall()
            result = []
            for r in rows:
                try:
                    msgs = json.loads(r["messages"])
                except (json.JSONDecodeError, TypeError):
                    msgs = []
                first = ""
                for m in msgs:
                    c = m.get("content", "")
                    if c:
                        first = c[:50]
                        break
                result.append({
                    "id": r["id"],
                    "title": first or r["title"] or "空对话",
                    "count": len(msgs),
                    "updated": r["updated_at"] or "",
                })
            return result

    def get_session(self, session_id: str) -> dict | None:
        """获取单个会话完整数据。
        返回 {"id", "user_id", "messages", "updated"} 或 None"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, user_id, messages, updated_at FROM sessions "
                "WHERE id = ?",
                (session_id,),
            ).fetchone()
            if not row:
                return None
            try:
                msgs = json.loads(row["messages"])
            except (json.JSONDecodeError, TypeError):
                msgs = []
            return {
                "id": row["id"],
                "user_id": row["user_id"],
                "messages": msgs,
                "updated": row["updated_at"] or "",
            }

    def save_session(self, session_id: str, user_id: str,
                     messages: list[dict], title: str = "") -> dict:
        """创建或更新会话（UPSERT）。返回 {"id": str, "status": "ok"}"""
        with self._conn() as conn:
            existing = conn.execute(
                "SELECT id FROM sessions WHERE id = ?", (session_id,)
            ).fetchone()
            msgs_json = json.dumps(messages, ensure_ascii=False)
            if existing:
                conn.execute(
                    "UPDATE sessions SET user_id=?, title=?, messages=?, "
                    "updated_at=datetime('now','localtime') WHERE id=?",
                    (user_id, title, msgs_json, session_id),
                )
            else:
                conn.execute(
                    "INSERT INTO sessions (id, user_id, title, messages) "
                    "VALUES (?, ?, ?, ?)",
                    (session_id, user_id, title, msgs_json),
                )
        return {"id": session_id, "status": "ok"}

    def delete_session(self, session_id: str) -> bool:
        """删除会话。返回 True 表示删除成功，False 表示不存在。"""
        with self._conn() as conn:
            cur = conn.execute(
                "DELETE FROM sessions WHERE id = ?", (session_id,)
            )
            return cur.rowcount > 0
```

- [ ] **Step 2: 验证模块可导入**

Run: `python -c "from db import Database; print('OK')"`
Expected: `OK`

- [ ] **Step 3: 手动验证建表和基本操作**

```bash
python -c "
from db import Database
import os, tempfile
tmp = os.path.join(tempfile.gettempdir(), 'test_db.sqlite3')
db = Database(tmp)
# 用户
u = db.create_user('testuser')
print('create_user:', u)
print('get_user:', db.get_user('testuser'))
# 幂等
u2 = db.create_user('testuser')
print('idempotent:', u['id'] == u2['id'])
# 会话
s = db.save_session('s1', u['id'], [{'role':'user','content':'hello'}])
print('save:', s)
print('list:', db.list_sessions(u['id']))
print('get:', db.get_session('s1'))
print('delete:', db.delete_session('s1'))
print('get_after_delete:', db.get_session('s1'))
os.remove(tmp)
print('All OK')
"
```
Expected: 所有操作正常，最后输出 `All OK`

- [ ] **Step 4: Commit**

```bash
git add db.py
git commit -m "feat: add SQLite database module for users and sessions"
```

---

### Task 2: 修改 `main.py` — 替换会话路由 + 新增用户端点

**Files:**
- Modify: `main.py:160-228`

**Interfaces:**
- Consumes: `Database` class from `db.py` (Task 1)
- Produces: `app.state.db` 实例（startup 事件）；修改后的会话端点（签名不变，实现换 DB）；新增 `POST /api/users`, `GET /api/users`

- [ ] **Step 1: 添加 import 和 startup 事件**

在 `main.py` 顶部 import 区域添加：
```python
from db import Database
```

在文件末尾 `if __name__ == "__main__":` 之前添加 startup 事件：
```python
# ──── 启动事件 ────
@app.on_event("startup")
async def startup():
    app.state.db = Database(os.path.join(_PROJECT_DIR, "data.db"))
```

- [ ] **Step 2: 替换会话管理模块**

在 `main.py:160-228` 处，删除所有 JSON 文件相关代码并替换为：

```python
# ──── 会话管理（SQLite）────

def _get_db(request: Request):
    return request.app.state.db


@app.get("/api/sessions")
async def list_sessions(request: Request, user_id: str = ""):
    """列出指定用户的会话摘要"""
    db = _get_db(request)
    if not user_id:
        return JSONResponse([])
    summary = db.list_sessions(user_id)
    return JSONResponse(summary)


@app.post("/api/sessions")
async def save_session(request: Request):
    """保存/创建会话"""
    db = _get_db(request)
    data = await request.json()
    sid = data.get("id") or str(int(__import__("time").time() * 1000))
    user_id = data.get("user_id", "")
    title = data.get("title", "")
    result = db.save_session(sid, user_id, data.get("messages", []), title)
    return JSONResponse(result)


@app.get("/api/sessions/{session_id}")
async def get_session(request: Request, session_id: str):
    """获取单个会话的完整消息"""
    db = _get_db(request)
    s = db.get_session(session_id)
    if not s:
        return JSONResponse({"error": "会话不存在"}, status_code=404)
    # 向后兼容：保持旧响应格式（不含 user_id 顶层字段）
    return JSONResponse({
        "messages": s["messages"],
        "updated": s["updated"],
    })


@app.delete("/api/sessions/{session_id}")
async def delete_session(request: Request, session_id: str):
    """删除会话"""
    db = _get_db(request)
    deleted = db.delete_session(session_id)
    if not deleted:
        return JSONResponse({"error": "会话不存在"}, status_code=404)
    return JSONResponse({"status": "ok"})


# ──── 用户管理 ────

@app.post("/api/users")
async def create_user(request: Request):
    """创建用户（幂等），返回 {user_id, name}"""
    db = _get_db(request)
    data = await request.json()
    name = data.get("name", "").strip()
    if not name:
        return JSONResponse({"error": "用户名不能为空"}, status_code=400)
    user = db.create_user(name)
    return JSONResponse({"user_id": user["id"], "name": user["name"]})


@app.get("/api/users")
async def get_user(request: Request, name: str = ""):
    """按名称查找用户"""
    db = _get_db(request)
    if not name:
        return JSONResponse({"error": "缺少 name 参数"}, status_code=400)
    user = db.get_user(name.strip())
    if not user:
        return JSONResponse({"error": "用户不存在"}, status_code=404)
    return JSONResponse({"user_id": user["id"], "name": user["name"]})
```

- [ ] **Step 3: 删除不再使用的 import**

确认 `import json, time` 已从 main.py 移除（会话路由不再需要）。之前第 162 行的 `import json, time` 已在替换时删除。

- [ ] **Step 4: 启动服务验证**

```bash
# 在后台启动
python -m uvicorn main:app --host 127.0.0.1 --port 8501 &
sleep 3
# 测试用户 API
curl -s -X POST http://127.0.0.1:8501/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"alice"}'
# 预期: {"user_id":"<8位ID>","name":"alice"}

# 测试会话 API
curl -s "http://127.0.0.1:8501/api/sessions?user_id=<上一步的ID>"
# 预期: []

curl -s -X POST http://127.0.0.1:8501/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"id":"test-001","user_id":"<上一步的ID>","messages":[{"role":"user","content":"hello"}]}'
# 预期: {"id":"test-001","status":"ok"}

curl -s "http://127.0.0.1:8501/api/sessions?user_id=<上一步的ID>"
# 预期: [{"id":"test-001","title":"hello","count":1,"updated":"..."}]
```

- [ ] **Step 5: 停止服务并清理测试数据**

```bash
kill %1 2>/dev/null
rm -f data.db data.db-wal data.db-shm
```

- [ ] **Step 6: Commit**

```bash
git add main.py
git commit -m "feat: replace JSON session storage with SQLite, add user endpoints"
```

---

### Task 3: 修改侧边栏 — 登录弹窗 → 用户名输入

**Files:**
- Modify: `templates/components/sidebar.html`

**Interfaces:**
- Consumes: `systemStatus` (Jinja2 注入的全局变量, 已存在)
- Produces: 用户名弹窗替代旧的登录/注册弹窗；`currentUser` 存入 `localStorage`

- [ ] **Step 1: 替换底部用户区域和登录弹窗**

在 `templates/components/sidebar.html` 中，将第 80-108 行（底部用户区域 + 登录弹窗）及第 179-217 行（登录/注册脚本）替换为：

**替换底部用户区域（第 80-85 行）：**
```html
<!-- 底部用户 -->
<div class="mt-auto pt-2 flex items-center justify-between">
    <span id="current-username" class="text-xs opacity-60 truncate cursor-pointer" onclick="document.getElementById('user-modal').showModal()">未设置</span>
    <button class="btn btn-ghost btn-xs" title="设置用户名" onclick="document.getElementById('user-modal').showModal()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 12a4 4 0 100-8 4 4 0 000 8zM20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/></svg>
    </button>
</div>
```

**替换登录弹窗（第 88-108 行）：**
```html
<!-- 用户名弹窗 -->
<dialog id="user-modal" class="modal">
    <div class="modal-box">
        <form method="dialog">
            <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">✕</button>
        </form>
        <h3 class="text-lg font-bold mb-4">设置用户名</h3>
        <input id="username-input" type="text" class="input input-bordered w-full mb-3" placeholder="输入你的用户名">
        <button onclick="setUsername()" class="btn btn-primary w-full">确认</button>
        <p id="user-msg" class="text-xs text-center mt-2 opacity-60"></p>
    </div>
</dialog>
```

**替换脚本区域（第 179-217 行 auth 相关部分）：**

删除旧的 `authMode` / `switchAuthTab` / `submitAuth` 函数和恢复登录状态的代码。保留 `renderDropdowns()` 调用。新增：

```javascript
// ── 用户设置 ──
let currentUser = { id: localStorage.getItem("mc_uid") || "", name: localStorage.getItem("mc_uname") || "" };

function updateUserDisplay() {
    const el = document.getElementById("current-username");
    if (el) el.textContent = currentUser.name || "未设置";
}

function setUsername() {
    const name = document.getElementById("username-input").value.trim();
    const msg = document.getElementById("user-msg");
    if (!name) { msg.textContent = "请输入用户名"; return; }
    fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) { msg.textContent = data.error; return; }
        currentUser.id = data.user_id;
        currentUser.name = data.name;
        localStorage.setItem("mc_uid", data.user_id);
        localStorage.setItem("mc_uname", data.name);
        updateUserDisplay();
        document.getElementById("user-modal").close();
        loadSessions();
    })
    .catch(err => { msg.textContent = "网络错误: " + err.message; });
}

// 初始化
updateUserDisplay();
```

- [ ] **Step 2: 验证弹窗渲染**

启动服务后访问 `http://localhost:8501`，确认：
- 侧边栏底部显示 "未设置" 或已保存的用户名
- 点击弹出用户名输入弹窗
- 输入用户名后确认，侧边栏底部更新

- [ ] **Step 3: Commit**

```bash
git add templates/components/sidebar.html
git commit -m "feat: replace fake login with username-only modal"
```

---

### Task 4: 修改 `chat.js` — 用户初始化和 user_id 携带

**Files:**
- Modify: `static/js/chat.js`

**Interfaces:**
- Consumes: `currentUser` 通过 `localStorage` 共享 (sidebar.html 写入 `mc_uid`/`mc_uname`)
- Produces: `loadSessions()` 携带 `user_id` 参数；`saveSession()` 携带 `user_id` 字段；`newChat()` 清除消息后加载当前用户会话

- [ ] **Step 1: 新增用户初始化函数和会话加载逻辑**

在 `chat.js` 文件末尾添加：

```javascript
// ===== 用户 =====
function getUserId() {
    return localStorage.getItem("mc_uid") || "";
}

function getUserName() {
    return localStorage.getItem("mc_uname") || "";
}

// ===== 会话列表加载 =====
async function loadSessions() {
    const uid = getUserId();
    if (!uid) return;
    try {
        const resp = await fetch("/api/sessions?user_id=" + encodeURIComponent(uid));
        if (!resp.ok) return;
        const sessions = await resp.json();
        renderSessionList(sessions);
    } catch { /* 静默失败 */ }
}

function renderSessionList(sessions) {
    // 查找或创建会话列表容器
    let container = document.getElementById("session-list");
    if (!container) return;
    if (!sessions.length) {
        container.innerHTML = '<div class="text-xs opacity-40">暂无历史会话</div>';
        return;
    }
    // 按时间分组
    const now = new Date();
    const groups = { today: [], week: [], month: [], older: [] };
    sessions.forEach(s => {
        container.innerHTML = ''; // will rebuild below
    });
    // 简单渲染（无分组）
    container.innerHTML = sessions.map(s =>
        `<div class="truncate py-0.5 cursor-pointer hover:opacity-80 opacity-60" 
              onclick="loadSession('${s.id}')" title="${escapeHtml(s.title)}">
            ${escapeHtml(s.title)}
        </div>`
    ).join("");
}

async function loadSession(sessionId) {
    try {
        const resp = await fetch("/api/sessions/" + sessionId);
        if (!resp.ok) return;
        const data = await resp.json();
        // 清空当前聊天区并渲染历史消息
        const container = document.getElementById("chat-messages");
        container.innerHTML = "";
        messageHistory = [];
        (data.messages || []).forEach(m => {
            if (m.role === "user") {
                appendUserMessage(m.content);
            } else {
                // 简化的 assistant 渲染（无 thinking 展开）
                const div = document.createElement("div");
                div.className = "message-assistant";
                div.innerHTML = `<div class="bubble">${escapeHtml(m.content || "").replace(/\n/g, "<br>")}</div>`;
                container.appendChild(div);
            }
            messageHistory.push(m);
        });
        container.scrollTop = container.scrollHeight;
    } catch { /* 静默失败 */ }
}

// 页面加载时初始化
document.addEventListener("DOMContentLoaded", () => {
    const uid = getUserId();
    if (uid) loadSessions();
});
```

- [ ] **Step 2: 修改 `sendMessage()` — 携带 `user_id`**

在 `chat.js:86` 行的 `sendMessage` 函数中，找到 `saveSession` 相关的调用。由于当前代码中 `sendMessage` 不直接调用 `saveSession`，我们需要在消息发送成功后自动保存会话。

修改 `sendMessage` 函数（在第 92-93 行附近），在 `messageHistory.push` 之后添加自动保存：

在 `chat.js:93-94`（即 `messageHistory.push({ role: "user"... })` 和 `messageHistory.push({ role: "assistant"... })` 之后）添加：

```javascript
// 自动保存会话到服务端
const uid = getUserId();
if (uid) {
    fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            id: "session-" + Date.now(),
            user_id: uid,
            messages: messageHistory,
        }),
    }).catch(() => {});
}
```

- [ ] **Step 3: 修改 `newChat()` — 关联用户**

在 `sidebar.html` 的 `newChat()` 函数（第 168-175 行）中，确保清除消息后加载当前用户会话。当前函数只清空 DOM，需追加：

在 `newChat()` 函数的 `document.getElementById("chat-messages").innerHTML = ...` 之后添加：

```javascript
messageHistory = [];
loadSessions();
```

但由于 `newChat()` 在 `sidebar.html` 中定义，而 `loadSessions()` 在 `chat.js` 中，需要确保加载顺序。将 `newChat()` 的追加逻辑写在 `chat.js` 中覆盖：

在 `chat.js` 文件末尾（`DOMContentLoaded` 事件之后）添加：

```javascript
// 覆盖 sidebar.html 中的 newChat（如果存在）
const _origNewChat = window.newChat;
window.newChat = function() {
    if (_origNewChat) _origNewChat();
    messageHistory = [];
    loadSessions();
};
```

- [ ] **Step 4: 在 sidebar 脚本中添加会话列表渲染容器**

`sidebar.html` 中历史对话区域（第 66-76 行）需要替换硬编码示例为动态容器：

```html
<h6 class="font-semibold text-xs mb-1">历史对话</h6>
<div id="session-list" class="text-xs space-y-1 overflow-y-auto max-h-48">
    <div class="text-xs opacity-40">请先设置用户名</div>
</div>
```

- [ ] **Step 5: 端到端验证**

1. 启动服务 `uvicorn main:app --port 8501`
2. 打开 `http://localhost:8501`
3. 在侧边栏设置用户名 "alice"
4. 发送一条消息 "你好"
5. 刷新页面 → 侧边栏仍显示 "alice"
6. 点击历史对话中的 "你好" → 聊天区恢复该会话
7. 点 "开启新对话" → 历史列表刷新

- [ ] **Step 6: Commit**

```bash
git add static/js/chat.js templates/components/sidebar.html
git commit -m "feat: add user-aware session loading and auto-save"
```

---

### Task 5: 修复 `rag/knowledge_base.py` — build_index() Bug

**Files:**
- Modify: `rag/knowledge_base.py:48-72`

**Interfaces:**
- Consumes: chromadb `PersistentClient` (新依赖 chromadb 包，但项目已依赖 `chromadb>=1.5`)
- Produces: 修复后的 `build_index()` — 删除旧 collection → 重建 → 清除全局缓存

- [ ] **Step 1: 添加 chromadb import 和修改 `build_index()`**

在 `rag/knowledge_base.py` 顶部 import 区域添加：
```python
import chromadb
```

将 `build_index()` 函数（第 48-72 行）替换为：

```python
def build_index():
    """扫描 documents/ 下所有 PDF/TXT，重建索引。
    先删除旧 collection，确保不会累积重复切片。"""
    global _vectorstore

    # 1. 删除旧 collection（如果存在）
    client = chromadb.PersistentClient(path=PERSIST_DIR)
    try:
        client.delete_collection("langchain")
    except Exception:
        pass  # 首次构建时 collection 不存在

    # 2. 清除全局缓存
    _vectorstore = None

    # 3. 扫描文档
    emb = _get_embeddings()
    docs = []
    for fname in os.listdir(DOCUMENTS_DIR):
        fpath = os.path.join(DOCUMENTS_DIR, fname)
        if fname.endswith(".pdf"):
            loader = PyPDFLoader(fpath)
            docs.extend(loader.load())
        elif fname.endswith(".txt"):
            loader = TextLoader(fpath, encoding="utf-8")
            docs.extend(loader.load())

    if not docs:
        return 0

    # 4. 切分
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=300, chunk_overlap=50,
        separators=["\n\n", "\n", "。", "！", "？", " ", ""],
    )
    chunks = splitter.split_documents(docs)

    # 5. 创建新 collection
    Chroma.from_documents(
        documents=chunks,
        embedding=emb,
        persist_directory=PERSIST_DIR,
    )

    return len(chunks)
```

注意：需要删除原来在文件顶部的 `chromadb` import 位置检查。确认 `import chromadb` 添加在文件开头合适位置（例如在 `from langchain_community.vectorstores import Chroma` 之后）。

- [ ] **Step 2: 运行已有测试确保不破坏**

```bash
python -m pytest tests/test_knowledge_routes.py -v
```
Expected: 所有测试通过（尤其是 `test_kb_rebuild`）

- [ ] **Step 3: 验证修复效果**

```bash
python -c "
from rag.knowledge_base import build_index, get_stats
# 第一次重建
n1 = build_index()
print(f'第1次重建: {n1} 切片')
s1 = get_stats()
print(f'第1次统计: {s1}')

# 第二次重建（相同文档）
n2 = build_index()
print(f'第2次重建: {n2} 切片')
s2 = get_stats()
print(f'第2次统计: {s2}')

# 验证切片数一致
assert n1 == n2, f'切片数不一致: {n1} vs {n2}'
assert s1['切片数'] == s2['切片数'], f'统计切片数不一致'
print('✅ Bug 已修复：连续重建切片数保持一致')
"
```
Expected: `✅ Bug 已修复：连续重建切片数保持一致`

- [ ] **Step 4: Commit**

```bash
git add rag/knowledge_base.py
git commit -m "fix: delete old ChromaDB collection before rebuild to prevent chunk duplication"
```

---

### Task 6: 全量测试

**Files:**
- Test: `tests/test_knowledge_routes.py` (已存在，不修改)

**Interfaces:**
- Consumes: Tasks 1-5 所有产物

- [ ] **Step 1: 运行知识库测试**

```bash
python -m pytest tests/test_knowledge_routes.py -v
```
Expected: 6 tests PASS

- [ ] **Step 2: 手动验证完整流程**

```bash
# 启动服务
python -m uvicorn main:app --host 127.0.0.1 --port 8501 &
sleep 3

# 1. 用户创建
USER=$(curl -s -X POST http://127.0.0.1:8501/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"integration_test"}')
echo "User: $USER"
UID=$(echo $USER | python -c "import sys,json; print(json.load(sys.stdin)['user_id'])")

# 2. 会话创建
curl -s -X POST http://127.0.0.1:8501/api/sessions \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"int-001\",\"user_id\":\"$UID\",\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}]}"

# 3. 用户隔离验证
curl -s -X POST http://127.0.0.1:8501/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"other_user"}' > /dev/null
OTHER_UID=$(curl -s "http://127.0.0.1:8501/api/users?name=other_user" | python -c "import sys,json; print(json.load(sys.stdin)['user_id'])")
OTHER_SESSIONS=$(curl -s "http://127.0.0.1:8501/api/sessions?user_id=$OTHER_UID")
echo "Other user sessions: $OTHER_SESSIONS"
# 应为空数组

# 4. 知识库重建
KB=$(curl -s -X POST http://127.0.0.1:8501/api/knowledge/rebuild)
echo "KB rebuild: $KB"
KB2=$(curl -s -X POST http://127.0.0.1:8501/api/knowledge/rebuild)
echo "KB rebuild 2: $KB2"
# 两次 added 应该相同

# 清理
kill %1 2>/dev/null
rm -f data.db data.db-wal data.db-shm
echo "✅ Integration test passed"
```

- [ ] **Step 3: Commit（如有残余更改）**

```bash
git status
# 如有未提交的更改
git add -A
git commit -m "test: add integration verification for SQLite + RAG fix"
```

---
