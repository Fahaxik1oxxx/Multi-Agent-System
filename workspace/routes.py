"""
工作空间与项目管理 API 路由
"""

import json
import logging
from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse

from user.helpers import _get_db, require_auth, require_workspace_role, require_admin

logger = logging.getLogger(__name__)

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
    
    db = _get_db(request)
    pid = db.create_project(workspace_id, name, description, member["user_id"])
    
    agent_config = data.get("agent_config")
    if agent_config is not None:
        if isinstance(agent_config, str):
            try:
                parsed_cfg = json.loads(agent_config)
                if isinstance(parsed_cfg, list):
                    parsed_cfg = {"enabled_agents": parsed_cfg}
                
                if "enabled_agents" in parsed_cfg:
                    enabled = parsed_cfg["enabled_agents"]
                    valid_agents = []
                    seen = set()
                    for a in enabled:
                        if a in ALL_PIPELINE_AGENTS and a not in seen:
                            valid_agents.append(a)
                            seen.add(a)
                    parsed_cfg["enabled_agents"] = valid_agents
                agent_config_str = json.dumps(parsed_cfg, ensure_ascii=False)
            except:
                agent_config_str = agent_config
        else:
            if isinstance(agent_config, list):
                agent_config = {"enabled_agents": agent_config}
            
            if "enabled_agents" in agent_config:
                enabled = agent_config["enabled_agents"]
                valid_agents = []
                seen = set()
                for a in enabled:
                    if a in ALL_PIPELINE_AGENTS and a not in seen:
                        valid_agents.append(a)
                        seen.add(a)
                agent_config["enabled_agents"] = valid_agents
            agent_config_str = json.dumps(agent_config, ensure_ascii=False)
            
        db.update_project(pid, agent_config=agent_config_str)
            
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
    if role != "owner" and proj.get("created_by") != user["user_id"] and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权删除"}, status_code=403)
    db.delete_project(project_id)
    return JSONResponse({"status": "ok"})


ALL_PIPELINE_AGENTS = {"Planner", "Retriever", "Coder", "Writer", "Executor", "Tester", "Summarizer", "Bot"}


@project_router.get("/projects/{project_id}/agent-config")
async def get_agent_config(
    request: Request,
    project_id: str,
    user: dict = Depends(require_auth),
):
    db = _get_db(request)
    proj = db.get_project(project_id)
    if not proj:
        return JSONResponse({"error": "项目不存在"}, status_code=404)
    role = db.get_member_role(proj["workspace_id"], user["user_id"])
    if role is None and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权访问"}, status_code=403)
    
    agent_config_str = proj.get("agent_config", "{}")
    try:
        config = json.loads(agent_config_str)
        if isinstance(config, list):
            config = {"enabled_agents": config}
    except:
        config = {}
        
    enabled_agents = config.get("enabled_agents", list(ALL_PIPELINE_AGENTS))
    disabled_agents = [a for a in ALL_PIPELINE_AGENTS if a not in enabled_agents]

    saved_pipeline = config.get("pipeline", {})
    logger.info(
        "agent-config | loaded | project=%s | user=%s | enabled_agents=%s | has_pipeline=%s",
        project_id, user["user_id"], enabled_agents,
        "yes" if saved_pipeline else "no",
    )

    return JSONResponse({
        "pipeline": config.get("pipeline", {}),
        "enabled_agents": enabled_agents,
        "disabled_agents": disabled_agents,
        "prompts": config.get("prompts", {}),
    })


