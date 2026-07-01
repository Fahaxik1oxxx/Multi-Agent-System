"""
模板市场 API 路由 —— 公开浏览 / 复制公共配置。
"""

from fastapi import APIRouter, Request, Depends, Query
from fastapi.responses import JSONResponse

from user.helpers import require_auth, _get_db

router = APIRouter()


# ──── 公开列表 ────


@router.get("/market")
async def list_market(
    request: Request,
    search: str = Query(default="", description="按名称搜索"),
    limit: int = Query(default=50, ge=1, le=200, description="每页数量"),
    offset: int = Query(default=0, ge=0, description="偏移量"),
):
    """公开浏览模板市场 —— 无需认证。"""
    db = _get_db(request)
    rows = db.list_public_configs(search=search, limit=limit, offset=offset)
    items = []
    for cfg in rows:
        items.append({
            "id": cfg.get("id"),
            "name": cfg.get("name"),
            "agents": cfg.get("agents", []),
            "project_id": cfg.get("project_id"),
            "pipeline": cfg.get("pipeline", {}),
            "user_id": cfg.get("user_id", ""),
            "author_name": db.get_user_name(cfg.get("user_id", "")),
            "created_at": cfg.get("created_at"),
            "updated_at": cfg.get("updated_at"),
        })
    return JSONResponse(items)


# ──── 公开详情 ────


@router.get("/market/{config_id}")
async def get_market_config(request: Request, config_id: str):
    """公开查看单个模板详情 —— 无需认证。"""
    db = _get_db(request)
    cfg = db.get_config(config_id)
    if not cfg:
        return JSONResponse({"error": "配置不存在"}, status_code=404)
    if not cfg.get("is_public"):
        return JSONResponse({"error": "配置未公开"}, status_code=404)

    return JSONResponse({
        "id": cfg.get("id"),
        "name": cfg.get("name"),
        "agents": cfg.get("agents", []),
        "project_id": cfg.get("project_id"),
        "pipeline": cfg.get("pipeline", {}),
        "prompts": cfg.get("prompts", {}),
        "author_name": db.get_user_name(cfg.get("user_id", "")),
        "created_at": cfg.get("created_at"),
        "updated_at": cfg.get("updated_at"),
    })


# ──── 复制 ────


@router.post("/market/{config_id}/copy")
async def copy_market_config(request: Request, config_id: str, user: dict = Depends(require_auth)):
    """将公共配置复制到当前用户的已保存配置 —— 需要认证。"""
    db = _get_db(request)
    cfg = db.get_config(config_id)
    if not cfg:
        return JSONResponse({"error": "配置不存在"}, status_code=404)
    if not cfg.get("is_public"):
        return JSONResponse({"error": "只能复制公开配置"}, status_code=400)

    original_name = cfg.get("name", "未命名")
    copy_name = f"{original_name} (副本)"

    cid = db.create_config(
        user["user_id"],
        copy_name,
        cfg.get("agents", []),
        project_id=cfg.get("project_id"),
        pipeline=cfg.get("pipeline"),
        prompts=cfg.get("prompts"),
    )
    return JSONResponse({"id": cid, "name": copy_name})
