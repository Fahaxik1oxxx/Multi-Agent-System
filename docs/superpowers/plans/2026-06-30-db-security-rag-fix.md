# 数据库/安全/RAG 全面修复 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复代码审计发现的 33 个数据库/安全/RAG 问题，确保系统安全、数据一致、知识库可靠。

**Architecture:** 四层顺序推进 — L1 安全加固（8 任务）→ L2 数据库修复（5 任务）→ L3 前端修复（6 任务）→ L4 RAG 修复（8 任务）。每层内部独立 task，每 task 可独立验证和 commit。

**Tech Stack:** Python FastAPI · SQLite · ChromaDB · LangChain · React 19 · TypeScript · cryptography (Fernet) · slowapi

## Global Constraints

- 所有修复必须向后兼容现有 API 契约
- 不改变前端路由结构
- 后端 26 个已有测试必须保持 PASS
- TSC 编译 0 错误
- 不使用 placeholder，每步具体可执行
- 每层完成后运行验证，确认通过再进入下层

---

### Task L1.1: JWT 密钥强制设置

**Files:**
- Modify: `user/auth.py:10-12`

**Interfaces:**
- Produces: `_JWT_SECRET` 不再有硬编码默认值，启动时弱密钥检测抛出 `RuntimeError`

- [ ] **Step 1: 修改 JWT 密钥加载逻辑**

将 `user/auth.py` 第 10-12 行从：
```python
_JWT_SECRET = os.getenv("JWT_SECRET", "zeng-key-123456")
if not _JWT_SECRET:
    raise RuntimeError("JWT_SECRET 环境变量未设置，请在 .env 中配置 JWT_SECRET=<随机密钥>")
```
改为：
```python
_JWT_SECRET = os.getenv("JWT_SECRET")
_WEAK_SECRETS = {"zeng-key-123456", "change-me", "secret", "dev-secret", "test"}
if not _JWT_SECRET:
    raise RuntimeError("JWT_SECRET 环境变量未设置，请在 .env 中配置 JWT_SECRET=<强随机密钥>")
if _JWT_SECRET in _WEAK_SECRETS:
    raise RuntimeError("JWT_SECRET 使用已知弱密钥，请更换为强随机值（建议: python -c 'import secrets; print(secrets.token_urlsafe(32))'）")
```

- [ ] **Step 2: 验证 — 弱密钥被拒绝**

```bash
cd "D:\AI\Internship\Multi_Agent"
python -c "import os; os.environ['JWT_SECRET']='zeng-key-123456'; __import__('user.auth')"
```
Expected: `RuntimeError: JWT_SECRET 使用已知弱密钥...`

- [ ] **Step 3: 验证 — 现有测试仍通过**

```bash
python -m pytest tests/ -v
```
Expected: 26 passed (JWT_SECRET 已在 .env 中正确设置)

- [ ] **Step 4: Commit**

```bash
git add user/auth.py
git commit -m "fix(security): 移除 JWT 硬编码弱密钥默认值，强制检测已知弱密钥"
```

---

### Task L1.2: 路径遍历防护

**Files:**
- Modify: `tools.py:16-19`

**Interfaces:**
- Produces: `_resolve_path(path: str) -> str` — 校验解析后路径在 WORK_DIR 内，否则抛出 `ValueError`

- [ ] **Step 1: 修改 _resolve_path 添加路径校验**

将 `tools.py` 第 16-19 行从：
```python
def _resolve_path(path: str) -> str:
    if path.startswith("coding/"):
        return os.path.join(PROJECT_DIR, path)
    return os.path.join(WORK_DIR, path)
```
改为：
```python
def _resolve_path(path: str) -> str:
    """解析路径并校验不超出 WORK_DIR，防止路径遍历攻击。"""
    if path.startswith("coding/"):
        full = os.path.join(PROJECT_DIR, path)
    else:
        full = os.path.join(WORK_DIR, path)
    
    work_real = os.path.realpath(WORK_DIR)
    full_real = os.path.realpath(full)
    if not full_real.startswith(work_real + os.sep) and full_real != work_real:
        raise ValueError(f"路径遍历检测: {path} (解析后: {full_real})")
    return full
```

- [ ] **Step 2: 验证 — 路径遍历被拦截**

```bash
python -c "from tools import _resolve_path; print(_resolve_path('../../etc/passwd'))"
```
Expected: `ValueError: 路径遍历检测: ...`

- [ ] **Step 3: 验证 — 正常路径仍可用**

```bash
python -c "from tools import _resolve_path; print(_resolve_path('test.py'))"
```
Expected: 返回合法路径（如 `D:\AI\Internship\Multi_Agent\coding\test.py`）

- [ ] **Step 4: 验证 — 现有测试仍通过**

```bash
python -m pytest tests/ -v
```

- [ ] **Step 5: Commit**

```bash
git add tools.py
git commit -m "fix(security): _resolve_path 添加路径遍历校验，禁止访问 WORK_DIR 外文件"
```

---

### Task L1.3: 速率限制

**Files:**
- Modify: `main.py` (添加 slowapi 中间件)
- Modify: `user/routes.py` (auth 端点限速)
- Modify: `requirements.txt` (添加 slowapi + limits)

**Interfaces:**
- Consumes: Flask-Limiter 等价物 `slowapi` (FastAPI 兼容)
- Produces: 注册/登录/游客聊天/report 端点均有速率限制

- [ ] **Step 1: 安装 slowapi 依赖**

```bash
pip install slowapi
```

在 `requirements.txt` 末尾添加：
```
slowapi>=0.1.9
limits>=3.0
```

- [ ] **Step 2: 在 main.py 配置 slowapi**

在 `main.py` 的 import 区域（第 31 行后）添加：
```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address, default_limits=["200/day", "50/hour"])
```

在 `app = FastAPI(...)` 后添加：
```python
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
```

