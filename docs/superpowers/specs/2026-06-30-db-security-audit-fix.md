# 数据库与安全审计修复 — 设计文档 v2.0

> 基于 2026-06-30 全面代码审计，修复 33 个数据库/安全/RAG 问题
> 版本：v2.0 | 日期：2026-06-30

---

## 一、审计发现总览

四个维度的全面审查（数据库层、前端数据流、安全漏洞、RAG 知识库），共发现 33 个问题：

| 优先级 | 数量 | 涉及文件 |
|--------|------|---------|
| CRITICAL | 8 | auth.py, .env, db.py, tools.py, main.py, knowledge_base.py |
| HIGH | 15 | V3ChatPage.tsx, TeamChat.tsx, V3ProjectPage.tsx, routes.py, knowledge.py, executor.py, knowledge_base.py, stream_graph.py |
| MEDIUM | 10 | db.py, TeamChat.tsx, organizations.py, ChatPage.tsx, ocr.py, knowledge.ts, FilesTab.tsx |

---

## 二、架构决策

### 修复分层策略

```
L1: 安全加固 (8 文件)
 ├── JWT 密钥强制设置，移除硬编码默认值
 ├── 路径遍历防护 (tools.py: _resolve_path)
 ├── 速率限制 (auth 端点 + guest chat + report)
 ├── API Key 加密存储 (Fernet 对称加密)
 ├── 权限收紧 (project delete → owner only, org invite → owner only)
 ├── 沙箱回退禁止 (Docker 不可用时报错而非无沙箱执行)
 ├── 文件上传大小限制 (5MB)
 └── 错误消息脱敏

L2: 数据库修复 (3 文件)
 ├── upsert_session 所有权检查 → 杜绝会话劫持
 ├── v5 表添加 ON DELETE CASCADE → 一致级联策略
 ├── 孤儿记录清理 (FTS5 + eval_logs)
 ├── 关键索引添加 (sessions.user_id, org_messages.channel_id 等)
 ├── ID 生成统一为完整 UUID4
 └── db dump_all() 添加 DEBUG guard

L3: 前端修复 (3 文件)
 ├── 合并两个 sessionsApi.list() 调用 → 单一数据源
 ├── 删除竞态修复 (auto-save 取消 + await fetchSessions)
 ├── SSE ReadableStream reader 存储到 ref + cleanup
 ├── 消息 key 从 index 改为 msg.id
 ├── 项目删除事务化 (session 删除失败则回滚)
 └── 重复"快速对话"项目防护

L4: RAG 知识库修复 (7 文件)
 ├── build_index() 添加用户级锁 → 杜绝并发重建
 ├── 事务化重建：先建到临时目录 → 成功后原子替换
 ├── 单文件异常隔离：损坏文件跳过而非全盘失败
 ├── 上传后自动触发索引 → 消除两步操作
 ├── search_knowledge 支持 per-user 检索
 ├── ChromaDB 连接池管理 + TTL 淘汰
 ├── 文件句柄用 with 管理 + OCR 超时控制
 └── 前端知识库页显示索引状态
```

### 设计原则

1. **向后兼容** — 不改变现有 API 契约，前端无需适配
2. **最小改动** — 每个修复只改必要代码，不重构无关逻辑
3. **DB 层优先** — 安全校验下沉到数据库层（defense-in-depth）
4. **先修后测** — 每层修复后运行后端 26 测试 + TSC 0 错误验证

---

## 三、逐项修复方案

### L1: 安全加固

#### 1.1 JWT 密钥强制设置
**文件:** `user/auth.py:8-12`
**方案:** 移除默认值，启动时检测 `JWT_SECRET` 环境变量，缺失或等于已知弱密钥时抛出 `RuntimeError`。
```python
_JWT_SECRET = os.getenv("JWT_SECRET")
if not _JWT_SECRET or _JWT_SECRET in ("zeng-key-123456", "change-me", "secret"):
    raise RuntimeError("JWT_SECRET 未设置或使用弱密钥，请在 .env 中设置强随机值")
```

#### 1.2 路径遍历防护
**文件:** `tools.py:14-20`
**方案:** `_resolve_path` 在 `os.path.join` 后调用 `os.path.realpath`，校验结果仍在 `WORK_DIR` 内。
```python
def _resolve_path(path: str) -> str:
    work_real = os.path.realpath(WORK_DIR)
    full = os.path.realpath(os.path.join(WORK_DIR, path))
    if not full.startswith(work_real + os.sep) and full != work_real:
        raise ValueError(f"路径遍历检测: {path}")
    return full
```

