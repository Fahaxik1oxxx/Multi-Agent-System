"""侧边栏知识库管理。"""

import os
import streamlit as st
from rag.knowledge_base import build_index, get_document_list, get_stats


def render_knowledge_sidebar():
    """在侧边栏渲染知识库管理。"""
    st.sidebar.markdown("### 📚 知识库")
    col1, col2 = st.sidebar.columns(2)
    stats = get_stats()
    with col1: st.sidebar.metric("文档", stats.get("文档数", 0))
    with col2: st.sidebar.metric("切片", stats.get("切片数", 0))

    # 重建索引
    if st.sidebar.button("🔄 重建索引", use_container_width=True):
        with st.sidebar:
            with st.spinner("重建中..."):
                n = build_index()
            st.success(f"新增 {n} 切片")
            st.rerun()

    # 上传
    st.sidebar.markdown("---")
    uploaded = st.sidebar.file_uploader(
        "📤 上传文档", type=["pdf", "txt"],
        accept_multiple_files=False, key="kb_upload",
    )
    if uploaded:
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        doc_path = os.path.join(base, "rag", "documents", uploaded.name)
        with open(doc_path, "wb") as f:
            f.write(uploaded.getbuffer())
        st.sidebar.success(f"已上传 {uploaded.name}")
        st.rerun()

    # 文档列表
    docs = get_document_list()
    if docs:
        st.sidebar.markdown("---")
        st.sidebar.caption("已上传文档")
        for doc in docs:
            c1, c2 = st.sidebar.columns([5, 1])
            with c1:
                st.sidebar.markdown(f"- {doc}")
            with c2:
                if st.sidebar.button("🗑", key=f"kb_del_{doc}", help="删除"):
                    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                    os.remove(os.path.join(base, "rag", "documents", doc))
                    st.rerun()
