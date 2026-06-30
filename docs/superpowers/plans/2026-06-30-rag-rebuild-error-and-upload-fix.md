# RAG 重建索引错误提示 + 知识库弹窗上传修复 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复两个 bug：(1) 重建索引失败时仅显示 "重建失败"，需改为逐文件列出具体原因；(2) V3ChatPage 知识库弹窗中上传按钮点击无反应（portal 隔离导致）。

**Architecture:** 后端 `_load_and_chunk_documents` 返回值从 `list` 改为 `(chunks, errors)` 元组，单文件损坏不再终止全局；`build_index` 同步改为返回 `(count, errors)`；所有调用点适配 tuple 解包。前端 Modal 上传改用弹窗内部的 file input ref 解决 portal 隔离问题。

**Tech Stack:** Python (FastAPI, ChromaDB, LangChain), TypeScript (React, TanStack Query, TailwindCSS, sonner toast)

## Global Constraints

- 软错误（单文件损坏）跳过继续，硬错误（ChromaDB 写入失败/磁盘满）仍抛异常
- errors 格式统一为 `[{"file": "xxx.pdf", "error": "具体原因"}, ...]`
- 所有前端 toast 使用 `sonner` 库，风格与现有代码一致
- 不引入新依赖

---

## 文件结构

```
rag/knowledge_base.py          # 改: _load_and_chunk_documents → (chunks, errors)
                                #     _build_index_locked → (count, errors)
                                #     build_index → (count, errors)

app/knowledge.py                # 改: /rebuild /upload /delete 三个端点适配 tuple 解包

app/ocr.py                      # 改: ocr_and_index 适配 tuple 解包

frontend/src/pages/knowledge/
  KnowledgePage.tsx             # 改: rebuildMutation onSuccess/onError 处理 errors

frontend/src/pages/chat/
  V3ChatPage.tsx                # 改: 弹窗重建按钮解析 errors
                                #     新增 modalFileInputRef
                                #     弹窗上传按钮改用 modalFileInputRef
                                #     上传补充 loading/toast
```

---

### Task 1: 后端 — `_load_and_chunk_documents` 返回 `(chunks, errors)`

**Files:**
- Modify: `rag/knowledge_base.py:104-138`

**Interfaces:**
- Consumes: (none — first task)
- Produces: `_load_and_chunk_documents(user_id: str) -> tuple[list, list[dict]]`
  - returns `(all_chunks, errors)`, errors 格式 `[{"file": str, "error": str}]`

- [ ] **Step 1: 修改 `_load_and_chunk_documents` 返回 `(chunks, errors)`**

```python
def _load_and_chunk_documents(user_id: str):
    """遍历文档目录，加载并切分。损坏文件跳过并记录警告。
    返回 (chunks, errors)，errors 格式 [{"file": fname, "error": str}]。
    仅当全部文件失败时抛 RuntimeError。"""
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
            _logger.warning(f"跳过损坏文件 {fname}: {e}")
            errors.append({"file": fname, "error": str(e)})

    if not all_chunks and errors:
        raise RuntimeError(f"所有文件处理失败: {errors}")

    return all_chunks, errors
```

- [ ] **Step 2: Commit**

```bash
git add rag/knowledge_base.py
git commit -m "refactor(rag): _load_and_chunk_documents 返回 (chunks, errors) 元组"
```

---

### Task 2: 后端 — `_build_index_locked` 和 `build_index` 传递 errors

**Files:**
- Modify: `rag/knowledge_base.py:98-101,141-173`

**Interfaces:**
- Consumes: `_load_and_chunk_documents` 返回 `(chunks, errors)`
- Produces:
  - `_build_index_locked(user_id: str) -> tuple[int, list[dict]]`
  - `build_index(user_id: str) -> tuple[int, list[dict]]`
  - 返回 `(chunk_count, errors)`

- [ ] **Step 1: 修改 `build_index` 签名和 docstring**

```python
def build_index(user_id: str):
    """扫描用户文档目录下所有 PDF/TXT，重建索引（线程安全，事务性）。
    返回 (chunk_count, errors)。"""
    with _get_lock(user_id):
        return _build_index_locked(user_id)
```

- [ ] **Step 2: 修改 `_build_index_locked` 传递 errors**