#### 1.3 速率限制
**文件:** `main.py` + `user/routes.py`
**方案:** 使用 `slowapi` 库（基于 `limits` + Redis/内存后端），对以下端点施加限制：
- `POST /api/auth/register` — 5次/IP/小时
- `POST /api/auth/login` — 20次/IP/小时（含指数退避）
- `POST /api/chat/guest` — 10次/IP/天
- `POST /api/report` — 需认证 + 20次/用户/天

#### 1.4 API Key 加密存储
**文件:** `user/db.py` + `user/routes.py`
**方案:** 引入 `cryptography.fernet.Fernet`，使用 `JWT_SECRET` 派生加密密钥。自定义模型 API Key 写入前加密，读取后解密。对旧数据（明文）做兼容处理：解密失败时假定为明文，自动迁移。

#### 1.5 权限收紧
**文件:** `workspace/routes.py:210-224` + `workspace/organizations.py:74-89`
**方案:**
- `delete_project`: 检查 `member_role == "owner"` 或 `project.created_by == user_id`
- `update_agent_config`: 检查 `member_role == "owner"` 或 `project.created_by == user_id`
- `invite_member` (org): 检查 `role == "owner"`

#### 1.6 沙箱回退禁止
**文件:** `executor.py:30-42`
**方案:** Docker 不可用时抛出明确错误而非 `subprocess.run`：
```python
if not docker_available:
    raise RuntimeError("Docker 不可用，代码执行已禁用。请安装 Docker。")
```

#### 1.7 文件上传大小限制
**文件:** `app/knowledge.py:88-96, 73-83`
**方案:** 全局常量 `MAX_UPLOAD_SIZE = 5 * 1024 * 1024`（5MB），读取后检查 `len(contents) > MAX_UPLOAD_SIZE` → 413 错误。

#### 1.8 错误消息脱敏
**文件:** `main.py:139-162, 165-181` + `router/stream.py:165-175`
**方案:** 生产模式下返回通用错误消息，完整 traceback 仅写入日志。添加 `is_production = os.getenv("ENV") == "production"` 判断。

---

### L2: 数据库修复

#### 2.1 upsert_session 所有权检查
**文件:** `user/db.py:368-385`
**方案:** UPDATE 时添加 `AND user_id = ?` 条件，不存在时执行 INSERT（而非覆盖他人记录）。
```python
def upsert_session(self, session_id: str, user_id: str, messages: list[dict], title: str = "") -> str:
    with self._conn() as conn:
        existing = conn.execute(
            "SELECT id FROM sessions WHERE id = ? AND user_id = ?",
            (session_id, user_id)
        ).fetchone()
        if existing:
            conn.execute("UPDATE sessions SET ... WHERE id = ? AND user_id = ?", ...)
        else:
            conn.execute("INSERT INTO sessions ...", ...)
```

#### 2.2 v5 表级联策略统一
**文件:** `user/db.py` migration v5 DDL
**方案:** 为 v5 四表添加 `ON DELETE CASCADE`（需 migration v6 rebuild）或在 `delete_organization` 中补充遗漏的清理。选择后者以保持兼容：补充 `org_messages` 中 channel 被删后的孤儿清理。

#### 2.3 索引添加
**文件:** `user/db.py` migration v6
**方案:** 添加以下索引：
```sql
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_org_msgs_channel ON org_messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_org_msgs_created ON org_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_org_channels_org ON org_channels(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_todos_org ON org_todos(org_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
```

#### 2.4 ID 生成统一
**文件:** `user/db.py:315, 401, 494, 572` + `user/routes.py:136`
**方案:** 将所有 `str(uuid.uuid4())[:8]` 替换为 `str(uuid.uuid4())`（完整 36 字符 UUID），session ID 使用 `uuid4` 替代时间戳。

#### 2.5 dump_all() 保护
**文件:** `user/db.py:826-834`
**方案:** 添加环境变量 guard：`if os.getenv("DEBUG") != "true": raise PermissionError("仅开发模式可用")`

---

### L3: 前端修复

#### 3.1 合并重复 sessionsApi.list() 调用
**文件:** `frontend/src/pages/chat/V3ChatPage.tsx`
**方案:** 
- 删除 path B（lines 592-604）中的 `sessionsApi.list()` 调用和 `setSideSessions`
- 将 path A（lines 248-260）作为唯一数据源
- path B 保留 `projectsApi.get`、`knowledgeApi` 等非 sessions 调用
- `displaySessions` 直接使用 `sessions` state，移除与 `sideSessions` 的双重状态

