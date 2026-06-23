"""
多智能体协作系统 — FastAPI Web 入口
运行：uvicorn main:app --reload --port 8501
"""

import os
import sys

_PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
if _PROJECT_DIR not in sys.path:
    sys.path.insert(0, _PROJECT_DIR)

os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
os.environ["NO_PROXY"] = "localhost,127.0.0.1"
os.environ["no_proxy"] = "localhost,127.0.0.1"
os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["PYTHONUTF8"] = "1"

import logging
logging.getLogger().handlers.clear()

import warnings
warnings.filterwarnings("ignore", category=UserWarning)

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

import config as _cfg

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
app = FastAPI(title="多智能体协作系统", version="4.0")

# ──── 静态文件 & 模板 ────
app.mount("/static", StaticFiles(directory=os.path.join(_PROJECT_DIR, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(_PROJECT_DIR, "templates"))

# ──── 路由 ────
from app.knowledge import router as knowledge_router
app.include_router(knowledge_router, prefix="/api/knowledge", tags=["知识库"])


@app.get("/", response_class=HTMLResponse, tags=["页面"])
async def index(request: Request):
    """聊天主页"""
    return templates.TemplateResponse("index.html", {
        "request": request,
        "role_model": ROLE_MODEL,
        "get_model_display": get_model_display,
    })


@app.post("/api/chat", tags=["聊天"])
async def chat(request: Request):
    """处理用户消息，返回 Agent 协作结果"""
    from app.chat import run_chat_pipeline

    data = await request.json()
    user_input = data.get("message", "")
    lane_mode = data.get("lane_mode", "slow")
    history = data.get("history", [])

    try:
        result = run_chat_pipeline(user_input, history=history, lane_mode=lane_mode)
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse(
            {"reply": f"❌ 执行失败: {str(e)}", "thinking": [], "task_type": "错误", "generated_files": []},
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
    uvicorn.run("main:app", host="127.0.0.1", port=8501, reload=True)
