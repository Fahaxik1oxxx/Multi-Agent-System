"""知识库管理 API 路由。"""
import os
from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse

router = APIRouter()

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@router.get("/stats")
async def kb_stats():
    from rag.knowledge_base import get_stats
    return JSONResponse(get_stats())


@router.post("/rebuild")
async def kb_rebuild():
    from rag.knowledge_base import build_index
    n = build_index()
    return JSONResponse({"success": True, "added": n})


@router.post("/upload")
async def kb_upload(file: UploadFile = File(...)):
    doc_dir = os.path.join(_BASE, "rag", "documents")
    os.makedirs(doc_dir, exist_ok=True)

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""

    if ext in ("png", "jpg", "jpeg"):
        try:
            from PIL import Image
            import pytesseract
            import io

            contents = await file.read()
            img = Image.open(io.BytesIO(contents))
            text = pytesseract.image_to_string(img, lang="chi_sim+eng")

            if not text.strip():
                return JSONResponse({"success": False, "error": "图片中未识别到文字"}, status_code=400)

            txt_name = file.filename.rsplit(".", 1)[0] + "_ocr.txt"
            txt_path = os.path.join(doc_dir, txt_name)
            with open(txt_path, "w", encoding="utf-8") as f:
                f.write(text)
            return JSONResponse({"success": True, "filename": txt_name, "ocr": True})
        except ImportError as e:
            return JSONResponse({"success": False, "error": f"依赖未安装: {e}"}, status_code=500)
        except Exception as e:
            return JSONResponse({"success": False, "error": f"OCR 失败: {e}"}, status_code=500)
    else:
        doc_path = os.path.join(doc_dir, file.filename)
        contents = await file.read()
        with open(doc_path, "wb") as f:
            f.write(contents)
        return JSONResponse({"success": True, "filename": file.filename})


@router.delete("/{filename}")
async def kb_delete(filename: str):
    doc_dir = os.path.join(_BASE, "rag", "documents")
    path = os.path.join(doc_dir, filename)
    if not os.path.exists(path):
        return JSONResponse({"success": False, "error": "文件不存在"}, status_code=404)
    os.remove(path)
    return JSONResponse({"success": True})