#### 3.2 删除竞态修复
**文件:** `frontend/src/pages/chat/V3ChatPage.tsx`
**方案:**
- 删除 handler 中 `await fetchSessions()` 后再 toast（而非 fire-and-forget）
- 删除前清除 auto-save 的 debounce timer：`clearTimeout(saveTimerRef.current)`
- localStorage 操作移到 `fetchSessions` 成功后（而非之前）

#### 3.3 SSE ReadableStream 清理
**文件:** `frontend/src/pages/team/TeamChat.tsx`
**方案:**
- 将 `reader` 存储到 `useRef<ReadableStreamDefaultReader | null>`
- cleanup 中调用 `readerRef.current?.cancel()` + 设置 `abortController.abort()`
- 使用 `AbortController` 信号传递给 fetch

#### 3.4 消息 React key 修复
**文件:** `V3ChatPage.tsx:781` + `ChatPage.tsx:401`
**方案:** 将 `key={i}` 替换为 `key={msg.id || msg.timestamp || i}`（优先使用消息唯一 ID）

#### 3.5 项目删除事务化
**文件:** `frontend/src/pages/chat/V3ProjectPage.tsx`
**方案:**
- 先收集所有 session delete promise
- `await Promise.allSettled(sessionDeletes)`
- 检查是否有失败，有则 toast 警告并阻止项目删除
- 全部成功才删除项目 + 清理 localStorage

#### 3.6 重复"快速对话"项目防护
**文件:** `frontend/src/pages/home/HomePage.tsx`
**方案:**
- 在创建前二次确认：先 `await projectsApi.list(wsId)` 获取最新列表
- 如已存在"快速对话"项目则复用而非创建
- 使用 `useRef` 作为跨渲染的创建锁（而非每次 mount 重置）

---

### L4: RAG 知识库修复

#### 4.1 build_index() 并发锁 → 杜绝并发重建导致 ChromaDB 损坏

**文件:** `rag/knowledge_base.py:61-129`
**问题:** 两个并发 `build_index()` 调用同时删除旧索引、同时写入新 ChromaDB，导致 SQLite 文件损坏。
**方案:** 使用 `threading.Lock` 字典，按 `user_id` 隔离锁：
```python
import threading
_locks: dict[str, threading.Lock] = {}

def _get_lock(user_id: str) -> threading.Lock:
    if user_id not in _locks:
        _locks[user_id] = threading.Lock()
    return _locks[user_id]

def build_index(user_id: str) -> int:
    with _get_lock(user_id):
        return _build_index_locked(user_id)
```

#### 4.2 事务化重建 → 先建到临时目录，成功后原子替换

**文件:** `rag/knowledge_base.py:61-129`
**问题:** 现有逻辑是先销毁旧索引再建新索引（destroy-before-build）。中间任何步骤失败（PDF 损坏、嵌入失败、磁盘满），用户丢失全部索引。
**方案:**
```python
def _build_index_locked(user_id: str) -> int:
    persist_dir = os.path.join(CHROMA_DIR, user_id)
    tmp_dir = os.path.join(CHROMA_DIR, f"{user_id}_tmp")
    
    # 1. 建新索引到临时目录
    if os.path.exists(tmp_dir):
        shutil.rmtree(tmp_dir, ignore_errors=True)
    
    chunks = _load_and_chunk_documents(user_id)  # 带 per-file try/except
    vs = Chroma.from_documents(chunks, emb, persist_directory=tmp_dir)
    vs.persist()
    
    # 2. 淘汰旧缓存的 vectorstore
    _evict_cached_vs(user_id)
    
    # 3. 原子替换：删除旧目录 → 重命名临时目录
    if os.path.exists(persist_dir):
        shutil.rmtree(persist_dir, ignore_errors=True)
    os.rename(tmp_dir, persist_dir)
    
    return len(chunks)
```

**文件:** `app/knowledge.py:45-50` — rebuild 端点无需修改，自动享有事务性。

#### 4.3 单文件异常隔离 → 损坏文件跳过而非全盘失败

