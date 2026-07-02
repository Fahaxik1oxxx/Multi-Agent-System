"""
意图分类器 —— LLM 分类 + 置信度评分 + 反问澄清
"""

import json
import logging
import re
from urllib.request import Request, urlopen

from config import get_model_config

logger = logging.getLogger(__name__)

_ROUTER_SYSTEM = """你是任务分类器。只需要分类一下这个问题的类型、复杂度，并评估把握程度。

输出格式（严格 JSON，不要其他文字）：
{
  "task_type": "编程|写作|分析|问答|闲聊",
  "complexity": "低|高",
  "confidence": 0.0~1.0,
  "top2": ["候选1", "候选2"],
  "reason": "简短说明"
}

confidence 评分标准（请严格参照具体关键词判断，不要凭感觉）：
- 1.0：用户明确包含如下精确动词之一（写代码/编程/实现/开发/写报告/写文章/分析数据/统计）
- 0.9：包含明确任务名词（算法/程序/报告/方案/数据）
- 0.7-0.8：有任务方向但细节模糊
- 0.5-0.6：只说"看/搞/弄/做/整"等模糊动词，不含任务名词
- <0.5：完全无法归类

示例：
  写一个Python爬虫 → confidence 1.0
  帮我看看这个代码 → confidence 0.7
  搞一下 → confidence 0.4
  你好 → confidence 0.9（闲聊类）

类型说明：
- 编程：涉及代码编写、算法实现、程序开发、实现某个功能
- 写作：报告、总结、方案、文档、文章、计划
- 分析：数据统计、CSV/Excel 分析、趋势分析
- 问答：知识性问题、概念解释、定义、原理
- 闲聊：问候、自我介绍、你是啥

复杂度说明：
- 低：简单社交、HelloWorld、概念解释
- 高：完整页面、复杂算法、数据分析、长篇报告
"""


def classify_with_confidence(user_input: str, lane_mode: str = "auto") -> dict:
    """返回带置信度的结构化分类结果"""
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
            "max_tokens": 150,
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

    default_result = {
        "task_type": "闲聊",
        "complexity": "低",
        "confidence": 0.0,
        "top2": ["闲聊", "问答"],
        "reason": "fallback"
    }

    try:
        resp = urlopen(req, timeout=15)
        data = json.loads(resp.read())
        raw = data["choices"][0]["message"]["content"].strip()
        logger.info("classify | raw=%s", raw)
        
        # 兼容处理：尝试提取 JSON
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            result = json.loads(match.group(0))
        else:
            result = default_result
            
    except Exception as e:
        logger.warning("classify | LLM call failed: %s, fallback", e)
        result = default_result.copy()

    # 规范化检查
    valid_types = {"编程", "写作", "分析", "问答", "闲聊"}
    if result.get("task_type") not in valid_types:
        result["task_type"] = "闲聊"
    
    # —— 关键词覆写（强制干预，Layer 3） ——
    _search = re.search(r"(搜索|检索|查找.*知道|基于知识库)", user_input, re.IGNORECASE)
    if _search and result["complexity"] == "低":
        result["complexity"] = "高"
        result["task_type"] = "写作"

    _analysis = re.match(r"^\+分析", user_input)
    if _analysis and result["complexity"] == "低":
        result["complexity"] = "高"
        if result["task_type"] not in ("分析", "编程"):
            result["task_type"] = "分析"

    _non_py = None
    if not _search:
        _non_py = re.search(
            r"(c语言|c\s*代码|java|rust|go\s*语言|golang|swift|c\+\+|c#|typescript)",
            user_input,
            re.IGNORECASE,
        )
        if _non_py and result["task_type"] == "编程":
            result["task_type"] = "问答"
            result["complexity"] = "低"

    # —— 车道模式覆盖 ——
    if lane_mode == "fast":
        result["complexity"] = "低"
    elif lane_mode == "slow":
        result["complexity"] = "高"
        
    return result


def classify_with_embedding(user_input: str, lane_mode: str = "auto") -> dict:
    """LLM 分类 + 置信度"""
    result = classify_with_confidence(user_input, lane_mode)
    
    result["final_confidence"] = result.get("confidence", 0.0)
    result["confidence_diff"] = result["final_confidence"]
    result["need_report"] = False if result["task_type"] == "写作" else True
    
    logger.info("classify_with_embedding | final=%s|%s conf=%.2f",
                result["task_type"], result["complexity"],
                result["final_confidence"])
    
    return result


def generate_clarification(user_input: str, top2: list, reason: str) -> str:
    """根据 top-2 候选生成追问"""
    if top2 == ["编程", "写作"] or top2 == ["写作", "编程"]:
        return "您是想让我编写代码，还是撰写文档/报告？"
    if top2 == ["分析", "编程"] or top2 == ["编程", "分析"]:
        return "您是需要我分析数据，还是编写代码实现功能？"
    if top2 == ["问答", "闲聊"] or top2 == ["闲聊", "问答"]:
        return "您是需要我查找具体信息，还是随便聊聊？"
    return "我不太确定您的具体需求，能否再详细描述一下？"


def reclassify_with_context(original_input: str, clarification_q: str, user_reply: str, lane_mode: str) -> dict:
    """带澄清上下文重新分类"""
    combined_input = f"初始需求：{original_input}\n追问：{clarification_q}\n用户补充：{user_reply}"
    return classify_with_embedding(combined_input, lane_mode)


def classify(user_input: str, lane_mode: str = "auto") -> tuple[str, str, bool]:
    """兼容旧版本的 classify 接口（如果有地方还用到）"""
    res = classify_with_embedding(user_input, lane_mode)
    return (res["task_type"], res["complexity"], res["need_report"])
