# 用户隔离与认证系统 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 bcrypt 密码认证 + UUID Token 鉴权 + 知识库物理隔离的轻量用户体系。

**Architecture:** 后端新增 4 个认证 API 和 Token 解析中间件；Session API 和 Knowledge API 从信任前端 `user_id` 改为 Token 鉴权；知识库按 `rag/documents/<user_id>/` 和 `rag/chroma_db/<user_id>/` 分目录存放；前端注册/登录对接新 API，所有请求带 `Authorization: Bearer <token>`。

**Tech Stack:** bcrypt（密码哈希）, Python uuid（Token 生成）, SQLite（用户+Token 存储）, ChromaDB（向量检索，目录隔离）

## Global Constraints

- 游客判定：`!localStorage.getItem("auth_token")`
- Chat API（`/api/chat`）不鉴权
- Report API（`/api/report`）不鉴权
- 模型配置 API 不鉴权
- UI 布局不变
- 旧密码字段从 localStorage 移除（`auth_user` → `auth_token`）

---

### Task 1: 安装 bcrypt + 数据库模式升级

**Files:**
- Modify: `requirements.txt`
- Modify: `db.py`

**Produces:**
- `Database.create_user(name, email, password) -> dict`（新签名，bcrypt 哈希）
- `Database.create_token(user_id) -> str`
- `Database.get_user_by_token(token) -> dict | None`
- `Database.delete_token(token) -> void`
- `Database.authenticate(name, password) -> dict | None`

- [ ] **Step 1: 安装 bcrypt**

```bash
pip install bcrypt
```

- [ ] **Step 2: 更新 requirements.txt**

找到 `requirements.txt`，追加一行：

```
bcrypt>=4.0
```

- [ ] **Step 3: 修改 db.py — 添加导入和更新 `_init_db`**

在 `db.py` 顶部追加导入：

```python
import bcrypt
```

修改 `_init_db()` 中的 `users` 建表语句（替换旧版）：

```python
conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        email      TEXT DEFAULT '',
        password   TEXT NOT NULL DEFAULT '',
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
    CREATE TABLE IF NOT EXISTS auth_tokens (
        token      TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
""")
```

- [ ] **Step 4: 替换 `create_user` 方法**

```python
def create_user(self, name: str, email: str = "", password: str = "") -> dict:
    """创建用户。返回 {"id", "name", "token"}。已存在则报错。"""
    with self._conn() as conn:
        existing = conn.execute(
            "SELECT id FROM users WHERE name = ?", (name,)
        ).fetchone()
        if existing:
            raise ValueError(f"用户名已存在: {name}")
        uid = str(uuid.uuid4())[:8]
        hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        conn.execute(
            "INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)",
            (uid, name, email, hashed),
        )
        token = self.create_token(uid)
        return {"id": uid, "name": name, "token": token}
```

- [ ] **Step 5: 添加 `create_token` 方法**

```python
def create_token(self, user_id: str) -> str:
    """为用户生成 auth token，返回 token 字符串"""
    token = str(uuid.uuid4())
    with self._conn() as conn:
        conn.execute(
            "INSERT INTO auth_tokens (token, user_id) VALUES (?, ?)",
            (token, user_id),
        )
    return token
```

- [ ] **Step 6: 添加 `delete_token` 方法**

```python
def delete_token(self, token: str) -> bool:
    """删除 token，返回是否成功"""
    with self._conn() as conn:
        cur = conn.execute("DELETE FROM auth_tokens WHERE token = ?", (token,))
        return cur.rowcount > 0
```

- [ ] **Step 7: 添加 `authenticate` 方法**

```python
def authenticate(self, name: str, password: str) -> dict | None:
    """验证用户名密码，成功返回 {"id", "name", "token"}，失败返回 None"""
    with self._conn() as conn:
        row = conn.execute(
            "SELECT id, name, password FROM users WHERE name = ?", (name,)
        ).fetchone()
        if not row:
            return None
        if not bcrypt.checkpw(password.encode("utf-8"), row["password"].encode("utf-8")):
            return None
        token = self.create_token(row["id"])
        return {"id": row["id"], "name": row["name"], "token": token}
```

