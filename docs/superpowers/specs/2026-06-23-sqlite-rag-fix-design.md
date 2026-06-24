# SQLite 数据库接入 + RAG Bug 修复 — 设计文档

> 版本: 1.0 | 日期: 2026-06-23 | 状态: 设计阶段

---

## 1. 概述

将多智能体协作系统的持久化层从 JSON 文件替换为 SQLite，同时修复 RAG 知识库重建索引时切片数逐次翻倍的 bug。

### 1.1 目标

1. **接入 SQLite**：会话和用户数据从 `sessions.json` 迁移到 SQLite
2. **保留多用户接口**：用户通过名称标识，会话按用户隔离
3. **修复 RAG bug**：`build_index()` 反复调用导致切片累积

### 1.2 范围

| 范围 | 说明 |
|------|------|
| ✅ 引入 | `db.py` SQLite 数据库模块 |
| ✅ 迁移 | 会话管理（sessions.json → SQLite） |
| ✅ 新增 | 用户标识（无密码认证） |
| ✅ 修复 | RAG 知识库重建索引 bug |
| ❌ 不动 | 模型/角色配置（保持内存 + localStorage） |
| ❌ 不动 | 聊天管道、Agent 工作流、工具系统 |

---

## 2. 架构变更

```
之前:
  main.py → sessions.json (JSON 文件)
  main.py → _model_config (内存 dict)
  frontend → localStorage (模型配置 + 假登录)

之后:
  main.py → db.py → data.db (SQLite)
                      ├── users 表
                      └── sessions 表
  main.py → _model_config (内存 dict, 不变)
  frontend → localStorage (仅模型配置, 登录改为用户名输入)
```

---

## 3. 数据库模块 `db.py`

### 3.1 表结构

```sql
CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
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
```

设计决策：
- `users.id` 用 `str(uuid.uuid4())[:8]` 生成短 ID
- `sessions.messages` 存 JSON 字符串，避免额外消息表（当前消息量不大，JSON 足够）
- `sessions.user_id` 建立外键关联，支持按用户筛选会话
- 时间戳用 SQLite `datetime('now', 'localtime')` 自动生成

### 3.2 Database 类接口

```python
class Database:
    def __init__(self, db_path: str):
        """初始化连接，启用 WAL 模式，自动建表"""

    # ── 用户 ──
    def create_user(self, name: str) -> dict:
        """创建用户，返回 {id, name}。已存在则直接返回"""

    def get_user(self, name: str) -> dict | None:
        """按名称查找用户，返回 {id, name} 或 None"""

    # ── 会话 ──
    def list_sessions(self, user_id: str) -> list[dict]:
        """列出某用户的所有会话摘要 [{id, title, count, updated}]，按更新时间倒序"""

    def get_session(self, session_id: str) -> dict | None:
        """获取单个会话完整数据 {id, user_id, messages, updated}"""

    def save_session(self, session_id: str, user_id: str,
                     messages: list[dict], title: str = "") -> dict:
        """创建或更新会话，返回 {id, status}"""

    def delete_session(self, session_id: str) -> bool:
        """删除会话，返回是否成功"""
```

### 3.3 连接管理

- 使用 `contextlib.contextmanager`，每次操作获取短连接 + 自动提交
- 启用 WAL 模式 (`PRAGMA journal_mode=WAL`) 支持并发读写
- 启用外键约束 (`PRAGMA foreign_keys=ON`)

### 3.4 依赖注入

```python
# main.py
from db import Database

@app.on_event("startup")
async def startup():
    app.state.db = Database(os.path.join(_PROJECT_DIR, "data.db"))

# 路由中通过 request.app.state.db 获取实例
```

---

## 4. API 变更

### 4.1 现有端点变更

| 端点 | 变更内容 |
|------|---------|
| `GET /api/sessions` | 新增查询参数 `?user_id=xxx`，筛选该用户的会话 |
| `POST /api/sessions` | 请求体新增 `user_id` 字段 |

### 4.2 新增端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/users` | 创建用户 `{name}` → `{user_id, name}` |
| `GET` | `/api/users` | 按名称查找 `?name=xxx` → `{user_id, name}` 或 404 |

### 4.3 不受影响的端点

以下端点协议不变（仅内部实现从 JSON 文件切换到 SQLite）：

- `GET /api/sessions/{session_id}` — 获取会话
- `DELETE /api/sessions/{session_id}` — 删除会话
- `POST /api/chat` — 聊天接口
- `POST /api/report` — 报告生成
- `POST/GET /api/config/roles` — 角色配置
- `POST/DELETE /api/config/models` — 模型配置
- `GET/POST/DELETE /api/knowledge/*` — 知识库

---

