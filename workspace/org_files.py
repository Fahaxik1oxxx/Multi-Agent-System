"""
团队文档 API 路由 — 上传/列表/删除/重命名/下载/批量导出
文件存储到 org_docs/{org_id}/ 目录，不经过 RAG 向量索引
"""

import os
import uuid
import shutil
import zipfile
import io
import json
from fastapi import APIRouter, Request, Depends, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse

from user.helpers import _get_db, require_auth

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORG_DOCS_DIR = os.path.join(PROJECT_DIR, "org_docs")

file_router = APIRouter()


def _ensure_org_dir(org_id: str) -> str:
    """确保组织文档目录存在"""
    d = os.path.join(ORG_DOCS_DIR, org_id)
    os.makedirs(d, exist_ok=True)
    return d


@file_router.get("/{org_id}/files")
async def list_files(request: Request, org_id: str, user: dict = Depends(require_auth)):
    """获取组织文件列表"""
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权访问"}, status_code=403)
    files = db.list_org_files(org_id)
    return JSONResponse(files)


@file_router.post("/{org_id}/files/upload")
async def upload_file(
    request: Request,
    org_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_auth),
):
    """上传文件到组织文档库"""
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None:
        return JSONResponse({"error": "无权上传"}, status_code=403)

    # 校验文件名
    safe_name = file.filename or f"untitled_{uuid.uuid4().hex[:8]}"
    # 防止路径穿越
    safe_name = os.path.basename(safe_name)
    if not safe_name:
        return JSONResponse({"error": "文件名不能为空"}, status_code=400)

    # 生成唯一存储文件名（同名不覆盖）
    base, ext = os.path.splitext(safe_name)
    store_name = f"{base}_{uuid.uuid4().hex[:8]}{ext}"
    org_dir = _ensure_org_dir(org_id)
    store_path = os.path.join(org_dir, store_name)

    # 写入文件
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        return JSONResponse({"error": "文件大小不能超过 5MB"}, status_code=400)
    with open(store_path, "wb") as f:
        f.write(contents)

    # 写入数据库
    mime_type = file.content_type or ""
    fid = db.create_org_file(
        org_id=org_id,
        file_name=safe_name,
        file_path=store_name,
        size=len(contents),
        mime_type=mime_type,
        uploaded_by=user["user_id"],
    )

    return JSONResponse({"id": fid, "file_name": safe_name, "size": len(contents), "status": "ok"}, status_code=201)


@file_router.put("/{org_id}/files/{file_id}/rename")
async def rename_file(request: Request, org_id: str, file_id: str, user: dict = Depends(require_auth)):
    """重命名文件"""
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None:
        return JSONResponse({"error": "无权操作"}, status_code=403)

    data = await request.json()
    new_name = (data.get("file_name") or "").strip()
    if not new_name:
        return JSONResponse({"error": "文件名不能为空"}, status_code=400)

    f = db.get_org_file(file_id)
    if not f or f["org_id"] != org_id:
        return JSONResponse({"error": "文件不存在"}, status_code=404)

    if not db.rename_org_file(file_id, new_name):
        return JSONResponse({"error": "重命名失败"}, status_code=500)
    return JSONResponse({"status": "ok"})


@file_router.delete("/{org_id}/files/{file_id}")
async def delete_file(request: Request, org_id: str, file_id: str, user: dict = Depends(require_auth)):
    """删除文件"""
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None:
        return JSONResponse({"error": "无权删除"}, status_code=403)

    f = db.get_org_file(file_id)
    if not f or f["org_id"] != org_id:
        return JSONResponse({"error": "文件不存在"}, status_code=404)

    # 删除物理文件
    file_path = os.path.join(ORG_DOCS_DIR, org_id, f["file_path"])
    if os.path.exists(file_path):
        os.remove(file_path)

    db.delete_org_file(file_id)
    return JSONResponse({"status": "ok"})


