"""
SQLite 数据库模块 —— 纯 CRUD，无业务校验。
users / sessions / user_configs 三张表。
"""

import base64
import datetime
import hashlib
import json
import os
import sqlite3
import time as _time
import uuid
from contextlib import contextmanager

from cryptography.fernet import Fernet


class Database:
    """SQLite 数据库封装，纯增删改查，不包含业务校验。"""

    TARGET_SCHEMA_VERSION = 10
    # 0 → 无数据库 / 未初始化
    # 1 → 初始表: users, sessions, user_configs
    # 2 → 新增: messages_fts (FTS5)
    # 3 → 新增: workspaces, workspace_members, projects + is_admin 列
    # 4 → 新增: eval_logs
    # 5 → 新增: organizations, org_members, org_channels, org_messages, org_todos
    # 6 → 新增: 10 个关键索引
    # 7 → 新增: users 表 avatar_seed, bio, email 列
    # 8 → 新增: step_logs + 索引
    # 9 → 新增: org_files
    # 10 → 新增: saved_configs, audit_logs + users.goal 列

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
            row = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()
            current = row[0] if row[0] is not None else 0

            # 3. 版本超前检查
            if current > self.TARGET_SCHEMA_VERSION:
                raise RuntimeError(
                    f"数据库 schema 版本 {current} 高于代码版本 {self.TARGET_SCHEMA_VERSION}，请升级代码或回滚数据库。"
                )

            # 4. 执行缺失的迁移
            for v in range(current + 1, self.TARGET_SCHEMA_VERSION + 1):
                self._run_migration(conn, v)
                conn.execute("INSERT INTO schema_version (version) VALUES (?)", (v,))

    def _get_fernet(self) -> Fernet:
        """从 JWT_SECRET 派生 Fernet 加密密钥（32 字节 base64）。"""
        if not hasattr(self, "_fernet_cache"):
            secret = os.getenv("JWT_SECRET", "")
            if not secret:
                raise RuntimeError("JWT_SECRET 未设置，无法加解密 API Key")
            key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())
            self._fernet_cache = Fernet(key)
        return self._fernet_cache

    @staticmethod
    def _create_index_safe(conn, idx_name: str, table: str, column: str):
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
            (idx_name,),
        )
        if not cur.fetchone():
            conn.execute(f"CREATE INDEX {idx_name} ON {table}({column})")

    def _run_migration(self, conn, version: int):
        """执行指定版本的数据库迁移（幂等 — 全部使用 IF NOT EXISTS）"""
        if version == 1:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id          TEXT PRIMARY KEY,
                    name        TEXT NOT NULL UNIQUE,
                    password    TEXT NOT NULL DEFAULT '',
                    avatar_seed TEXT DEFAULT '',
                    bio         TEXT DEFAULT '',
                    email       TEXT DEFAULT '',
                    created_at  TEXT DEFAULT (datetime('now', 'localtime'))
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
            conn.executescript("""
                CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                    session_id,
                    user_id,
                    msg_index,
                    role,
                    content,
                    tokenize='unicode61'
                );
            """)
            # 清理可能存在的残留数据（幂等保证）
            conn.execute("DELETE FROM messages_fts")
            # 回填已有会话
            import json as _json

            rows = conn.execute("SELECT id, user_id, messages FROM sessions").fetchall()
            for r in rows:
                try:
                    msgs = _json.loads(r["messages"])
                except (_json.JSONDecodeError, TypeError):
                    continue
                for i, msg in enumerate(msgs):
                    content = (msg.get("content", "") or "").strip()
                    role = msg.get("role", "") or ""
                    if content:
                        conn.execute(
                            "INSERT INTO messages_fts"
                            "(session_id, user_id, msg_index, role, content) "
                            "VALUES (?, ?, ?, ?, ?)",
                            (r["id"], r["user_id"], i, role, content),
                        )
        elif version == 3:
            conn.executescript("""
                ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0;

                CREATE TABLE IF NOT EXISTS workspaces (
                    id          TEXT PRIMARY KEY,
                    name        TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    owner_id    TEXT NOT NULL REFERENCES users(id),
                    is_public   INTEGER DEFAULT 0,
                    created_at  TEXT DEFAULT (datetime('now', 'localtime'))
                );

                CREATE TABLE IF NOT EXISTS workspace_members (
                    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    user_id      TEXT NOT NULL REFERENCES users(id),
                    role         TEXT NOT NULL DEFAULT 'member',
                    joined_at    TEXT DEFAULT (datetime('now', 'localtime')),
                    PRIMARY KEY (workspace_id, user_id)
                );

                CREATE TABLE IF NOT EXISTS projects (
                    id           TEXT PRIMARY KEY,
                    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    name         TEXT NOT NULL,
                    description  TEXT DEFAULT '',
                    agent_config TEXT DEFAULT '{}',
                    created_by   TEXT NOT NULL REFERENCES users(id),
                    created_at   TEXT DEFAULT (datetime('now', 'localtime'))
                );
            """)
        elif version == 4:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS eval_logs (
                    id           TEXT PRIMARY KEY,
                    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    session_id   TEXT DEFAULT '',
                    task_type    TEXT DEFAULT '',
                    complexity   TEXT DEFAULT '',
                    agent_count  INTEGER DEFAULT 0,
                    total_tokens INTEGER DEFAULT 0,
                    elapsed_ms   INTEGER DEFAULT 0,
                    has_error    INTEGER DEFAULT 0,
                    created_at   TEXT DEFAULT (datetime('now', 'localtime'))
                );
                CREATE INDEX IF NOT EXISTS idx_eval_project ON eval_logs(project_id);
                CREATE INDEX IF NOT EXISTS idx_eval_created ON eval_logs(created_at);
            """)
        elif version == 5:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS organizations (
                    id          TEXT PRIMARY KEY,
                    name        TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    invite_code TEXT NOT NULL UNIQUE,
                    owner_id    TEXT NOT NULL,
                    created_at  TEXT DEFAULT (datetime('now', 'localtime')),
                    FOREIGN KEY (owner_id) REFERENCES users(id)
                );
                CREATE TABLE IF NOT EXISTS org_members (
                    org_id    TEXT NOT NULL,
                    user_id   TEXT NOT NULL,
                    role      TEXT NOT NULL DEFAULT 'member',
                    joined_at TEXT DEFAULT (datetime('now', 'localtime')),
                    PRIMARY KEY (org_id, user_id),
                    FOREIGN KEY (org_id) REFERENCES organizations(id),
                    FOREIGN KEY (user_id) REFERENCES users(id)
                );
                CREATE TABLE IF NOT EXISTS org_channels (
                    id      TEXT PRIMARY KEY,
                    org_id  TEXT NOT NULL,
                    name    TEXT NOT NULL DEFAULT 'general',
                    FOREIGN KEY (org_id) REFERENCES organizations(id)
                );
                CREATE TABLE IF NOT EXISTS org_messages (
                    id         TEXT PRIMARY KEY,
                    channel_id TEXT NOT NULL,
                    user_id    TEXT NOT NULL,
                    content    TEXT NOT NULL,
                    is_agent   INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT (datetime('now', 'localtime')),
                    FOREIGN KEY (channel_id) REFERENCES org_channels(id),
                    FOREIGN KEY (user_id) REFERENCES users(id)
                );
                CREATE TABLE IF NOT EXISTS org_todos (
                    id          TEXT PRIMARY KEY,
                    org_id      TEXT NOT NULL,
                    content     TEXT NOT NULL,
                    assignee_id TEXT,
                    completed   INTEGER DEFAULT 0,
                    created_by  TEXT NOT NULL,
                    created_at  TEXT DEFAULT (datetime('now', 'localtime')),
                    FOREIGN KEY (org_id) REFERENCES organizations(id),
                    FOREIGN KEY (assignee_id) REFERENCES users(id)
                );
            """)
        elif version == 6:
            self._create_index_safe(conn, "idx_sessions_user", "sessions", "user_id")
            self._create_index_safe(conn, "idx_sessions_updated", "sessions", "updated_at")
            self._create_index_safe(conn, "idx_org_msgs_channel", "org_messages", "channel_id")
            self._create_index_safe(conn, "idx_org_msgs_created", "org_messages", "created_at")
            self._create_index_safe(conn, "idx_org_channels_org", "org_channels", "org_id")
            self._create_index_safe(conn, "idx_org_members_org", "org_members", "org_id")
            self._create_index_safe(conn, "idx_org_members_user", "org_members", "user_id")
            self._create_index_safe(conn, "idx_org_todos_org", "org_todos", "org_id")
            self._create_index_safe(conn, "idx_ws_members_user", "workspace_members", "user_id")
            self._create_index_safe(conn, "idx_projects_ws", "projects", "workspace_id")
        elif version == 7:
            for col, dtype in [("avatar_seed", "TEXT DEFAULT ''"), ("bio", "TEXT DEFAULT ''"), ("email", "TEXT DEFAULT ''")]:
                try:
                    conn.execute(f"ALTER TABLE users ADD COLUMN {col} {dtype}")
                except sqlite3.OperationalError:
                    pass  # 列已存在
        elif version == 8:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS step_logs (
                    id           TEXT PRIMARY KEY,
                    session_id   TEXT NOT NULL,
                    task_type    TEXT DEFAULT '',
                    agent_name   TEXT NOT NULL,
                    status       TEXT DEFAULT 'done',
                    elapsed_ms   INTEGER DEFAULT 0,
                    token_count  INTEGER DEFAULT 0,
                    created_at   TEXT DEFAULT (datetime('now', 'localtime'))
                );
                CREATE INDEX IF NOT EXISTS idx_step_session ON step_logs(session_id);
            """)
        elif version == 9:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS org_files (
                    id            TEXT PRIMARY KEY,
                    org_id        TEXT NOT NULL,
                    file_name     TEXT NOT NULL,
                    file_path     TEXT NOT NULL,
                    size          INTEGER DEFAULT 0,
                    mime_type     TEXT DEFAULT '',
                    uploaded_by   TEXT NOT NULL,
                    created_at    TEXT DEFAULT (datetime('now', 'localtime')),
                    updated_at    TEXT DEFAULT (datetime('now', 'localtime')),
                    FOREIGN KEY (org_id) REFERENCES organizations(id),
                    FOREIGN KEY (uploaded_by) REFERENCES users(id)
                );
            """)
        elif version == 10:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS saved_configs (
                    id           TEXT PRIMARY KEY,
                    user_id      TEXT NOT NULL,
                    project_id   TEXT,
                    name         TEXT NOT NULL,
                    agents       TEXT NOT NULL DEFAULT '[]',
                    pipeline     TEXT DEFAULT '{}',
                    prompts      TEXT DEFAULT '{}',
                    is_public    INTEGER DEFAULT 0,
                    github_url   TEXT DEFAULT '',
                    created_at   TEXT DEFAULT (datetime('now', 'localtime')),
                    updated_at   TEXT DEFAULT (datetime('now', 'localtime')),
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
                );
                CREATE INDEX IF NOT EXISTS idx_sc_user ON saved_configs(user_id);
                CREATE INDEX IF NOT EXISTS idx_sc_project ON saved_configs(project_id);
                CREATE INDEX IF NOT EXISTS idx_sc_public ON saved_configs(is_public, created_at);

                CREATE TABLE IF NOT EXISTS audit_logs (
                    id           TEXT PRIMARY KEY,
                    user_id      TEXT,
                    action       TEXT NOT NULL,
                    detail       TEXT DEFAULT '{}',
                    ip           TEXT DEFAULT '',
                    created_at   TEXT DEFAULT (datetime('now', 'localtime'))
                );
                CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, created_at);
                CREATE INDEX IF NOT EXISTS idx_audit_ip ON audit_logs(ip, created_at);
            """)
            try:
                conn.execute("ALTER TABLE users ADD COLUMN goal TEXT DEFAULT ''")
            except sqlite3.OperationalError:
                pass
        else:
            raise ValueError(f"未知的迁移版本: {version}")

    def _sync_fts(self, conn, session_id: str, user_id: str, messages: list[dict]) -> None:
        """先删后插，将 messages 同步到 messages_fts。
        调用方必须在同一个 with self._conn() 事务内传入 conn。"""
        conn.execute("DELETE FROM messages_fts WHERE session_id = ?", (session_id,))
        for i, msg in enumerate(messages):
            content = (msg.get("content", "") or "").strip()
            role = msg.get("role", "") or ""
            if content:
                conn.execute(
                    "INSERT INTO messages_fts(session_id, user_id, msg_index, role, content) VALUES (?, ?, ?, ?, ?)",
                    (session_id, user_id, i, role, content),
                )

    def search_messages(
        self,
        user_id: str,
        query: str,
        limit: int = 20,
        offset: int = 0,
    ) -> list[dict]:
        """全文检索用户会话消息。

        返回 [{session_id, msg_index, role, snippet}, ...]。
        空查询 / 纯空白返回 []。

        unicode61 tokenizer 将连续非 ASCII 字符（CJK、假名、韩文等）
        视为单一 token，导致子串搜索失败。对此类查询使用
        ``content LIKE '%q%'`` 回退。

        注意：LIKE 回退路径下 snippet() 不产生 <mark> 高亮，
        因为 FTS5 没有可用的匹配词条信息。
        """
        q = (query or "").strip()
        if not q:
            return []
        # unicode61 将连续非 ASCII 字符（CJK、假名、韩文等）视为
        # 单一 token，导致子串匹配失败。对含非 ASCII 字符的查询
        # 使用 LIKE 回退，否则使用 FTS5 MATCH 获得 rank 排序和高亮。
        has_non_ascii = any(ord(ch) > 127 for ch in q)
        if has_non_ascii:
            # LIKE 回退路径：转义 LIKE 元字符（\ % _）
            escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            sql = (
                "SELECT session_id, msg_index, role, "
                "snippet(messages_fts, 4, '<mark>', '</mark>', '...', 40) "
                "AS snippet "
                "FROM messages_fts "
                "WHERE user_id = ? AND content LIKE ? ESCAPE '\\' "
                "ORDER BY msg_index "
                "LIMIT ? OFFSET ?"
            )
            params = (user_id, f"%{escaped}%", limit, offset)
        else:
            # FTS5 MATCH 路径：转义双引号（FTS5 短语语法）
            escaped = q.replace('"', '""')
            sql = (
                "SELECT session_id, msg_index, role, "
                "snippet(messages_fts, 4, '<mark>', '</mark>', '...', 40) "
                "AS snippet "
                "FROM messages_fts "
                "WHERE user_id = ? AND messages_fts MATCH ? "
                "ORDER BY rank "
                "LIMIT ? OFFSET ?"
            )
            params = (user_id, escaped, limit, offset)
        with self._conn() as conn:
            try:
                rows = conn.execute(sql, params).fetchall()
            except sqlite3.OperationalError:
                # FTS5 MATCH 语法错误 → 回退 LIKE（无高亮、无 rank 排序）
                escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                sql = (
                    "SELECT session_id, msg_index, role, "
                    "snippet(messages_fts, 4, '<mark>', '</mark>', '...', 40) "
                    "AS snippet "
                    "FROM messages_fts "
                    "WHERE user_id = ? AND content LIKE ? ESCAPE '\\' "
                    "ORDER BY msg_index "
                    "LIMIT ? OFFSET ?"
                )
                params = (user_id, f"%{escaped}%", limit, offset)
                rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

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
        uid = str(uuid.uuid4())
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO users (id, name, password) VALUES (?, ?, ?)",
                (uid, name, hashed_password),
            )
        return uid

    def get_user(self, name: str) -> dict | None:
        """按名称查找用户。返回 {"id", "name", "password"} 或 None。"""
        with self._conn() as conn:
            row = conn.execute("SELECT id, name, password, is_admin FROM users WHERE name = ?", (name,)).fetchone()
            if row:
                return dict(row)
            return None

    def get_user_by_id(self, user_id: str) -> dict | None:
        """按 ID 查找用户。返回 {"id", "name", "created_at", "avatar_seed", "bio", "email"} 或 None。"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, name, created_at, avatar_seed, bio, email FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            if row:
                return dict(row)
            return None

    def update_user_name(self, user_id: str, new_name: str):
        """更新用户名。"""
        with self._conn() as conn:
            conn.execute("UPDATE users SET name = ? WHERE id = ?", (new_name, user_id))

    def update_user_password(self, user_id: str, hashed_password: str):
        """更新用户密码（已哈希）。"""
        with self._conn() as conn:
            conn.execute("UPDATE users SET password = ? WHERE id = ?", (hashed_password, user_id))

    def update_user_fields(self, user_id: str, fields: dict):
        """更新用户非关键字段（bio, email, avatar_seed 等）。"""
        sets = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [user_id]
        with self._conn() as conn:
            conn.execute(f"UPDATE users SET {sets} WHERE id = ?", values)

    # ── 会话 ──

    def list_sessions(self, user_id: str) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, title, messages, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC",
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

    def upsert_session(self, session_id: str, user_id: str, messages: list[dict], title: str = "") -> str:
        msgs_json = json.dumps(messages, ensure_ascii=False)
        with self._conn() as conn:
            existing = conn.execute(
                "SELECT id FROM sessions WHERE id = ? AND user_id = ?",
                (session_id, user_id),
            ).fetchone()
            if existing:
                conn.execute(
                    "UPDATE sessions SET title=?, messages=?, "
                    "updated_at=datetime('now','localtime') WHERE id=? AND user_id=?",
                    (title, msgs_json, session_id, user_id),
                )
            else:
                conn.execute(
                    "INSERT INTO sessions (id, user_id, title, messages) VALUES (?, ?, ?, ?)",
                    (session_id, user_id, title, msgs_json),
                )
            # 同步 FTS5（同一事务内）
            self._sync_fts(conn, session_id, user_id, messages)
        return session_id

    def delete_session(self, session_id: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            if cur.rowcount > 0:
                conn.execute(
                    "DELETE FROM messages_fts WHERE session_id = ?",
                    (session_id,),
                )
                return True
            return False

    # ── 工作空间 ──

    def create_workspace(self, name: str, description: str, owner_id: str) -> str:
        wid = str(uuid.uuid4())
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO workspaces (id, name, description, owner_id) VALUES (?, ?, ?, ?)",
                (wid, name, description, owner_id),
            )
            conn.execute(
                "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')",
                (wid, owner_id),
            )
        return wid

    def get_workspace(self, workspace_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, name, description, owner_id, is_public, created_at FROM workspaces WHERE id = ?",
                (workspace_id,),
            ).fetchone()
            return dict(row) if row else None

    def list_workspaces(self, user_id: str) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT w.id, w.name, w.description, w.owner_id, w.is_public, "
                "w.created_at, wm.role "
                "FROM workspaces w "
                "INNER JOIN workspace_members wm ON w.id = wm.workspace_id "
                "WHERE wm.user_id = ? "
                "ORDER BY w.created_at DESC",
                (user_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def update_workspace(self, workspace_id: str, **fields) -> bool:
        allowed = {"name", "description", "is_public"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return False
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [workspace_id]
        with self._conn() as conn:
            cur = conn.execute(f"UPDATE workspaces SET {set_clause} WHERE id = ?", values)
            return cur.rowcount > 0

    def delete_workspace(self, workspace_id: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM workspaces WHERE id = ?", (workspace_id,))
            return cur.rowcount > 0

    # ── 成员管理 ──

    def add_member(self, workspace_id: str, user_id: str, role: str = "member") -> bool:
        with self._conn() as conn:
            try:
                conn.execute(
                    "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)",
                    (workspace_id, user_id, role),
                )
                return True
            except sqlite3.IntegrityError:
                return False

    def remove_member(self, workspace_id: str, user_id: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute(
                "DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND role != 'owner'",
                (workspace_id, user_id),
            )
            return cur.rowcount > 0

    def list_members(self, workspace_id: str) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT wm.user_id, u.name, wm.role, wm.joined_at "
                "FROM workspace_members wm "
                "JOIN users u ON wm.user_id = u.id "
                "WHERE wm.workspace_id = ? "
                "ORDER BY wm.joined_at",
                (workspace_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def get_member_role(self, workspace_id: str, user_id: str) -> str | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
                (workspace_id, user_id),
            ).fetchone()
            return row["role"] if row else None

    # ── 项目 ──

    def create_project(self, workspace_id: str, name: str, description: str, created_by: str) -> str:
        pid = str(uuid.uuid4())
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO projects (id, workspace_id, name, description, created_by) VALUES (?, ?, ?, ?, ?)",
                (pid, workspace_id, name, description, created_by),
            )
        return pid

    def get_project(self, project_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, workspace_id, name, description, agent_config, "
                "created_by, created_at "
                "FROM projects WHERE id = ?",
                (project_id,),
            ).fetchone()
            return dict(row) if row else None

    def list_projects(self, workspace_id: str) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, name, description, agent_config, created_by, created_at "
                "FROM projects WHERE workspace_id = ? "
                "ORDER BY created_at DESC",
                (workspace_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def update_project(self, project_id: str, **fields) -> bool:
        allowed = {"name", "description", "agent_config"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return False
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [project_id]
        with self._conn() as conn:
            cur = conn.execute(f"UPDATE projects SET {set_clause} WHERE id = ?", values)
            return cur.rowcount > 0

    def delete_project(self, project_id: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            return cur.rowcount > 0

    # ── 管理员 ──

    def set_user_admin(self, user_id: str, is_admin: bool) -> bool:
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE users SET is_admin = ? WHERE id = ?",
                (1 if is_admin else 0, user_id),
            )
            return cur.rowcount > 0

    def is_admin(self, user_id: str) -> bool:
        with self._conn() as conn:
            row = conn.execute("SELECT is_admin FROM users WHERE id = ?", (user_id,)).fetchone()
            return bool(row["is_admin"]) if row else False

    def list_all_users(self) -> list[dict]:
        """管理员接口：列出所有用户"""
        with self._conn() as conn:
            rows = conn.execute("SELECT id, name, is_admin, created_at FROM users ORDER BY created_at").fetchall()
            return [dict(r) for r in rows]

    # ── 评估日志 ──

    def create_eval_log(
        self,
        project_id: str,
        session_id: str = "",
        task_type: str = "",
        complexity: str = "",
        agent_count: int = 0,
        total_tokens: int = 0,
        elapsed_ms: int = 0,
        has_error: int = 0,
    ) -> str:
        eid = str(uuid.uuid4())
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO eval_logs (id, project_id, session_id, task_type, "
                "complexity, agent_count, total_tokens, elapsed_ms, has_error) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (eid, project_id, session_id, task_type, complexity, agent_count, total_tokens, elapsed_ms, has_error),
            )
        return eid

    def get_eval_stats(self, project_id: str = "", days: int = 0) -> dict:
        with self._conn() as conn:
            clauses = []
            params = []
            if project_id:
                clauses.append("project_id = ?")
                params.append(project_id)
            if days > 0:
                clauses.append(f"created_at >= datetime('now', 'localtime', '-{days} days')")
            where = "WHERE " + " AND ".join(clauses) if clauses else ""
            total = conn.execute(f"SELECT COUNT(*) FROM eval_logs {where}", params).fetchone()[0]
            if total == 0:
                return {
                    "total": 0,
                    "avg_elapsed_ms": 0,
                    "total_tokens": 0,
                    "error_rate": 0,
                    "task_types": {},
                    "daily": [],
                }
            avg_elapsed = conn.execute(f"SELECT AVG(elapsed_ms) FROM eval_logs {where}", params).fetchone()[0] or 0
            sum_tokens = conn.execute(f"SELECT SUM(total_tokens) FROM eval_logs {where}", params).fetchone()[0] or 0
            error_count = conn.execute(f"SELECT COUNT(*) FROM eval_logs {where} AND has_error = 1", params).fetchone()[
                0
            ]
            task_type_rows = conn.execute(
                f"SELECT task_type, COUNT(*) as cnt FROM eval_logs {where} GROUP BY task_type ORDER BY cnt DESC", params
            ).fetchall()
            daily_rows = conn.execute(
                f"SELECT DATE(created_at) as day, COUNT(*) as cnt, AVG(elapsed_ms) as avg_ms "
                f"FROM eval_logs {where} GROUP BY day ORDER BY day DESC LIMIT 14",
                params,
            ).fetchall()
            return {
                "total": total,
                "avg_elapsed_ms": round(avg_elapsed),
                "total_tokens": sum_tokens,
                "error_rate": round(error_count / total * 100, 1) if total > 0 else 0,
                "task_types": {r["task_type"]: r["cnt"] for r in task_type_rows},
                "daily": [dict(r) for r in daily_rows],
            }

    # ── 步骤日志 (Monitor) ──

    def create_step_log(self, session_id: str, task_type: str, agent_name: str, status: str, elapsed_ms: int, token_count: int) -> str:
        sid = str(uuid.uuid4())[:8]
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO step_logs (id, session_id, task_type, agent_name, status, elapsed_ms, token_count) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (sid, session_id, task_type, agent_name, status, elapsed_ms, token_count),
            )
        return sid

    def get_session_steps(self, session_id: str) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT task_type, agent_name as name, status, elapsed_ms, token_count "
                "FROM step_logs WHERE session_id = ? ORDER BY created_at ASC",
                (session_id,),
            ).fetchall()
            merged = {}
            for r in rows:
                name = r["name"]
                if name not in merged:
                    merged[name] = dict(r)
                else:
                    merged[name]["elapsed_ms"] += r["elapsed_ms"]
                    merged[name]["token_count"] += r["token_count"]
                    merged[name]["status"] = r["status"]
            return list(merged.values())

    # ── 用户配置 ──

    def get_user_config(self, user_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute("SELECT roles, models FROM user_configs WHERE user_id = ?", (user_id,)).fetchone()
            if not row:
                return None
            roles = json.loads(row["roles"]) if row["roles"] else {}
            models = json.loads(row["models"]) if row["models"] else []
            if models:
                fernet = self._get_fernet()
                for model in models:
                    if model.get("api_key", "").startswith("gAAAAA"):
                        try:
                            model["api_key"] = fernet.decrypt(model["api_key"].encode()).decode()
                        except Exception:
                            model["api_key"] = "[解密失败]"
            return {"roles": roles, "models": models}

    def upsert_user_config(self, user_id: str, roles: dict, models: list) -> bool:
        if models:
            fernet = self._get_fernet()
            for model in models:
                if model.get("api_key") and not model.get("api_key", "").startswith("gAAAAA"):
                    model["api_key"] = fernet.encrypt(model["api_key"].encode()).decode()
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

    # ── 组织 ──

    def create_organization(self, name: str, description: str, owner_id: str) -> str:
        import secrets, string

        oid = str(uuid.uuid4())
        code = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO organizations (id, name, description, invite_code, owner_id) VALUES (?,?,?,?,?)",
                (oid, name, description, code, owner_id),
            )
            conn.execute(
                "INSERT INTO org_members (org_id, user_id, role) VALUES (?,?,?)",
                (oid, owner_id, "owner"),
            )
        return oid

    def list_organizations(self, user_id: str) -> list:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT o.*, om.role as my_role,
                       (SELECT COUNT(*) FROM org_members WHERE org_id = o.id) as member_count
                FROM organizations o
                JOIN org_members om ON o.id = om.org_id AND om.user_id = ?
                ORDER BY o.created_at DESC
            """,
                (user_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_organization(self, org_id: str):
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM organizations WHERE id = ?", (org_id,)).fetchone()
        return dict(row) if row else None

    def get_org_by_invite(self, code: str):
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM organizations WHERE invite_code = ?", (code,)).fetchone()
        return dict(row) if row else None

    def join_organization(self, org_id: str, user_id: str, role: str = "member") -> bool:
        with self._conn() as conn:
            existing = conn.execute(
                "SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?", (org_id, user_id)
            ).fetchone()
            if existing:
                return False
            conn.execute(
                "INSERT INTO org_members (org_id, user_id, role) VALUES (?,?,?)",
                (org_id, user_id, role),
            )
        return True

    def list_org_members(self, org_id: str) -> list:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT om.*, u.name as user_name
                FROM org_members om JOIN users u ON om.user_id = u.id
                WHERE om.org_id = ?
            """,
                (org_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_org_member_role(self, org_id: str, user_id: str):
        with self._conn() as conn:
            row = conn.execute(
                "SELECT role FROM org_members WHERE org_id = ? AND user_id = ?",
                (org_id, user_id),
            ).fetchone()
        return row["role"] if row else None

    def remove_org_member(self, org_id: str, user_id: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute(
                "DELETE FROM org_members WHERE org_id = ? AND user_id = ? AND role != 'owner'",
                (org_id, user_id),
            )
            return cur.rowcount > 0

    def delete_organization(self, org_id: str) -> bool:
        with self._conn() as conn:
            conn.execute(
                "DELETE FROM org_messages WHERE channel_id IN "
                "(SELECT id FROM org_channels WHERE org_id = ?)",
                (org_id,),
            )
            conn.execute("DELETE FROM org_channels WHERE org_id = ?", (org_id,))
            conn.execute("DELETE FROM org_todos WHERE org_id = ?", (org_id,))
            conn.execute("DELETE FROM org_members WHERE org_id = ?", (org_id,))
            cur = conn.execute("DELETE FROM organizations WHERE id = ?", (org_id,))
            return cur.rowcount > 0

    def create_channel(self, org_id: str, name: str) -> str:
        cid = str(uuid.uuid4())
        with self._conn() as conn:
            conn.execute("INSERT INTO org_channels (id, org_id, name) VALUES (?,?,?)", (cid, org_id, name))
        return cid

    def list_channels(self, org_id: str) -> list:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM org_channels WHERE org_id = ? ORDER BY name", (org_id,)).fetchall()
        return [dict(r) for r in rows]

    def create_message(self, channel_id: str, user_id: str, content: str, is_agent: int = 0) -> str:
        mid = str(uuid.uuid4())
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO org_messages (id, channel_id, user_id, content, is_agent, created_at) VALUES (?,?,?,?,?,?)",
                (mid, channel_id, user_id, content, is_agent, now),
            )
        return mid

    def list_messages(self, channel_id: str, limit: int = 50, before: str | None = None) -> list:
        with self._conn() as conn:
            if before:
                rows = conn.execute(
                    """
                    SELECT m.*, u.name as user_name
                    FROM org_messages m JOIN users u ON m.user_id = u.id
                    WHERE m.channel_id = ? AND m.created_at < ?
                    ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?
                """,
                    (channel_id, before, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT m.*, u.name as user_name
                    FROM org_messages m JOIN users u ON m.user_id = u.id
                    WHERE m.channel_id = ?
                    ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?
                """,
                    (channel_id, limit),
                ).fetchall()
        return [dict(r) for r in reversed(rows)]

    def create_todo(self, org_id: str, content: str, created_by: str, assignee_id: str | None = None) -> str:
        tid = str(uuid.uuid4())
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO org_todos (id, org_id, content, assignee_id, created_by) VALUES (?,?,?,?,?)",
                (tid, org_id, content, assignee_id, created_by),
            )
        return tid

    def list_todos(self, org_id: str) -> list:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT t.*, u.name as assignee_name
                FROM org_todos t LEFT JOIN users u ON t.assignee_id = u.id
                WHERE t.org_id = ?
                ORDER BY t.completed ASC, t.created_at DESC
            """,
                (org_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def update_todo(self, todo_id: str, completed: int | None = None, content: str | None = None) -> bool:
        with self._conn() as conn:
            if completed is not None and content is not None:
                conn.execute("UPDATE org_todos SET completed=?, content=? WHERE id=?", (completed, content, todo_id))
            elif completed is not None:
                conn.execute("UPDATE org_todos SET completed=? WHERE id=?", (completed, todo_id))
            elif content is not None:
                conn.execute("UPDATE org_todos SET content=? WHERE id=?", (content, todo_id))
            else:
                return False
        return True

    # ── 团队文档 ──

    def create_org_file(self, org_id: str, file_name: str, file_path: str, size: int, mime_type: str, uploaded_by: str) -> str:
        fid = str(uuid.uuid4())
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO org_files (id, org_id, file_name, file_path, size, mime_type, uploaded_by) VALUES (?,?,?,?,?,?,?)",
                (fid, org_id, file_name, file_path, size, mime_type, uploaded_by),
            )
        return fid

    def list_org_files(self, org_id: str) -> list:
        with self._conn() as conn:
            rows = conn.execute("""
                SELECT f.*, u.name as uploaded_by_name
                FROM org_files f JOIN users u ON f.uploaded_by = u.id
                WHERE f.org_id = ?
                ORDER BY f.created_at DESC
            """, (org_id,)).fetchall()
        return [dict(r) for r in rows]

    def get_org_file(self, file_id: str):
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM org_files WHERE id = ?", (file_id,)).fetchone()
        return dict(row) if row else None

    def rename_org_file(self, file_id: str, new_name: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE org_files SET file_name = ?, updated_at = datetime('now','localtime') WHERE id = ?",
                (new_name, file_id),
            )
            return cur.rowcount > 0

    def delete_org_file(self, file_id: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM org_files WHERE id = ?", (file_id,))
            return cur.rowcount > 0

    # ── 频道管理 ──

    def delete_channel(self, channel_id: str) -> bool:
        with self._conn() as conn:
            conn.execute("DELETE FROM org_messages WHERE channel_id = ?", (channel_id,))
            cur = conn.execute("DELETE FROM org_channels WHERE id = ?", (channel_id,))
            return cur.rowcount > 0

    def clear_channel_messages(self, channel_id: str) -> bool:
        with self._conn() as conn:
            conn.execute("DELETE FROM org_messages WHERE channel_id = ?", (channel_id,))
            return True

    def rename_channel(self, channel_id: str, new_name: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute("UPDATE org_channels SET name = ? WHERE id = ?", (new_name, channel_id))
            return cur.rowcount > 0

    # ── 智能体配置 ──

    def create_config(self, user_id: str, name: str, agents: list[str],
                      project_id: str = "", pipeline: dict | None = None,
                      prompts: dict | None = None) -> str:
        cid = str(uuid.uuid4())
        agents_json = json.dumps(agents, ensure_ascii=False)
        pipeline_json = json.dumps(pipeline or {}, ensure_ascii=False)
        prompts_json = json.dumps(prompts or {}, ensure_ascii=False)
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO saved_configs (id, user_id, project_id, name, agents, pipeline, prompts) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (cid, user_id, project_id or None, name, agents_json, pipeline_json, prompts_json),
            )
        return cid

    def get_config(self, config_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM saved_configs WHERE id = ?", (config_id,)).fetchone()
            if not row:
                return None
            return self._parse_config_row(row)

    def list_configs(self, user_id: str, project_id: str = "") -> list[dict]:
        with self._conn() as conn:
            if project_id:
                rows = conn.execute(
                    "SELECT * FROM saved_configs WHERE user_id = ? AND project_id = ? ORDER BY updated_at DESC",
                    (user_id, project_id),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM saved_configs WHERE user_id = ? ORDER BY updated_at DESC",
                    (user_id,),
                ).fetchall()
        return [self._parse_config_row(r) for r in rows]

    def _parse_config_row(self, row) -> dict:
        d = dict(row)
        d["agents"] = json.loads(d.get("agents", "[]"))
        d["pipeline"] = json.loads(d.get("pipeline", "{}"))
        d["prompts"] = json.loads(d.get("prompts", "{}"))
        return d

    def update_config(self, config_id: str, **fields) -> bool:
        allowed = {"name", "agents", "pipeline", "prompts", "is_public", "github_url"}
        updates = {}
        for k, v in fields.items():
            if k in allowed:
                updates[k] = json.dumps(v, ensure_ascii=False) if k in ("agents", "pipeline", "prompts") else v
        if not updates:
            return False
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [config_id]
        with self._conn() as conn:
            cur = conn.execute(f"UPDATE saved_configs SET {set_clause}, updated_at=datetime('now','localtime') WHERE id = ?", values)
            return cur.rowcount > 0

    def delete_config(self, config_id: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM saved_configs WHERE id = ?", (config_id,))
            return cur.rowcount > 0

    def list_public_configs(self, search: str = "", limit: int = 50, offset: int = 0) -> list[dict]:
        with self._conn() as conn:
            if search:
                rows = conn.execute(
                    "SELECT * FROM saved_configs WHERE is_public = 1 AND name LIKE ? "
                    "ORDER BY updated_at DESC LIMIT ? OFFSET ?",
                    (f"%{search}%", limit, offset),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM saved_configs WHERE is_public = 1 "
                    "ORDER BY updated_at DESC LIMIT ? OFFSET ?",
                    (limit, offset),
                ).fetchall()
        return [self._parse_config_row(r) for r in rows]

    # ── 审计日志 ──

    def create_audit_log(self, action: str, user_id: str = "", detail: dict | None = None,
                         ip: str = "") -> str:
        aid = str(uuid.uuid4())
        detail_json = json.dumps(detail or {}, ensure_ascii=False)
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO audit_logs (id, user_id, action, detail, ip) VALUES (?, ?, ?, ?, ?)",
                (aid, user_id or None, action, detail_json, ip),
            )
        return aid

    def count_recent_audit(self, action: str, user_id: str = "", ip: str = "",
                           minutes: int = 15) -> int:
        with self._conn() as conn:
            clauses = ["action = ?", f"created_at >= datetime('now', 'localtime', '-{minutes} minutes')"]
            params = [action]
            if user_id:
                clauses.append("user_id = ?")
                params.append(user_id)
            if ip:
                clauses.append("ip = ?")
                params.append(ip)
            where = " AND ".join(clauses)
            row = conn.execute(f"SELECT COUNT(*) FROM audit_logs WHERE {where}", params).fetchone()
            return row[0] if row else 0

    # ── 用户目标 ──

    def get_user_goal(self, user_id: str) -> str:
        with self._conn() as conn:
            row = conn.execute("SELECT goal FROM users WHERE id = ?", (user_id,)).fetchone()
            return (row["goal"] or "") if row else ""

    def set_user_goal(self, user_id: str, goal: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute("UPDATE users SET goal = ? WHERE id = ?", (goal, user_id))
            return cur.rowcount > 0

    def get_user_name(self, user_id: str) -> str:
        with self._conn() as conn:
            row = conn.execute("SELECT name FROM users WHERE id = ?", (user_id,)).fetchone()
        return row["name"] if row else "未知用户"

    def dump_all(self) -> dict:
        if os.getenv("DEBUG", "").lower() != "true":
            raise PermissionError("dump_all 仅开发模式可用（需设置 DEBUG=true）")
        """返回数据库全部内容的格式化字符串，用于实时观察。"""
        with self._conn() as conn:
            lines = [f"\n=== {_time.strftime('%H:%M:%S')} DB DUMP ==="]
            for table in ["users", "sessions", "user_configs"]:
                lines.append(f"[{table}]")
                for row in conn.execute(f"SELECT * FROM {table}"):
                    lines.append(f"  {dict(row)}")
            return "\n".join(lines)
