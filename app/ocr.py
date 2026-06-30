"""
OCR 模块 —— Tesseract 图片文字识别。
"""

import io
import os


def ocr_file(uploaded_file) -> str:
    """将上传的图片文件 OCR 提取文字。
    uploaded_file: Streamlit UploadedFile 或 file-like object
    返回识别的文字内容
    """
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return "[错误] pytesseract 或 Pillow 未安装"

    try:
        if hasattr(uploaded_file, "getbuffer"):
            data = uploaded_file.getbuffer()
        elif hasattr(uploaded_file, "read"):
            data = uploaded_file.read()
        else:
            data = uploaded_file

        img = Image.open(io.BytesIO(data))
        text = pytesseract.image_to_string(img, lang="chi_sim+eng")
        return text.strip() or ""
    except Exception as e:
        return f"[OCR错误] {e}"


def ocr_clipboard(image_bytes: bytes) -> str:
    """从剪贴板图片 OCR 提取文字"""
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return "[错误] pytesseract 或 Pillow 未安装"

    try:
        img = Image.open(io.BytesIO(image_bytes))
        text = pytesseract.image_to_string(img, lang="chi_sim+eng")
        return text.strip() or ""
    except Exception as e:
        return f"[OCR错误] {e}"


def ocr_and_index(uploaded_file) -> int:
    """OCR 提取文字后直接存入知识库，返回新增 chunk 数。"""
    text = ocr_file(uploaded_file)
    if not text or text.startswith("[OCR错误]"):
        return 0

    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    doc_dir = os.path.join(base, "rag", "documents", "shared")
    os.makedirs(doc_dir, exist_ok=True)

    name = uploaded_file.name if hasattr(uploaded_file, "name") else "clipboard_ocr"
    txt_name = name.rsplit(".", 1)[0] + "_ocr.txt"
    txt_path = os.path.join(doc_dir, txt_name)
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(text)

    from rag.knowledge_base import build_index

    chunk_count, _ = build_index(user_id="shared")
    return chunk_count
