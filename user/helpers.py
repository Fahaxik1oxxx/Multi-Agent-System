"""
请求辅助：require_auth、_get_db。
"""

from fastapi import Request, HTTPException
from user.auth import decode_jwt
from user.db import Database


def _get_db(request: Request) -> Database:
    return request.app.state.db


async def require_auth(request: Request) -> dict:
    """FastAPI 依赖：从 Authorization Header 解析 JWT，失败抛出 401。
    返回 {"user_id": str, "user_name": str}"""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未提供认证令牌")
    payload = decode_jwt(auth[7:])
    if payload is None:
        raise HTTPException(status_code=401, detail="令牌无效或已过期")
    user = _get_db(request).get_user_by_id(payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    return {"user_id": user["id"], "user_name": user["name"]}