@file_router.post("/{org_id}/files/batch-delete")
async def batch_delete_files(request: Request, org_id: str, user: dict = Depends(require_auth)):
    """批量删除文件"""
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None:
        return JSONResponse({"error": "无权操作"}, status_code=403)

    data = await request.json()
    file_ids = data.get("file_ids", [])
    if not file_ids:
        return JSONResponse({"error": "未指定文件"}, status_code=400)

    deleted = 0
    for fid in file_ids:
        f = db.get_org_file(fid)
        if f and f["org_id"] == org_id:
            file_path = os.path.join(ORG_DOCS_DIR, org_id, f["file_path"])
            if os.path.exists(file_path):
                os.remove(file_path)
            db.delete_org_file(fid)
            deleted += 1

    return JSONResponse({"status": "ok", "deleted": deleted})


@file_router.get("/{org_id}/files/{file_id}/download")
async def download_file(request: Request, org_id: str, file_id: str, user: dict = Depends(require_auth)):
    """下载/预览文件（返回文件内容）"""
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权访问"}, status_code=403)

    f = db.get_org_file(file_id)
    if not f or f["org_id"] != org_id:
        return JSONResponse({"error": "文件不存在"}, status_code=404)

    file_path = os.path.join(ORG_DOCS_DIR, org_id, f["file_path"])
    if not os.path.exists(file_path):
        return JSONResponse({"error": "文件已丢失"}, status_code=404)

    # 文本文件直接返回内容用于预览，二进制文件返回流
    ext = os.path.splitext(f["file_name"])[1].lower()
    text_exts = {".md", ".txt", ".py", ".js", ".ts", ".jsx", ".tsx", ".json", ".yaml", ".yml", ".toml", ".cfg", ".ini", ".css", ".html", ".xml", ".sql", ".sh", ".bat", ".env", ".csv"}

    if ext in text_exts:
        try:
            with open(file_path, "r", encoding="utf-8") as fp:
                content = fp.read()
            return JSONResponse({
                "file_name": f["file_name"],
                "content": content,
                "mime_type": "text/plain",
                "size": f["size"],
            })
        except UnicodeDecodeError:
            pass  # fallback to binary

    # 二进制文件
    async def file_stream():
        with open(file_path, "rb") as fp:
            while chunk := fp.read(64 * 1024):
                yield chunk

    media_type = f["mime_type"] or "application/octet-stream"
    return StreamingResponse(file_stream(), media_type=media_type, headers={
        "Content-Disposition": f'inline; filename="{f["file_name"]}"',
        "Content-Length": str(f["size"]),
    })


@file_router.post("/{org_id}/files/batch-export")
async def batch_export_files(request: Request, org_id: str, user: dict = Depends(require_auth)):
    """批量导出文件为 ZIP"""
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权访问"}, status_code=403)

    data = await request.json()
    file_ids = data.get("file_ids", [])
    if not file_ids:
        return JSONResponse({"error": "未指定文件"}, status_code=400)

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for fid in file_ids:
            f = db.get_org_file(fid)
            if f and f["org_id"] == org_id:
                file_path = os.path.join(ORG_DOCS_DIR, org_id, f["file_path"])
                if os.path.exists(file_path):
                    zf.write(file_path, f["file_name"])

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=org_{org_id[:8]}_files.zip"},
    )


@file_router.get("/{org_id}/files/{file_id}/content")
async def get_file_content(request: Request, org_id: str, file_id: str, user: dict = Depends(require_auth)):
    """获取文件文本内容（供 Agent 读取）"""
    db = _get_db(request)
    role = db.get_org_member_role(org_id, user["user_id"])
    if role is None and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权访问"}, status_code=403)

    f = db.get_org_file(file_id)
    if not f or f["org_id"] != org_id:
        return JSONResponse({"error": "文件不存在"}, status_code=404)

    file_path = os.path.join(ORG_DOCS_DIR, org_id, f["file_path"])
    if not os.path.exists(file_path):
        return JSONResponse({"error": "文件已丢失"}, status_code=404)

    ext = os.path.splitext(f["file_name"])[1].lower()
    text_exts = {".md", ".txt", ".py", ".js", ".ts", ".json", ".yaml", ".yml", ".toml", ".css", ".html", ".xml", ".sql", ".csv"}
    if ext not in text_exts:
        return JSONResponse({"error": "不支持读取该文件格式"}, status_code=400)

    try:
        with open(file_path, "r", encoding="utf-8") as fp:
            content = fp.read()
        return JSONResponse({"file_name": f["file_name"], "content": content, "size": len(content)})
    except UnicodeDecodeError:
        return JSONResponse({"error": "文件无法以文本方式读取"}, status_code=400)
