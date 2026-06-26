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