```python
def _build_index_locked(user_id: str):
    """带锁的实际重建逻辑：先建到临时目录，成功后原子替换。
    返回 (chunk_count, errors)。"""
    docs_dir, persist_dir = _get_user_dirs(user_id)
    tmp_dir = persist_dir + "_tmp"

    # 1. 清理残留临时目录
    if os.path.exists(tmp_dir):
        shutil.rmtree(tmp_dir, ignore_errors=True)

    # 2. 加载并切分文档（单文件异常隔离）
    chunks, errors = _load_and_chunk_documents(user_id)
    if not chunks:
        return 0, errors

    # 3. 建到临时目录
    emb = _get_embeddings()
    vs = Chroma.from_documents(documents=chunks, embedding=emb, persist_directory=tmp_dir)
    vs.persist()

    # 4. 淘汰旧缓存并关闭连接
    _evict_cached_vs(user_id)

    # 5. 原子替换（Windows: os.rename 对已存在目录返回 PermissionError）
    if os.path.exists(persist_dir):
        shutil.rmtree(persist_dir)
    try:
        os.rename(tmp_dir, persist_dir)
    except OSError:
        # Windows 回退：跨驱动器或目标残留时用 copytree
        shutil.copytree(tmp_dir, persist_dir)
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return len(chunks), errors
```

- [ ] **Step 3: Commit**

```bash
git add rag/knowledge_base.py
git commit -m "refactor(rag): build_index 返回 (chunk_count, errors) 元组"
```

---

### Task 3: 后端 — `app/knowledge.py` 三个端点适配 tuple 解包

**Files:**
- Modify: `app/knowledge.py:51,109,136`

**Interfaces:**
- Consumes: `build_index` 返回 `(chunk_count, errors)`
- Produces: `/rebuild` `/upload` `/delete` 响应中均包含 `errors` 字段（有 errors 时）

- [ ] **Step 1: 修改 `/rebuild` 端点（第 51 行）**

```python
@router.post("/rebuild")
async def kb_rebuild(user: dict = Depends(require_auth)):
    from rag.knowledge_base import build_index

    n, errors = build_index(user["user_id"])
    return JSONResponse({"success": True, "added": n, "errors": errors})
```

- [ ] **Step 2: 修改 `/upload` 端点（第 109 行）**

替换第 107-113 行：
```python
        try:
            from rag.knowledge_base import build_index
            chunk_count, errors = build_index(user["user_id"])
            return JSONResponse({
                "success": True, "status": "ok", "filename": safe_name,
                "indexed": True, "chunks": chunk_count,
                "errors": errors if errors else None,
            })
```

- [ ] **Step 3: 修改 `/{filename}` DELETE 端点（第 136 行）**

替换第 134-139 行：
```python
    from rag.knowledge_base import build_index
    try:
        n, errors = build_index(user["user_id"])
        resp = {"success": True, "chunks": n}
        if errors:
            resp["errors"] = errors
        return JSONResponse(resp)
    except Exception as e:
        return JSONResponse({"success": True, "warning": f"文件已删除但索引重建失败: {str(e)[:100]}"})
```

- [ ] **Step 4: Commit**

```bash
git add app/knowledge.py
git commit -m "fix(api): /rebuild /upload /delete 返回 per-file errors 列表"
```

---

### Task 4: 后端 — `app/ocr.py` 适配 tuple 解包

**Files:**
- Modify: `app/ocr.py:69`

**Interfaces:**
- Consumes: `build_index` 返回 `(chunk_count, errors)`
- Produces: 返回 `chunk_count`（忽略 errors）

- [ ] **Step 1: 修改 `ocr_and_index` 第 69 行**

```python
    from rag.knowledge_base import build_index

    chunk_count, _ = build_index(user_id="shared")
    return chunk_count
```

- [ ] **Step 2: Commit**

```bash
git add app/ocr.py
git commit -m "fix(ocr): 适配 build_index 新返回值 (count, errors)"
```

---

### Task 5: 前端 — `KnowledgePage.tsx` rebuildMutation 处理 errors

**Files:**
- Modify: `frontend/src/pages/knowledge/KnowledgePage.tsx:30-34`

**Interfaces:**
- Consumes: `knowledgeApi.rebuild()` 返回 `{ added: number, errors?: Array<{file: string, error: string}> }`
- Produces: 逐文件 toast + 汇总 toast

- [ ] **Step 1: 修改 `rebuildMutation` onSuccess 和 onError**

