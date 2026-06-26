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


class TestFts5Sync:
    def test_upsert_creates_fts_entries(self):
        """upsert_session 后 FTS5 可检索到新消息"""
        with TestClient(app) as client:
            token, user_id = _register(client, "fts_up")
            db = app.state.db

            sid = f"test_{uuid.uuid4().hex[:8]}"
            msgs = [
                {"role": "user", "content": "帮我写一个 Python 爬虫"},
                {"role": "assistant", "content": "好的，这里是一个爬虫示例..."},
                {"role": "user", "content": ""},  # 空消息不应入库
            ]
            db.upsert_session(sid, user_id, msgs, "爬虫教程")

            with db._conn() as conn:
                rows = conn.execute(
                    "SELECT msg_index, role FROM messages_fts "
                    "WHERE session_id = ? ORDER BY msg_index",
                    (sid,),
                ).fetchall()
            # 只有 2 条有效内容入库
            assert len(rows) == 2
            assert rows[0]["msg_index"] == 0
            assert rows[0]["role"] == "user"
            assert rows[1]["msg_index"] == 1
            assert rows[1]["role"] == "assistant"

    def test_upsert_replaces_old_fts_entries(self):
        """更新会话后旧消息在 FTS5 中被替换"""
        with TestClient(app) as client:
            token, user_id = _register(client, "fts_up2")
            db = app.state.db

            sid = f"test_{uuid.uuid4().hex[:8]}"
            msgs_v1 = [{"role": "user", "content": "原来的消息"}]
            db.upsert_session(sid, user_id, msgs_v1, "旧标题")

            msgs_v2 = [{"role": "user", "content": "更新后的消息"}
                      ]
            db.upsert_session(sid, user_id, msgs_v2, "新标题")

            with db._conn() as conn:
                rows = conn.execute(
                    "SELECT content FROM messages_fts WHERE session_id = ?",
                    (sid,),
                ).fetchall()
            assert len(rows) == 1
            assert "更新后" in rows[0]["content"]

    def test_delete_removes_fts_entries(self):
        """delete_session 后 FTS5 记录同步删除"""
        with TestClient(app) as client:
            token, user_id = _register(client, "fts_del")
            db = app.state.db

            sid = f"test_{uuid.uuid4().hex[:8]}"
            msgs = [{"role": "user", "content": "会被删除的消息"}]
            db.upsert_session(sid, user_id, msgs)

            result = db.delete_session(sid)
            assert result is True

            with db._conn() as conn:
                rows = conn.execute(
                    "SELECT COUNT(*) AS cnt FROM messages_fts "
                    "WHERE session_id = ?",
                    (sid,),
                ).fetchone()
            assert rows["cnt"] == 0

    def test_empty_messages_not_indexed(self):
        """空消息（content 为空或纯空白）不被写入 FTS5"""
        with TestClient(app) as client:
            token, user_id = _register(client, "fts_empty")
            db = app.state.db

            sid = f"test_{uuid.uuid4().hex[:8]}"
            msgs = [
                {"role": "user", "content": ""},
                {"role": "user", "content": "   "},
                {"role": "assistant", "content": "唯一有效消息"},
            ]
            db.upsert_session(sid, user_id, msgs)

            with db._conn() as conn:
                rows = conn.execute(
                    "SELECT content FROM messages_fts WHERE session_id = ?",
                    (sid,),
                ).fetchall()
            assert len(rows) == 1
            assert "唯一有效消息" in rows[0]["content"]

    def test_backfill_on_v2_migration(self, tmp_path):
        """v1 数据库迁移到 v2，已有会话回填到 FTS5"""
        import json as _json
        db_path = os.path.join(tmp_path, "test_backfill.db")

        # 手动创建 v1 数据库
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL DEFAULT '',
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                title TEXT DEFAULT '', messages TEXT DEFAULT '[]',
                updated_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS user_configs (
                user_id TEXT PRIMARY KEY, roles TEXT DEFAULT '{}',
                models TEXT DEFAULT '[]',
                updated_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT DEFAULT (datetime('now', 'localtime'))
            );
        """)
        uid = "backfill_user"
        sid = "backfill_session"
        conn.execute("INSERT INTO users (id, name) VALUES (?, ?)", (uid, "test"))
        messages = [
            {"role": "user", "content": "回填测试消息"},
            {"role": "assistant", "content": "收到，这条应该进 FTS5"},
        ]
        conn.execute(
            "INSERT INTO sessions (id, user_id, messages) VALUES (?, ?, ?)",
            (sid, uid, _json.dumps(messages, ensure_ascii=False)),
        )
        conn.execute("INSERT INTO schema_version (version) VALUES (1)")
        conn.commit()
        conn.close()

        # 用 Database 打开，应触发 v2 迁移并回填
        from user.db import Database
        db = Database(db_path)
        with db._conn() as conn:
            rows = conn.execute(
                "SELECT content FROM messages_fts WHERE session_id = ? "
                "ORDER BY msg_index",
                (sid,),
            ).fetchall()
        assert len(rows) == 2
        assert "回填测试" in rows[0]["content"]
        assert "这条应该进" in rows[1]["content"]