**文件:** `rag/knowledge_base.py:96-108`
**问题:** 遍历目录时，一个损坏 PDF 的 `loader.load()` 抛异常会导致整个 rebuild 失败，所有文件的处理都白费。
**方案:** 将文件加载提取为独立函数，每个文件独立 try/except：
```python
def _load_and_chunk_documents(user_id: str) -> list:
    docs_dir = os.path.join(DOCUMENTS_DIR, user_id)
    all_chunks = []
    errors = []
    
    for fname in os.listdir(docs_dir):
        fpath = os.path.join(docs_dir, fname)
        try:
            if fname.endswith(".pdf"):
                loader = PyPDFLoader(fpath)
                with loader:  # 确保句柄释放
                    pages = loader.load()
            elif fname.endswith(".txt"):
                with open(fpath, "r", encoding="utf-8") as f:
                    text = f.read()
                pages = [Document(page_content=text, metadata={"source": fname})]
            else:
                continue
            
            splitter = RecursiveCharacterTextSplitter(
                chunk_size=300, chunk_overlap=50,
                separators=["\n\n", "\n", "。", "！", "？", " ", ""]
            )
            chunks = splitter.split_documents(pages)
            all_chunks.extend([c for c in chunks if c.page_content.strip()])
        except Exception as e:
            logging.getLogger(__name__).warning(f"跳过损坏文件 {fname}: {e}")
            errors.append({"file": fname, "error": str(e)})
    
    if not all_chunks and errors:
        raise RuntimeError(f"所有文件处理失败: {errors}")
    
    return all_chunks
```

#### 4.4 上传后自动触发索引 → 消除两步操作

**文件:** `app/knowledge.py:53-100`
**问题:** 上传只保存文件不索引，用户必须手动点击"重建索引"。文件列表显示已上传但搜索不到。
**方案:** 在 `kb_upload()` 保存文件后自动调用 `build_index(user_id)`：
```python
@app.post("/api/knowledge/upload")
async def kb_upload(request: Request, file: UploadFile = File(...), user: dict = Depends(require_auth)):
    # ... 保存文件逻辑不变 ...
    
    # 上传后自动重建索引
    try:
        from rag.knowledge_base import build_index
        chunk_count = build_index(user["user_id"])
        return JSONResponse({
            "status": "ok", "filename": safe_name,
            "indexed": True, "chunks": chunk_count
        })
    except Exception as e:
        logging.getLogger(__name__).error(f"自动索引失败: {e}")
        return JSONResponse({
            "status": "ok", "filename": safe_name,
            "indexed": False, "warning": "文件已保存但索引失败，请手动重建"
        })
```

#### 4.5 search_knowledge 支持 per-user 检索

**文件:** `tools.py:49-62` + `router/stream_graph.py:138-162`
**问题:** `search_knowledge` 硬编码 `user_id="shared"`，Agent 永远检索不到用户个人知识库。
**方案:** 
1. 将 `search_knowledge` 从 `@tool` 改为接受 `user_id` 参数
2. `stream_graph.py` 的 `retriever_node` 从 `state.user_id` 传递当前用户 ID
```python
# tools.py — 改为接受 user_id 参数
def search_knowledge(query: str, user_id: str = "shared") -> str:
    from rag.knowledge_base import search
    try:
        results = search(query, user_id=user_id, k=5)
        ...
```

```python
# stream_graph.py — retriever_node 传递 user_id
def retriever_node(state: SessionState):
    query = state["user_input"]
    user_id = state.get("user_id", "shared")
    result = search_knowledge.invoke({"query": query, "user_id": user_id})
    ...
```

#### 4.6 _vectorstores 缓存 TTL 淘汰

**文件:** `rag/knowledge_base.py:25, 48-58`
**问题:** 全局 `_vectorstores` dict 无限增长，每次搜索缓存一个 Chroma 实例，永不释放。
**方案:** 添加时间戳追踪 + 30 分钟 TTL：
```python
_vectorstores: dict[str, tuple[Chroma, float]] = {}  # (instance, last_access_ts)
_VS_TTL = 30 * 60  # 30 分钟

def _get_vectorstore(user_id: str):
    import time
    now = time.time()
    
    # 淘汰过期条目
    expired = [uid for uid, (_, ts) in _vectorstores.items() if now - ts > _VS_TTL]
    for uid in expired:
        _evict_cached_vs(uid)
    
    if user_id in _vectorstores:
        vs, _ = _vectorstores[user_id]
        _vectorstores[user_id] = (vs, now)  # 更新时间戳
        return vs
    ...
```

#### 4.7 移除模块级环境变量副作用

