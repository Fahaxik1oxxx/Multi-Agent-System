"""
意图分类器 —— 单次 LLM 调用，返回 (类型, 复杂度)。

复杂度：低 = 社交/通知类/HelloWorld | 高 = 完整页面/复杂算法
"""

import json
import logging
import re
from urllib.request import Request, urlopen

from config import get_model_config

logger = logging.getLogger(__name__)

_ROUTER_SYSTEM = """你是任务分类器。只需要分类一下这个问题的类型、复杂度，以及是否需要附加执行报告。

输出格式（严格用 | 分隔，务必是三个部分，不要任何其他文字）：
类型|复杂度|是否报告

类型：
- 编程：涉及代码编写、算法实现、程序开发、实现某个功能
- 写作：报告、总结、方案、文档、文章、计划
- 分析：数据统计、CSV/Excel 分析、趋势分析
- 问答：知识性问题、概念解释、定义、原理
- 闲聊：问候、自我介绍、你是啥

复杂度：
- 低：简单社交、HelloWorld、概念解释
- 高：完整页面、复杂算法、数据分析、长篇报告

是否报告（务必是 True 或 False）：
- 如果用户明确表示直接给我正文不要废话不要报告等，务必输出 False
- 如果是一般的文章/文档写作任务（不涉及复杂逻辑复杂的），倾向输出 False
- 对于编程、数据分析等需要仔细执行的任务，或者未明确排除报告的，输出 True

示例：
写一个最简单的C程序 → 编程|低|True
写一篇关于XX的分析，不要加你们的总结报告 → 写作|高|False
实现一个LRU缓存 → 编程|高|True
你好 → 闲聊|低|True
最高规则： 如果是写作务必使用False"""


def classify(user_input: str, lane_mode: str = "auto") -> tuple[str, str, bool]:
    """返回 (task_type, complexity, need_report)
    task_type: 编程 | 写作 | 分析 | 问答 | 闲聊
    complexity: 低 | 高
    need_report: True | False
    lane_mode 车道规则：
      - "fast" → complexity 强制为 "低"
      - "slow" → complexity 强制为 "高"
      - "auto" → 不强制车道，由 LLM 判断
    """
    info = get_model_config("Planner")
    logger.info("classify | input=%s | lane=%s | model=%s", user_input[:60], lane_mode, info["model"])
    payload = json.dumps(
        {
            "model": info["model"],
            "messages": [
                {"role": "system", "content": _ROUTER_SYSTEM},
                {"role": "user", "content": user_input},
            ],
            "temperature": 0,
            "max_tokens": 50,
            "stream": False,
            "thinking": {"type": "disabled"},
        }
    ).encode("utf-8")

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
        logger.info("classify | raw=%s", raw)
    except Exception as e:
        logger.warning("classify | LLM call failed: %s, fallback to (闲聊,低,True)", e)
        return ("闲聊", "低", True)

    parts = [p.strip() for p in raw.replace("｜", "|").split("|")]

    valid_types = {"编程", "写作", "分析", "问答", "闲聊"}
    task_type = "闲聊"
    complexity = "低"
    need_report = True

    for p in parts:
        if p in valid_types:
            task_type = p
        elif p == "高":
            complexity = "高"
        elif p == "低":
            complexity = "低"
        elif p == "False":
            need_report = False

    # —— 关键词覆写 ——
    _search = re.search(r"(搜索|检索|查找.*知道|基于知识库)", user_input, re.IGNORECASE)
    if _search and complexity == "低":
        complexity = "高"
        task_type = "写作"

    _analysis = re.match(r"^\+分析", user_input)
    if _analysis and complexity == "低":
        complexity = "高"
        if task_type not in ("分析", "编程"):
            task_type = "分析"

    _non_py = None
    if not _search:
        _non_py = re.search(
            r"(c语言|c\s*代码|java|rust|go\s*语言|golang|swift|c\+\+|c#|typescript)",
            user_input,
            re.IGNORECASE,
        )
        if _non_py and task_type == "编程":
            task_type = "问答"
            complexity = "低"

    # —— 关键词覆盖日志 ——
    if _search:
        logger.info(
            "classify | keyword_override=search | task_type=%s | complexity=%s",
            task_type,
            complexity,
        )
    if _analysis:
        logger.info(
            "classify | keyword_override=analysis | task_type=%s | complexity=%s",
            task_type,
            complexity,
        )
    if _non_py:
        logger.info(
            "classify | keyword_override=non_py | task_type=%s | complexity=%s",
            task_type,
            complexity,
        )

    # —— 车道模式覆盖 ——
    if lane_mode == "fast":
        complexity = "低"
    elif lane_mode == "slow":
        complexity = "高"

    logger.info("classify | result=%s|%s|%s", task_type, complexity, need_report)
    return (task_type, complexity, need_report)
