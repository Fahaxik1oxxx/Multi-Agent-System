"""
OCR 模块 —— Tesseract 图片文字识别。
"""

import io


def ocr_file(uploaded_file) -> str:
    """将上传的图片文件 OCR 提取文字。
    uploaded_file: file-like object
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
