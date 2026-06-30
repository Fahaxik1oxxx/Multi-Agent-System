# RAG 重建索引错误提示 + 知识库弹窗上传修复

**日期**: 2026-06-30
**状态**: 已批准

---

## 背景

两个紧耦合的缺陷修复，涉及同一组前后端文件。

### 问题 1: 重建索引失败无具体原因

`KnowledgePage.tsx` 和 `V3ChatPage.tsx` 知识库弹窗中，重建索引失败仅显示 "重建失败"，用户无法得知是哪个文件出错、原因是什么。

**涉及位置:**
- `frontend/src/pages/knowledge/KnowledgePage.tsx:33`
- `frontend/src/pages/chat/V3ChatPage.tsx:992`
- `rag/knowledge_base.py:_load_and_chunk_documents`
- `app/knowledge.py:/rebuild`

### 问题 2: 知识库管理弹窗上传按钮无反应

V3ChatPage 的知识库管理弹窗（PageModal）中，点击 "+ 上传" 按钮后文件选择器不弹出。

**根因:** `PageModal` 通过 `createPortal` 渲染到 `document.body`，而触发文件选择的 `<input ref={sideFileInputRef}>` 在原组件树中，两者处于不同 DOM 子树。`className="hidden"`（`display:none`）的 input 在跨 portal 场景下 `click()` 被浏览器拦截。

**涉及位置:**
- `frontend/src/pages/chat/V3ChatPage.tsx:593,813,1000`
- `frontend/src/components/shared/PageModal.tsx`（portal 实现）

---

## 设计

### 1. 后端 — 结构化错误返回

**`rag/knowledge_base.py`**

`_load_and_chunk_documents` 返回值从 `list[chunks]` 改为 `(chunks: list, errors: list[dict])`。
单个文件损坏不终止全部流程——该文件被跳过并记录 error，其余文件继续处理。
仅当**全部**文件都失败时才抛 `RuntimeError`（视为硬错误）。

```
errors 格式:
[
  {"file": "xxx.pdf", "error": "PDF 文件已损坏: Unexpected EOF"},
  {"file": "yyy.txt", "error": "编码错误: 'gbk' codec can't decode..."},
]
```

`_build_index_locked` 传递 errors（per-file 软错误），ChromaDB 写入/OS 操作失败仍抛异常（硬错误）。
`build_index` 返回值从 `int` 改为 `(chunk_count: int, errors: list)`。

> **软/硬错误区分：** 软错误 = 个别文件问题（损坏/编码），跳过继续；硬错误 = ChromaDB 写入失败/磁盘满等，抛异常。

**`app/knowledge.py`** — 3 个调用点全部适配：

① `/rebuild`（第 51 行）：

```python
n, errors = build_index(user["user_id"])
return JSONResponse({"success": True, "added": n, "errors": errors})
```

② `/upload`（第 109 行）— 上传后自动重建，errors 附加到响应：

```python
chunk_count, errors = build_index(user["user_id"])
return JSONResponse({
    "success": True, "status": "ok", "filename": safe_name,
    "indexed": True, "chunks": chunk_count,
    "errors": errors if errors else None,
})
```

③ `/{filename}` DELETE（第 136 行）— 删除后重建：

```python
n, errors = build_index(user["user_id"])
return JSONResponse({"success": True, "chunks": n, "errors": errors if errors else None})
```

**`app/ocr.py:69`** — 改 tuple 解包（忽略 errors）：

```python
chunk_count, _ = build_index(user_id="shared")
return chunk_count
```

### 2. 前端 — 重建错误逐文件展示

**KnowledgePage.tsx** `rebuildMutation`:

```tsx
onSuccess: (res) => {
  qc.invalidateQueries({ queryKey: ['kb-stats'] });
  const errors = res.data?.errors;
  if (errors && errors.length > 0) {
    errors.forEach((e) => toast.error(`${e.file}: ${e.error}`));
    toast.warning(`索引部分完成，${errors.length} 个文件失败`);
  } else {
    toast.success('索引已重建');
  }
},
onError: (err) => {
  const detail = err?.response?.data?.detail;
  toast.error(detail ? `重建失败: ${detail}` : '重建失败');
},
```

**V3ChatPage.tsx** 知识库弹窗重建按钮（第 992 行）:

```tsx
// 当前: .catch(() => toast.error('重建失败'))
// 改为:
.then((res) => {
  const errors = res.data?.errors;
  if (errors?.length) {
    errors.forEach((e) => toast.error(`${e.file}: ${e.error}`));
  }
  toast.success('重建完成');
  refreshKnowledgeFiles();
})
.catch((err) => {
  const detail = err?.response?.data?.detail;
  toast.error(detail ? `重建失败: ${detail}` : '重建失败');
})
```

### 3. 前端 — 弹窗上传按钮修复

**V3ChatPage.tsx:**

- 新增 `modalFileInputRef` 用于弹窗内部的独立 file input
- Modal 内容区增加 `<input ref={modalFileInputRef}>`，与上传按钮同属 portal DOM 子树
- 上传按钮触发 `modalFileInputRef.current?.click()` 而非外部 `sideFileInputRef`
- 补充 loading toast + error toast（替代原 `.catch(() => {})` 静默吞错）
- onChange 中重置 `e.target.value = ''` 以允许重复上传同一文件

保留外部 `sideFileInputRef` 不变（仅改弹窗内的按钮引用）。

---

## 影响范围

| 文件 | 改动类型 |
|---|---|
| `rag/knowledge_base.py` | `_load_and_chunk_documents` 返回 `(chunks, errors)`；`build_index` 返回 `(count, errors)` |
| `app/knowledge.py` | `/rebuild` `/upload` `/delete` 三个端点适配 tuple 解包 + 返回 errors |
| `app/ocr.py` | 适配 tuple 解包 |
| `frontend/src/pages/knowledge/KnowledgePage.tsx` | rebuildMutation onSuccess/onError 处理 errors |
| `frontend/src/pages/chat/V3ChatPage.tsx` | 弹窗重建按钮 + 上传 ref 改为 `modalFileInputRef` + 上传 toast |

---

## 测试要点

- [ ] 全部文件正常时重建成功，toast 显示 "索引已重建"
- [ ] 存在 1 个损坏 PDF 时，其余文件正常索引，逐文件 toast 显示失败原因
- [ ] 全部文件损坏时，不抛异常，返回 errors 列表
- [ ] 弹窗上传按钮点击后文件选择器正常弹出
- [ ] 上传成功显示 "上传完成" toast，文件列表刷新
- [ ] 上传失败显示 "上传失败" toast（含文件名）
