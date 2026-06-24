"""
多智能体协作系统 — FastAPI Web 入口
运行：uvicorn main:app --reload --port 8501
"""

import os
import sys

_PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
if _PROJECT_DIR not in sys.path:
    sys.path.insert(0, _PROJECT_DIR)

# 加载 .env 文件（优先级高于系统环境变量）
from dotenv import load_dotenv
load_dotenv(os.path.join(_PROJECT_DIR, ".env"), override=True)

os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
os.environ["NO_PROXY"] = "localhost,127.0.0.1"
os.environ["no_proxy"] = "localhost,127.0.0.1"
os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["PYTHONUTF8"] = "1"

import logging
logging.getLogger().handlers.clear()

import warnings
warnings.filterwarnings("ignore", category=UserWarning)

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Depends
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

import config as _cfg
from db import Database

try:
    get_model_display = _cfg.get_model_display
    ROLE_MODEL = _cfg.ROLE_MODEL
except AttributeError:
    ROLE_MODEL = {k: "?" for k in [
        "Planner", "Retriever", "Coder", "Writer",
        "Tester", "Summarizer", "Bot",
    ]}

    def get_model_display(role):
        return "?"

# ──── FastAPI 应用 ────
@asynccontextmanager
async def lifespan(a: FastAPI):
    """启动时初始化数据库，关闭时清理连接"""
    a.state.db = Database(os.path.join(_PROJECT_DIR, "data.db"))
    yield

app = FastAPI(title="多智能体协作系统", version="3.1", lifespan=lifespan)

# ──── 静态文件 & 模板 ────
app.mount("/static", StaticFiles(directory=os.path.join(_PROJECT_DIR, "static")), name="static")
app.mount("/coding", StaticFiles(directory=os.path.join(_PROJECT_DIR, "coding")), name="coding")
templates = Jinja2Templates(directory=os.path.join(_PROJECT_DIR, "templates"))

# ──── 路由 ────
from app.knowledge import router as knowledge_router
app.include_router(knowledge_router, prefix="/api/knowledge", tags=["知识库"])

from app.auth import router as auth_router, require_auth
app.include_router(auth_router, prefix="/api/auth", tags=["认证"])


@app.get("/", response_class=HTMLResponse, tags=["页面"])
async def index(request: Request):
    """聊天主页"""
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "role_model": ROLE_MODEL,
            "get_model_display": get_model_display,
        },
    )


@app.post("/api/chat", tags=["聊天"])
async def chat(request: Request):
    """处理用户消息，返回 Agent 协作结果"""
    from app.chat import run_chat_pipeline

    data = await request.json()
    user_input = data.get("message", "")
    lane_mode = data.get("lane_mode", "auto")
    history = data.get("history", [])
    model_config = data.get("model_config", {})

    if model_config:
        _model_config["roles"] = model_config

    try:
        result = run_chat_pipeline(user_input, history=history, lane_mode=lane_mode)
        return JSONResponse(result)
    except Exception as e:
        import traceback
        logging.error(f"聊天管道异常: {traceback.format_exc()}")
        return JSONResponse(
            {
                "reply": f"❌ 执行失败: {str(e)}",
                "error": str(e),
                "thinking": [],
                "task_type": "错误",
                "generated_files": [],
            },
            status_code=500,
        )


@app.post("/api/report", tags=["聊天"])
async def generate_report(request: Request):
    """从 thinking 记录生成详细报告"""
    from app.chat import generate_report_from_thinking

    data = await request.json()
    thinking = data.get("thinking", [])

    try:
        report = generate_report_from_thinking(thinking)
    except Exception:
        report = "# 报告生成失败\n\n请稍后重试。"

    os.makedirs(os.path.join(_PROJECT_DIR, "reports"), exist_ok=True)
    import time
    report_path = os.path.join(_PROJECT_DIR, "reports", f"report_{int(time.time())}.md")
    try:
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(report)
    except OSError:
        report_path = ""

    return JSONResponse({"content": report, "path": report_path})


# ──── 模型配置（运行时，内存存储）────

_model_config: dict = {
    "roles": {},
    "custom_models": [],
}


@app.post("/api/config/roles")
async def save_roles(request: Request):
    """保存角色→模型映射"""
    data = await request.json()
    _model_config["roles"] = data.get("roles", {})
    return JSONResponse({"status": "ok"})


@app.get("/api/config/roles")
async def get_roles():
    return JSONResponse({"roles": _model_config["roles"]})


@app.post("/api/config/models")
async def add_model(request: Request):
    """添加自定义模型"""
    data = await request.json()
    _model_config["custom_models"].append({
        "name": data.get("name"),
        "base_url": data.get("base_url"),
        "api_key": data.get("api_key"),
    })
    return JSONResponse({"status": "ok"})


@app.delete("/api/config/models/{model_name}")
async def delete_model(model_name: str):
    _model_config["custom_models"] = [
        m for m in _model_config["custom_models"] if m["name"] != model_name
    ]
    return JSONResponse({"status": "ok"})


# ──── 会话管理（SQLite）────

def _get_db(request: Request):
    return request.app.state.db


@app.get("/api/sessions")
async def list_sessions(request: Request, user: dict = Depends(require_auth)):
    """列出当前用户的会话摘要"""
    db = _get_db(request)
    summary = db.list_sessions(user["user_id"])
    return JSONResponse(summary)


@app.post("/api/sessions")
async def save_session(request: Request, user: dict = Depends(require_auth)):
    """保存/创建会话"""
    db = _get_db(request)
    data = await request.json()
    sid = data.get("id") or str(int(__import__("time").time() * 1000))
    title = data.get("title", "")
    result = db.save_session(sid, user["user_id"], data.get("messages", []), title)
    return JSONResponse(result)


@app.get("/api/sessions/{session_id}")
async def get_session(request: Request, session_id: str, user: dict = Depends(require_auth)):
    """获取单个会话的完整消息"""
    db = _get_db(request)
    s = db.get_session(session_id)
    if not s:
        return JSONResponse({"error": "会话不存在"}, status_code=404)
    if s["user_id"] != user["user_id"]:
        return JSONResponse({"error": "无权访问"}, status_code=403)
    # 向后兼容：保持旧响应格式（不含 user_id 顶层字段）
    return JSONResponse({
        "messages": s["messages"],
        "updated": s["updated"],
    })


@app.delete("/api/sessions/{session_id}")
async def delete_session(request: Request, session_id: str, user: dict = Depends(require_auth)):
    """删除会话"""
    db = _get_db(request)
    s = db.get_session(session_id)
    if not s:
        return JSONResponse({"error": "会话不存在"}, status_code=404)
    if s["user_id"] != user["user_id"]:
        return JSONResponse({"error": "无权访问"}, status_code=403)
    db.delete_session(session_id)
    return JSONResponse({"status": "ok"})


# ──── 启动 ────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8502, reload=False)