- [ ] **Step 8: 添加 `get_user_by_token` 方法**

```python
def get_user_by_token(self, token: str) -> dict | None:
    """从 token 获取用户信息，返回 {"id", "name"} 或 None"""
    with self._conn() as conn:
        row = conn.execute(
            "SELECT u.id, u.name FROM users u "
            "JOIN auth_tokens t ON u.id = t.user_id "
            "WHERE t.token = ?", (token,)
        ).fetchone()
        if not row:
            return None
        return {"id": row["id"], "name": row["name"]}
```

- [ ] **Step 9: 提交**

```bash
git add requirements.txt db.py
git commit -m "feat: 数据库升级 — bcrypt 密码哈希 + auth_tokens 表"
```

---

### Task 2: Auth API 端点 + 鉴权依赖

**Files:**
- Create: `app/auth.py`
- Modify: `main.py` — 注册 auth router

**Consumes:** `Database.create_user`, `Database.authenticate`, `Database.get_user_by_token`, `Database.delete_token`

**Produces:** `POST/GET /api/auth/*` 端点, `require_auth()` 依赖函数

- [ ] **Step 1: 创建 `app/auth.py`**

```python
"""认证 API 路由 — 注册、登录、退出、获取当前用户。"""
import uuid
from fastapi import APIRouter, Request, Depends, HTTPException
from fastapi.responses import JSONResponse

router = APIRouter()


def _get_db(request: Request):
    return request.app.state.db


def require_auth(request: Request) -> dict:
    """FastAPI 依赖：从 Authorization Header 解析用户，失败抛出 401。
    返回 {"user_id": str, "user_name": str}"""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未提供认证令牌")
    token = auth[7:]
    db = _get_db(request)
    user = db.get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="令牌无效或已过期")
    return {"user_id": user["id"], "user_name": user["name"]}


@router.post("/register")
async def auth_register(request: Request):
    """注册：{name, email, password} → {token, user_id, name}"""
    data = await request.json()
    name = data.get("name", "").strip()
    email = data.get("email", "").strip()
    password = data.get("password", "").strip()
    if not name or not password:
        return JSONResponse({"error": "用户名和密码不能为空"}, status_code=400)
    if len(password) < 6:
        return JSONResponse({"error": "密码至少 6 位"}, status_code=400)
    db = _get_db(request)
    try:
        user = db.create_user(name, email, password)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=409)
    return JSONResponse({"token": user["token"], "user_id": user["id"], "name": user["name"]})


@router.post("/login")
async def auth_login(request: Request):
    """登录：{name, password} → {token, user_id, name}"""
    data = await request.json()
    name = data.get("name", "").strip()
    password = data.get("password", "").strip()
    if not name or not password:
        return JSONResponse({"error": "用户名和密码不能为空"}, status_code=400)
    db = _get_db(request)
    user = db.authenticate(name, password)
    if not user:
        return JSONResponse({"error": "用户名或密码错误"}, status_code=401)
    return JSONResponse({"token": user["token"], "user_id": user["id"], "name": user["name"]})


@router.post("/logout")
async def auth_logout(request: Request):
    """退出：删除 token"""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
        _get_db(request).delete_token(token)
    return JSONResponse({"status": "ok"})


@router.get("/me")
async def auth_me(user: dict = Depends(require_auth)):
    """获取当前用户信息（需鉴权）"""
    return JSONResponse({"user_id": user["user_id"], "user_name": user["user_name"]})
```

- [ ] **Step 2: 注册 auth router 到 main.py**

在 `main.py` 的路由注册区域（`app.knowledge` router 附近）添加：

```python
from app.auth import router as auth_router, require_auth
app.include_router(auth_router, prefix="/api/auth", tags=["认证"])
```

- [ ] **Step 3: 提交**

```bash
git add app/auth.py main.py
git commit -m "feat: 认证 API — 注册/登录/退出/获取当前用户"
```

---

### Task 3: Session API 添加 Token 鉴权

**Files:**
- Modify: `main.py` — session 路由

