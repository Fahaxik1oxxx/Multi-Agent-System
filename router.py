"""
意图分类器 —— 单次 LLM 调用，返回 (标签, 复杂度)。

复杂度： 轻 = 示例/告知型/Helloworld | 重 = 完整项目/复杂算法
"""

import json
from urllib.request import Request, urlopen

_ROUTER_SYSTEM = (
    "你是任务分类器。同一个标签就可以完成这份工作吗？"
    "只需要分类一下这个问题的类型与复杂度\n\n"
    "输出格式（三个词，中间用 | 分隔，不要任何其他文字）：\n"
    "标签|复杂度\n\n"
    "标签：\n"
    "- 编程：涉及代码编写、算法实现、程序开发、实现某个功能\n"
    "- 写作：报告、总结、方案、文案、文章、策划\n"
    "- 分析：数据统计、CSV/Excel 分析、趋势分析\n"
    "- 问答：知识性问题、概念解释、定义、原理、\"怎么写\"、\"是什么\"\n"
    "- 闲聊：问候、自我介绍、你是谁、简单对话\n\n"
    "复杂度：\n"
    "- 轻：简单示例、HelloWorld、代码片段展示、\"怎么写\"、概念解释\n"
    "- 重：完整项目、复杂算法、数据分析、长篇报告\n\n"
    "判断规则：\n"
    "1. 如果用户说「写一个最简单的X」或「给我一个X的例子」→ 轻 + 问答或编程\n"
    "2. 如果用户要求「实现一个完整的X系统」→ 重 + 编程\n"
    "3. 如果是 HelloWorld/C 程序代码片段 → 轻 + 问答（不需要走完整开发流程）\n"
    "4. 「帮我分析这个数据」→ 重 + 分析；「数据分析是什么」→ 轻 + 问答\n"
    "5. 「写一份详细的项目方案」→ 重 + 写作；「三句话总结」→ 轻 + 写作\n"
    "    6. 如果用户要求搜索/查资料/检索/查找XX知识/基于知识库 → 重 + 分析\n"
    "7. 用户直接粘贴数据要求「分析 以下数据」→ 重 + 分析\n\n"
    "示例：\n"
    "写一个最简单的c程序 → 编程|轻\n"
    "实现一个LRU缓存 → 编程|重\n"
    "什么是机器学习 → 问答|轻\n"
    "分析这个CSV数据 → 分析|重\n"
    "你好 → 闲聊|轻\n"
)

_MODEL_INFO = None


def _get_model_info():
    global _MODEL_INFO
    if _MODEL_INFO is None:
        from config import get_config
        cfg = get_config("Planner")["config_list"][0]
        _MODEL_INFO = {
            "model": cfg["model"],
            "api_key": cfg.get("api_key", "ollama"),
            "base_url": cfg.get("base_url", "http://localhost:11434/v1"),
        }
    return _MODEL_INFO


def classify(user_input: str) -> tuple[str, str]:
    """返回 (task_type, complexity)"""
    info = _get_model_info()
    payload = json.dumps({
        "model": info["model"],
        "messages": [
            {"role": "system", "content": _ROUTER_SYSTEM},
            {"role": "user", "content": user_input},
        ],
        "temperature": 0,
        "max_tokens": 50,
        "stream": False,
        "thinking": {"type": "disabled"},
    }).encode("utf-8")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {info['api_key']}",
    }
    url = info["base_url"].rstrip("/") + "/chat/completions"
    req = Request(url, data=payload, headers=headers, method="POST")

    try:
        resp = urlopen(req, timeout=15)
        data = json.loads(resp.read())
        raw = data["choices"][0]["message"]["content"].strip()
    except Exception:
        return ("闲聊", "轻")

    # 解析 "编程|重" 或 "问答|轻"
    parts = [p.strip() for p in raw.replace("｜", "|").split("|")]

    valid_types = {"编程", "写作", "分析", "问答", "闲聊"}
    task_type = "闲聊"
    complexity = "轻"

    for p in parts:
        if p in valid_types:
            task_type = p
        elif p == "重":
            complexity = "重"
        elif p == "轻":
            complexity = "轻"

    return (task_type, complexity)