- [ ] **Step 3: 对敏感端点添加限速装饰器**

在 `main.py` 的 guest chat 端点（第 165 行）上方添加：
```python
@app.post("/api/chat/guest", tags=["聊天"])
@limiter.limit("10/day")  # 游客聊天 10 次/天
async def chat_guest(request: Request):
```

在 `main.py` 的 report 端点（第 192 行）上方添加：
```python
@app.post("/api/report", tags=["聊天"])
@limiter.limit("20/day")  # 报告生成 20 次/天
async def generate_report(request: Request):
```

在 `user/routes.py` 的 register 端点（`@auth_router.post("/register")`）上方添加：
```python
@limiter.limit("5/hour")  # 注册 5 次/小时
```

在 `user/routes.py` 的 login 端点（`@auth_router.post("/login")`）上方添加：
```python
@limiter.limit("20/hour")  # 登录 20 次/小时
```

注意：`limiter` 需要从 `main` 导入：`from main import limiter`

- [ ] **Step 4: 验证 — 后端启动无错误**

```bash
python -c "from main import app; print('OK')"
```

- [ ] **Step 5: 验证 — 现有测试仍通过**

```bash
python -m pytest tests/ -v
```

- [ ] **Step 6: Commit**

```bash
git add main.py user/routes.py requirements.txt
git commit -m "fix(security): 添加速率限制 — auth/guest/report 端点防止滥用"
```

---

### Task L1.4: API Key 加密存储

**Files:**
- Modify: `user/db.py` (upsert_user_config 加密 + get_user_config 解密)
- Modify: `user/routes.py` (API key 相关端点)
- Modify: `requirements.txt` (添加 cryptography)

**Interfaces:**
- Consumes: `_JWT_SECRET` from `user.auth` 派生加密密钥
- Produces: `_encrypt_key(plain: str) -> str`, `_decrypt_key(cipher: str) -> str`

- [ ] **Step 1: 安装 cryptography**

```bash
pip install cryptography
```

在 `requirements.txt` 末尾添加：
```
cryptography>=41.0
```

- [ ] **Step 2: 在 user/db.py 添加加解密函数**

在 `user/db.py` 顶部 import 区域添加：
```python
import base64
import hashlib
from cryptography.fernet import Fernet
```

在 Database 类初始化方法中添加 `_fernet` 的懒加载：
```python
def _get_fernet(self) -> Fernet:
    """从 JWT_SECRET 派生 Fernet 加密密钥（32 字节 base64）。"""
    if not hasattr(self, '_fernet_cache'):
        secret = os.getenv("JWT_SECRET", "")
        if not secret:
            raise RuntimeError("JWT_SECRET 未设置，无法加解密 API Key")
        key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())
        self._fernet_cache = Fernet(key)
    return self._fernet_cache
```

- [ ] **Step 3: 修改 upsert_user_config 加密 models 中的 api_key**

在 `upsert_user_config` 方法中（约第 740 行），处理 `models` 参数时遍历加密每个 api_key：
```python
def upsert_user_config(self, user_id: str, roles: dict | None = None, models: list[dict] | None = None) -> bool:
    if models is not None:
        fernet = self._get_fernet()
        for model in models:
            if model.get("api_key") and not model.get("api_key", "").startswith("gAAAAA"):  # Fernet 密文前缀
                model["api_key"] = fernet.encrypt(model["api_key"].encode()).decode()
    # ... 其余逻辑不变
```

- [ ] **Step 4: 修改 get_user_config 解密 api_key**

在 `get_user_config` 方法中（约第 724 行），返回前解密：
```python
def get_user_config(self, user_id: str) -> dict | None:
    # ... 查询逻辑不变 ...
    if row:
        roles = json.loads(row["roles"]) if row["roles"] else {}
        models = json.loads(row["models"]) if row["models"] else []
        fernet = self._get_fernet()
        for model in models:
            if model.get("api_key", "").startswith("gAAAAA"):
                try:
                    model["api_key"] = fernet.decrypt(model["api_key"].encode()).decode()
                except Exception:
                    model["api_key"] = "[解密失败]"
        return {"roles": roles, "models": models}
    return None
```

- [ ] **Step 5: 验证 — 加解密往返测试**

```bash
python -c "
from user.db import Database
db = Database('data.db')

# 测试加解密往返
fernet = db._get_fernet()
original = 'sk-test-api-key-12345'
encrypted = fernet.encrypt(original.encode()).decode()
decrypted = fernet.decrypt(encrypted.encode()).decode()
assert original == decrypted, f'FAIL: {original} != {decrypted}'
print('PASS: 加解密往返正确')
"
```

- [ ] **Step 6: Commit**

```bash
git add user/db.py user/routes.py requirements.txt
git commit -m "fix(security): API Key 使用 Fernet 加密存储，密钥从 JWT_SECRET 派生"
```

---

### Task L1.5: 权限收紧

**Files:**
- Modify: `workspace/routes.py:210-224` (delete_project 权限)
- Modify: `workspace/organizations.py:74-89` (invite_member 权限)

**Interfaces:**
- Produces: delete_project 仅 owner 或项目创建者可执行；invite_member 仅 org owner 可执行

- [ ] **Step 1: 收紧 delete_project 权限**

在 `workspace/routes.py` 的 `delete_project` 函数中（约第 210 行），修改权限检查：
```python
# 修改前：仅检查 is_member
# 修改后：检查 member_role == "owner" 或 project.created_by == user_id
member_role = db.get_member_role(workspace_id, user["user_id"])
project = db.get_project(project_id)
if member_role != "owner" and project.get("created_by") != user["user_id"]:
    raise HTTPException(status_code=403, detail="仅 Owner 或项目创建者可删除项目")
```

- [ ] **Step 2: 收紧 org invite 权限**

