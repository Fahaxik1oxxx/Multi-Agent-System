# 安全增强 v3.4 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Docker 沙箱隔离 AI 代码执行 + 登录限流防暴力破解 + Token 7 天过期自动续期。

**Architecture:** 三个独立模块：executor.py 用 `docker run` 替代宿主 `subprocess`；app/auth.py 新增内存 `LoginRateLimiter`；db.py 加 `expires_at` 列 + 续期/清理方法，require_auth 加过期检查。

**Tech Stack:** Docker, Python subprocess, threading.Lock, SQLite datetime

## Global Constraints

- Chat API 不鉴权（游客可用）
- 游客模式行为不变
- 代码执行超时从 60s 改为 30s（Docker）
- Token 过期 7 天，`/api/auth/me` 自动续期
- 限流：5 次/15 分钟，按 IP

---

### Task 1: Docker 代码执行沙箱

**Files:**
- Modify: `executor.py`

**Interfaces:**
- Produces: `CodeExecutor.execute(code) -> dict` 方法签名不变

- [ ] **Step 1: 重写 `executor.py`**

```python
"""
安全代码执行沙箱 —— Docker 容器隔离。
Docker 不可用时降级为 subprocess。
"""

import subprocess
import uuid
import os
import logging

_PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.join(_PROJECT_DIR, "coding")


def _docker_available() -> bool:
    """检测 Docker 是否可用"""
    try:
        subprocess.run(["docker", "--version"], capture_output=True, timeout=5)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


DOCKER_OK = _docker_available()


class CodeExecutor:
    """代码执行沙箱 — 优先 Docker，降级 subprocess"""

    TIMEOUT = 30

    def execute(self, code: str) -> dict:
        if DOCKER_OK:
            return self._docker_exec(code)
        logging.warning("Docker 不可用，降级为 subprocess 执行（不安全）")
        return self._subprocess_exec(code)

    def _docker_exec(self, code: str) -> dict:
        os.makedirs(WORKSPACE, exist_ok=True)
        file_id = str(uuid.uuid4())[:8]
        filepath = os.path.join(WORKSPACE, f"tmp_{file_id}.py")
        container_name = f"sandbox_{file_id}"

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(code)

        try:
            result = subprocess.run([
                "docker", "run", "--rm",
                "--name", container_name,
                "--network", "none",
                "--memory", "256m",
                "--cpus", "0.5",
                "--read-only",
                "--tmpfs", "/tmp:exec",
                "-v", f"{os.path.abspath(filepath)}:/code.py:ro",
                "python:3.11-slim",
                "python", "/code.py",
            ], capture_output=True, text=True, timeout=self.TIMEOUT)
            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "exitcode": result.returncode,
            }
        except subprocess.TimeoutExpired:
            subprocess.run(["docker", "kill", container_name], capture_output=True)
            return {"stdout": "", "stderr": f"执行超时 (>{self.TIMEOUT}s)", "exitcode": 1}
        finally:
            if os.path.exists(filepath):
                os.remove(filepath)

    def _subprocess_exec(self, code: str) -> dict:
        os.makedirs(WORKSPACE, exist_ok=True)
        file_id = str(uuid.uuid4())[:8]
        filepath = os.path.join(WORKSPACE, f"tmp_{file_id}.py")

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(code)

        try:
            result = subprocess.run(
                ["python", filepath],
                capture_output=True, text=True,
                timeout=self.TIMEOUT, cwd=WORKSPACE,
            )
            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "exitcode": result.returncode,
            }
        except subprocess.TimeoutExpired:
            return {"stdout": "", "stderr": f"执行超时 (>{self.TIMEOUT}s)", "exitcode": 1}
        finally:
            if os.path.exists(filepath):
                os.remove(filepath)
```

- [ ] **Step 2: 提交**

```bash
git add executor.py
git commit -m "feat: AI 代码 Docker 容器沙箱隔离 — 降级兼容 subprocess"
```

---

### Task 2: 登录限流器

**Files:**
- Modify: `app/auth.py`

**Consumes:** `Database` from `db.py`
**Produces:** `LoginRateLimiter` 类

- [ ] **Step 1: 在 `app/auth.py` 中添加 `LoginRateLimiter`**