@project_router.put("/projects/{project_id}/agent-config")
async def update_agent_config(
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
        return JSONResponse({"error": "无权修改"}, status_code=403)
        
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON format"}, status_code=422)
    
    agent_config_str = proj.get("agent_config", "{}")
    try:
        config = json.loads(agent_config_str)
        if isinstance(config, list):
            config = {"enabled_agents": config}
    except:
        config = {}

    if not any(k in data for k in ("enabled_agents", "pipeline", "prompts")):
        return JSONResponse({"error": "缺少 enabled_agents、pipeline 或 prompts 字段"}, status_code=422)

    if "enabled_agents" in data:
        enabled = data["enabled_agents"]
        if not isinstance(enabled, list):
            return JSONResponse({"error": "enabled_agents must be a list"}, status_code=422)
            
        valid_agents = []
        seen = set()
        for a in enabled:
            if a not in ALL_PIPELINE_AGENTS:
                return JSONResponse({"error": f"无效的 agent: {a}"}, status_code=422)
            if a not in seen:
                valid_agents.append(a)
                seen.add(a)
                
        config["enabled_agents"] = valid_agents

    if "pipeline" in data:
        pipeline = data["pipeline"]
        if not isinstance(pipeline, dict) or "nodes" not in pipeline:
            return JSONResponse({"error": "Invalid pipeline format"}, status_code=422)
            
        config["pipeline"] = pipeline
        
        agent_nodes = [n.get("data", {}).get("agent") for n in pipeline.get("nodes", []) if n.get("type") == "agent"]
        enabled = [a for a in agent_nodes if a in ALL_PIPELINE_AGENTS]
        
        valid_agents = []
        seen = set()
        for a in enabled:
            if a not in seen:
                valid_agents.append(a)
                seen.add(a)
        config["enabled_agents"] = valid_agents

    if "prompts" in data:
        prompts = data["prompts"]
        if not isinstance(prompts, dict):
            return JSONResponse({"error": "prompts must be a dict"}, status_code=422)
        config["prompts"] = prompts

    saved_pipeline = config.get("pipeline", {})
    pipeline_nodes = len(saved_pipeline.get("nodes", [])) if saved_pipeline else 0
    pipeline_edges = len(saved_pipeline.get("edges", [])) if saved_pipeline else 0
    prompts_count = len(config.get("prompts", {}))
    logger.info(
        "agent-config | saved | project=%s | user=%s | enabled_agents=%s | has_pipeline=%s | pipeline_nodes=%d | pipeline_edges=%d | prompts=%d",
        project_id, user["user_id"], config.get("enabled_agents", []),
        "yes" if saved_pipeline else "no", pipeline_nodes, pipeline_edges,
        prompts_count,
    )

    db.update_project(project_id, agent_config=json.dumps(config, ensure_ascii=False))
    return JSONResponse({
        "status": "ok",
        "enabled_agents": config.get("enabled_agents", []),
        "disabled_agents": [a for a in ALL_PIPELINE_AGENTS if a not in config.get("enabled_agents", [])]
    })


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


# ──── 评估日志 ────


@project_router.post("/eval/log")
async def log_eval(request: Request, user: dict = Depends(require_auth)):
    data = await request.json()
    db = _get_db(request)
    project_id = data.get("project_id", "")
    if project_id:
        proj = db.get_project(project_id)
        if proj:
            role = db.get_member_role(proj["workspace_id"], user["user_id"])
            if role is None and not db.is_admin(user["user_id"]):
                return JSONResponse({"error": "无权访问"}, status_code=403)
    eid = db.create_eval_log(
        project_id=project_id,
        session_id=data.get("session_id", ""),
        task_type=data.get("task_type", ""),
        complexity=data.get("complexity", ""),
        agent_count=data.get("agent_count", 0),
        total_tokens=data.get("total_tokens", 0),
        elapsed_ms=data.get("elapsed_ms", 0),
        has_error=1 if data.get("has_error") else 0,
    )
    return JSONResponse({"id": eid, "status": "ok"})


@project_router.get("/eval/stats/{project_id}")
async def get_eval_stats(request: Request, project_id: str, user: dict = Depends(require_auth)):
    db = _get_db(request)
    proj = db.get_project(project_id)
    if not proj:
        return JSONResponse({"error": "项目不存在"}, status_code=404)
    role = db.get_member_role(proj["workspace_id"], user["user_id"])
    if role is None and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权访问"}, status_code=403)
    stats = db.get_eval_stats(project_id)
    return JSONResponse(stats)
