import io
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uuid
import pytest
from fastapi.testclient import TestClient
from main import app


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register(client, suffix: str = ""):
    """注册测试用户，返回 (token, user_id)"""
    name = f"test_{suffix}_{uuid.uuid4().hex[:6]}"
    resp = client.post("/api/auth/register", json={
        "name": name, "email": f"{name}@t.com", "password": "test1234"
    })
    assert resp.status_code == 200, f"注册失败 ({name}): {resp.json()}"
    data = resp.json()
    return data["token"], data["user_id"]


def test_auth_register():
    with TestClient(app) as client:
        token, _ = _register(client, "reg")
        assert token


def test_auth_login():
    with TestClient(app) as client:
        name = f"login_{uuid.uuid4().hex[:6]}"
        client.post("/api/auth/register", json={
            "name": name, "email": f"{name}@t.com", "password": "pass1234"
        })
        resp = client.post("/api/auth/login", json={
            "name": name, "password": "pass1234"
        })
        assert resp.status_code == 200
        assert "token" in resp.json()


def test_auth_me():
    with TestClient(app) as client:
        token, _ = _register(client, "me")
        resp = client.get("/api/auth/me", headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["user_name"].startswith("test_me_")


def test_kb_stats():
    with TestClient(app) as client:
        token, _ = _register(client, "stats")
        resp = client.get("/api/knowledge/stats", headers=_auth(token))
        assert resp.status_code == 200
        data = resp.json()
        assert "文档数" in data
        assert "切片数" in data


def test_kb_rebuild():
    with TestClient(app) as client:
        token, _ = _register(client, "rebuild")
        resp = client.post("/api/knowledge/rebuild", headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["success"] is True


def test_kb_delete_not_found():
    with TestClient(app) as client:
        token, _ = _register(client, "delnf")
        resp = client.delete("/api/knowledge/nonexistent_file.txt", headers=_auth(token))
        assert resp.status_code == 404


def test_kb_upload_reject_invalid_type():
    with TestClient(app) as client:
        token, _ = _register(client, "upload")
        fake_exe = io.BytesIO(b"malicious content")
        resp = client.post(
            "/api/knowledge/upload",
            files={"file": ("evil.exe", fake_exe, "application/octet-stream")},
            headers=_auth(token),
        )
        assert resp.status_code == 400
        data = resp.json()
        assert data["success"] is False
        assert "不支持" in data["error"]


def test_kb_delete_success():
    with TestClient(app) as client:
        token, user_id = _register(client, "delok")
        _BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        doc_dir = os.path.join(_BASE, "rag", "documents", user_id)
        os.makedirs(doc_dir, exist_ok=True)
        tmp_path = os.path.join(doc_dir, "_test_delete_me.txt")
        with open(tmp_path, "w", encoding="utf-8") as f:
            f.write("temp file for delete test")
        try:
            resp = client.delete("/api/knowledge/_test_delete_me.txt", headers=_auth(token))
            assert resp.status_code == 200
            assert resp.json()["success"] is True
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)


def test_kb_upload_text_file():
    with TestClient(app) as client:
        token, _ = _register(client, "upok")
        fake_txt = io.BytesIO(b"hello world\nthis is a test document.")
        resp = client.post(
            "/api/knowledge/upload",
            files={"file": ("test_doc.txt", fake_txt, "text/plain")},
            headers=_auth(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["filename"] == "test_doc.txt"