在 `workspace/organizations.py` 的 `invite_member` 函数中（约第 74 行），修改权限检查：
```python
# 修改前：role is None → 403，role 存在即可邀请
# 修改后：仅 role == "owner" 可邀请
role = db.get_org_member_role(org_id, user["user_id"])
if role != "owner":
    raise HTTPException(status_code=403, detail="仅 Owner 可邀请成员")
```

- [ ] **Step 3: 验证 — 现有测试仍通过**

```bash
python -m pytest tests/ -v
```

- [ ] **Step 4: Commit**

```bash
git add workspace/routes.py workspace/organizations.py
git commit -m "fix(security): 收紧权限 — delete_project + org invite 仅限 owner"
```

---

### Task L1.6: 沙箱回退禁止

**Files:**
- Modify: `executor.py:32-36`

**Interfaces:**
- Produces: `CodeExecutor.execute()` — Docker 不可用时抛出 `RuntimeError`，不再无沙箱执行

- [ ] **Step 1: 修改 execute 方法**

将 `executor.py` 第 32-36 行从：
```python
def execute(self, code: str) -> dict:
    if DOCKER_OK:
        return self._docker_exec(code)
    logging.warning("Docker 不可用，降级为 subprocess 执行（不安全）")
    return self._subprocess_exec(code)
```
改为：
```python
def execute(self, code: str) -> dict:
    if DOCKER_OK:
        return self._docker_exec(code)
    raise RuntimeError("Docker 不可用，代码执行已禁用。请安装 Docker 后重启服务。")
```

- [ ] **Step 2: 验证 — 语法正确**

```bash
python -c "from executor import CodeExecutor; print('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add executor.py
git commit -m "fix(security): Docker 不可用时拒绝代码执行，不再退化为无沙箱 subprocess"
```

---

### Task L1.7: 文件上传大小限制

**Files:**
- Modify: `app/knowledge.py:53-100`

**Interfaces:**
- Produces: upload 端点检查文件大小 ≤ 5MB，超限返回 413

- [ ] **Step 1: 添加上传大小检查**

在 `app/knowledge.py` 顶部添加常量：
```python
MAX_UPLOAD_SIZE = 5 * 1024 * 1024  # 5MB
```

在 `kb_upload` 函数中，`contents = await file.read()` 之后添加：
```python
if len(contents) > MAX_UPLOAD_SIZE:
    raise HTTPException(status_code=413, detail=f"文件大小超过限制 ({MAX_UPLOAD_SIZE // 1024 // 1024}MB)")
```

- [ ] **Step 2: 验证 — 语法正确**

```bash
python -c "from app.knowledge import router; print('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add app/knowledge.py
git commit -m "fix(security): 知识库上传添加 5MB 文件大小限制"
```

---

### Task L1.8: 错误消息脱敏

**Files:**
- Modify: `main.py:139-162, 165-181` (chat + guest chat 端点)
- Modify: `router/stream.py:165-175` (SSE 错误事件)

**Interfaces:**
- Produces: 生产模式下客户端收到通用错误消息，详细信息仅写入日志

- [ ] **Step 1: 添加环境判断函数**

在 `main.py` 顶部添加：
```python
def _is_production() -> bool:
    return os.getenv("ENV", "").lower() == "production"
```

- [ ] **Step 2: 修改聊天端点错误响应**

将 `main.py` 第 142-153 行和 174-181 行的错误处理改为：
```python
except Exception as e:
    import traceback
    tb = traceback.format_exc()
    logging.error(f"聊天管道异常: {tb}")
    if _is_production():
        return JSONResponse(
            {"reply": "❌ 服务内部错误，请稍后重试。", "error": "internal_error",
             "thinking": [], "task_type": "错误", "generated_files": []},
            status_code=500,
        )
    else:
        return JSONResponse(
            {"reply": f"❌ 执行失败: {str(e)}", "error": str(e),
             "thinking": [], "task_type": "错误", "generated_files": []},
            status_code=500,
        )
```

- [ ] **Step 3: 修改 SSE 错误消息**

在 `router/stream.py` 约第 171 行：
```python
# 修改前:
# push(state, {"type": "error", "content": f"{type(e).__name__}: {e}"})
# 修改后:
if os.getenv("ENV") == "production":
    push(state, {"type": "error", "content": "服务内部错误，请稍后重试。"})
else:
    push(state, {"type": "error", "content": f"{type(e).__name__}: {e}"})
```

- [ ] **Step 4: 验证 — 语法正确**

```bash
python -c "from main import app; print('OK')"
```

- [ ] **Step 5: Commit**

```bash
git add main.py router/stream.py
git commit -m "fix(security): 生产模式下错误消息脱敏，敏感信息仅写入日志"
```

---

### Task L2.1: upsert_session 所有权检查

**Files:**
- Modify: `user/db.py:368-385` (upsert_session)

**Interfaces:**
- Produces: `upsert_session` 在 UPDATE 时验证 `user_id` 所有权，防止会话劫持

- [ ] **Step 1: 修改 upsert_session**

将 `user/db.py` 第 368-385 行从检查 `WHERE id = ?` 改为 `WHERE id = ? AND user_id = ?`：
```python
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
        self._sync_fts(conn, session_id, user_id, messages)
    return session_id
```

- [ ] **Step 2: 验证 — 现有测试仍通过**

```bash
python -m pytest tests/ -v
```

- [ ] **Step 3: Commit**

```bash
git add user/db.py
git commit -m "fix(db): upsert_session 添加所有权检查，修复会话劫持漏洞"
```

---

### Task L2.2: v5 表级联策略统一 + 孤儿清理

**Files:**
- Modify: `user/db.py:651-795` (delete_organization 补充清理)

**Interfaces:**
- Produces: delete_organization 确保清理所有关联数据（含 channel→message 链）

- [ ] **Step 1: 补充删除组织时清理 org_messages**