**Consumes:** `require_auth` (from `app.auth`)

- [ ] **Step 1: 修改 `GET /api/sessions` — 从 token 获取 user_id**

将：
```python
@app.get("/api/sessions")
async def list_sessions(request: Request, user_id: str = ""):
    db = _get_db(request)
    if not user_id:
        return JSONResponse([])
    summary = db.list_sessions(user_id)
    return JSONResponse(summary)
```

替换为：
```python
@app.get("/api/sessions")
async def list_sessions(request: Request, user: dict = Depends(require_auth)):
    db = _get_db(request)
    summary = db.list_sessions(user["user_id"])
    return JSONResponse(summary)
```

- [ ] **Step 2: 修改 `POST /api/sessions` — 从 token 获取 user_id**

将：
```python
data = await request.json()
sid = data.get("id") or str(int(__import__("time").time() * 1000))
user_id = data.get("user_id", "")
title = data.get("title", "")
result = db.save_session(sid, user_id, data.get("messages", []), title)
```

替换为：
```python
user: dict = Depends(require_auth)
# 函数签名加 user 参数
data = await request.json()
sid = data.get("id") or str(int(__import__("time").time() * 1000))
title = data.get("title", "")
result = db.save_session(sid, user["user_id"], data.get("messages", []), title)
```

完整函数签名：
```python
@app.post("/api/sessions")
async def save_session(request: Request, user: dict = Depends(require_auth)):
```

- [ ] **Step 3: 修改 `GET /api/sessions/{session_id}` — 校验归属**

在 `get_session` 函数中加入归属校验：

```python
@app.get("/api/sessions/{session_id}")
async def get_session(request: Request, session_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    s = db.get_session(session_id)
    if not s:
        return JSONResponse({"error": "会话不存在"}, status_code=404)
    if s["user_id"] != user["user_id"]:
        return JSONResponse({"error": "无权访问"}, status_code=403)
    return JSONResponse({
        "messages": s["messages"],
        "updated": s["updated"],
    })
```

- [ ] **Step 4: 修改 `DELETE /api/sessions/{session_id}` — 校验归属**

```python
@app.delete("/api/sessions/{session_id}")
async def delete_session(request: Request, session_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    s = db.get_session(session_id)
    if not s:
        return JSONResponse({"error": "会话不存在"}, status_code=404)
    if s["user_id"] != user["user_id"]:
        return JSONResponse({"error": "无权访问"}, status_code=403)
    db.delete_session(session_id)
    return JSONResponse({"status": "ok"})
```

- [ ] **Step 5: 删除 `/api/users` 路由（游客不再注册为数据库用户）**

移除 `POST /api/users` 和 `GET /api/users` 两个路由（游客不需要后端 user_id 了）。

- [ ] **Step 6: 提交**

```bash
git add main.py
git commit -m "feat: 会话 API 添加 Token 鉴权"
```

---

### Task 4: 知识库物理隔离

**Files:**
- Modify: `rag/knowledge_base.py` — 所有函数添加 `user_id` 参数

**Consumes:** `require_auth` 提供的 `user_id`

**Produces:** 所有知识库函数签名增加 `user_id` 参数

- [ ] **Step 1: 修改 `rag/knowledge_base.py` — 路径函数化**

```python
def _get_user_dirs(user_id: str):
    """返回 (documents_dir, chroma_db_dir)"""
    docs = os.path.join(BASE_DIR, "rag", "documents", user_id)
    db = os.path.join(BASE_DIR, "rag", "chroma_db", user_id)
    os.makedirs(docs, exist_ok=True)
    os.makedirs(db, exist_ok=True)
    return docs, db
```

- [ ] **Step 2: 修改 `_get_vectorstore()` — 按 user_id 加载**

```python
_vectorstores = {}  # 替换全局 _vectorstore，改为 dict 缓存

def _get_vectorstore(user_id: str):
    if user_id not in _vectorstores:
        docs_dir, persist_dir = _get_user_dirs(user_id)
        emb = _get_embeddings()
        if os.path.exists(os.path.join(persist_dir, "chroma.sqlite3")):
            _vectorstores[user_id] = Chroma(
                persist_directory=persist_dir,
                embedding_function=emb,
            )
    return _vectorstores.get(user_id)
```

