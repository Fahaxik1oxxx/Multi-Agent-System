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

os.environ["HF_ENDPOINT"] = os.getenv("HF_ENDPOINT", "https://hf-mirror.com")
os.environ["NO_PROXY"] = "localhost,127.0.0.1"
os.environ["no_proxy"] = "localhost,127.0.0.1"
os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["PYTHONUTF8"] = "1"

import logging
logging.getLogger().handlers.clear()

import warnings
warnings.filterwarnings("ignore", category=UserWarning)

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

import config as _cfg
from user.db import Database

try:
    get_model_display = _cfg.get_model_display
    ROLE_MODEL = _cfg.ROLE_MODEL
    ROLES = _cfg.ROLES
except AttributeError:
    ROLES = ("Planner", "Retriever", "Coder", "Writer",
             "Tester", "Summarizer", "Bot")
    ROLE_MODEL = {k: "?" for k in ROLES}

    def get_model_display(role: str) -> str:
        return "?"

# ──── FastAPI 应用 ────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时初始化数据库（含迁移校验），关闭时执行 WAL 检查点"""
    db = Database(os.path.join(_PROJECT_DIR, "data.db"))
    app.state.db = db
    yield
    # 关闭时强制 WAL 检查点，将 -wal 文件内容写入主数据库
    try:
        with db._conn() as conn:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except Exception:
        logging.getLogger(__name__).warning(
            "WAL checkpoint 执行失败，下次启动时 SQLite 将自动恢复", exc_info=True
        )

app = FastAPI(title="多智能体协作系统", version="3.4", lifespan=lifespan)

# ──── 静态文件 & 模板 ────
app.mount("/static", StaticFiles(directory=os.path.join(_PROJECT_DIR, "static")), name="static")
app.mount("/coding", StaticFiles(directory=os.path.join(_PROJECT_DIR, "coding")), name="coding")
templates = Jinja2Templates(directory=os.path.join(_PROJECT_DIR, "templates"))

# ──── 路由 ────
from app.knowledge import router as knowledge_router
app.include_router(knowledge_router, prefix="/api/knowledge", tags=["知识库"])

from user.auth import decode_jwt
from user.routes import auth_router, session_router, user_router
app.include_router(auth_router, prefix="/api/auth", tags=["认证"])
app.include_router(session_router, prefix="/api/sessions", tags=["会话"])
app.include_router(user_router, prefix="/api/user", tags=["用户配置"])

from workspace.routes import workspace_router, project_router, admin_router
app.include_router(workspace_router, prefix="/api/workspaces", tags=["工作空间"])
app.include_router(project_router, prefix="/api", tags=["项目"])
app.include_router(admin_router, prefix="/api/admin", tags=["管理"])


@app.get("/", response_class=HTMLResponse, tags=["页面"])
async def index(request: Request):
    """聊天主页"""
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "role_model": ROLE_MODEL,
            "get_model_display": get_model_display,
            "model_pool": _cfg.MODEL_POOL,
        },
    )


@app.post("/api/chat", tags=["聊天"])
async def chat(request: Request):
    """处理用户消息，返回 Agent 协作结果（支持用户自定义 API Key）"""
    from app.chat import run_chat_pipeline

    data = await request.json()
    user_input = data.get("message", "")
    lane_mode = data.get("lane_mode", "auto")
    history = data.get("history", [])
    model_config_override = data.get("model_config", None)

    # 尝试从 JWT 解析用户，使用其自定义 API Key
    auth = request.headers.get("Authorization", "")
    user_id = None
    if auth.startswith("Bearer "):
        payload = decode_jwt(auth[7:])
        if payload:
            user_id = payload["sub"]

    try:
        result = run_chat_pipeline(
            user_input,
            history=history,
            lane_mode=lane_mode,
            model_config_override=model_config_override,
            user_id=user_id,
        )
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


# ──── 启动 ────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8502, reload=False)
