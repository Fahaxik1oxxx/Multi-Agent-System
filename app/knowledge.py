"""侧边栏知识库管理。"""

import os
import streamlit as st
from rag.knowledge_base import build_index, get_document_list, get_stats


def render_knowledge_sidebar():
    """在侧边栏渲染知识库管理。"""
    st.markdown("### 📚 知识库")
    col1, col2 = st.columns(2)
    stats = get_stats()
    with col1:
        st.metric("文档", stats.get("文档数", 0))
    with col2:
        st.metric("切片", stats.get("切片数", 0))

    if st.button("🔄 重建索引", use_container_width=True):
        with st.spinner("重建中..."):
            n = build_index()
        st.success(f"新增 {n} 切片")
        st.rerun()

    st.markdown("---")
    uploaded = st.file_uploader(
        "📤 上传文档 (PDF/TXT/PNG/JPG)",
        type=["pdf", "txt", "png", "jpg", "jpeg"],
        accept_multiple_files=False,
        key="kb_upload",
    )
    if uploaded:
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        doc_dir = os.path.join(base, "rag", "documents")
        os.makedirs(doc_dir, exist_ok=True)

        ext = uploaded.name.rsplit(".", 1)[-1].lower()

        if ext in ("png", "jpg", "jpeg"):
            st.info("🔍 正在 OCR 识别图片文字...")
            try:
                from PIL import Image
                import pytesseract
                import io

                img = Image.open(io.BytesIO(uploaded.getbuffer()))
                text = pytesseract.image_to_string(img, lang="chi_sim+eng")

                if not text.strip():
                    st.warning("⚠️ 图片中未识别到文字")
                else:
                    txt_name = uploaded.name.rsplit(".", 1)[0] + "_ocr.txt"
                    txt_path = os.path.join(doc_dir, txt_name)
                    with open(txt_path, "w", encoding="utf-8") as f:
                        f.write(text)
                    st.success(f"已 OCR 识别并保存为 {txt_name}")
            except ImportError:
                st.error("pytesseract 或 Pillow 未安装")
            except Exception as e:
                st.error(f"OCR 失败: {e}")
        else:
            doc_path = os.path.join(doc_dir, uploaded.name)
            with open(doc_path, "wb") as f:
                f.write(uploaded.getbuffer())
            st.success(f"已上传 {uploaded.name}")

        st.rerun()

    docs = get_document_list()
    if docs:
        st.markdown("---")
        st.caption("已上传文档")
        for doc in docs:
            c1, c2 = st.columns([5, 1])
            with c1:
                st.markdown(f"- {doc}")
            with c2:
                if st.button("🗑", key=f"kb_del_{doc}", help="删除"):
                    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                    os.remove(os.path.join(base, "rag", "documents", doc))
                    st.rerun()
