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


async def require_admin(request: Request) -> dict:
    """FastAPI 依赖：要求管理员权限。先走 require_auth 再检查 is_admin。"""
    user = await require_auth(request)
    db = _get_db(request)
    if not db.is_admin(user["user_id"]):
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return {**user, "is_admin": True}


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
