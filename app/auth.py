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
