import io
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uuid
import pytest
import sqlite3
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


class TestMigration:
    def test_fresh_db_creates_all_tables(self):
        """空白数据库 → 直接到 v2，所有表创建正确"""
        with TestClient(app) as client:
            token, _ = _register(client, "mig_fresh")
            db = app.state.db
            with db._conn() as conn:
                # 验证版本表
                v = conn.execute(
                    "SELECT MAX(version) FROM schema_version"
                ).fetchone()[0]
                assert v == db.TARGET_SCHEMA_VERSION

                # 验证业务表存在
                tables = conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
                table_names = [t[0] for t in tables]
                for expected in ["users", "sessions", "user_configs",
                                 "schema_version"]:
                    assert expected in table_names, \
                        f"表 {expected} 缺失"

    def test_version_ahead_rejected(self, tmp_path):
        """版本超前 → RuntimeError 拒绝启动"""
        db_path = os.path.join(tmp_path, "test_future.db")
        conn = sqlite3.connect(db_path)
        conn.execute("CREATE TABLE schema_version (version INTEGER PRIMARY KEY)")
        conn.execute("INSERT INTO schema_version VALUES (99)")
        conn.commit()
        conn.close()

        from user.db import Database
        with pytest.raises(RuntimeError, match="版本.*高于代码版本"):
            Database(db_path)

    def test_migration_idempotent(self):
        """幂等：重复运行不报错"""
        with TestClient(app) as client:
            _register(client, "mig_idem")
            db = app.state.db
            # 二次调用 _init_db 不应报错
            db._init_db()
            with db._conn() as conn:
                v = conn.execute(
                    "SELECT MAX(version) FROM schema_version"
                ).fetchone()[0]
                assert v == db.TARGET_SCHEMA_VERSION