- [ ] **Step 3: 修改 `build_index(user_id)`**

```python
def build_index(user_id: str):
    global _vectorstores
    docs_dir, persist_dir = _get_user_dirs(user_id)

    # 删除旧 collection
    client = chromadb.PersistentClient(path=persist_dir)
    try:
        client.delete_collection("langchain")
    except Exception:
        pass
    _vectorstores.pop(user_id, None)

    emb = _get_embeddings()
    docs = []
    for fname in os.listdir(docs_dir):
        fpath = os.path.join(docs_dir, fname)
        if fname.endswith(".pdf"):
            loader = PyPDFLoader(fpath)
            docs.extend(loader.load())
        elif fname.endswith(".txt"):
            loader = TextLoader(fpath, encoding="utf-8")
            docs.extend(loader.load())

    if not docs:
        return 0

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=300, chunk_overlap=50,
        separators=["\n\n", "\n", "。", "！", "？", " ", ""],
    )
    chunks = splitter.split_documents(docs)
    Chroma.from_documents(documents=chunks, embedding=emb, persist_directory=persist_dir)
    return len(chunks)
```

- [ ] **Step 4: 修改 `search(query, user_id, k, min_score)`**

```python
def search(query: str, user_id: str, k: int = 3, min_score: float = 0.40) -> list[str]:
    vs = _get_vectorstore(user_id)
    if vs is None:
        return []
    docs_with_scores = vs.similarity_search_with_relevance_scores(query, k=k)
    result = []
    for d, score in docs_with_scores:
        if score < min_score:
            continue
        page = d.metadata.get("page", "?")
        content = d.page_content[:300]
        result.append(f"[第{page+1}页, 相关度{score:.2f}] {content}")
    return result
```

- [ ] **Step 5: 修改 `get_document_list(user_id)` 和 `get_stats(user_id)`**

```python
def get_document_list(user_id: str) -> list[str]:
    docs_dir, _ = _get_user_dirs(user_id)
    if not os.path.exists(docs_dir):
        return []
    return [f for f in os.listdir(docs_dir) if f.endswith((".pdf", ".txt"))]


def get_stats(user_id: str) -> dict:
    docs = get_document_list(user_id)
    _, persist_dir = _get_user_dirs(user_id)
    db_path = os.path.join(persist_dir, "chroma.sqlite3")
    if not os.path.exists(db_path):
        return {"文档数": len(docs), "切片数": 0, "就绪": False}
    vs = _get_vectorstore(user_id)
    if vs is None:
        return {"文档数": len(docs), "切片数": 0, "就绪": False}
    return {"文档数": len(docs), "切片数": vs._collection.count(), "就绪": True}
```

- [ ] **Step 6: 修改 workflow.py/agents.py 中调用 `search()` 的地方**

在 `workflow.py` 或调用 `from rag.knowledge_base import search` 的地方，需要传入 `user_id`。由于 Chat API 不鉴权，知识库检索在聊天中暂时不支持（后续 Task 解决）。

暂时在调用处使用 `search(query, user_id="shared", k=3)` 作为向后兼容。

- [ ] **Step 7: 提交**

```bash
git add rag/knowledge_base.py
git commit -m "feat: 知识库物理隔离 — 按 user_id 分目录存储"
```

---

### Task 5: 知识库 API 添加 Token 鉴权

**Files:**
- Modify: `app/knowledge.py`

**Consumes:** `require_auth`, 知识库函数新签名（带 `user_id`）

- [ ] **Step 1: 修改 `app/knowledge.py`**

在每个路由函数添加 `user: dict = Depends(require_auth)` 并传递 `user["user_id"]`：