```python
import time
import threading

class LoginRateLimiter:
    """内存登录限流器 — 5 次失败锁 15 分钟"""
    MAX_ATTEMPTS = 5
    LOCK_MINUTES = 15

    def __init__(self):
        self._records: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._last_cleanup = time.time()

    def _get_key(self, request: Request) -> str:
        forwarded = request.headers.get("X-Forwarded-For", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def check(self, request: Request) -> int | None:
        """返回 None=允许，返回秒数=需等待"""
        self._maybe_cleanup()
        key = self._get_key(request)
        with self._lock:
            record = self._records.get(key)
            if record and record.get("locked_until"):
                remaining = int(record["locked_until"] - time.time())
                if remaining > 0:
                    return remaining
                del self._records[key]
        return None

    def record_failure(self, request: Request):
        key = self._get_key(request)
        with self._lock:
            r = self._records.get(key, {"failures": 0, "locked_until": 0})
            r["failures"] += 1
            if r["failures"] >= self.MAX_ATTEMPTS:
                r["locked_until"] = time.time() + self.LOCK_MINUTES * 60
            self._records[key] = r

    def clear(self, request: Request):
        key = self._get_key(request)
        with self._lock:
            self._records.pop(key, None)

    def _maybe_cleanup(self):
        now = time.time()
        if now - self._last_cleanup > 3600:
            with self._lock:
                expired = [k for k, v in self._records.items()
                           if v.get("locked_until", 0) > 0 and v["locked_until"] < now]
                for k in expired:
                    del self._records[k]
                self._last_cleanup = now


_limiter = LoginRateLimiter()
```

- [ ] **Step 2: 修改 `auth_login` 集成限流**

在现有 `auth_login` 的 `if not name or not password:` 校验之后添加：

```python
    # 检查登录限流
    wait = _limiter.check(request)
    if wait is not None:
        return JSONResponse(
            {"error": f"尝试次数过多，请 {wait // 60} 分 {wait % 60} 秒后重试"},
            status_code=429,
        )
```

在 `db.authenticate` 失败时添加 `_limiter.record_failure(request)`：

```python
    user = db.authenticate(name, password)
    if not user:
        _limiter.record_failure(request)
        return JSONResponse({"error": "用户名或密码错误"}, status_code=401)
```

在成功返回前添加 `_limiter.clear(request)`：

```python
    _limiter.clear(request)
    return JSONResponse({"token": user["token"], "user_id": user["id"], "name": user["name"]})
```

- [ ] **Step 3: 提交**

```bash
git add app/auth.py
git commit -m "feat: 登录限流 — 5 次失败锁定 15 分钟"
```

---

### Task 3: Token 过期 — 数据库层

**Files:**
- Modify: `db.py`

**Produces:** `create_token` 加 `expires_at`，新增 `renew_token`、`cleanup_user_tokens`、`is_token_expired`

- [ ] **Step 1: 更新 `_init_db` 中 `auth_tokens` 建表语句**

```sql
CREATE TABLE IF NOT EXISTS auth_tokens (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    expires_at TEXT NOT NULL DEFAULT (datetime('now', '+7 days', 'localtime')),
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

- [ ] **Step 2: 修改 `create_token` — 写入 `expires_at`**

```python
def create_token(self, user_id: str, _conn=None) -> str:
    token = str(uuid.uuid4())
    sql = ("INSERT INTO auth_tokens (token, user_id, expires_at) "
           "VALUES (?, ?, datetime('now', '+7 days', 'localtime'))")
    if _conn is not None:
        _conn.execute(sql, (token, user_id))
    else:
        with self._conn() as conn:
            conn.execute(sql, (token, user_id))
    return token
```

- [ ] **Step 3: 修改 `get_user_by_token` — 加过期过滤**

```python
def get_user_by_token(self, token: str) -> dict | None:
    with self._conn() as conn:
        row = conn.execute(
            "SELECT u.id, u.name FROM users u "
            "JOIN auth_tokens t ON u.id = t.user_id "
            "WHERE t.token = ? AND t.expires_at > datetime('now', 'localtime')",
            (token,)
        ).fetchone()
        if not row:
            return None
        return {"id": row["id"], "name": row["name"]}
```

- [ ] **Step 4: 新增三个方法**

```python
def renew_token(self, token: str) -> bool:
    """续期 Token 到 7 天后"""
    with self._conn() as conn:
        cur = conn.execute(
            "UPDATE auth_tokens SET expires_at = datetime('now', '+7 days', 'localtime') "
            "WHERE token = ?", (token,)
        )
        return cur.rowcount > 0

def cleanup_user_tokens(self, user_id: str):
    """清理指定用户的所有过期 Token"""
    with self._conn() as conn:
        conn.execute(
            "DELETE FROM auth_tokens WHERE user_id = ? "
            "AND expires_at < datetime('now', 'localtime')",
            (user_id,)
        )

