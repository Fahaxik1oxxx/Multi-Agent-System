"""
配置管理 API 路由 —— 保存/加载 Agent 编排配置。
所有业务校验集中在此层。
"""

import json
import datetime
from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse, Response

from user.helpers import require_auth, _get_db

router = APIRouter()


# ──── CRUD ────


@router.post("/configs")
async def create_config(request: Request, user: dict = Depends(require_auth)):
    data = await request.json()
    name = (data.get("name") or "").strip()
    agents = data.get("agents") or []
    project_id = (data.get("project_id") or "").strip()
    pipeline = data.get("pipeline")
    prompts = data.get("prompts")

    if not name:
        return JSONResponse({"error": "配置名称不能为空"}, status_code=400)
    if not agents or not isinstance(agents, list) or len(agents) == 0:
        return JSONResponse({"error": "必须至少选择一个 Agent"}, status_code=400)

    db = _get_db(request)
    cid = db.create_config(
        user["user_id"], name, agents,
        project_id=project_id, pipeline=pipeline, prompts=prompts,
    )
    return JSONResponse({"id": cid, "name": name})


@router.get("/configs")
async def list_configs(
    request: Request,
    project_id: str = "",
    user: dict = Depends(require_auth),
):
    db = _get_db(request)
    rows = db.list_configs(user["user_id"], project_id=project_id if project_id else "")
    return JSONResponse(rows)


@router.get("/configs/{config_id}")
async def get_config(request: Request, config_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    cfg = db.get_config(config_id)
    if not cfg:
        return JSONResponse({"error": "配置不存在"}, status_code=404)
    if cfg.get("user_id") != user["user_id"]:
        return JSONResponse({"error": "无权访问"}, status_code=403)
    return JSONResponse(cfg)


@router.put("/configs/{config_id}")
async def update_config(request: Request, config_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    cfg = db.get_config(config_id)
    if not cfg:
        return JSONResponse({"error": "配置不存在"}, status_code=404)
    if cfg.get("user_id") != user["user_id"]:
        return JSONResponse({"error": "无权访问"}, status_code=403)

    data = await request.json()
    fields = {}
    for key in ("name", "agents", "pipeline", "prompts"):
        if key in data and data[key] is not None:
            fields[key] = data[key]
    if not fields:
        return JSONResponse({"error": "没有可更新的字段"}, status_code=400)

    db.update_config(config_id, **fields)
    return JSONResponse({"status": "ok"})


@router.delete("/configs/{config_id}")
async def delete_config(request: Request, config_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    cfg = db.get_config(config_id)
    if not cfg:
        return JSONResponse({"error": "配置不存在"}, status_code=404)
    if cfg.get("user_id") != user["user_id"]:
        return JSONResponse({"error": "无权访问"}, status_code=403)

    db.delete_config(config_id)
    db.create_audit_log("config_delete", user_id=user["user_id"],
                        detail={"config_id": config_id, "config_name": cfg.get("name", "")},
                        ip=request.client.host if request.client else "")
    return JSONResponse({"status": "ok"})


# ──── 发布控制 ────


@router.post("/configs/{config_id}/publish")
async def publish_config(request: Request, config_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    cfg = db.get_config(config_id)
    if not cfg:
        return JSONResponse({"error": "配置不存在"}, status_code=404)
    if cfg.get("user_id") != user["user_id"]:
        return JSONResponse({"error": "无权访问"}, status_code=403)

    db.update_config(config_id, is_public=1)
    db.create_audit_log("config_publish", user_id=user["user_id"],
                        detail={"config_id": config_id, "config_name": cfg.get("name", "")},
                        ip=request.client.host if request.client else "")
    return JSONResponse({"status": "ok"})


@router.post("/configs/{config_id}/unpublish")
async def unpublish_config(request: Request, config_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    cfg = db.get_config(config_id)
    if not cfg:
        return JSONResponse({"error": "配置不存在"}, status_code=404)
    if cfg.get("user_id") != user["user_id"]:
        return JSONResponse({"error": "无权访问"}, status_code=403)

    db.update_config(config_id, is_public=0)
    db.create_audit_log("config_unpublish", user_id=user["user_id"],
                        detail={"config_id": config_id, "config_name": cfg.get("name", "")},
                        ip=request.client.host if request.client else "")
    return JSONResponse({"status": "ok"})


# ──── 导出 ────


@router.get("/configs/{config_id}/export")
async def export_config(request: Request, config_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    cfg = db.get_config(config_id)
    if not cfg:
        return JSONResponse({"error": "配置不存在"}, status_code=404)
    if cfg.get("user_id") != user["user_id"]:
        return JSONResponse({"error": "无权访问"}, status_code=403)

    export_data = {
        "name": cfg.get("name", ""),
        "agents": cfg.get("agents", []),
        "pipeline": cfg.get("pipeline", {}),
        "prompts": cfg.get("prompts", {}),
        "exported_at": datetime.datetime.utcnow().isoformat() + "Z",
        "source": "Multi-Agent System v3.6",
    }
    filename = f"config-{config_id[:8]}.json"
    return Response(
        content=json.dumps(export_data, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