在 `delete_organization` 方法开头添加 channel 关联的消息级联删除：
```python
def delete_organization(self, org_id: str) -> bool:
    with self._conn() as conn:
        # 先删除所有频道的消息
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
```

- [ ] **Step 2: 验证 — 现有测试仍通过**

```bash
python -m pytest tests/ -v
```

- [ ] **Step 3: Commit**

```bash
git add user/db.py
git commit -m "fix(db): delete_organization 补充 org_messages 级联清理，修复孤儿记录"
```

---

### Task L2.3: 关键索引添加 (migration v6)

**Files:**
- Modify: `user/db.py` (migration v6 — 添加 10 个关键索引)

**Interfaces:**
- Produces: 10 个新索引，提升查询性能

- [ ] **Step 1: 添加 migration v6**

在 `user/db.py` 的 `_migrate` 方法中，在 v5 迁移逻辑之后添加 v6：
```python
if current_version < 6:
    _create_index_safe(conn, "idx_sessions_user", "sessions", "user_id")
    _create_index_safe(conn, "idx_sessions_updated", "sessions", "updated_at")
    _create_index_safe(conn, "idx_org_msgs_channel", "org_messages", "channel_id")
    _create_index_safe(conn, "idx_org_msgs_created", "org_messages", "created_at")
    _create_index_safe(conn, "idx_org_channels_org", "org_channels", "org_id")
    _create_index_safe(conn, "idx_org_members_org", "org_members", "org_id")
    _create_index_safe(conn, "idx_org_members_user", "org_members", "user_id")
    _create_index_safe(conn, "idx_org_todos_org", "org_todos", "org_id")
    _create_index_safe(conn, "idx_ws_members_user", "workspace_members", "user_id")
    _create_index_safe(conn, "idx_projects_ws", "projects", "workspace_id")
    conn.execute("UPDATE schema_version SET version = 6")
```

同时更新 `TARGET_SCHEMA_VERSION = 6`。

添加辅助函数：
```python
def _create_index_safe(conn, idx_name: str, table: str, column: str):
    """幂等创建索引（IF NOT EXISTS 兼容处理）。"""
    cur = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
        (idx_name,),
    )
    if not cur.fetchone():
        conn.execute(f"CREATE INDEX {idx_name} ON {table}({column})")
```

- [ ] **Step 2: 验证 — 索引创建**

```bash
python -c "
from user.db import Database
db = Database('data.db')
cur = db._conn().execute(\"SELECT name FROM sqlite_master WHERE type='index' ORDER BY name\")
for r in cur.fetchall():
    print(r[0])
"
```
Expected: 输出中包含 10 个新索引名。

- [ ] **Step 3: 验证 — 现有测试仍通过**

```bash
python -m pytest tests/ -v
```

- [ ] **Step 4: Commit**

```bash
git add user/db.py
git commit -m "feat(db): migration v6 — 添加 10 个关键外键索引 + TARGET_SCHEMA_VERSION=6"
```

---

### Task L2.4: ID 生成统一为完整 UUID4

**Files:**
- Modify: `user/db.py:315, 401, 494, 572` (insert_user, create_workspace, create_project, create_eval_log)
- Modify: `user/routes.py:136` (save_session ID)

**Interfaces:**
- Produces: 所有新记录 ID 使用 36 字符完整 UUID4

- [ ] **Step 1: 修改所有 ID 生成**

将所有 `str(uuid.uuid4())[:8]` 替换为 `str(uuid.uuid4())`：

`user/db.py:315`: `uid = str(uuid.uuid4())`
`user/db.py:401`: `wid = str(uuid.uuid4())`
`user/db.py:494`: `pid = str(uuid.uuid4())`
`user/db.py:572`: `eid = str(uuid.uuid4())`
`user/routes.py:136`: 将 `sid = data.get("id") or str(int(__import__("time").time() * 1000))` 改为 `sid = data.get("id") or str(uuid.uuid4())`

需要在 `user/routes.py` 顶部添加 `import uuid`。

- [ ] **Step 2: 验证 — TSC + 后端测试**

```bash
cd frontend && npx tsc --noEmit
cd .. && python -m pytest tests/ -v
```

- [ ] **Step 3: Commit**

```bash
git add user/db.py user/routes.py
git commit -m "fix(db): ID 生成统一为完整 UUID4（36 字符），session ID 改用 uuid 替代时间戳"
```

---

### Task L2.5: dump_all() 添加 DEBUG guard

**Files:**
- Modify: `user/db.py:826-834` (dump_all)

**Interfaces:**
- Produces: dump_all() 仅在 DEBUG=true 时可用

- [ ] **Step 1: 添加环境变量 guard**

在 `dump_all` 方法开头添加：
```python
def dump_all(self) -> dict:
    """导出所有数据（仅开发模式）。"""
    if os.getenv("DEBUG", "").lower() != "true":
        raise PermissionError("dump_all 仅开发模式可用（需设置 DEBUG=true）")
    # ... 其余逻辑不变
```

- [ ] **Step 2: 验证**

```bash
python -c "from user.db import Database; db=Database('data.db'); db.dump_all()"
```
Expected: `PermissionError` (因为 DEBUG 未设置)

- [ ] **Step 3: Commit**

```bash
git add user/db.py
git commit -m "fix(security): dump_all() 添加 DEBUG guard，防止生产环境泄漏数据"
```

---

### Task L3.1: 合并重复 sessionsApi.list() 调用

**Files:**
- Modify: `frontend/src/pages/chat/V3ChatPage.tsx:248-260, 592-604`

**Interfaces:**
- Produces: 单一数据源 `sessions` state，移除 `sideSessions` 重复状态

- [ ] **Step 1: 移除 path B 中的 sessionsApi.list() 和 setSideSessions**