## 5. 前端变更

### 5.1 登录弹窗 → 用户名输入

- 移除假登录弹窗中的密码字段和注册/登录切换
- 改为单一用户名输入框 + "进入" 按钮
- 输入用户名后调用 `POST /api/users` 创建/获取用户
- `user_id` 存入 `localStorage`，后续请求携带

### 5.2 会话列表按用户筛选

- `loadSessions()` 传入当前 `user_id`
- `GET /api/sessions?user_id=xxx` 仅返回该用户的会话
- 新会话自动关联当前用户

### 5.3 模型配置 UI 不变

- 侧边栏的模型配置、角色分配、执行模式保持不变
- 仍使用 `localStorage` 存储模型配置

---

## 6. RAG Bug 修复

### 6.1 根因

`rag/knowledge_base.py:67`：

```python
Chroma.from_documents(documents=chunks, embedding=emb, persist_directory=PERSIST_DIR)
```

`Chroma.from_documents()` 使用默认 collection 名 `"langchain"`。当此 collection 已存在时，LangChain 的 Chroma wrapper 会加载已有 collection 并**追加**新文档，而非替换。每次调用 `build_index()` 切片数 = 原有 + 新增，呈线性增长。

附加问题：全局 `_vectorstore` 缓存不会在 `build_index()` 后更新，导致 `search()` 在缓存命中时返回旧数据。

### 6.2 修复

```python
def build_index():
    # 1. 删除旧 collection（如果存在）
    import chromadb
    client = chromadb.PersistentClient(path=PERSIST_DIR)
    try:
        client.delete_collection("langchain")
    except Exception:
        pass  # 首次构建时不存在，忽略

    # 2. 扫描文档、切分
    emb = _get_embeddings()
    docs = []
    for fname in os.listdir(DOCUMENTS_DIR):
        fpath = os.path.join(DOCUMENTS_DIR, fname)
        if fname.endswith(".pdf"):
            loader = PyPDFLoader(fpath)
            docs.extend(loader.load())
        elif fname.endswith(".txt"):
            loader = TextLoader(fpath, encoding="utf-8")
            docs.extend(loader.load())
    if not docs:
        global _vectorstore
        _vectorstore = None
        return 0

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=300, chunk_overlap=50,
        separators=["\n\n", "\n", "。", "！", "？", " ", ""],
    )
    chunks = splitter.split_documents(docs)

    # 3. 创建新 collection
    Chroma.from_documents(
        documents=chunks, embedding=emb, persist_directory=PERSIST_DIR
    )

    # 4. 清除全局缓存，强制下次 search() 重新加载
    global _vectorstore
    _vectorstore = None

    return len(chunks)
```

### 6.3 受影响的函数

| 函数 | 变更 |
|------|------|
| `build_index()` | 新增 4 行：删除旧 collection + 清除全局缓存 |
| `_get_vectorstore()` | 不变（缓存清除后自动重新加载） |
| `search()` | 不变（通过 `_get_vectorstore()` 间接修复） |
| `get_stats()` | 不变 |

---

## 7. 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `db.py` | **新增** | SQLite 数据库模块 |
| `main.py` | **修改** | 替换会话管理路由的 JSON 文件操作为 DB 调用；新增用户端点；startup 事件初始化 DB |
| `templates/components/sidebar.html` | **修改** | 登录弹窗改为用户名输入 |
| `static/js/chat.js` | **修改** | 新增用户初始化逻辑；会话操作携带 user_id |
| `rag/knowledge_base.py` | **修改** | `build_index()` 删除旧 collection + 清缓存 |
| `requirements.txt` | **不变** | sqlite3 是标准库 |
| `sessions.json` | **删除** | 数据迁移后废弃 |

---

## 8. 向后兼容

- API 响应格式与 `docs/api.md` 保持一致
- 现有的 `sessions.json` 中的数据不会自动迁移（开发阶段数据量小，可手动处理）
- 已有的知识库文档和 ChromaDB 向量数据不受影响

---

## 9. 测试要点

| 场景 | 验证方法 |
|------|---------|
| 用户创建 + 查找 | `POST /api/users` `{name}` → 200，再查 → 200 |
| 重复用户名 | 再次创建同名用户 → 200 返回已有用户（幂等） |
| 会话 CRUD | 创建 → 列出 → 读取 → 删除 → 确认 404 |
| 用户隔离 | 用户 A 的会话列表不包含用户 B 的会话 |
| RAG 重建 | 连续调用 `POST /api/knowledge/rebuild` 3 次，验证切片数恒定 |
| 模型配置不变 | 角色配置和模型池 API 功能正常 |

---

*本文档将在用户确认后进入实现计划阶段。*
