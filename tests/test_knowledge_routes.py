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
