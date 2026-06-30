import os, sys, uuid
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from main import app

def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}

def _register(client, suffix: str = ""):
    name = f"test_{suffix}_{uuid.uuid4().hex[:6]}"
    resp = client.post("/api/auth/register", json={"name": name, "email": f"{name}@t.com", "password": "test1234"})
    assert resp.status_code == 200, f"Registration failed: {resp.json()}"
    data = resp.json()
    return data["token"], data["user_id"]

def _create_workspace_and_project(client, token):
    # Create workspace
    resp = client.post("/api/workspaces", json={"name": "test_workspace", "description": ""}, headers=_auth(token))
    assert resp.status_code == 201
    ws_id = resp.json()["id"]

    # Create project
    resp = client.post(f"/api/w/{ws_id}/projects", json={"name": "test_project", "description": ""}, headers=_auth(token))
    assert resp.status_code == 201
    proj_id = resp.json()["id"]

    return ws_id, proj_id

def test_eval_logs():
    with TestClient(app) as client:
        token, user_id = _register(client, "eval1")
        ws_id, proj_id = _create_workspace_and_project(client, token)

        # 1. Create eval log
        log_data = {
            "project_id": proj_id,
            "session_id": "test_sess_123",
            "task_type": "Data Analysis",
            "complexity": "Medium",
            "agent_count": 3,
            "total_tokens": 1500,
            "elapsed_ms": 5000,
            "has_error": False
        }
        resp = client.post("/api/eval/log", json=log_data, headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

        # 2. Get eval stats
        resp = client.get(f"/api/eval/stats/{proj_id}", headers=_auth(token))
        assert resp.status_code == 200
        stats = resp.json()
        assert stats["total"] == 1
        assert stats["total_tokens"] == 1500
        assert stats["avg_elapsed_ms"] == 5000
        assert stats["error_rate"] == 0.0
        assert stats["task_types"]["Data Analysis"] == 1

        # 3. Test days filter
        resp = client.get(f"/api/eval/stats/{proj_id}?days=7", headers=_auth(token))
        assert resp.status_code == 200
        stats = resp.json()
        assert stats["total"] == 1

def test_eval_stats_token_accumulation():
    """多条写入 total_tokens 应累加，has_error 不影响 SUM"""
    with TestClient(app) as client:
        token, user_id = _register(client, "tok_acc")
        ws_id, proj_id = _create_workspace_and_project(client, token)

        base = {
            "project_id": proj_id,
            "session_id": "tok_acc_sess",
            "task_type": "Coding",
            "complexity": "Low",
            "agent_count": 2,
            "elapsed_ms": 1000,
            "has_error": False,
        }

        # 写入 3 条
        for tokens in [1000, 2500, 500]:
            client.post("/api/eval/log", json={**base, "total_tokens": tokens}, headers=_auth(token))

        stats = client.get(f"/api/eval/stats/{proj_id}", headers=_auth(token)).json()
        assert stats["total"] == 3
        assert stats["total_tokens"] == 4000  # 1000 + 2500 + 500
        assert stats["avg_elapsed_ms"] == 1000


def test_eval_stats_token_project_isolation():
    """不同项目的 total_tokens 互不干扰"""
    with TestClient(app) as client:
        token, user_id = _register(client, "tok_iso")
        ws_id, proj_a = _create_workspace_and_project(client, token)
        ws_id, proj_b = _create_workspace_and_project(client, token)

        def log(pid, tokens):
            client.post("/api/eval/log", json={
                "project_id": pid, "session_id": "iso", "task_type": "Writing",
                "complexity": "Low", "agent_count": 1, "total_tokens": tokens,
                "elapsed_ms": 100, "has_error": False,
            }, headers=_auth(token))

        log(proj_a, 7000)
        log(proj_a, 3000)
        log(proj_b, 500)

        stats_a = client.get(f"/api/eval/stats/{proj_a}", headers=_auth(token)).json()
        stats_b = client.get(f"/api/eval/stats/{proj_b}", headers=_auth(token)).json()

        assert stats_a["total_tokens"] == 10000  # 7000 + 3000
        assert stats_b["total_tokens"] == 500     # 只有一条
        assert stats_a["total"] == 2
        assert stats_b["total"] == 1


def test_eval_stats_token_with_errors():
    """has_error=1 的条目 total_tokens 仍计入 SUM"""
    with TestClient(app) as client:
        token, user_id = _register(client, "tok_err")
        ws_id, proj_id = _create_workspace_and_project(client, token)

        base = {
            "project_id": proj_id, "session_id": "err_sess", "task_type": "Testing",
            "complexity": "High", "agent_count": 1, "elapsed_ms": 2000,
        }

        client.post("/api/eval/log", json={**base, "total_tokens": 800, "has_error": True}, headers=_auth(token))
        client.post("/api/eval/log", json={**base, "total_tokens": 200, "has_error": False}, headers=_auth(token))
        client.post("/api/eval/log", json={**base, "total_tokens": 1000, "has_error": True}, headers=_auth(token))

        stats = client.get(f"/api/eval/stats/{proj_id}", headers=_auth(token)).json()
        assert stats["total"] == 3
        assert stats["total_tokens"] == 2000     # 800 + 200 + 1000
        assert stats["error_rate"] == round(2 / 3 * 100, 1)  # 2/3 有 error


def test_eval_stats_token_days_filter():
    """days 参数应过滤超出时间范围的 token"""
    import time

    with TestClient(app) as client:
        token, user_id = _register(client, "tok_day")
        ws_id, proj_id = _create_workspace_and_project(client, token)

        base = {
            "project_id": proj_id, "session_id": "day_sess", "task_type": "QA",
            "complexity": "Low", "agent_count": 1, "elapsed_ms": 100,
            "has_error": False, "total_tokens": 9999,
        }
        client.post("/api/eval/log", json=base, headers=_auth(token))

        # 全量统计应包含该条
        stats_all = client.get(f"/api/eval/stats/{proj_id}", headers=_auth(token)).json()
        assert stats_all["total_tokens"] == 9999

        # days=365 足够大，应包含
        stats_wide = client.get(f"/api/eval/stats/{proj_id}?days=365", headers=_auth(token)).json()
        assert stats_wide["total_tokens"] == 9999


def test_monitor_session():
    with TestClient(app) as client:
        token, user_id = _register(client, "mon1")
        
        # Test empty session
        session_id = f"sess_{uuid.uuid4().hex[:6]}"
        resp = client.get(f"/api/monitor/session/{session_id}", headers=_auth(token))
        assert resp.status_code == 200
        data = resp.json()
        assert data["session_id"] == session_id
        assert data["steps"] == []

        # We need a way to insert step logs. Currently there is no API endpoint to post a step log directly from the client.
        # But we can access the DB directly through app.state.db to insert a log and test the GET endpoint.
        db = app.state.db
        
        # Insert a step log
        db.create_step_log(
            session_id=session_id,
            task_type="Code Generation",
            agent_name="Coder",
            status="done",
            elapsed_ms=2500,
            token_count=1200
        )
        
        # Insert ANOTHER step log for the same agent
        db.create_step_log(
            session_id=session_id,
            task_type="Code Generation",
            agent_name="Coder",
            status="done",
            elapsed_ms=1000,
            token_count=300
        )
        
        # Now fetch the monitor session again
        resp = client.get(f"/api/monitor/session/{session_id}", headers=_auth(token))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["steps"]) == 1  # Should be merged into 1
        step = data["steps"][0]
        assert step["name"] == "Coder"
        assert step["status"] == "done"
        assert step["elapsed_ms"] == 3500  # 2500 + 1000
        assert step["token_count"] == 1500 # 1200 + 300
        assert data["task_type"] == "Code Generation"
