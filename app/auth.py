"""认证 API 路由 — 注册、登录、退出、获取当前用户。"""
import time
import threading
import uuid
from fastapi import APIRouter, Request, Depends, HTTPException
from fastapi.responses import JSONResponse

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

    # 先检查 Token 是否存在但已过期
    if db.is_token_expired(token):
        raise HTTPException(status_code=401, detail="令牌已过期，请重新登录")

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

    # 检查登录限流
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
    db.cleanup_user_tokens(user["id"])
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
async def auth_me(request: Request, user: dict = Depends(require_auth)):
    """获取当前用户信息（需鉴权）— 每次请求自动续期 Token 至 7 天后"""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        _get_db(request).renew_token(auth[7:])
    return JSONResponse({"user_id": user["user_id"], "user_name": user["user_name"]})
