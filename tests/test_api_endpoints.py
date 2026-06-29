"""
Comprehensive API endpoint tests — simulates frontend network requests.
Covers auth, workspaces, projects, sessions, user config, and chat pipelines.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uuid
import pytest
from fastapi.testclient import TestClient
from main import app


# ─── Helpers ────────────────────────────────────────────────────────────────


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register(client, suffix: str = "") -> tuple[str, str]:
    """Register a test user, return (token, user_id)."""
    name = f"t_{suffix}_{uuid.uuid4().hex[:6]}"
    resp = client.post("/api/auth/register", json={"name": name, "email": f"{name}@t.com", "password": "test1234"})
    assert resp.status_code in (200, 201), f"register failed: {resp.json()}"
    data = resp.json()
    return data["token"], data["user_id"]


def _create_workspace(client, token: str) -> str:
    """Create a workspace, return its id."""
    name = f"ws_{uuid.uuid4().hex[:6]}"
    resp = client.post(
        "/api/workspaces",
        json={"name": name, "description": "test workspace"},
        headers=_auth(token),
    )
    assert resp.status_code in (200, 201), f"create workspace failed: {resp.json()}"
    return resp.json()["id"]


def _create_project(client, token: str, ws_id: str) -> str:
    """Create a project in given workspace, return its id."""
    name = f"proj_{uuid.uuid4().hex[:6]}"
    resp = client.post(
        f"/api/w/{ws_id}/projects",
        json={"name": name, "description": "test project"},
        headers=_auth(token),
    )
    assert resp.status_code in (200, 201), f"create project failed: {resp.json()}"
    return resp.json()["id"]


# ─── Health ─────────────────────────────────────────────────────────────────


class TestHealth:
    def test_health(self):
        with TestClient(app) as client:
            resp = client.get("/api/health")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "ok"


# ─── Auth ───────────────────────────────────────────────────────────────────


class TestAuth:
    def test_register(self):
        with TestClient(app) as client:
            token, uid = _register(client, "reg")
            assert token
            assert uid

    def test_login(self):
        with TestClient(app) as client:
            name = f"login_{uuid.uuid4().hex[:6]}"
            client.post("/api/auth/register", json={"name": name, "email": f"{name}@t.com", "password": "pass1234"})
            resp = client.post("/api/auth/login", json={"name": name, "password": "pass1234"})
            assert resp.status_code == 200
            assert "token" in resp.json()

    def test_me(self):
        with TestClient(app) as client:
            token, _ = _register(client, "me")
            resp = client.get("/api/auth/me", headers=_auth(token))
            assert resp.status_code == 200
            assert resp.json()["user_name"].startswith("t_me_")

    def test_verify(self):
        with TestClient(app) as client:
            token, _ = _register(client, "vfy")
            resp = client.get("/api/auth/verify", headers=_auth(token))
            assert resp.status_code == 200

    def test_system_config(self):
        with TestClient(app) as client:
            resp = client.get("/api/auth/system-config")
            assert resp.status_code == 200
            data = resp.json()
            # may return "model_pool" or "models" depending on version
            assert "model_pool" in data or "models" in data


# ─── Workspaces ─────────────────────────────────────────────────────────────


class TestWorkspaces:
    def test_list_empty(self):
        with TestClient(app) as client:
            token, _ = _register(client, "ws_list")
            resp = client.get("/api/workspaces", headers=_auth(token))
            assert resp.status_code == 200
            assert isinstance(resp.json(), list)

    def test_create_and_get(self):
        with TestClient(app) as client:
            token, _ = _register(client, "ws_cg")
            ws_id = _create_workspace(client, token)
            resp = client.get(f"/api/workspaces/{ws_id}", headers=_auth(token))
            assert resp.status_code == 200
            assert resp.json()["id"] == ws_id

    def test_update(self):
        with TestClient(app) as client:
            token, _ = _register(client, "ws_up")
            ws_id = _create_workspace(client, token)
            resp = client.put(
                f"/api/workspaces/{ws_id}",
                json={"name": "updated_name"},
                headers=_auth(token),
            )
            assert resp.status_code == 200

    def test_delete(self):
        with TestClient(app) as client:
            token, _ = _register(client, "ws_del")
            ws_id = _create_workspace(client, token)
            resp = client.delete(f"/api/workspaces/{ws_id}", headers=_auth(token))
            assert resp.status_code == 200

    def test_create_and_list(self):
        with TestClient(app) as client:
            token, _ = _register(client, "ws_cl")
            _create_workspace(client, token)
            resp = client.get("/api/workspaces", headers=_auth(token))
            assert resp.status_code == 200
            assert len(resp.json()) >= 1


# ─── Projects ───────────────────────────────────────────────────────────────


class TestProjects:
    def test_create_and_list(self):
        with TestClient(app) as client:
            token, _ = _register(client, "pj_cl")
            ws_id = _create_workspace(client, token)
            resp = client.get(f"/api/w/{ws_id}/projects", headers=_auth(token))
            assert resp.status_code == 200
            before = len(resp.json())
            _create_project(client, token, ws_id)
            resp = client.get(f"/api/w/{ws_id}/projects", headers=_auth(token))
            assert len(resp.json()) == before + 1

    def test_get(self):
        with TestClient(app) as client:
            token, _ = _register(client, "pj_get")
            ws_id = _create_workspace(client, token)
            proj_id = _create_project(client, token, ws_id)
            resp = client.get(f"/api/projects/{proj_id}", headers=_auth(token))
            assert resp.status_code == 200
            assert resp.json()["id"] == proj_id

    def test_delete(self):
        with TestClient(app) as client:
            token, _ = _register(client, "pj_del")
            ws_id = _create_workspace(client, token)
            proj_id = _create_project(client, token, ws_id)
            resp = client.delete(f"/api/projects/{proj_id}", headers=_auth(token))
            assert resp.status_code == 200

    def test_agent_config_not_implemented(self):
        """agent-config endpoints are NOT implemented — should return 404."""
        with TestClient(app) as client:
            token, _ = _register(client, "ag_cfg")
            ws_id = _create_workspace(client, token)
            proj_id = _create_project(client, token, ws_id)
            resp = client.get(
                f"/api/projects/{proj_id}/agent-config",
                headers=_auth(token),
            )
            assert resp.status_code == 404, f"expected 404, got {resp.status_code}: {resp.json()}"
            resp = client.put(
                f"/api/projects/{proj_id}/agent-config",
                json={"enabled_agents": ["Planner", "Coder"]},
                headers=_auth(token),
            )
            assert resp.status_code == 404, f"expected 404, got {resp.status_code}: {resp.json()}"


# ─── Sessions ───────────────────────────────────────────────────────────────


class TestSessions:
    def test_list(self):
        with TestClient(app) as client:
            token, _ = _register(client, "sess_list")
            resp = client.get("/api/sessions", headers=_auth(token))
            assert resp.status_code == 200
            assert isinstance(resp.json(), list)

    def test_save_and_get(self):
        with TestClient(app) as client:
            token, _ = _register(client, "sess_sg")
            sess_id = uuid.uuid4().hex
            resp = client.post(
                "/api/sessions",
                json={"id": sess_id, "title": "test", "messages": []},
                headers=_auth(token),
            )
            assert resp.status_code == 200
            resp = client.get(f"/api/sessions/{sess_id}", headers=_auth(token))
            assert resp.status_code == 200
            assert "messages" in resp.json()

    def test_delete(self):
        with TestClient(app) as client:
            token, _ = _register(client, "sess_del")
            sess_id = uuid.uuid4().hex
            client.post(
                "/api/sessions",
                json={"id": sess_id, "title": "del", "messages": []},
                headers=_auth(token),
            )
            resp = client.delete(f"/api/sessions/{sess_id}", headers=_auth(token))
            assert resp.status_code == 200


# ─── User Config ────────────────────────────────────────────────────────────


class TestUserConfig:
    def test_get_config(self):
        with TestClient(app) as client:
            token, _ = _register(client, "uc_get")
            resp = client.get("/api/user/config", headers=_auth(token))
            assert resp.status_code == 200
            assert "roles" in resp.json()

    def test_get_profile(self):
        with TestClient(app) as client:
            token, _ = _register(client, "up_get")
            resp = client.get("/api/user/profile", headers=_auth(token))
            assert resp.status_code == 200
            assert "user_name" in resp.json()


# ─── Report (no auth required) ──────────────────────────────────────────────


class TestReport:
    def test_report_empty(self):
        with TestClient(app) as client:
            resp = client.post("/api/report", json={"thinking": []})
            assert resp.status_code == 200
            data = resp.json()
            assert "content" in data
            assert "path" in data

    def test_report_with_thinking(self):
        with TestClient(app) as client:
            resp = client.post(
                "/api/report",
                json={
                    "thinking": [
                        {"name": "Bot", "content": "Hello!"},
                    ]
                },
            )
            assert resp.status_code == 200
            data = resp.json()
            assert isinstance(data["content"], str)
            assert len(data["content"]) > 0


# ─── Chat endpoints ─────────────────────────────────────────────────────────
# These require actual LLM API keys. If keys are missing / invalid,
# the endpoints should still return a structured error response.


class TestChat:
    @pytest.mark.skipif(
        not os.environ.get("DEEPSEEK_API_KEY"), reason="DEEPSEEK_API_KEY not set — skip LLM-dependent test"
    )
    def test_chat_guest_sync(self):
        """POST /api/chat/guest — sync, no auth required."""
        with TestClient(app) as client:
            resp = client.post(
                "/api/chat/guest",
                json={
                    "message": "你好",
                    "lane_mode": "fast",
                },
            )
            assert resp.status_code == 200, f"guest chat failed: {resp.json()}"
            data = resp.json()
            assert "reply" in data
            assert "thinking" in data
            assert "task_type" in data

    def test_chat_guest_sync_without_api_key_structure(self):
        """Verify endpoint returns a structured response even without API key."""
        with TestClient(app) as client:
            resp = client.post(
                "/api/chat/guest",
                json={
                    "message": "hi",
                    "lane_mode": "fast",
                },
            )
            assert resp.status_code in (200, 500)
            if resp.status_code == 500:
                data = resp.json()
                assert "reply" in data
                assert "error" in data

    @pytest.mark.skipif(
        not os.environ.get("DEEPSEEK_API_KEY"), reason="DEEPSEEK_API_KEY not set — skip LLM-dependent test"
    )
    def test_chat_auth_sync(self):
        """POST /api/chat — sync, auth required."""
        with TestClient(app) as client:
            token, _ = _register(client, "chat_auth")
            resp = client.post(
                "/api/chat",
                json={"message": "写一个Hello World", "lane_mode": "fast"},
                headers=_auth(token),
            )
            assert resp.status_code == 200, f"auth chat failed: {resp.json()}"
            data = resp.json()
            assert "reply" in data
            assert "thinking" in data
            assert "task_type" in data

    @pytest.mark.skipif(
        not os.environ.get("DEEPSEEK_API_KEY"), reason="DEEPSEEK_API_KEY not set — skip LLM-dependent test"
    )
    def test_chat_start_stream(self):
        """POST /api/chat/start + GET /api/chat/stream/{id} — streaming."""
        with TestClient(app) as client:
            token, _ = _register(client, "chat_str")
            resp = client.post(
                "/api/chat/start",
                json={"message": "简单测试", "lane_mode": "fast"},
                headers=_auth(token),
            )
            assert resp.status_code == 200
            session_id = resp.json().get("session_id")
            assert session_id is not None

            resp = client.get(
                f"/api/chat/stream/{session_id}",
                headers=_auth(token),
            )
            assert resp.status_code == 200

    @pytest.mark.skipif(
        not os.environ.get("DEEPSEEK_API_KEY"), reason="DEEPSEEK_API_KEY not set — skip LLM-dependent test"
    )
    def test_chat_cancel(self):
        """POST /api/chat/cancel/{id}."""
        with TestClient(app) as client:
            token, _ = _register(client, "chat_can")
            resp = client.post(
                "/api/chat/start",
                json={"message": "写一篇长报告", "lane_mode": "slow"},
                headers=_auth(token),
            )
            assert resp.status_code == 200
            session_id = resp.json()["session_id"]

            resp = client.post(
                f"/api/chat/cancel/{session_id}",
                headers=_auth(token),
            )
            assert resp.status_code == 200
            assert resp.json()["status"] == "cancelled"

    def test_chat_stream_unauthorized(self):
        """Streaming endpoints should reject unauthenticated requests."""
        with TestClient(app) as client:
            resp = client.get("/api/chat/stream/nonexistent")
            assert resp.status_code == 401

            resp = client.post("/api/chat/start", json={"message": "hi"})
            assert resp.status_code == 401


# ─── Organizations (optional) ──────────────────────────────────────────────


class TestOrganizations:
    def test_list(self):
        with TestClient(app) as client:
            token, _ = _register(client, "org_list")
            resp = client.get("/api/orgs", headers=_auth(token))
            assert resp.status_code == 200
            assert isinstance(resp.json(), list)

    def test_create(self):
        with TestClient(app) as client:
            token, _ = _register(client, "org_cr")
            name = f"org_{uuid.uuid4().hex[:6]}"
            resp = client.post(
                "/api/orgs",
                json={"name": name, "description": "test org"},
                headers=_auth(token),
            )
            assert resp.status_code in (200, 201), f"create org failed: {resp.json()}"
            data = resp.json()
            assert data["name"] == name
            assert "id" in data


# ─── 404 fallback ───────────────────────────────────────────────────────────


class TestFallback:
    def test_unknown_route(self):
        with TestClient(app) as client:
            resp = client.get("/api/nonexistent")
            assert resp.status_code == 404