```python
from app.auth import require_auth
from fastapi import Depends

@router.get("/stats")
async def kb_stats(user: dict = Depends(require_auth)):
    from rag.knowledge_base import get_stats
    return JSONResponse(get_stats(user["user_id"]))

@router.post("/rebuild")
async def kb_rebuild(user: dict = Depends(require_auth)):
    from rag.knowledge_base import build_index
    n = build_index(user["user_id"])
    return JSONResponse({"success": True, "added": n})

@router.post("/upload")
async def kb_upload(file: UploadFile = File(...), user: dict = Depends(require_auth)):
    docs_dir, _ = _get_user_kb_dirs(user["user_id"])
    os.makedirs(docs_dir, exist_ok=True)
    # ... 其余上传逻辑使用 docs_dir 替代全局 doc_dir
```

需要在 `app/knowledge.py` 顶部添加辅助函数：

```python
def _get_user_kb_dirs(user_id: str):
    docs = os.path.join(_BASE, "rag", "documents", user_id)
    chroma = os.path.join(_BASE, "rag", "chroma_db", user_id)
    os.makedirs(docs, exist_ok=True)
    os.makedirs(chroma, exist_ok=True)
    return docs, chroma
```

完整的 `kb_upload`：

```python
@router.post("/upload")
async def kb_upload(file: UploadFile = File(...), user: dict = Depends(require_auth)):
    docs_dir, _ = _get_user_kb_dirs(user["user_id"])

    safe_name = os.path.basename(file.filename)
    ext = safe_name.rsplit(".", 1)[-1].lower() if "." in safe_name else ""

    if ext not in ALLOWED_EXTENSIONS:
        return JSONResponse({"success": False, "error": f"不支持的文件类型: .{ext}"}, status_code=400)

    if ext in ("png", "jpg", "jpeg"):
        try:
            from PIL import Image
            import pytesseract
            import io
            contents = await file.read()
            img = Image.open(io.BytesIO(contents))
            text = pytesseract.image_to_string(img, lang="chi_sim+eng")
            if not text.strip():
                return JSONResponse({"success": False, "error": "图片中未识别到文字"}, status_code=400)
            txt_name = safe_name.rsplit(".", 1)[0] + "_ocr.txt"
            txt_path = os.path.join(docs_dir, os.path.basename(txt_name))
            with open(txt_path, "w", encoding="utf-8") as f:
                f.write(text)
            return JSONResponse({"success": True, "filename": txt_name, "ocr": True})
        except ImportError as e:
            return JSONResponse({"success": False, "error": f"依赖未安装: {e}"}, status_code=500)
        except Exception as e:
            return JSONResponse({"success": False, "error": f"OCR 失败: {e}"}, status_code=500)
    else:
        doc_path = os.path.join(docs_dir, safe_name)
        contents = await file.read()
        with open(doc_path, "wb") as f:
            f.write(contents)
        return JSONResponse({"success": True, "filename": safe_name})


@router.delete("/{filename}")
async def kb_delete(filename: str, user: dict = Depends(require_auth)):
    docs_dir, _ = _get_user_kb_dirs(user["user_id"])
    safe_name = os.path.basename(filename)
    path = os.path.join(docs_dir, safe_name)
    if not os.path.exists(path):
        return JSONResponse({"success": False, "error": "文件不存在"}, status_code=404)
    try:
        os.remove(path)
    except OSError as e:
        return JSONResponse({"success": False, "error": f"删除失败: {e}"}, status_code=500)
    return JSONResponse({"success": True})
```

- [ ] **Step 2: 提交**

```bash
git add app/knowledge.py
git commit -m "feat: 知识库 API 添加 Token 鉴权 + 用户目录隔离"
```

---

### Task 6: 前端 — 注册/登录表单对接新 API

**Files:**
- Modify: `templates/components/sidebar.html`

- [ ] **Step 1: 修改 `submitAuth()` — 对接 `/api/auth/register` 和 `/api/auth/login`**

将现有的 email/password 逻辑替换为：