**文件:** `rag/knowledge_base.py:13-16`
**问题:** 模块导入时强制设置 `HF_HUB_OFFLINE`、`NO_PROXY` 等全局环境变量，影响其他模块。
**方案:** 将环境变量设置移到 `_get_embeddings()` 函数内部，使用 `model_kwargs` 参数控制：
```python
def _get_embeddings():
    global _embeddings
    if _embeddings is None:
        _embeddings = HuggingFaceEmbeddings(
            model_name="BAAI/bge-small-zh-v1.5",
            model_kwargs={"device": "cpu", "local_files_only": True},
            encode_kwargs={"normalize_embeddings": True}
        )
    return _embeddings
```
删除模块顶部的 4 行 `os.environ` 覆盖。

#### 4.8 OCR 超时 + 图片预处理

**文件:** `app/knowledge.py:73-88` + `app/ocr.py`
**方案:**
- OCR 调用包装 `concurrent.futures.ThreadPoolExecutor` + 30s 超时
- 图片长边 > 2000px 时等比缩放到 2000px 后再 OCR
- `pytesseract.image_to_string()` 添加 `timeout=30` 参数

#### 4.9 前端知识库页显示索引状态

**文件:** `frontend/src/pages/knowledge/KnowledgePage.tsx` + `frontend/src/api/knowledge.ts`
**方案:**
- API 上传超时从 30s 提高到 120s（OCR 场景）
- 文件列表项显示索引状态徽标（绿色 `已索引` / 黄色 `未索引`）
- 上传进度指示器（多文件时显示 "上传中 3/10..."）

---

## 四、测试与验证

### 后端验证
```bash
# 1. 运行现有测试套件（26 tests）
python -m pytest tests/ -v

# 2. RAG 并发测试 — 模拟同时上传+重建
python -c "
import threading, time
from rag.knowledge_base import build_index

def rebuild(name):
    print(f'{name} start')
    build_index('test_user')
    print(f'{name} done')

# 3 个线程同时 rebuild，不应报错/损坏
threads = [threading.Thread(target=rebuild, args=(f't{i}',)) for i in range(3)]
[t.start() for t in threads]; [t.join() for t in threads]
print('并发测试通过')
"

# 3. RAG 事务性测试 — 模拟 PDF 损坏场景
# 在 docs 目录放入一个损坏 PDF，验证 rebuild 不丢失旧索引

# 4. 验证 JWT 密钥检查
python -c "import os; os.environ.pop('JWT_SECRET', None); \
  from user.auth import _JWT_SECRET"  # 应抛出 RuntimeError

# 5. 验证路径遍历被拦截
python -c "from tools import _resolve_path; _resolve_path('../../etc/passwd')"  # 应抛出 ValueError
```

### 前端验证
```bash
cd frontend
npx tsc --noEmit                          # 0 错误
npm run build                              # 构建成功
```

### 功能验证
1. 登录 → 创建会话 → 发送消息 → 刷新 → 确认消息无重复
2. 删除会话 → 确认列表即时更新、不重新出现
3. 进入团队聊天 → 发送消息 → 切换到其他页 → 返回 → 确认消息不翻倍
4. 游客模式 → 确认速率限制生效
5. 非 owner 用户尝试删除项目 → 确认 403
6. **RAG：** 上传 3 个文件 → 确认自动索引 → 搜索验证可检索
7. **RAG：** 上传含 1 个损坏 PDF + 2 个正常文件 → 确认正常文件仍被索引
8. **RAG：** 两个浏览器 Tab 同时点"重建索引" → 确认不报错、数据不损坏
9. **RAG：** Agent 对话中提问知识库内容 → 确认能检索到用户个人知识库

---

## 五、风险与回滚

| 风险 | 影响 | 缓解 |
|------|------|------|
| ID 长度变化导致前端截断显示 | 低 | 前端使用完整 ID，不做截断 |
| API Key 加密迁移失败 | 中 | 兼容明文旧数据，自动迁移 |
| 速率限制过严 | 低 | 使用宽松阈值，日志记录限流事件 |
| migration v6 与旧 DB 不兼容 | 低 | migration 幂等，自动检测版本 |
| RAG 事务重建时磁盘空间不足 | 中 | 临时目录需要等量空间；重建前检查可用空间 |
| search_knowledge 改为 per-user 影响共享知识库 | 低 | 保留 `user_id="shared"` 作为默认回退 |
| 自动索引增加上传响应时间 | 低 | 对大文件异步后台索引，上传 API 立即返回 |
