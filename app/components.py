"""
Streamlit 可复用组件 —— Agent 卡片、状态指示器。
"""

import streamlit as st

_ICONS = {
    "Planner":    "📋", "Retriever": "🔍",
    "Coder":      "💻", "Writer":    "✍️",
    "Tester":     "✅", "Summarizer":"📊",
    "Bot":        "🤖", "Executor":  "⚙️",
}

_COLORS = {
    "Planner":    "#4f8cff",
    "Retriever":  "#8b5cf6",
    "Coder":      "#10b981",
    "Writer":     "#f59e0b",
    "Tester":     "#ef4444",
    "Summarizer": "#4f8cff",
    "Bot":        "#10b981",
    "Executor":   "#8b5cf6",
}


def _icon(name: str) -> str:
    return _ICONS.get(name, "🔹")


def _color(name: str) -> str:
    return _COLORS.get(name, "#4f8cff")


def render_agent_card(thinking: list[dict], key_suffix: str = "", expanded: bool = False):
    """渲染思考过程，每个 Agent 一张彩色标签卡片"""
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

    flow = " → ".join(
        f"{_icon(m.get('name', ''))} {m.get('name', '')}"
        for m in thinking if m.get("name")
    )

    with st.expander(f"🧠 思考过程（{flow}）", expanded=expanded):
        for i, msg in enumerate(thinking):
            name = msg.get("name", "")
            content = msg.get("content", "")
            if not content:
                continue

            color = _color(name)
            st.markdown(
                f'<span style="display:inline-block; background:{color}20; '
                f'border-left:3px solid {color}; padding:4px 12px; '
                f'border-radius:4px; font-weight:bold;">'
                f'{_icon(name)} {name}</span>',
                unsafe_allow_html=True,
            )
            st.markdown(content)
            if i < len(thinking) - 1:
                st.divider()


def render_status_badge(status: str) -> str:
    cmap = {"就绪": "🟢", "运行中": "🟡", "完成": "✅", "错误": "❌"}
    return f"{cmap.get(status, '⚪')} {status}"
