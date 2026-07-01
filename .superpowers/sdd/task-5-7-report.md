# Tasks 5-7: Security Hardening Report

Date: 2026-07-01

## Task 5: Password Minimum Length + CORS Middleware

### Changes

**user/routes.py** — Added password minimum length check in `register`:
- After the empty-check, added `if len(password) < 6: return JSONResponse({"error": "密码至少需要 6 位"}, status_code=400)`
- Also added `db.create_audit_log("register", user_id=uid, ip=ip)` after successful registration (part of Task 6)

**main.py** — Added CORS middleware after `app = FastAPI(...)`:
- Imports `CORSMiddleware` from `fastapi.middleware.cors`
- Configured with `allow_origins` from `CORS_ORIGINS` env var (defaults to localhost:5173,5174,5175)
- `allow_credentials=True`, `allow_methods=["*"]`, `allow_headers=["*"]`

### Verification
- `curl -X POST http://127.0.0.1:8000/api/auth/register -H "Content-Type: application/json" -d '{"name":"pwtest","password":"12"}'` -> expects 400 "密码至少需要 6 位"
- `curl -I -X OPTIONS http://127.0.0.1:8000/api/health -H "Origin: http://localhost:5173"` -> expects CORS headers (Access-Control-Allow-Origin, etc.)

## Task 6: Login Lockout + Audit Logging

### Changes

**user/routes.py** — Replaced login endpoint:
1. Gets client IP: `ip = request.client.host if request.client else ""`
2. Account lockout: checks `db.count_recent_audit("login_failed", user_id=user["id"], minutes=15) >= 5` -> returns 429 "账号已被临时锁定，请 15 分钟后重试"
3. IP lockout: checks `db.count_recent_audit("login_failed", ip=ip, minutes=30) >= 10` -> returns 429 "IP 已被临时锁定，请 30 分钟后重试"
4. On wrong password: calls `db.create_audit_log("login_failed", user_id=user["id"] if user else "", detail={"name": name}, ip=ip)` before returning 401
5. On successful register: calls `db.create_audit_log("register", user_id=uid, ip=ip)`

### Verification
- Login with wrong password 5 times for an account -> 6th attempt should get 429 "账号已被临时锁定"
- Login with wrong password 10 times from same IP (different accounts) -> should get 429 "IP 已被临时锁定"

## Task 7: /coding Auth Protection

### Changes

**main.py**:
- Removed `from fastapi.staticfiles import StaticFiles` import
- Added `FileResponse` to `from fastapi.responses` import
- Replaced `app.mount("/coding", StaticFiles(...))` with authenticated `@app.get("/api/coding/{file_path:path}")` route:
  - Requires auth via `require_auth(request)`
  - Path traversal protection: normalizes and checks path starts with coding directory
  - Returns 403 for illegal paths, 404 for missing files
  - Returns `FileResponse(full)` for valid files

### Notes
- The URL changed from `/coding/...` to `/api/coding/...`
- No frontend code was found referencing the `/coding` path, so no UI changes needed

## Summary

| Task | File | Lines Changed |
|------|------|---------------|
| 5 (password) | user/routes.py | +4 |
| 5 (CORS) | main.py | +9 |
| 6 (lockout) | user/routes.py | +13 (replaced login) |
| 6 (register audit) | user/routes.py | +2 |
| 7 (coding auth) | main.py | +9, -3 |

---

## Post-Merge Security Fix (2026-07-01)

### Issue 1 (HIGH): Path traversal bypass in /coding route

**File:** `main.py`, line 104

**Problem:** The `startswith` check did not append a trailing separator, so a directory named `coding_backup` (or any name starting with `coding`) would also pass the path traversal guard.

**Before:**
```python
if not full.startswith(os.path.normpath(os.path.join(PROJECT_DIR, "coding"))):
```

**After:**
```python
coding_root = os.path.normpath(os.path.join(PROJECT_DIR, "coding"))
if not (full == coding_root or full.startswith(coding_root + os.sep)):
```

This ensures only the exact `coding` directory or its subdirectories pass the check.

### Issue 2 (LOW): CORS origin whitespace

**File:** `main.py`, line 89

**Problem:** `os.getenv(...).split(",")` does not strip whitespace. If the `CORS_ORIGINS` env var has spaces after commas (e.g. `http://a.com, http://b.com`), the origins would fail to match.

**Before:**
```python
allow_origins=os.getenv("CORS_ORIGINS", "...").split(","),
```

**After:**
```python
allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "...").split(",")],
```

### Verification
- `python -c "import main; print('import OK')"` -- passes cleanly
