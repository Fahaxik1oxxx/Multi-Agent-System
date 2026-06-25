"""
SQLite 数据库模块 —— 用户与会话持久化。
使用标准库 sqlite3，WAL 模式，支持多用户并发。
"""

import json
import sqlite3
import uuid
from contextlib import contextmanager

import bcrypt


class Database:
    """SQLite 数据库封装，管理用户和会话两张表。"""

    def __init__(self, db_path: str):
        self._path = db_path
        self._init_db()

    def _init_db(self):
        """初始化数据库：启用 WAL + 外键 + 建表"""
        with self._conn() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id         TEXT PRIMARY KEY,
                    name       TEXT NOT NULL UNIQUE,
                    email      TEXT DEFAULT '',
                    password   TEXT NOT NULL DEFAULT '',
                    created_at TEXT DEFAULT (datetime('now', 'localtime'))
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    id         TEXT PRIMARY KEY,
                    user_id    TEXT NOT NULL,
                    title      TEXT DEFAULT '',
                    messages   TEXT DEFAULT '[]',
                    updated_at TEXT DEFAULT (datetime('now', 'localtime')),p
                    FOREIGN KEY (user_id) REFERENCES users(id)
                );
                CREATE TABLE IF NOT EXISTS auth_tokens (
                    token      TEXT PRIMARY KEY,
                    user_id    TEXT NOT NULL,
                    expires_at TEXT NOT NULL DEFAULT (datetime('now', '+7 days', 'localtime')),
                    created_at TEXT DEFAULT (datetime('now', 'localtime')),
                    FOREIGN KEY (user_id) REFERENCES users(id)
                );
            """)

    @contextmanager
    def _conn(self):
        """获取短期数据库连接，自动提交/关闭。异常时回滚。"""
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

    def create_user(self, name: str, email: str = "", password: str = "") -> dict:
        """创建用户。返回 {"id", "name", "token"}。已存在则报错。"""
        with self._conn() as conn:
            existing = conn.execute(
                "SELECT id FROM users WHERE name = ?", (name,)
            ).fetchone()
            if existing:
                raise ValueError(f"用户名已存在: {name}")
            uid = str(uuid.uuid4())[:8]
            hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            conn.execute(
                "INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)",
                (uid, name, email, hashed),
            )
            token = self.create_token(uid, conn)
            return {"id": uid, "name": name, "token": token}

    def get_user(self, name: str) -> dict | None:
        """按名称查找用户。找到返回 {"id", "name"}，否则 None。"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, name FROM users WHERE name = ?", (name,)
            ).fetchone()
            if row:
                return {"id": row["id"], "name": row["name"]}
            return None

    # ── 认证 ──

    def create_token(self, user_id: str, _conn=None) -> str:
        """为用户生成 auth token（7 天有效期），返回 token 字符串"""
        token = str(uuid.uuid4())
        sql = ("INSERT INTO auth_tokens (token, user_id, expires_at) "
               "VALUES (?, ?, datetime('now', '+7 days', 'localtime'))")
        if _conn is not None:
            _conn.execute(sql, (token, user_id))
        else:
            with self._conn() as conn:
                conn.execute(sql, (token, user_id))
        return token

    def delete_token(self, token: str) -> bool:
        """删除 token，返回是否成功"""
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM auth_tokens WHERE token = ?", (token,))
            return cur.rowcount > 0

    def authenticate(self, name: str, password: str) -> dict | None:
        """验证用户名密码，成功返回 {"id", "name", "token"}，失败返回 None"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, name, password FROM users WHERE name = ?", (name,)
            ).fetchone()
            if not row:
                return None
            if not bcrypt.checkpw(password.encode("utf-8"), row["password"].encode("utf-8")):
                return None
            token = self.create_token(row["id"])
            return {"id": row["id"], "name": row["name"], "token": token}

    def get_user_by_token(self, token: str) -> dict | None:
        """从 token 获取用户信息（自动过滤过期 Token），返回 {"id", "name"} 或 None"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT u.id, u.name FROM users u "
                "JOIN auth_tokens t ON u.id = t.user_id "
                "WHERE t.token = ? AND t.expires_at > datetime('now', 'localtime')",
                (token,)
            ).fetchone()
            if not row:
                return None
            return {"id": row["id"], "name": row["name"]}

    def renew_token(self, token: str) -> bool:
        """续期 Token 到 7 天后，返回是否成功"""
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE auth_tokens SET expires_at = datetime('now', '+7 days', 'localtime') "
                "WHERE token = ?", (token,)
            )
            return cur.rowcount > 0

    def cleanup_user_tokens(self, user_id: str):
        """清理指定用户的所有过期 Token"""
        with self._conn() as conn:
            conn.execute(
                "DELETE FROM auth_tokens WHERE user_id = ? "
                "AND expires_at < datetime('now', 'localtime')",
                (user_id,)
            )

    def is_token_expired(self, token: str) -> bool:
        """检查 Token 是否存在且已过期（不存在返回 False）"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT expires_at FROM auth_tokens WHERE token = ?", (token,)
            ).fetchone()
            if not row:
                return False
            from datetime import datetime
            try:
                expiry = datetime.fromisoformat(row["expires_at"])
            except (ValueError, TypeError):
                return True
            return expiry < datetime.now()

    # ── 会话 ──

    def list_sessions(self, user_id: str) -> list[dict]:
        """列出某用户的所有会话摘要，按更新时间倒序。
        返回 [{"id", "title", "count", "updated"}, ...]"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, title, messages, updated_at FROM sessions "
                "WHERE user_id = ? ORDER BY updated_at DESC",
                (user_id,),
            ).fetchall()
            result = []
            for r in rows:
                try:
                    msgs = json.loads(r["messages"])
                except (json.JSONDecodeError, TypeError):
                    msgs = []
                first = ""
                for m in msgs:
                    c = m.get("content", "")
                    if c:
                        first = c[:50]
                        break
                result.append({
                    "id": r["id"],
                    "title": first or r["title"] or "空对话",
                    "count": len(msgs),
                    "updated": r["updated_at"] or "",
                })
            return result

    def get_session(self, session_id: str) -> dict | None:
        """获取单个会话完整数据。
        返回 {"id", "user_id", "messages", "updated"} 或 None"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, user_id, messages, updated_at FROM sessions "
                "WHERE id = ?",
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

    def save_session(self, session_id: str, user_id: str,
                     messages: list[dict], title: str = "") -> dict:
        """创建或更新会话（UPSERT）。返回 {"id": str, "status": "ok"}"""
        with self._conn() as conn:
            # 确保用户存在（容错：数据库重建后前端可能持有旧 user_id）
            user_exists = conn.execute(
                "SELECT id FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            if not user_exists:
                # 用 user_id 作为 name 的兜底方案创建用户
                conn.execute(
                    "INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)",
                    (user_id, f"用户_{user_id}"),
                )
            existing = conn.execute(
                "SELECT id FROM sessions WHERE id = ?", (session_id,)
            ).fetchone()
            msgs_json = json.dumps(messages, ensure_ascii=False)
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
        return {"id": session_id, "status": "ok"}

    def delete_session(self, session_id: str) -> bool:
        """删除会话。返回 True 表示删除成功，False 表示不存在。"""
        with self._conn() as conn:
            cur = conn.execute(
                "DELETE FROM sessions WHERE id = ?", (session_id,)
            )
            return cur.rowcount > 0
