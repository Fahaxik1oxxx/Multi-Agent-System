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


@org_router.post("/{org_id}/leave")
async def leave_org(request: Request, org_id: str, user: dict = Depends(require_auth)):
    """当前用户退出组织（Owner 不可退出，请先转让或删除组织）"""
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None:
        return JSONResponse({"error": "你不在该组织中"}, status_code=404)
    if role == "owner":
        return JSONResponse({"error": "组织创建者不能退出，请先转让所有权或删除组织"}, status_code=400)
    db.remove_org_member(org_id, user["user_id"])
    return JSONResponse({"status": "ok"})
