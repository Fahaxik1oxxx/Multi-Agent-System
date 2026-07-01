# Config DB Migration + Public Sharing + Security Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate agent configs/prompts from localStorage to SQLite, add public template market + GitHub export, harden security.

**Architecture:** New `saved_configs` and `audit_logs` DB tables (migration v10). New `app/configs.py` (9 endpoints) and `app/market.py` (3 endpoints). Security patches in `user/routes.py`, `main.py`. Frontend: 6 files migrate localStorage → API with auto-migration.

**Tech Stack:** FastAPI + SQLite + React/TypeScript + TanStack Query

## Global Constraints

- DB migration follows existing `_run_migration(conn, version)` pattern with `IF NOT EXISTS`
- API files follow existing router pattern: `APIRouter`, `JSONResponse`, `require_auth`
- Password minimum: 6 chars (matches existing profile update rule)
- CORS origins from env `CORS_ORIGINS`, default `http://localhost:5173`
- Login lockout: 5 fails/account/15min, 10 fails/IP/30min

---

### Task 1: Database Migration v10

**Files:** Modify `user/db.py`

**Interfaces:**
- Produces: `saved_configs` table, `audit_logs` table, `users.goal` column

- [ ] Bump `TARGET_SCHEMA_VERSION` from 9 to 10 (line 21)

- [ ] Add migration case v10 after version 9 block:

```python
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
```

- [ ] Restart backend, verify: `python -c "from user.db import Database; d=Database('data.db'); print('v10 OK')"`

---

### Task 2: DB Methods — saved_configs + audit_logs + goal

**Files:** Modify `user/db.py`

**Interfaces:**
- Produces: `create_config()`, `get_config()`, `list_configs()`, `update_config()`, `delete_config()`, `list_public_configs()`, `create_audit_log()`, `count_recent_audit()`, `get_user_goal()`, `set_user_goal()`

- [ ] Add after `# ── 频道管理 ──` section, before `get_user_name`:

```python
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
            d = dict(row)
            d["agents"] = json.loads(d.get("agents", "[]"))
            d["pipeline"] = json.loads(d.get("pipeline", "{}"))
            d["prompts"] = json.loads(d.get("prompts", "{}"))
            return d

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
```

- [ ] Test: `python -c "from user.db import Database; d=Database('data.db'); cid=d.create_config('u1','Test',['P']); assert d.get_config(cid)['name']=='Test'; d.delete_config(cid); print('OK')"`

---

### Task 3: Configs API (`app/configs.py`)

**Files:** Create `app/configs.py`, modify `main.py`

- [ ] Create `app/configs.py` with 9 endpoints: POST `/configs`, GET `/configs`, GET `/configs/{id}`, PUT `/configs/{id}`, DELETE `/configs/{id}`, POST `/configs/{id}/publish`, POST `/configs/{id}/unpublish`, GET `/configs/{id}/export`

- [ ] Register in `main.py`: `from app.configs import router as configs_router` + `app.include_router(configs_router, prefix="/api", tags=["配置"])`

- [ ] Smoke test: create/list configs via curl

---

### Task 4: Market API (`app/market.py`)

**Files:** Create `app/market.py`, modify `main.py`

- [ ] Create `app/market.py` with 3 endpoints: GET `/market` (public, searchable), GET `/market/{id}`, POST `/market/{id}/copy`

- [ ] Register in `main.py`: `from app.market import router as market_router` + `app.include_router(market_router, prefix="/api", tags=["模板市场"])`

---

### Task 5: Security — Password + CORS

**Files:** Modify `user/routes.py`, `main.py`

- [ ] Register endpoint: add `if len(password) < 6: return JSONResponse({"error":"密码至少需要 6 位"}, 400)`

- [ ] `main.py`: add `CORSMiddleware` with `allow_origins` from env var `CORS_ORIGINS`

---

### Task 6: Security — Login Lockout + Audit

**Files:** Modify `user/routes.py`

- [ ] Login endpoint: before password verification, check `count_recent_audit("login_failed", user_id=..., minutes=15) >= 5` → 429, and IP check `>= 10 in 30 min` → 429

- [ ] Log `login_failed` audit on wrong password

- [ ] Register endpoint: log `register` audit after successful registration

---

### Task 7: `/coding` Auth Protection

**Files:** Modify `main.py`

- [ ] Replace `app.mount("/coding", StaticFiles(...))` with `@app.get("/api/coding/{file_path:path}")` that calls `require_auth` and validates path traversal.

---

### Task 8: Frontend API Client

**Files:** Modify `frontend/src/api/projects.ts`

- [ ] Add `configsApi` object: `list`, `get`, `create`, `update`, `delete`, `publish`, `unpublish`, `export`
- [ ] Add `marketApi` object: `list`, `get`, `copy`

---

### Task 9: Frontend — V3AgentSelectPage migration

**Files:** Modify `frontend/src/pages/chat/V3AgentSelectPage.tsx`

- [ ] Replace `reloadConfigs` to call `configsApi.list(projectId)` instead of localStorage
- [ ] Update `handleRenameSave` to call `configsApi.update(id, {name})`
- [ ] Update `handleDelete` to call `configsApi.delete(id)`
- [ ] Add `handlePublish` toggle
- [ ] Add auto-migration useEffect: if old `v3_configs_${projectId}` exists in localStorage, create via API then delete key
- [ ] Add publish button to config item UI

---

### Task 10: Frontend — ConfigBuilderPage migration

**Files:** Modify `frontend/src/pages/chat/ConfigBuilderPage.tsx`

- [ ] Replace `handleSave`: call `configsApi.create(...)` instead of writing localStorage

---

### Task 11: Frontend — OrchestrationPage migration

**Files:** Modify `frontend/src/pages/project/OrchestrationPage.tsx`

- [ ] In `saveMutation.onSuccess`: call `configsApi.create(...)` instead of writing localStorage

---

### Task 12: Frontend — V3Sidebar Goal migration

**Files:** Modify `frontend/src/components/layout/V3Sidebar.tsx`, `user/routes.py`

- [ ] Backend: add `goal` field to `get_profile` response, accept `goal` in `update_profile`
- [ ] Frontend: load goal from `userApi.getProfile()`, save via `userApi.updateProfile({goal})`

---

### Task 13: Frontend — TemplateMarket dynamic loading

**Files:** Modify `frontend/src/pages/templates/TemplateMarket.tsx`

- [ ] Replace static data with `useQuery({ queryKey: ['market-templates'], queryFn: () => marketApi.list() })`

---

### Task 14: Cleanup localStorage references

- [ ] Search frontend for `v3_configs_`, `v3_proj_configs_`, `v3_prompt_templates`, `v3_current_goal` — remove all writes, keep only auth_token + guest mode keys
- [ ] Verify no leaks: `grep -rn "localStorage.setItem\|localStorage.getItem" frontend/src/`

---

### Task 15: End-to-End Validation

- [ ] Register with short password → rejected
- [ ] Register with valid password → success
- [ ] Login 5× wrong → lockout → 429
- [ ] Create config → appears in list
- [ ] Rename config → persisted
- [ ] Publish config → visible in market
- [ ] Copy from market → appears in my configs
- [ ] Export config → JSON download
- [ ] Delete config → removed
- [ ] Orchestra save → config created
- [ ] Goal save → persists on refresh
- [ ] Old localStorage data auto-migrated