def is_token_expired(self, token: str) -> bool:
    """检查 Token 是否存在且已过期（不存在返回 False）"""
    with self._conn() as conn:
        row = conn.execute(
            "SELECT expires_at FROM auth_tokens WHERE token = ?", (token,)
        ).fetchone()
        if not row:
            return False
        from datetime import datetime
        try:
            expiry = datetime.fromisoformat(row["expires_at"])
        except (ValueError, TypeError):
            return True
        return expiry < datetime.now()
```

- [ ] **Step 5: 提交**

```bash
git add db.py
git commit -m "feat: Token 过期机制 — auth_tokens 加 expires_at + 续期/清理方法"
```

---

### Task 4: Token 过期 — 认证层集成

**Files:**
- Modify: `app/auth.py`

**Consumes:** `db.renew_token`, `db.cleanup_user_tokens`, `db.is_token_expired`

- [ ] **Step 1: 修改 `require_auth` — 区分"无效"和"已过期"**

```python
def require_auth(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未提供认证令牌")
    token = auth[7:]
    db = _get_db(request)

    # 先检查 Token 是否存在但已过期
    expired = db.is_token_expired(token)
    if expired:
        raise HTTPException(status_code=401, detail="令牌已过期，请重新登录")

    user = db.get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="令牌无效或已过期")
    return {"user_id": user["id"], "user_name": user["name"]}
```

- [ ] **Step 2: 修改 `auth_me` — 添加自动续期**

在 `auth_me` 函数中从 Header 提取 token 并续期：

```python
@router.get("/me")
async def auth_me(request: Request, user: dict = Depends(require_auth)):
    # 自动续期
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        _get_db(request).renew_token(auth[7:])
    return JSONResponse({"user_id": user["user_id"], "user_name": user["user_name"]})
```

- [ ] **Step 3: 修改 `auth_login` — 成功后清理过期 Token**

在 `auth_login` 成功返回前添加：

```python
    _limiter.clear(request)
    db.cleanup_user_tokens(user["id"])
    return JSONResponse({"token": user["token"], "user_id": user["id"], "name": user["name"]})
```

- [ ] **Step 4: 提交**

```bash
git add app/auth.py
git commit -m "feat: Token 过期检查 + /api/auth/me 自动续期 + 登录时清理过期 Token"
```

---

### Task 5: 前端适配 — 429 + 401 处理

**Files:**
- Modify: `templates/components/sidebar.html` — `submitAuth()`

- [ ] **Step 1: 修改 `submitAuth` 的登录错误处理**

在登录分支的 `resp.json()` 之后，区分 429 和 401：

```javascript
    } else {
        try {
            const resp = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name, password: password }),
            });
            const data = await resp.json();
            if (resp.status === 429) {
                msg.textContent = data.error; // "请 X 分 Y 秒后重试"
                return;
            }
            if (data.error) { msg.textContent = data.error; return; }
            // 登录成功...
```

- [ ] **Step 2: 修改 `logout` — 静默忽略过期 Token**

logout 中的 `/api/auth/logout` 调用已经是 try/catch，无需改动。但需要确保 401 时不弹错误：

```javascript
    // 调用后端删除 token（已过期时可能返回 401，忽略）
    const token = localStorage.getItem("auth_token");
    if (token) {
        try {
            await fetch("/api/auth/logout", {
                method: "POST",
                headers: { "Authorization": "Bearer " + token }
            });
        } catch(e) {}
    }
```

当前 logout 已有 try/catch，无需改动。

- [ ] **Step 3: 提交**

```bash
git add templates/components/sidebar.html
git commit -m "feat: 前端适配 429 限流提示 + Token 过期处理"
```

---

### Task 6: 测试 + 最终验证

- [ ] **Step 1: 运行现有测试**

```bash
python -m pytest tests/ -v
```
预期：全部 PASS

- [ ] **Step 2: 手动验证**

| 场景 | 验证方法 | 预期结果 |
|------|----------|----------|
| Docker 沙箱 | 发送"写一个打印 hello 的代码" | 代码在 Docker 容器执行，exitcode=0 |
| Docker 不可用 | `export DOCKER_OK=false` | 降级 subprocess + 警告 |
| 登录限流 | 连续 6 次错误密码 | 第 6 次返回 429 + 等待时间 |
| 锁定后正确登录 | 等 15 分钟或用正确密码 | 清除计数，正常登录 |
| Token 过期 | 改数据库 expires_at 为过去 | 请求返回 401 "令牌已过期" |
| Token 续期 | 调用 /api/auth/me | expires_at 更新为 7 天后 |

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: 安全增强 v3.4 回归验证"
```