```javascript
async function submitAuth() {
    var name = document.getElementById("auth-email").value.trim();
    var password = document.getElementById("auth-password").value.trim();
    var msg = document.getElementById("auth-msg");
    if (!name || !password) { msg.textContent = "请填写完整"; return; }

    if (authMode === "register") {
        var confirm = document.getElementById("auth-confirm").value.trim();
        if (password !== confirm) { msg.textContent = "两次密码不一致"; return; }
        try {
            const resp = await fetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name, email: name, password: password }),
            });
            const data = await resp.json();
            if (data.error) { msg.textContent = data.error; return; }
            // 保存 token
            localStorage.setItem("auth_token", data.token);
            localStorage.setItem("mc_uname", data.name);
            // 迁移游客会话
            await migrateGuestSessions();
            // 更新 UI
            updateAuthUI(name);
            document.getElementById("login-modal").close();
            msg.textContent = "";
            loadSessionHistory();
        } catch(e) { msg.textContent = "注册失败"; }
    } else {
        try {
            const resp = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name, password: password }),
            });
            const data = await resp.json();
            if (data.error) { msg.textContent = data.error; return; }
            localStorage.setItem("auth_token", data.token);
            localStorage.setItem("mc_uname", data.name);
            await migrateGuestSessions();
            updateAuthUI(name);
            document.getElementById("login-modal").close();
            msg.textContent = "";
            loadSessionHistory();
        } catch(e) { msg.textContent = "登录失败"; }
    }
}
```

- [ ] **Step 2: 添加 `updateAuthUI()` 辅助函数**

```javascript
function updateAuthUI(name) {
    document.getElementById("user-display").textContent = name;
    document.getElementById("user-avatar").textContent = name.charAt(0).toUpperCase();
}
```

- [ ] **Step 3: 提取 `migrateGuestSessions()` 为独立函数**

将 `submitAuth` 中的迁移逻辑移到独立函数（保持和之前 Task 4 同样的逻辑）：

```javascript
async function migrateGuestSessions() {
    const guestSessions = typeof loadGuestSessions === 'function' ? loadGuestSessions() : [];
    if (guestSessions.length === 0) return;
    const token = localStorage.getItem("auth_token");
    if (!token) return;
    const remaining = [];
    for (const s of guestSessions) {
        try {
            await fetch("/api/sessions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + token,
                },
                body: JSON.stringify({ id: s.id, messages: s.messages, title: s.title }),
            });
        } catch (e) {
            console.warn("迁移失败:", s.id, e);
            remaining.push(s);
        }
    }
    if (remaining.length > 0) {
        if (typeof saveGuestSessions === 'function') saveGuestSessions(remaining);
    } else {
        sessionStorage.removeItem("guest_sessions");
    }
}
```

- [ ] **Step 4: 修改 `logout()` — 调用 `/api/auth/logout`**

在 `logout()` 函数中添加 API 调用：

```javascript
async function logout() {
    if (!confirm("确认退出登录？")) return;
    // 调用后端删除 token
    const token = localStorage.getItem("auth_token");
    if (token) {
        try { await fetch("/api/auth/logout", { method: "POST", headers: { "Authorization": "Bearer " + token } }); } catch(e) {}
    }
    localStorage.removeItem("auth_token");
    localStorage.removeItem("mc_uname");
    document.getElementById("user-display").textContent = "游客";
    document.getElementById("user-avatar").textContent = "游";
    document.getElementById("login-modal").close();
    // 清空聊天区
    const chatEl = document.getElementById("chat-messages");
    if (chatEl) { chatEl.innerHTML = '<div class="chat-welcome"><h2 class="chat-welcome-title">多智能体协作系统</h2><p class="chat-welcome-sub">输入任务开始对话 · 支持编程 / 写作 / 分析 / 问答 / 闲聊</p></div>'; }
    if (typeof messageHistory !== 'undefined') messageHistory = [];
    if (typeof _currentSessionId !== 'undefined') _currentSessionId = null;
    const el = document.getElementById("session-list");
    if (el) el.innerHTML = '<div class="text-xs opacity-40 text-center py-2">暂无对话记录</div>';
}
```

- [ ] **Step 5: 修改 `refreshAuthUI()` — 适配新 token**

```javascript
function refreshAuthUI() {
    var token = localStorage.getItem("auth_token");
    var uname = localStorage.getItem("mc_uname") || "";
    if (token && uname) {
        updateAuthUI(uname);
        return;
    }
    // 未登录 → 显示注册/登录表单（保持不变）
    // ...
}
```

