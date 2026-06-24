# 安全增强 v3.4 设计方案

## 目标

三项安全加固：AI 代码 Docker 沙箱隔离、登录限流防暴力破解、Token 7 天过期 + 自动续期。

---

## 一、代码执行 Docker 沙箱

### 改动：`executor.py`

将 `subprocess.run(["python", filepath])` 替换为 Docker 容器执行：

```python
def execute(self, code: str) -> dict:
    file_id = str(uuid.uuid4())[:8]
    filepath = os.path.join(WORKSPACE, f"tmp_{file_id}.py")

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(code)

    container_name = f"sandbox_{file_id}"
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
        ], capture_output=True, text=True, timeout=30)
        return {"stdout": result.stdout, "stderr": result.stderr, "exitcode": result.returncode}
    except subprocess.TimeoutExpired:
        # 超时时强制停止容器
        subprocess.run(["docker", "kill", container_name], capture_output=True)
        return {"stdout": "", "stderr": "执行超时 (>30s)", "exitcode": 1}
    finally:
        if os.path.exists(filepath):
            os.remove(filepath)
```

### 安全隔离说明

| 防护层 | 实现 |
|--------|------|
| 网络隔离 | `--network none`，代码无法访问网络 |
| 资源限制 | `--memory 256m`，`--cpus 0.5`，防挖矿/资源耗尽 |
| 文件系统 | `--read-only` + `/code.py:ro`，仅 `/tmp` 可写（tmpfs） |
| 自动销毁 | `--rm`，执行完立即删除容器 |
| 超时防护 | 30s 超时 → `docker kill` 强制终止 |

### Docker 不可用时的降级策略

检测 `docker --version` 不可用时，退回原始 `subprocess.run` 方式并打印警告。

---

## 二、登录限流

### 改动：`app/auth.py`

新增 `LoginRateLimiter` 类：

```python
import time
import threading

class LoginRateLimiter:
    """内存登录限流器"""
    MAX_ATTEMPTS = 5
    LOCK_MINUTES = 15
    CLEANUP_INTERVAL = 3600  # 每小时清理过期记录

    def __init__(self):
        self._records: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._last_cleanup = time.time()

    def _get_key(self, request: Request) -> str:
        """以客户端 IP 为限流 key"""
        forwarded = request.headers.get("X-Forwarded-For", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def check(self, request: Request) -> int | None:
        """
        检查是否允许尝试。返回 None 表示允许，
        返回秒数表示还需等待的秒数。
        """
        self._maybe_cleanup()
        key = self._get_key(request)
        with self._lock:
            record = self._records.get(key)
            if record and record.get("locked_until"):
                remaining = record["locked_until"] - time.time()
                if remaining > 0:
                    return int(remaining)
                del self._records[key]
        return None

    def record_failure(self, request: Request):
        """记录一次失败尝试"""
        key = self._get_key(request)
        with self._lock:
            record = self._records.get(key, {"failures": 0, "locked_until": 0})
            record["failures"] += 1
            if record["failures"] >= self.MAX_ATTEMPTS:
                record["locked_until"] = time.time() + self.LOCK_MINUTES * 60
            self._records[key] = record

    def clear(self, request: Request):
        """登录成功，清除记录"""
        key = self._get_key(request)
        with self._lock:
            self._records.pop(key, None)

    def _maybe_cleanup(self):
        if time.time() - self._last_cleanup > self.CLEANUP_INTERVAL:
            with self._lock:
                now = time.time()
                expired = [k for k, v in self._records.items()
                           if v.get("locked_until", 0) > 0 and v["locked_until"] < now]
                for k in expired:
                    del self._records[k]
                self._last_cleanup = now

# 模块级单例
_limiter = LoginRateLimiter()
```

### `auth_login` 集成

```python
@router.post("/login")
async def auth_login(request: Request):
    data = await request.json()
    name = data.get("name", "").strip()
    password = data.get("password", "").strip()

    if not name or not password:
        return JSONResponse({"error": "用户名和密码不能为空"}, status_code=400)

    # 检查是否被锁定
    wait = _limiter.check(request)
    if wait is not None:
        return JSONResponse(
            {"error": f"尝试次数过多，请 {wait // 60} 分 {wait % 60} 秒后重试"},
            status_code=429,
        )

    db = _get_db(request)
    user = db.authenticate(name, password)
    if not user:
        _limiter.record_failure(request)
        return JSONResponse({"error": "用户名或密码错误"}, status_code=401)

    _limiter.clear(request)
    return JSONResponse({"token": user["token"], "user_id": user["id"], "name": user["name"]})
```

---

## 三、Token 过期 + 自动续期

### 数据库改动：`db.py`

`auth_tokens` 表加 `expires_at` 列：

```sql
CREATE TABLE IF NOT EXISTS auth_tokens (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    expires_at TEXT NOT NULL DEFAULT (datetime('now', '+7 days', 'localtime')),
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### `create_token` 改动

```python
def create_token(self, user_id: str, _conn=None) -> str:
    token = str(uuid.uuid4())
    if _conn is not None:
        _conn.execute(
            "INSERT INTO auth_tokens (token, user_id, expires_at) "
            "VALUES (?, ?, datetime('now', '+7 days', 'localtime'))",
            (token, user_id),
        )
    else:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO auth_tokens (token, user_id, expires_at) "
                "VALUES (?, ?, datetime('now', '+7 days', 'localtime'))",
                (token, user_id),
            )
    return token
```

### 新增方法

```python
def renew_token(self, token: str) -> bool:
    """续期 Token 到 7 天后，返回是否成功"""
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
```

### `get_user_by_token` — 加过期检查

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

### `require_auth` 改动：过期 Token 返回特定 401

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

### `is_token_expired` 方法

```python
def is_token_expired(self, token: str) -> bool:
    """检查 Token 是否存在且已过期"""
    with self._conn() as conn:
        row = conn.execute(
            "SELECT expires_at FROM auth_tokens WHERE token = ?", (token,)
        ).fetchone()
        if not row:
            return False  # 不存在，由调用方返回"无效"
        from datetime import datetime
        return datetime.fromisoformat(row["expires_at"]) < datetime.now()
```

### `/api/auth/me` 自动续期

```python
@router.get("/me")
async def auth_me(user: dict = Depends(require_auth), request: Request = None):
    db = _get_db(request)
    # 从 Header 提取 token 并续期
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        db.renew_token(auth[7:])
    return JSONResponse({"user_id": user["user_id"], "user_name": user["user_name"]})
```

### 登录时清理过期 Token

`auth_login` 成功后调用 `db.cleanup_user_tokens(user["id"])`。

---

## 前端改动（最小化）

- 登录失败返回 429 时，`submitAuth()` 显示具体等待时间
- 401 "令牌已过期" 时，清除 `auth_token`，提示重新登录

---

## 不变项

- Chat API、Report API 不要求鉴权
- 游客模式行为不变
- 知识库隔离方案不变

## 不涉及

- Docker 镜像预热/缓存优化
- 分布式限流（Redis）
- OAuth / 两步验证
