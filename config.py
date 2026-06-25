import os
from dotenv import load_dotenv
load_dotenv()

# ===== 模型池 =====
# 在这里添加你的所有模型，格式：
#   "编号-标签": {"model": "...", "api_key": ..., "base_url": "..."}
# api_key 支持三种写法：
#   os.getenv("VAR")  — 环境变量（推荐）
#   "ollama"          — 本地 Ollama
#   "sk-xxx"          — 直写 Key（不安全，仅测试）
MODEL_POOL = {
    "a-deepseek": {
        "model": "deepseek-v4-flash",
        "api_key": os.getenv("DEEPSEEK_API_KEY"),
        "base_url": "https://api.deepseek.com/v1",
    },
}

# ===== 角色-模型对应表 =====
# 把 role-model 的值改成上面 MODEL_POOL 的 key 即可
ROLE_MODEL = {
    "Planner":    "a-deepseek",
    "Retriever":  "a-deepseek",
    "Coder":      "a-deepseek",
    "Tester":     "a-deepseek",
    "Writer":     "a-deepseek",
    "Summarizer": "a-deepseek",
    "Bot":        "a-deepseek",
}


def get_config(role: str) -> dict:
    """返回 AG2 兼容的 llm_config"""
    key = ROLE_MODEL[role]
    cfg = dict(MODEL_POOL[key])
    return {"config_list": [cfg]}


def get_model_display(role: str) -> str:
    """返回前端显示的模型名"""
    key = ROLE_MODEL[role]
    return MODEL_POOL[key]["model"]
