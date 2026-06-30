"""
多智能体协作系统 — FastAPI Web 入口
运行：uvicorn main:app --reload --port 8501
"""

import os
import sys

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)


def _is_production() -> bool:
    return os.getenv("ENV", "").lower() == "production"


# 加载 .env 文件（优先级高于系统环境变量）
from dotenv import load_dotenv

load_dotenv(os.path.join(PROJECT_DIR, ".env"), override=True)

os.environ["HF_ENDPOINT"] = os.getenv("HF_ENDPOINT", "https://hf-mirror.com")
os.environ["NO_PROXY"] = "localhost,127.0.0.1"
os.environ["no_proxy"] = "localhost,127.0.0.1"
os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["PYTHONUTF8"] = "1"

import logging

logging.getLogger().handlers.clear()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)-28s | %(levelname)-5s | %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

import warnings

warnings.filterwarnings("ignore", category=UserWarning)

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address, default_limits=["200/day", "50/hour"])

import config as _cfg
from user.db import Database

try:
    get_model_display = _cfg.get_model_display
    ROLE_MODEL = _cfg.ROLE_MODEL
    ROLES = _cfg.ROLES
except AttributeError:
    ROLES = ("Planner", "Retriever", "Coder", "Writer", "Tester", "Summarizer", "Bot")
    ROLE_MODEL = {k: "?" for k in ROLES}

    def get_model_display(role: str) -> str:
        return "?"


# ──── FastAPI 应用 ────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时初始化数据库（含迁移校验），关闭时执行 WAL 检查点"""
    db = Database(os.path.join(PROJECT_DIR, "data.db"))
    app.state.db = db
    yield
    # 关闭时强制 WAL 检查点，将 -wal 文件内容写入主数据库
    try:
        with db._conn() as conn:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except Exception:
        logging.getLogger(__name__).warning("WAL checkpoint 执行失败，下次启动时 SQLite 将自动恢复", exc_info=True)


app = FastAPI(title="多智能体协作系统", version="3.4", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ──── 静态文件 ────
app.mount("/coding", StaticFiles(directory=os.path.join(PROJECT_DIR, "coding")), name="coding")

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

from workspace.organizations import org_router

app.include_router(org_router, prefix="/api/orgs", tags=["组织"])

from workspace.team_chat import chat_router as team_chat_router

app.include_router(team_chat_router, prefix="/api/orgs", tags=["团队聊天"])

from router.router import router as chat_router

app.include_router(chat_router, prefix="/api", tags=["流式聊天"])


@app.get("/", include_in_schema=False)
async def root():
    """根路径 → 重定向到 API 文档"""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/docs")


@app.get("/api/health", tags=["系统"])
async def health():
    """健康检查"""
    return JSONResponse({"status": "ok", "version": "3.5"})


@app.get("/scalar", include_in_schema=False)
async def scalar_docs():
    """Scalar API 文档 UI"""
    from scalar_fastapi import get_scalar_api_reference
    from fastapi.responses import HTMLResponse

    return HTMLResponse(
        get_scalar_api_reference(
            openapi_url="/openapi.json",
            title="Multi-Agent API 文档",
        )
    )


@app.post("/api/chat", tags=["聊天"])
async def chat(request: Request):
    """处理用户消息，返回 Agent 协作结果（使用流式工作图）"""
    from router.stream import run_sync_workflow

    data = await request.json()
    user_input = data.get("message", "")
    lane_mode = data.get("lane_mode", "auto")

    try:
        result = await run_sync_workflow(user_input, lane_mode)
        return JSONResponse(result)
    except Exception as e:
        import traceback

        logging.error(f"聊天管道异常: {traceback.format_exc()}")
        if _is_production():
            return JSONResponse(
                {
                    "reply": "❌ 服务内部错误，请稍后重试。",
                    "error": "internal_error",
                    "thinking": [],
                    "task_type": "错误",
                },
                status_code=500,
            )
        return JSONResponse(
            {
                "reply": f"❌ 执行失败: {str(e)}",
                "error": str(e),
                "thinking": [],
                "task_type": "错误",
            },
            status_code=500,
        )


@app.post("/api/chat/guest", tags=["聊天"])
@limiter.limit("10/day")
async def chat_guest(request: Request):
    """游客免认证聊天 — 使用流式工作图"""
    from router.stream import run_sync_workflow

    data = await request.json()
    user_input = data.get("message", "")
    lane_mode = data.get("lane_mode", "auto")

    try:
        result = await run_sync_workflow(user_input, lane_mode)
        return JSONResponse(result)
    except Exception as e:
        import traceback

        logging.error(f"游客聊天异常: {traceback.format_exc()}")
        if _is_production():
            return JSONResponse(
                {
                    "reply": "❌ 服务内部错误，请稍后重试。",
                    "error": "internal_error",
                    "thinking": [],
                    "task_type": "错误",
                },
                status_code=500,
            )
        return JSONResponse(
            {
                "reply": f"❌ 执行失败: {str(e)}",
                "error": str(e),
                "thinking": [],
                "task_type": "错误",
            },
            status_code=500,
        )


@app.post("/api/report", tags=["聊天"])
@limiter.limit("20/day")
async def generate_report(request: Request):
    """从 thinking 记录生成详细报告"""
    from agents import create_llm, SYSTEM_PROMPTS

    data = await request.json()
    thinking = data.get("thinking", [])

    if not thinking:
        report = "无可用记录。"
    else:
        llm = create_llm("Summarizer")
        context = "\n\n".join(
            f"{m.get('name', '')}: {m.get('content', '')[:2000]}" for m in thinking if m.get("content")
        )
        prompt = (
            f"{SYSTEM_PROMPTS['Summarizer']}\n\n"
            f"以下是一个多智能体协作过程的内部记录。"
            f"请你据此生成一份结构化的执行报告。\n\n"
            f"协作记录：\n\n{context}"
        )
        try:
            response = llm.invoke(prompt)
            report = response.content if hasattr(response, "content") else str(response)
        except Exception:
            report = "# 多智能体协作报告\n\n报告生成失败。"

    os.makedirs(os.path.join(PROJECT_DIR, "reports"), exist_ok=True)
    import time

    report_path = os.path.join(PROJECT_DIR, "reports", f"report_{int(time.time())}.md")
    try:
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(report)
    except OSError:
        report_path = ""

    return JSONResponse({"content": report, "path": report_path})


# ──── 启动 ────
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8501, reload=False)