删除 path B（约第 592-604 行）中：
```typescript
sessionsApi.list().then(r => {
    const all = r.data || [];
    setSideSessions(all.filter((s: any) => stored.includes(s.id)));
}).catch(() => {});
```

保留 `projectsApi.get` 和 `knowledgeApi` 调用不变。

- [ ] **Step 2: 统一 displaySessions 使用 sessions state**

将 `displaySessions` 的计算逻辑（约第 624 行）改为直接使用 `sessions`：
```typescript
const displaySessions = sideResults !== null ? sideResults : sessions;
```
移除 `sideSessions` 状态声明。

- [ ] **Step 3: 验证 — TSC 0 错误**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/chat/V3ChatPage.tsx
git commit -m "fix(frontend): 合并两个 sessionsApi.list() 调用，消除重复渲染和数据竞态"
```

---

### Task L3.2: 删除竞态修复

**Files:**
- Modify: `frontend/src/pages/chat/V3ChatPage.tsx:693-706` (delete handler)

**Interfaces:**
- Consumes: Task L2.1 修复后的 delete_session API
- Produces: 删除操作先清除 auto-save timer，await fetchSessions 后再 toast

- [ ] **Step 1: 修改删除处理函数**

将 delete handler 改为：
```typescript
onClick={(e) => {
    e.stopPropagation();
    const del = async () => {
        try {
            // 1. 清除 pending 的自动保存定时器
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
            // 2. 删除会话
            await sessionsApi.delete(s.id);
            // 3. 从 localStorage 移除
            const stored: string[] = JSON.parse(
                localStorage.getItem(`v3_proj_sessions_${projectId}`) || '[]'
            );
            localStorage.setItem(
                `v3_proj_sessions_${projectId}`,
                JSON.stringify(stored.filter(id => id !== s.id))
            );
            // 4. 等待列表刷新完成后再 toast
            await fetchSessions();
            if (sessionIdRef.current === s.id) newChat();
            toast.success('已删除');
        } catch {
            toast.error('删除失败');
        }
    };
    del();
}}
```

- [ ] **Step 2: 验证 — TSC 0 错误**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/chat/V3ChatPage.tsx
git commit -m "fix(frontend): 修复删除竞态 — 清除 auto-save timer + await fetchSessions"
```

---

### Task L3.3: SSE ReadableStream 清理

**Files:**
- Modify: `frontend/src/pages/team/TeamChat.tsx:51-88`

**Interfaces:**
- Produces: SSE 连接在组件卸载时正确取消，不再泄漏

- [ ] **Step 1: 添加 AbortController + reader ref**

在组件顶部添加：
```typescript
const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
const abortRef = useRef<AbortController | null>(null);
```

修改 SSE fetch 逻辑（约第 51-88 行）：
```typescript
useEffect(() => {
    if (!orgId) return;

    const controller = new AbortController();
    abortRef.current = controller;

    const token = localStorage.getItem('auth_token');
    const url = `/api/orgs/${orgId}/stream`;

    fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
    })
      .then(async (response) => {
          if (!response.ok || !response.body) return;
          const reader = response.body.getReader();
          readerRef.current = reader;
          const decoder = new TextDecoder();
          
          try {
              while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  const text = decoder.decode(value, { stream: true });
                  // ... 解析 SSE text ...
              }
          } catch (err: any) {
              if (err.name !== 'AbortError') console.error('SSE error:', err);
          } finally {
              reader.releaseLock();
          }
      })
      .catch((err) => {
          if (err.name !== 'AbortError') console.error('SSE fetch error:', err);
      });

    return () => {
        readerRef.current?.cancel();
        abortRef.current?.abort();
        readerRef.current = null;
        abortRef.current = null;
    };
}, [orgId]);
```

