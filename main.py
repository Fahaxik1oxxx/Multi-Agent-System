"""
多智能体协作系统 — 聊天入口

运行：streamlit run main.py
"""

import os, sys, re

_PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
if _PROJECT_DIR not in sys.path:
    sys.path.insert(0, _PROJECT_DIR)

def escape_md(text: str) -> str:
    chars = r'\`*_{}[]()#+-.!>|~'
    text = text or ""
    for c in chars:
        text = text.replace(c, '\\' + c)
    return text


os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
os.environ["NO_PROXY"] = "localhost,127.0.0.1"
os.environ["no_proxy"] = "localhost,127.0.0.1"
os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["PYTHONUTF8"] = "1"

# ──── 日志静默 ────
import logging
logging.getLogger().handlers.clear()
import warnings
warnings.filterwarnings("ignore", category=UserWarning)
for name in ["autogen", "autogen.logger"]:
    lg = logging.getLogger(name)
    lg.setLevel(logging.CRITICAL)
    lg.handlers.clear()

# ──── DeepSeek thinking 补丁 ────
import openai
_orig_create = openai.resources.chat.completions.Completions.create
def _patched_create(self, **kwargs):
    model = str(kwargs.get("model", ""))
    if "deepseek" in model.lower():
        kwargs.setdefault("extra_body", {})
        kwargs["extra_body"]["thinking"] = {"type": "disabled"}
    # 防御 AG2 _format_json_str(None) 崩溃
    msgs = kwargs.get("messages", [])
    for m in msgs:
        for tc in (m.get("tool_calls") or []):
            fn = tc.get("function", {})
            if fn.get("arguments") is None:
                fn["arguments"] = "{}"
    return _orig_create(self, **kwargs)
openai.resources.chat.completions.Completions.create = _patched_create

# ──── 模型信息（兼容 config.py 加载失败）────
import config as _cfg
try:
    get_model_display = _cfg.get_model_display
    ROLE_MODEL = _cfg.ROLE_MODEL
except AttributeError:
    ROLE_MODEL = {k: f"？" for k in [
        "Planner","Retriever","Coder","Writer",
        "Tester","Summarizer","Bot",
    ]}
    def get_model_display(role):
        return "?"

# ──── Streamlit ────
import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(
    page_title="多智能体协作", page_icon="🤖",
    layout="wide", initial_sidebar_state="expanded",
)

if "messages" not in st.session_state:
    st.session_state.messages = []
if "jump_to" not in st.session_state:
    st.session_state.jump_to = -1


# ══════ 侧边栏 ══════
with st.sidebar:
    st.title("🤖 多智能体")
    st.caption("模型分配")
    for name in ROLE_MODEL:
        st.caption(f"{name}  ·  {get_model_display(name)}")
    st.divider()
    from app.knowledge import render_knowledge_sidebar
    render_knowledge_sidebar()

    # 📋 对话快速跳转
    user_questions = [
        (i, m["content"][:40])
        for i, m in enumerate(st.session_state.messages)
        if m["role"] == "user"
    ]
    if len(user_questions) > 1:
        st.sidebar.divider()
        st.sidebar.markdown("### 📋 对话目录")
        for i, q_text in user_questions[-10:]:
            label = q_text + ("..." if len(q_text) >= 40 else "")
            if st.sidebar.button(label, key=f"jump_{i}"):
                st.session_state.jump_to = i

# ══════ 主区域 ══════
from app.components import render_thinking_card
from app.chat import run_chat_pipeline, generate_report_from_thinking

# ── 历史消息 ──
for idx, msg in enumerate(st.session_state.messages):
    if msg["role"] == "user":
        st.markdown(f'<div id="msg_{idx}"></div>', unsafe_allow_html=True)
        st.chat_message("user").markdown(escape_md(msg.get("content") or ""))
    else:
        with st.chat_message("assistant"):
            thinking = msg.get("thinking", [])
            task_type = msg.get("task_type", "?")
            if thinking:
                st.caption(f"🏷 {task_type}")
                # 最新一条思考卡片默认展开，历史折叠
                is_latest = (idx == len(st.session_state.messages) - 1)
                render_thinking_card(thinking, key_suffix=str(idx), expanded=is_latest)
            st.markdown(msg["content"])
            # Agent 生成的文件预览
            for f in (msg.get("generated_files") or []):
                ext = f.get("ext", "").lower()
                if ext in ("png", "jpg", "jpeg", "gif", "bmp"):
                    try:
                        st.image(f.get("path", ""), caption=f.get("name", ""), width=500)
                    except Exception as img_err:
                        st.caption(f"⚠️ 图片无法显示：{f.get('name', '?')} ({img_err})")
            if thinking and task_type not in ("闲聊", "问答"):
                if st.button("📥 生成详细报告", key=f"btn_report_{idx}"):
                    with st.spinner("正在生成..."):
                        report = generate_report_from_thinking(thinking)
                    # 保存报告为 .md 文件
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
                        content = report_state.get("content", "")
                        st.markdown(content)
                        files = report_state.get("files", [])
                        if files:
                            st.caption("📎 生成文件：")
                            for f in files:
                                ext = f.get("ext", "").lower()
                                if ext in ("png", "jpg", "jpeg", "gif", "bmp"):
                                    st.image(f.get("path", ""), caption=f.get("name", ""))
                                elif ext == "md":
                                    st.info(f"📄 {f.get('name', '')}")
                                else:
                                    st.text(f"📎 {f.get('name', '')}")
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

# ── 输入 ──
if prompt := st.chat_input("描述你的任务（编程 / 写作 / 分析 / 问答 / 闲聊）"):
    st.session_state.messages.append({"role": "user", "content": prompt})

    with st.spinner("思考中..."):
        result = run_chat_pipeline(prompt, history=st.session_state.messages[:-1])

    st.session_state.messages.append({
        "role": "assistant",
        "content": result["reply"],
        "thinking": result["thinking"],
        "task_type": result["task_type"],
        "generated_files": result.get("generated_files", []),
    })
    st.rerun()
