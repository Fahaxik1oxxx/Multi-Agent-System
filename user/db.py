"""
SQLite 数据库模块 —— 纯 CRUD，无业务校验。
users / sessions / user_configs 三张表。
"""

import json
import sqlite3
import time as _time
import uuid
from contextlib import contextmanager


class Database:
    """SQLite 数据库封装，纯增删改查，不包含业务校验。"""

    TARGET_SCHEMA_VERSION = 2
    # 0 → 无数据库 / 未初始化
    # 1 → 初始表: users, sessions, user_configs
    # 2 → 新增: messages_fts (FTS5)

    def __init__(self, db_path: str):
        self._path = db_path
        self._init_db()

    def _init_db(self):
        with self._conn() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")

            # 1. 确保 schema_version 表存在
            conn.execute("""
                CREATE TABLE IF NOT EXISTS schema_version (
                    version     INTEGER PRIMARY KEY,
                    applied_at  TEXT DEFAULT (datetime('now', 'localtime'))
                )
            """)

            # 2. 读取当前数据库版本（无记录则为 0）
            row = conn.execute(
                "SELECT MAX(version) FROM schema_version"
            ).fetchone()
            current = row[0] if row[0] is not None else 0

            # 3. 版本超前检查
            if current > self.TARGET_SCHEMA_VERSION:
                raise RuntimeError(
                    f"数据库 schema 版本 {current} 高于代码版本 "
                    f"{self.TARGET_SCHEMA_VERSION}，请升级代码或回滚数据库。"
                )

            # 4. 执行缺失的迁移
            for v in range(current + 1, self.TARGET_SCHEMA_VERSION + 1):
                self._run_migration(conn, v)
                conn.execute(
                    "INSERT INTO schema_version (version) VALUES (?)", (v,)
                )

    def _run_migration(self, conn, version: int):
        """执行指定版本的数据库迁移（幂等 — 全部使用 IF NOT EXISTS）"""
        if version == 1:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id         TEXT PRIMARY KEY,
                    name       TEXT NOT NULL UNIQUE,
                    password   TEXT NOT NULL DEFAULT '',
                    created_at TEXT DEFAULT (datetime('now', 'localtime'))
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    id         TEXT PRIMARY KEY,
                    user_id    TEXT NOT NULL,
                    title      TEXT DEFAULT '',
                    messages   TEXT DEFAULT '[]',
                    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
                    FOREIGN KEY (user_id) REFERENCES users(id)
                );
                CREATE TABLE IF NOT EXISTS user_configs (
                    user_id    TEXT PRIMARY KEY,
                    roles      TEXT DEFAULT '{}',
                    models     TEXT DEFAULT '[]',
                    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
                    FOREIGN KEY (user_id) REFERENCES users(id)
                );
            """)
        elif version == 2:
            # 将在 Task 2 中实现 messages_fts 创建和回填
            pass
        else:
            raise ValueError(f"未知的迁移版本: {version}")

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self._path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    # ── 用户 ──

    def insert_user(self, name: str, hashed_password: str) -> str:
        """插入用户，返回 user_id。"""
        uid = str(uuid.uuid4())[:8]
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO users (id, name, password) VALUES (?, ?, ?)",
                (uid, name, hashed_password),
            )
        return uid

    def get_user(self, name: str) -> dict | None:
        """按名称查找用户。返回 {"id", "name", "password"} 或 None。"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, name, password FROM users WHERE name = ?", (name,)
            ).fetchone()
            if row:
                return dict(row)
            return None

    def get_user_by_id(self, user_id: str) -> dict | None:
        """按 ID 查找用户。返回 {"id", "name"} 或 None。"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, name FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            if row:
                return dict(row)
            return None

    # ── 会话 ──

    def list_sessions(self, user_id: str) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, title, messages, updated_at FROM sessions "
                "WHERE user_id = ? ORDER BY updated_at DESC",
                (user_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def get_session(self, session_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, user_id, messages, updated_at FROM sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
            if not row:
                return None
            try:
                msgs = json.loads(row["messages"])
            except (json.JSONDecodeError, TypeError):
                msgs = []
            return {
                "id": row["id"],
                "user_id": row["user_id"],
                "messages": msgs,
                "updated": row["updated_at"] or "",
            }

    def upsert_session(self, session_id: str, user_id: str,
                       messages: list[dict], title: str = "") -> str:
        msgs_json = json.dumps(messages, ensure_ascii=False)
        with self._conn() as conn:
            existing = conn.execute(
                "SELECT id FROM sessions WHERE id = ?", (session_id,)
            ).fetchone()
            if existing:
                conn.execute(
                    "UPDATE sessions SET user_id=?, title=?, messages=?, "
                    "updated_at=datetime('now','localtime') WHERE id=?",
                    (user_id, title, msgs_json, session_id),
                )
            else:
                conn.execute(
                    "INSERT INTO sessions (id, user_id, title, messages) "
                    "VALUES (?, ?, ?, ?)",
                    (session_id, user_id, title, msgs_json),
                )
        return session_id

    def delete_session(self, session_id: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            return cur.rowcount > 0

    # ── 用户配置 ──

    def get_user_config(self, user_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT roles, models FROM user_configs WHERE user_id = ?", (user_id,)
            ).fetchone()
            if not row:
                return None
            return {
                "roles": json.loads(row["roles"]),
                "models": json.loads(row["models"]),
            }

    def upsert_user_config(self, user_id: str, roles: dict, models: list) -> bool:
        roles_json = json.dumps(roles, ensure_ascii=False)
        models_json = json.dumps(models, ensure_ascii=False)
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO user_configs (user_id, roles, models, updated_at) "
                "VALUES (?, ?, ?, datetime('now','localtime')) "
                "ON CONFLICT(user_id) DO UPDATE SET "
                "roles=excluded.roles, models=excluded.models, "
                "updated_at=datetime('now','localtime')",
                (user_id, roles_json, models_json),
            )
        return True

    def delete_user_config(self, user_id: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM user_configs WHERE user_id = ?", (user_id,))
            return cur.rowcount > 0

    def dump_all(self) -> str:
        """返回数据库全部内容的格式化字符串，用于实时观察。"""
        with self._conn() as conn:
            lines = [f"\n=== {_time.strftime('%H:%M:%S')} DB DUMP ==="]
            for table in ["users", "sessions", "user_configs"]:
                lines.append(f"[{table}]")
                for row in conn.execute(f"SELECT * FROM {table}"):
                    lines.append(f"  {dict(row)}")
            return "\n".join(lines)
