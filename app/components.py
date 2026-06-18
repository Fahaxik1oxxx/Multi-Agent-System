"""
Streamlit 可复用组件 —— 思考卡片、状态指示器。
"""

import streamlit as st

_ICONS = {
    "Planner":    "📋", "Retriever": "🔍",
    "Coder":      "💻", "Writer":    "✍️",
    "Tester":     "✅", "Summarizer":"📊",
    "Bot":        "🤖",
}


def _icon(name: str) -> str:
    return _ICONS.get(name, "🔹")


def render_thinking_card(thinking: list[dict], key_suffix: str = "", expanded: bool = False):
    """渲染思考过程（expander 折叠 + 独立滚动容器）"""
    if not thinking:
        return
    st.markdown("""
<style>
div[data-testid="stExpander"] div[data-testid="stExpanderContent"] {
    max-height: 500px;
    overflow-y: auto;
}
</style>
""", unsafe_allow_html=True)
    # 构建发言顺序条
    flow = " → ".join(
        f"{_icon(m.get('name',''))} {m.get('name','')}"
        for m in thinking if m.get("name")
    )
    with st.expander(f"🧠 思考过程（{flow}）", expanded=expanded):
        for i, msg in enumerate(thinking):
            name = msg.get("name", "")
            content = msg.get("content", "")
            if not content:
                continue
            st.markdown(f"**{_icon(name)} {name}**")
            st.markdown(content)
            if i < len(thinking) - 1:
                st.divider()


def render_status_badge(status: str) -> str:
    cmap = {"就绪": "🟢", "运行中": "🟡", "完成": "✅", "错误": "❌"}
    return f"{cmap.get(status, '⚪')} {status}"