替换第 31-34 行：
```tsx
  const rebuildMutation = useMutation({
    mutationFn: () => knowledgeApi.rebuild(),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['kb-stats'] });
      const errors = res.data?.errors;
      if (errors && errors.length > 0) {
        errors.forEach((e: { file: string; error: string }) =>
          toast.error(`${e.file}: ${e.error}`)
        );
        toast.warning(`索引部分完成，${errors.length} 个文件失败`);
      } else {
        toast.success('索引已重建');
      }
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail;
      toast.error(detail ? `重建失败: ${detail}` : '重建失败');
    },
  });
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/knowledge/KnowledgePage.tsx
git commit -m "fix(frontend): 知识库页重建失败逐文件显示具体原因"
```

---

### Task 6: 前端 — `V3ChatPage.tsx` 弹窗重建按钮处理 errors

**Files:**
- Modify: `frontend/src/pages/chat/V3ChatPage.tsx:992`

**Interfaces:**
- Consumes: `knowledgeApi.rebuild()` 返回 `{ added: number, errors?: [...] }`
- Produces: 逐文件 toast + refreshKnowledgeFiles

- [ ] **Step 1: 修改弹窗重建按钮 onClick（第 992 行）**

替换：
```tsx
                <button onClick={() => knowledgeApi.rebuild().then(() => { toast.success('重建中'); refreshKnowledgeFiles(); }).catch(() => toast.error('重建失败'))}
```
为：
```tsx
                <button onClick={() => knowledgeApi.rebuild().then((res: any) => {
                  const errors = res.data?.errors;
                  if (errors && errors.length > 0) {
                    errors.forEach((e: { file: string; error: string }) =>
                      toast.error(`${e.file}: ${e.error}`)
                    );
                  }
                  toast.success('重建完成');
                  refreshKnowledgeFiles();
                }).catch((err: any) => {
                  const detail = err?.response?.data?.detail;
                  toast.error(detail ? `重建失败: ${detail}` : '重建失败');
                })}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/chat/V3ChatPage.tsx
git commit -m "fix(frontend): 弹窗重建按钮逐文件显示具体原因"
```

---

### Task 7: 前端 — 弹窗上传按钮改用 `modalFileInputRef`

**Files:**
- Modify: `frontend/src/pages/chat/V3ChatPage.tsx:593,1000,1001`

并在 Modal 内容区新增 hidden input。

**Interfaces:**
- Consumes: (none — standalone fix)
- Produces: `modalFileInputRef` ref；弹窗内上传按钮触发弹窗内部 file input

- [ ] **Step 1: 新增 `modalFileInputRef`（第 593 行下方）**

在第 593 行 `const sideFileInputRef = useRef<HTMLInputElement>(null);` 下方新增一行：
```tsx
  const modalFileInputRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 2: 修改弹窗上传按钮 + 新增弹窗内 hidden input（第 1000-1001 行）**

替换：
```tsx
            <button onClick={() => sideFileInputRef.current?.click()}
              className="btn btn-xs" style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '8px', border: 'none' }}>+ 上传</button>
```
为：
```tsx
            <button onClick={() => modalFileInputRef.current?.click()}
              className="btn btn-xs" style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '8px', border: 'none' }}>+ 上传</button>
            <input ref={modalFileInputRef} type="file" className="hidden" accept=".pdf,.txt,.png,.jpg,.jpeg"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const toastId = toast.loading(`上传中: ${f.name}`);
                try {
                  await knowledgeApi.upload(f);
                  toast.success(`上传完成: ${f.name}`, { id: toastId });
                  refreshKnowledgeFiles();
                } catch {
                  toast.error(`上传失败: ${f.name}`, { id: toastId });
                }
                e.target.value = '';
              }} />
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/chat/V3ChatPage.tsx
git commit -m "fix(frontend): 弹窗上传按钮改用 modal 内部 ref，解决 portal 隔离 + 补全 toast"
```

---

## 验证

- [ ] 启动后端：`uvicorn main:app --reload`
- [ ] 启动前端：`cd frontend && npm run dev`
- [ ] 测试：上传一个损坏 PDF，点击重建索引，确认 toast 逐文件显示错误
- [ ] 测试：在快速对话页面打开知识库弹窗，点击 "+ 上传"，确认文件选择器弹出
- [ ] 测试：上传一个有效 PDF，确认 toast "上传完成"
- [ ] 测试：上传后文件列表自动刷新
