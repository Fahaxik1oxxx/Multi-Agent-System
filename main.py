"""
多智能体协作系统 — 聊天入口
运行：streamlit run main.py
"""

import os, sys

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

# ──── 模型信息 ────
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

import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(
    page_title="多智能体协作", page_icon="🤖",
    layout="wide", initial_sidebar_state="expanded",
)

# ──── 自定义 CSS ────
st.markdown("""
<style>
    [data-testid="stSidebar"] {
        background-color: #1a1f36;
    }
    [data-testid="stSidebar"] * {
        color: #e0e0e0;
    }
    [data-testid="stSidebar"] h1,
    [data-testid="stSidebar"] h2,
    [data-testid="stSidebar"] h3 {
        color: #ffffff;
    }
    [data-testid="stSidebar"] .stButton > button {
        background-color: #4f8cff;
        color: white;
        border: none;
        border-radius: 8px;
        transition: all 0.2s;
    }
    [data-testid="stSidebar"] .stButton > button:hover {
        background-color: #3d6fd9;
        transform: translateY(-1px);
    }
    .main .block-container {
        padding-top: 1rem;
    }
    [data-testid="stChatMessage"] {
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        margin-bottom: 0.5rem;
    }
    [data-testid="stChatInput"] textarea {
        border-radius: 12px;
        border: 1px solid #e0e0e0;
    }
    [data-testid="stExpander"] {
        border-radius: 8px;
        border: 1px solid #e8ecf1;
    }
</style>
""", unsafe_allow_html=True)

# ──── Session State ────
if "messages" not in st.session_state:
    st.session_state.messages = []
if "jump_to" not in st.session_state:
    st.session_state.jump_to = -1
if "lane_mode" not in st.session_state:
    st.session_state.lane_mode = "slow"


# ══════ 侧边栏 ══════
with st.sidebar:
    st.markdown("""
    <div style="text-align:center; padding:10px 0;">
        <h1 style="margin:0; color:#4f8cff;">🤖 Multi-Agent</h1>
        <p style="margin:0; font-size:0.85rem; opacity:0.7;">多智能体协作系统</p>
    </div>
    """, unsafe_allow_html=True)
    st.divider()

    # ⚡ 快慢车道切换
    st.markdown("### ⚡ 执行模式")
    lane_mode = st.radio(
        "选择执行模式",
        options=["fast", "slow"],
        format_func=lambda x: "🚀 快车道 (直接回复)" if x == "fast" else "🔄 慢车道 (多Agent协作)",
        key="lane_mode",
        horizontal=True,
    )
    color = "#10b981" if st.session_state.lane_mode == "slow" else "#4f8cff"
    st.markdown(
        f'<p style="text-align:center; color:{color}; font-weight:bold;">'
        f'当前: {"🔄 慢车道" if st.session_state.lane_mode == "slow" else "🚀 快车道"}'
        f'</p>',
        unsafe_allow_html=True,
    )

    st.divider()

    # 📊 系统状态
    st.markdown("### 📊 系统状态")
    for name in ROLE_MODEL:
        st.caption(f"{name}  ·  {get_model_display(name)}")

    st.divider()

    from app.knowledge import render_knowledge_sidebar
    render_knowledge_sidebar()

    # 📜 对话跳转
    user_questions = [
        (i, m["content"][:40])
        for i, m in enumerate(st.session_state.messages)
        if m["role"] == "user"
    ]
    if len(user_questions) > 1:
        st.divider()
        st.markdown("### 📜 对话跳转")
        for i, q_text in user_questions[-10:]:
            label = q_text + ("..." if len(q_text) >= 40 else "")
            if st.button(label, key=f"jump_{i}"):
                st.session_state.jump_to = i


# ══════ 主区域 ══════
from app.components import render_agent_card
from app.chat import run_chat_pipeline, generate_report_from_thinking

# ── 历史消息渲染 ──
for idx, msg in enumerate(st.session_state.messages):
    if msg["role"] == "user":
        st.markdown(f'<div id="msg_{idx}"></div>', unsafe_allow_html=True)
        st.chat_message("user").markdown(
            msg.get("content", "").replace("$", "\\$")
        )
    else:
        with st.chat_message("assistant"):
            thinking = msg.get("thinking", [])
            task_type = msg.get("task_type", "?")

            if thinking:
                st.caption(f"🏷 {task_type}")
                is_latest = (idx == len(st.session_state.messages) - 1)
                render_agent_card(thinking, key_suffix=str(idx), expanded=is_latest)

            st.markdown(msg["content"])

            for f in (msg.get("generated_files") or []):
                ext = f.get("ext", "").lower()
                if ext in ("png", "jpg", "jpeg", "gif", "bmp"):
                    try:
                        st.image(f.get("path", ""), caption=f.get("name", ""))
                    except Exception:
                        st.caption(f"⚠️ 图片无法显示：{f.get('name', '?')}")

            if thinking and task_type not in ("闲聊", "问答"):
                if st.button("📥 生成详细报告", key=f"btn_report_{idx}"):
                    with st.spinner("正在生成..."):
                        report = generate_report_from_thinking(thinking)
                    os.makedirs(os.path.join(_PROJECT_DIR, "reports"), exist_ok=True)
                    report_path = os.path.join(_PROJECT_DIR, "reports", f"report_{idx}.md")
                    try:
                        with open(report_path, "w", encoding="utf-8") as f_rp:
                            f_rp.write(report)
                        files = list(msg.get("generated_files", []))
                        files.append({"name": f"report_{idx}.md", "path": report_path, "ext": "md"})
                    except OSError:
                        files = msg.get("generated_files", [])
                    st.session_state[f"report_{idx}"] = {"content": report, "files": files}
                    st.rerun()

            report_state = st.session_state.get(f"report_{idx}")
            if report_state:
                with st.expander("📊 详细报告", expanded=True):
                    if isinstance(report_state, dict):
                        st.markdown(report_state.get("content", ""))
                        for f in report_state.get("files", []):
                            ext = f.get("ext", "").lower()
                            if ext in ("png", "jpg", "jpeg", "gif", "bmp"):
                                st.image(f.get("path", ""), caption=f.get("name", ""))
                    else:
                        st.markdown(str(report_state))

# ── 跳转执行 ──
if st.session_state.jump_to >= 0:
    idx = st.session_state.jump_to
    components.html(
        f"<script>window.parent.document.getElementById('msg_{idx}')?.scrollIntoView({{behavior:'smooth',block:'start'}});</script>",
        height=0
    )
    st.session_state.jump_to = -1

# ── 输入区 ──
if prompt := st.chat_input("💬 描述你的任务（编程 / 写作 / 分析 / 问答 / 闲聊）"):
    st.session_state.messages.append({"role": "user", "content": prompt})

    with st.spinner("思考中..."):
        result = run_chat_pipeline(
            prompt,
            history=st.session_state.messages[:-1],
            lane_mode=st.session_state.lane_mode,
        )

    st.session_state.messages.append({
        "role": "assistant",
        "content": result["reply"],
        "thinking": result["thinking"],
        "task_type": result["task_type"],
        "generated_files": result.get("generated_files", []),
    })
    st.rerun()