- [ ] **Step 6: 修改页面底部恢复登录状态逻辑**

```javascript
(function() {
    var token = localStorage.getItem("auth_token");
    var uname = localStorage.getItem("mc_uname");
    if (token && uname) {
        document.getElementById("user-display").textContent = uname;
        document.getElementById("user-avatar").textContent = uname.charAt(0).toUpperCase();
    }
})();
```

- [ ] **Step 7: 提交**

```bash
git add templates/components/sidebar.html
git commit -m "feat: 注册/登录/退出对接新认证 API"
```

---

### Task 7: 前端 — chat.js 所有请求带 Token

**Files:**
- Modify: `static/js/chat.js`

- [ ] **Step 1: 添加 `getAuthHeaders()` 辅助函数**

```javascript
function getAuthHeaders() {
    const token = localStorage.getItem("auth_token");
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;
    return headers;
}
```

- [ ] **Step 2: 修改 `isGuest()`**

```javascript
function isGuest() {
    return !localStorage.getItem("auth_token");
}
```

- [ ] **Step 3: 修改 `saveCurrentSession()` — 注册用户分支带 Token**

将注册用户分支的 `fetch("/api/sessions", ...)` 添加 Authorization header：

```javascript
await fetch("/api/sessions", {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ id: sid, messages: messageHistory, title: title }),
});
```

注意：去掉请求体中的 `user_id` 字段（后端从 token 解析）。

- [ ] **Step 4: 修改 `loadSessionHistory()` — 去掉 query 参数中的 user_id**

在 sidebar.html 的注册用户分支中：

```javascript
const resp = await fetch("/api/sessions", {
    headers: { "Authorization": "Bearer " + localStorage.getItem("auth_token") }
});
```

- [ ] **Step 5: 修改 `switchSession()` 和 `deleteSession()` — 带 Token**

```javascript
// switchSession
const resp = await fetch(`/api/sessions/${sid}`, {
    headers: { "Authorization": "Bearer " + localStorage.getItem("auth_token") }
});

// deleteSession
await fetch(`/api/sessions/${sid}`, {
    method: "DELETE",
    headers: { "Authorization": "Bearer " + localStorage.getItem("auth_token") }
});
```

- [ ] **Step 6: 修改知识库相关请求**

```javascript
// loadKnowledgeStats
const resp = await fetch("/api/knowledge/stats", {
    headers: { "Authorization": "Bearer " + (localStorage.getItem("auth_token") || "") }
});
```

- [ ] **Step 7: 删除 `ensureUserId()` 和 `getUserId()`**

这两个函数不再需要，删除或标记废弃。

- [ ] **Step 8: 修改 DOMContentLoaded**

```javascript
document.addEventListener("DOMContentLoaded", async () => {
    loadKnowledgeStats();
    setupLaneMode();
    setupChatForm();
    setupKnowledgeUI();
    if (typeof loadSessionHistory === 'function') {
        loadSessionHistory();
    }
});
```

不再需要 `ensureUserId()` 调用。

- [ ] **Step 9: 提交**

```bash
git add static/js/chat.js templates/components/sidebar.html
git commit -m "feat: 前端所有请求添加 Authorization Token Header"
```

---

### Task 8: 回归测试 + 最终验证

- [ ] **Step 1: 运行现有测试**

```bash
python -m pytest tests/ -v
```
预期：全部 PASS

- [ ] **Step 2: 手动验证完整流程**

启动服务器后验证：
1. **游客**：发消息 → 刷新（对话保留在 sessionStorage）→ 知识库操作返回 401
2. **注册**：用户名 + 密码 → 获得 token → UI 更新
3. **注册用户登录**：输入密码 → 获得 token → 侧栏加载历史
4. **知识库**：上传文档 → 检索 → 仅当前用户可见
5. **退出登录**：token 清除 → 聊天区清空 → 回到游客状态
6. **游客登录迁移**：游客发几条消息 → 登录 → 会话出现在侧栏

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: 回归验证通过"
```
