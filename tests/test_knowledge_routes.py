import io
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient


def test_kb_stats():
    """知识库统计端点应返回包含文档数和切片数的 JSON"""
    from main import app
    client = TestClient(app)
    resp = client.get("/api/knowledge/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert "文档数" in data
    assert "切片数" in data


def test_kb_rebuild():
    """重建索引端点应返回 success"""
    from main import app
    client = TestClient(app)
    resp = client.post("/api/knowledge/rebuild")
    assert resp.status_code == 200
    assert resp.json()["success"] is True


def test_kb_delete_not_found():
    """删除不存在的文件应返回 404"""
    from main import app
    client = TestClient(app)
    resp = client.delete("/api/knowledge/nonexistent_file.txt")
    assert resp.status_code == 404


def test_kb_upload_reject_invalid_type():
    """上传 .exe 文件应返回 400"""
    from main import app
    client = TestClient(app)
    fake_exe = io.BytesIO(b"malicious content")
    resp = client.post(
        "/api/knowledge/upload",
        files={"file": ("evil.exe", fake_exe, "application/octet-stream")},
    )
    assert resp.status_code == 400
    data = resp.json()
    assert data["success"] is False
    assert "不支持" in data["error"]


def test_kb_delete_success():
    """先创建临时文件再通过 API 删除，应返回 200"""
    from main import app
    client = TestClient(app)

    # Create a temp file in the documents directory
    _BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    doc_dir = os.path.join(_BASE, "rag", "documents")
    os.makedirs(doc_dir, exist_ok=True)
    tmp_path = os.path.join(doc_dir, "_test_delete_me.txt")
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write("temp file for delete test")

    try:
        resp = client.delete("/api/knowledge/_test_delete_me.txt")
        assert resp.status_code == 200
        assert resp.json()["success"] is True
    finally:
        # Cleanup in case the API didn't remove it
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def test_kb_upload_text_file():
    """上传 .txt 文件应返回 success"""
    from main import app
    client = TestClient(app)
    fake_txt = io.BytesIO(b"hello world\nthis is a test document.")
    resp = client.post(
        "/api/knowledge/upload",
        files={"file": ("test_doc.txt", fake_txt, "text/plain")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["filename"] == "test_doc.txt"