- [ ] **Step 2: 验证 — TSC 0 错误**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/team/TeamChat.tsx
git commit -m "fix(frontend): SSE ReadableStream 正确清理 — AbortController + reader.cancel()"
```

---

### Task L3.4: 消息 React key 修复

**Files:**
- Modify: `frontend/src/pages/chat/V3ChatPage.tsx:781`
- Modify: `frontend/src/pages/project/ChatPage.tsx:401`

**Interfaces:**
- Produces: 消息列表使用稳定唯一 key

- [ ] **Step 1: 替换 V3ChatPage key**

将 `{messages.map((msg, i) => (` 中的 `key={i}` 替换为：
```typescript
key={msg.id || `msg-${i}-${msg.timestamp || Date.now()}`}
```

- [ ] **Step 2: 替换 ChatPage key**

同样修改 `ChatPage.tsx` 中的 `key={i}`。

- [ ] **Step 3: 验证 — TSC 0 错误**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/chat/V3ChatPage.tsx frontend/src/pages/project/ChatPage.tsx
git commit -m "fix(frontend): 消息列表 React key 从数组索引改为稳定唯一 ID"
```

---

### Task L3.5: 项目删除事务化

**Files:**
- Modify: `frontend/src/pages/chat/V3ProjectPage.tsx:78-95`

**Interfaces:**
- Produces: 项目删除前确保所有关联 session 删除成功

- [ ] **Step 1: 修改 deleteProjectMutation**

将 mutation 函数改为：
```typescript
mutationFn: async (id: string) => {
    const sessionIds = getProjectSessionIds(id);
    // 并行删除所有 sessions，收集结果
    const results = await Promise.allSettled(
        sessionIds.map(sid => sessionsApi.delete(sid))
    );
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
        throw new Error(`${failed.length}/${sessionIds.length} 个会话删除失败`);
    }
    // 只有所有 session 删除成功后才删项目
    await projectsApi.delete(id);
    cleanupProjectStorage(id);
},
onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['v3-projects', workspaceId] });
    toast.success('项目已删除（含关联会话记录）');
},
onError: (err: any) => {
    toast.error(`删除失败: ${err.message || '请重试'}`);
},
```

- [ ] **Step 2: 验证 — TSC 0 错误**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/chat/V3ProjectPage.tsx
git commit -m "fix(frontend): 项目删除事务化 — session 删除全部成功后才删项目"
```

---

### Task L3.6: 重复"快速对话"项目防护

**Files:**
- Modify: `frontend/src/pages/home/HomePage.tsx:71-79`

**Interfaces:**
- Produces: 创建"快速对话"前二次确认，防止跨 Tab 重复创建

- [ ] **Step 1: 添加二次确认逻辑**

修改 `initProject` 函数中的默认项目创建逻辑：
```typescript
let defaultProj = projects.find((p: any) => p.name === DEFAULT_PROJECT_NAME);
if (!defaultProj) {
    // 二次确认：重新获取最新列表（防止竞态）
    const latestProjects = await projectsApi.list(wsId!);
    const freshDefault = latestProjects.data?.find((p: any) => p.name === DEFAULT_PROJECT_NAME);
    if (freshDefault) {
        defaultProj = freshDefault;
    } else {
        try {
            const created = await projectsApi.create(wsId!, {
                name: DEFAULT_PROJECT_NAME,
                description: '首页快速对话',
            });
            defaultProj = created.data;
        } catch (err: any) {
            // 如果创建失败（可能已存在），再次尝试获取
            const retryProjects = await projectsApi.list(wsId!);
            defaultProj = retryProjects.data?.find((p: any) => p.name === DEFAULT_PROJECT_NAME);
        }
    }
}
```

- [ ] **Step 2: 验证 — TSC 0 错误**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/home/HomePage.tsx
git commit -m "fix(frontend): 创建默认项目前二次确认，防止重复'快速对话'项目"
```

---

### Task L4.1: build_index() 添加用户级并发锁

**Files:**
- Modify: `rag/knowledge_base.py:1-10, 61-65`

**Interfaces:**
- Produces: `_get_lock(user_id) -> threading.Lock` — 按用户隔离的互斥锁

- [ ] **Step 1: 添加锁机制**

在 `rag/knowledge_base.py` 顶部 import 区域添加 `import threading`。

在全局变量区域（第 25 行后）添加：
```python
_locks: dict[str, threading.Lock] = {}

def _get_lock(user_id: str) -> threading.Lock:
    """返回 user_id 对应的互斥锁，不存在时创建。"""
    if user_id not in _locks:
        _locks[user_id] = threading.Lock()
    return _locks[user_id]
```

修改 `build_index` 函数签名（第 61 行）：
```python
def build_index(user_id: str) -> int:
    """扫描用户文档目录下所有 PDF/TXT，重建索引（线程安全）。"""
    with _get_lock(user_id):
        return _build_index_locked(user_id)
```

将原有的 `build_index` 函数体（第 61-129 行）重命名为 `_build_index_locked`。

- [ ] **Step 2: 验证 — 并发重建不损坏数据**

```bash
python -c "
import threading, time
from rag.knowledge_base import build_index

errors = []
def safe_rebuild(idx):
    try:
        print(f'T{idx} start'); build_index('test_user'); print(f'T{idx} done')
    except Exception as e:
        errors.append((idx, str(e)))

threads = [threading.Thread(target=safe_rebuild, args=(i,)) for i in range(3)]
[t.start() for t in threads]; [t.join() for t in threads]
assert not errors, f'FAIL: {errors}'
print('PASS: 并发重建无错误')
"
```

- [ ] **Step 3: Commit**

```bash
git add rag/knowledge_base.py
git commit -m "fix(rag): build_index() 添加 per-user 互斥锁，杜绝并发重建损坏 ChromaDB"
```

---

### Task L4.2: build_index 事务化 — 临时目录 + 原子替换

**Files:**
- Modify: `rag/knowledge_base.py:61-129` (_build_index_locked)

**Interfaces:**
- Produces: 重建索引先写入临时目录，成功后原子替换，失败保留旧索引

- [ ] **Step 1: 重写 _build_index_locked 为事务式**

```python
def _build_index_locked(user_id: str) -> int:
    """带锁的实际重建逻辑：先建到临时目录，成功后原子替换。"""
    docs_dir, persist_dir = _get_user_dirs(user_id)
    tmp_dir = persist_dir + "_tmp"
    
    # 1. 清理残留临时目录
    if os.path.exists(tmp_dir):
        shutil.rmtree(tmp_dir, ignore_errors=True)
    
    # 2. 加载并切分文档（单文件异常隔离）
    chunks = _load_and_chunk_documents(user_id)
    if not chunks:
        return 0
    
    # 3. 建到临时目录
    emb = _get_embeddings()
    vs = Chroma.from_documents(documents=chunks, embedding=emb, persist_directory=tmp_dir)
    vs.persist()
    
    # 4. 淘汰旧缓存并关闭连接
    _evict_cached_vs(user_id)
    
    # 5. 原子替换
    if os.path.exists(persist_dir):
        shutil.rmtree(persist_dir, ignore_errors=True)
    os.rename(tmp_dir, persist_dir)
    
    return len(chunks)
```

并添加辅助函数 `_evict_cached_vs`：
```python
def _evict_cached_vs(user_id: str):
    """安全淘汰缓存的 vectorstore 实例。"""
    global _vectorstores
    old_vs = _vectorstores.pop(user_id, None)
    if old_vs is not None and hasattr(old_vs, "_client"):
        try:
            old_vs._client.close()
            if hasattr(old_vs._client, "_system"):
                old_vs._client._system.stop()
        except Exception:
            pass
```

- [ ] **Step 2: 验证 — 事务性**

```bash
python -c "
from rag.knowledge_base import build_index
# 正常重建
result = build_index('test_user')
print(f'PASS: 重建返回 {result} 个 chunks')
"
```

- [ ] **Step 3: 验证 — 现有测试仍通过**

```bash
python -m pytest tests/ -v
```

- [ ] **Step 4: Commit**

```bash
git add rag/knowledge_base.py
git commit -m "fix(rag): build_index 事务化 — 临时目录构建 + 原子替换，失败保留旧索引"
```

---

### Task L4.3: 单文件异常隔离

**Files:**
- Modify: `rag/knowledge_base.py` (新增 `_load_and_chunk_documents` 函数)

**Interfaces:**
- Produces: `_load_and_chunk_documents(user_id: str) -> list` — 跳过损坏文件，返回有效 chunks

- [ ] **Step 1: 实现 _load_and_chunk_documents**

```python
def _load_and_chunk_documents(user_id: str) -> list:
    """遍历文档目录，加载并切分。损坏文件跳过并记录警告。"""
    docs_dir, _ = _get_user_dirs(user_id)
    
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=300, chunk_overlap=50,
        separators=["\n\n", "\n", "。", "！", "？", " ", ""],
    )
    
    all_chunks = []
    errors = []
    
    for fname in sorted(os.listdir(docs_dir)):
        fpath = os.path.join(docs_dir, fname)
        try:
            if fname.endswith(".pdf"):
                loader = PyPDFLoader(fpath)
                pages = loader.load()
            elif fname.endswith(".txt"):
                loader = TextLoader(fpath, encoding="utf-8")
                pages = loader.load()
            else:
                continue
            
            chunks = splitter.split_documents(pages)
            valid = [c for c in chunks if c.page_content and c.page_content.strip()]
            all_chunks.extend(valid)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"跳过损坏文件 {fname}: {e}")
            errors.append({"file": fname, "error": str(e)})
    
    if not all_chunks and errors:
        raise RuntimeError(f"所有文件处理失败: {errors}")
    
    return all_chunks
```

- [ ] **Step 2: 验证**

```bash
python -c "from rag.knowledge_base import _load_and_chunk_documents; print(len(_load_and_chunk_documents('test_user')))"
```

- [ ] **Step 3: Commit**

```bash
git add rag/knowledge_base.py
git commit -m "fix(rag): 单文件异常隔离 — 损坏 PDF/TXT 跳过不中断全量重建"
```

---

### Task L4.4: 上传后自动触发索引

**Files:**
- Modify: `app/knowledge.py:53-100` (kb_upload)

**Interfaces:**
- Produces: upload API 返回 `indexed: true/false` + `chunks` 或 `warning`

- [ ] **Step 1: 修改 kb_upload 末尾逻辑**

在文件保存成功后（第 92 行后），添加自动索引：
```python
# 保存文件后自动重建索引
try:
    from rag.knowledge_base import build_index
    chunk_count = build_index(user["user_id"])
    return JSONResponse({
        "status": "ok", "filename": safe_name,
        "indexed": True, "chunks": chunk_count,
    })
except Exception as e:
    import logging
    logging.getLogger(__name__).error(f"自动索引失败: {e}")
    return JSONResponse({
        "status": "ok", "filename": safe_name,
        "indexed": False,
        "warning": f"文件已保存但索引失败，请手动重建: {str(e)[:100]}",
    })
```

- [ ] **Step 2: 验证 — 语法正确**

```bash
python -c "from app.knowledge import router; print('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add app/knowledge.py
git commit -m "feat(rag): 上传后自动重建索引，消除两步操作"
```

---

### Task L4.5: search_knowledge 支持 per-user 检索

**Files:**
- Modify: `tools.py:49-62` (search_knowledge)
- Modify: `router/stream_graph.py:138-162` (retriever_node)

**Interfaces:**
- Produces: search_knowledge 接受 `user_id` 参数；retriever_node 传递当前用户 ID

- [ ] **Step 1: 修改 search_knowledge 工具**

将 `tools.py` 第 49-62 行：
```python
@tool
def search_knowledge(query: str) -> str:
    """在知识库中搜索相关文档。..."""
    try:
        from rag.knowledge_base import search
        results = search(query, user_id="shared")  # 默认 shared
        ...
```
改为：
```python
@tool
def search_knowledge(query: str, user_id: str = "shared") -> str:
    """在知识库中搜索相关文档。参数 query: 查询字符串, user_id: 用户ID（默认 shared）。"""
    try:
        from rag.knowledge_base import search
        results = search(query, user_id=user_id)
        ...
```

- [ ] **Step 2: 修改 retriever_node 传递 user_id**

在 `router/stream_graph.py` 的 `retriever_node` 中（约第 142 行）：
```python
# 修改前:
# knowledge = search_knowledge.invoke({"query": state["user_input"]})
# 修改后:
user_id = state.get("user_id", "shared")
knowledge = search_knowledge.invoke({"query": state["user_input"], "user_id": user_id})
```

- [ ] **Step 3: 验证 — 语法正确**

```bash
python -c "from tools import search_knowledge; print('OK')"
python -c "from router.stream_graph import retriever_node; print('OK')"
```

- [ ] **Step 4: Commit**

```bash
git add tools.py router/stream_graph.py
git commit -m "fix(rag): search_knowledge 支持 per-user 检索，Agent 可搜索用户个人知识库"
```

---

### Task L4.6: _vectorstores 缓存 TTL 淘汰

**Files:**
- Modify: `rag/knowledge_base.py:25, 48-58`

**Interfaces:**
- Produces: 30 分钟未访问的 Chroma 实例自动关闭并淘汰

- [ ] **Step 1: 添加 TTL 追踪**

将 `_vectorstores` 从 `dict[str, Chroma]` 改为 `dict[str, tuple[Chroma, float]]`（加时间戳）。

修改 `_get_vectorstore`：
```python
_VS_TTL = 30 * 60  # 30 分钟

def _get_vectorstore(user_id: str):
    """按 user_id 加载向量库，带 TTL 缓存淘汰。"""
    import time
    now = time.time()
    
    global _vectorstores
    # 淘汰过期条目
    expired = [uid for uid, (_, ts) in _vectorstores.items() if now - ts > _VS_TTL]
    for uid in expired:
        _evict_cached_vs(uid)
    
    if user_id in _vectorstores:
        vs, _ = _vectorstores[user_id]
        _vectorstores[user_id] = (vs, now)  # 更新访问时间戳
        return vs
    
    docs_dir, persist_dir = _get_user_dirs(user_id)
    emb = _get_embeddings()
    if os.path.exists(os.path.join(persist_dir, "chroma.sqlite3")):
        vs = Chroma(persist_directory=persist_dir, embedding_function=emb)
        _vectorstores[user_id] = (vs, now)
        return vs
    return None
```

- [ ] **Step 2: 验证 — 语法正确**

```bash
python -c "from rag.knowledge_base import _get_vectorstore; print('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add rag/knowledge_base.py
git commit -m "fix(rag): _vectorstores 缓存添加 30 分钟 TTL 淘汰，防止内存泄漏"
```

---

### Task L4.7: 移除模块级环境变量副作用 + OCR 改进

**Files:**
- Modify: `rag/knowledge_base.py:13-16` (移除 os.environ 覆盖)
- Modify: `app/knowledge.py:73-88` (OCR 超时 + 图片预处理)

**Interfaces:**
- Produces: HF_HUB_OFFLINE 通过 model_kwargs 控制；OCR 有 30s 超时和图片缩放

- [ ] **Step 1: 移除模块级 os.environ**

删除 `rag/knowledge_base.py` 第 13-16 行：
```python
# 删除这 4 行：
# os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
# os.environ["HF_HUB_OFFLINE"] = "1"
# os.environ["TRANSFORMERS_OFFLINE"] = "1"
# os.environ["HF_DATASETS_OFFLINE"] = "1"
```

`_get_embeddings` 保持不变（已通过 `model_kwargs={"local_files_only": True}` 控制）。

- [ ] **Step 2: OCR 添加超时和图片缩放**

在 `app/knowledge.py` 的 OCR 处理部分（约第 75 行）：
```python
# OCR 前缩放图片
from PIL import Image
import io
img = Image.open(io.BytesIO(contents))
# 长边 > 2000px 时等比缩放
max_dim = 2000
if max(img.size) > max_dim:
    ratio = max_dim / max(img.size)
    new_size = (int(img.width * ratio), int(img.height * ratio))
    img = img.resize(new_size, Image.LANCZOS)

# OCR 带超时
import concurrent.futures
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
    future = executor.submit(pytesseract.image_to_string, img, lang="chi_sim+eng")
    try:
        text = future.result(timeout=30)
    except concurrent.futures.TimeoutError:
        raise HTTPException(status_code=500, detail="OCR 超时，图片可能过大")
```

- [ ] **Step 3: 验证 — 语法正确**

```bash
python -c "from rag.knowledge_base import _get_embeddings; print('OK')"
python -c "from app.knowledge import router; print('OK')"
```

- [ ] **Step 4: Commit**

```bash
git add rag/knowledge_base.py app/knowledge.py
git commit -m "fix(rag): 移除模块级 env 覆盖 + OCR 添加 30s 超时和图片缩放"
```

---

### Task L4.8: 前端知识库页显示索引状态

**Files:**
- Modify: `frontend/src/api/knowledge.ts:17` (超时调整)
- Modify: `frontend/src/pages/knowledge/KnowledgePage.tsx` (索引状态徽标)

**Interfaces:**
- Produces: 文件列表显示 `已索引`/`未索引` 徽标；上传超时延长到 120s

- [ ] **Step 1: API 超时延长**

修改 `frontend/src/api/knowledge.ts` 第 17 行，将 `timeout: 30000` 改为 `timeout: 120000`。

- [ ] **Step 2: 文件列表添加索引状态**

在 `KnowledgePage.tsx` 的文件列表项中添加状态徽标（利用 `kb-stats` query 的结果）：
```tsx
{files.map((f: any) => (
    <div key={f.name} className="flex items-center justify-between p-3 bg-base-200 rounded">
        <div className="flex items-center gap-2">
            <span>{f.name}</span>
            {stats?.就绪 ? (
                <span className="badge badge-success badge-xs">已索引</span>
            ) : (
                <span className="badge badge-warning badge-xs">未索引</span>
            )}
        </div>
        <button ...>删除</button>
    </div>
))}
```

- [ ] **Step 3: 验证 — TSC 0 错误 + 构建成功**

```bash
cd frontend && npx tsc --noEmit && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/knowledge.ts frontend/src/pages/knowledge/KnowledgePage.tsx
git commit -m "feat(frontend): 知识库页显示索引状态 + 上传超时延长到 120s"
```

---

## 验证清单

### L1 安全加固完成后：
```bash
python -m pytest tests/ -v                    # 26 tests PASS
python -c "from user.auth import _JWT_SECRET"  # 无 RuntimeError（.env 配置正确）
python -c "from tools import _resolve_path; _resolve_path('../../etc/passwd')"  # ValueError
```

### L2 数据库修复完成后：
```bash
python -m pytest tests/ -v                    # 26 tests PASS
python -c "
from user.db import Database
db = Database('data.db')
# 验证索引
cur = db._conn().execute('SELECT name FROM sqlite_master WHERE type=\"index\"')
print([r[0] for r in cur.fetchall()])
"
```

### L3 前端修复完成后：
```bash
cd frontend && npx tsc --noEmit              # 0 errors
npm run build                                  # 构建成功
```

### L4 RAG 修复完成后：
```bash
python -m pytest tests/ -v                    # 26 tests PASS
python -c "from rag.knowledge_base import build_index; print('OK')"
python -c "from tools import search_knowledge; print('OK')"
```
