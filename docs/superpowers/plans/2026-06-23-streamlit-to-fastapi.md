# Streamlit → FastAPI Web 迁移 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将前端从 Streamlit 迁移到 FastAPI + Jinja2 + Bootstrap 5 + 原生 JS，核心业务逻辑不变

**Architecture:** FastAPI 作为 Web 服务器，Jinja2 渲染 HTML 页面，Bootstrap 5 提供 UI 组件，原生 JS 处理聊天交互。后端 API 返回 JSON，前端动态渲染消息。无 WebSocket/SSE。

**Tech Stack:** Python 3.11+, FastAPI, Uvicorn, Jinja2, Bootstrap 5 CDN, Vanilla JS

## Global Constraints

- 不引入 WebSocket / SSE（一次性返回结果）
- 不引入前端框架（React / Vue）
- 不引入 Node.js 构建工具
- 核心逻辑文件不动：workflow.py, tools.py, executor.py, config.py, app/chat.py, rag/
- 启动方式：`uvicorn main:app --reload --port 8501`
- 端口保持 8501

---

## File Structure

```
modified:
  main.py            → FastAPI app (完全重写)
  agents.py          → lru_cache 替代 st.cache_resource
  requirements.txt   → streamlit → fastapi/uvicorn/jinja2/python-multipart
  app/knowledge.py   → FastAPI router (完全重写)

deleted:
  app/components.py  → 改为 Jinja2 模板 + JS 渲染

created:
  templates/base.html
  templates/index.html
  templates/components/sidebar.html
  static/css/custom.css
  static/js/chat.js

unchanged:
  workflow.py, tools.py, executor.py, config.py, app/chat.py, app/ocr.py, rag/
```

---

### Task 1: 更新依赖文件

**Files:**
- Modify: `requirements.txt`

**Interfaces:**
- Produces: `requirements.txt` 安装后包含 fastapi, uvicorn, jinja2, python-multipart

- [ ] **Step 1: 替换 requirements.txt**

将第一行的 `streamlit>=1.35` 替换为 `fastapi` 系列依赖，其余保持不变。

```txt
fastapi>=0.115
uvicorn[standard]>=0.34
jinja2>=3.1
python-multipart>=0.0.20
pandas>=2.0
langgraph>=0.2
langchain>=0.3
langchain-deepseek>=0.1
langchain-community>=0.4
langchain-huggingface>=1.0
langchain-text-splitters>=1.1
chromadb>=1.5
sentence-transformers>=3.0
pypdf>=6.0
Pillow>=10
pytesseract>=0.3.10
```

- [ ] **Step 2: 安装依赖**

```bash
pip install -r requirements.txt
```

- [ ] **Step 3: 验证关键包可导入**

```bash
python -c "import fastapi; import uvicorn; import jinja2; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add requirements.txt
git commit -m "deps: replace streamlit with fastapi/uvicorn/jinja2"
```

---

### Task 2: 修改 agents.py（清除 Streamlit 缓存依赖）

**Files:**
- Modify: `agents.py:83-96`

**Interfaces:**
- Produces: `get_cached_llm(role: str, temperature: float = 0.3)` → ChatDeepSeek 实例（基于 lru_cache）

- [ ] **Step 1: 替换 get_cached_llm 函数**

将 `agents.py` 中第 83-96 行替换为：

```python
# ===== LLM 缓存 =====
from functools import lru_cache


@lru_cache(maxsize=8)
def get_cached_llm(role: str, temperature: float = 0.3):
    """获取缓存的 LLM 实例。使用 lru_cache 替代 Streamlit st.cache_resource。"""
    return create_llm(role, temperature)
```

- [ ] **Step 2: 验证导入和缓存**

```bash
python -c "from agents import get_cached_llm; a = get_cached_llm('Bot'); b = get_cached_llm('Bot'); print('cache hit' if a is b else 'cache miss')"
```

Expected: `cache hit`

- [ ] **Step 3: Commit**

```bash
git add agents.py
git commit -m "refactor: replace st.cache_resource with functools.lru_cache"
```

---

### Task 3: 重写 app/knowledge.py（FastAPI 路由）

**Files:**
- Modify: `app/knowledge.py`（完全重写）

**Interfaces:**
- Produces: `router` (FastAPI APIRouter)，挂载到 `/api/knowledge`
  - `GET /api/knowledge/stats` → `{文档数: int, 切片数: int, 就绪: bool}`
  - `POST /api/knowledge/rebuild` → `{success: bool, added: int}`
  - `POST /api/knowledge/upload` (multipart form file) → `{success: bool, filename: str, ocr?: bool}`
  - `DELETE /api/knowledge/{filename}` → `{success: bool}`

- [ ] **Step 1: 写路由测试**

创建 `tests/test_knowledge_routes.py`：

```python
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient


def test_kb_stats():
    """知识库统计端点应返回包含文档数和切片数的 JSON"""
    from main import app
    client = TestClient(app)
    resp = client.get("/api/knowledge/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert "文档数" in data
    assert "切片数" in data


def test_kb_rebuild():
    """重建索引端点应返回 success"""
    from main import app
    client = TestClient(app)
    resp = client.post("/api/knowledge/rebuild")
    assert resp.status_code == 200
    assert resp.json()["success"] is True


def test_kb_delete_not_found():
    """删除不存在的文件应返回 404"""
    from main import app
    client = TestClient(app)
    resp = client.delete("/api/knowledge/nonexistent_file.txt")
    assert resp.status_code == 404
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pytest tests/test_knowledge_routes.py -v
```

Expected: FAIL（因为 `main.py` 尚未创建 / 路由未定义）

- [ ] **Step 3: 重写 app/knowledge.py**

```python
"""知识库管理 API 路由。"""
import os
from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse

router = APIRouter()

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@router.get("/stats")
async def kb_stats():
    from rag.knowledge_base import get_stats
    return JSONResponse(get_stats())


@router.post("/rebuild")
async def kb_rebuild():
    from rag.knowledge_base import build_index
    n = build_index()
    return JSONResponse({"success": True, "added": n})


@router.post("/upload")
async def kb_upload(file: UploadFile = File(...)):
    doc_dir = os.path.join(_BASE, "rag", "documents")
    os.makedirs(doc_dir, exist_ok=True)

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""

    if ext in ("png", "jpg", "jpeg"):
        try:
            from PIL import Image
            import pytesseract
            import io

            contents = await file.read()
            img = Image.open(io.BytesIO(contents))
            text = pytesseract.image_to_string(img, lang="chi_sim+eng")

            if not text.strip():
                return JSONResponse({"success": False, "error": "图片中未识别到文字"}, status_code=400)

            txt_name = file.filename.rsplit(".", 1)[0] + "_ocr.txt"
            txt_path = os.path.join(doc_dir, txt_name)
            with open(txt_path, "w", encoding="utf-8") as f:
                f.write(text)
            return JSONResponse({"success": True, "filename": txt_name, "ocr": True})
        except ImportError as e:
            return JSONResponse({"success": False, "error": f"依赖未安装: {e}"}, status_code=500)
        except Exception as e:
            return JSONResponse({"success": False, "error": f"OCR 失败: {e}"}, status_code=500)
    else:
        doc_path = os.path.join(doc_dir, file.filename)
        contents = await file.read()
        with open(doc_path, "wb") as f:
            f.write(contents)
        return JSONResponse({"success": True, "filename": file.filename})


@router.delete("/{filename}")
async def kb_delete(filename: str):
    doc_dir = os.path.join(_BASE, "rag", "documents")
    path = os.path.join(doc_dir, filename)
    if not os.path.exists(path):
        return JSONResponse({"success": False, "error": "文件不存在"}, status_code=404)
    os.remove(path)
    return JSONResponse({"success": True})
```

- [ ] **Step 4: Commit**

```bash
git add app/knowledge.py tests/test_knowledge_routes.py
git commit -m "refactor: rewrite knowledge.py as FastAPI router"
```

---

### Task 4: 创建自定义 CSS

**Files:**
- Create: `static/css/custom.css`

**Interfaces:**
- Produces: CSS 文件，被 `base.html` 通过 `<link>` 引用

- [ ] **Step 1: 创建 static/css/custom.css**

```css
/* ===== 侧边栏 ===== */
.sidebar {
    background-color: #1a1f36;
    color: #e0e0e0;
    min-width: 300px;
    max-width: 320px;
    overflow-y: auto;
}

.sidebar h4, .sidebar h5, .sidebar h6 {
    color: #ffffff;
}

.sidebar hr {
    border-color: #2d3348;
}

.sidebar .btn-outline-secondary {
    color: #a0a0b8;
    border-color: #3d4260;
}

.sidebar .btn-outline-secondary:hover {
    background-color: #2d3348;
    color: #ffffff;
}

/* ===== 聊天区 ===== */
#chat-messages {
    background-color: #f8f9fc;
}

.chat-input-area {
    background-color: #ffffff;
}

/* ===== 消息气泡 ===== */
.message-user {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 1rem;
}

.message-user .bubble {
    background-color: #4f8cff;
    color: white;
    border-radius: 16px 4px 16px 16px;
    padding: 10px 16px;
    max-width: 70%;
    word-wrap: break-word;
}

.message-assistant {
    display: flex;
    flex-direction: column;
    margin-bottom: 1rem;
}

.message-assistant .bubble {
    background-color: #ffffff;
    border-radius: 4px 16px 16px 16px;
    padding: 12px 16px;
    max-width: 85%;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    word-wrap: break-word;
}

.message-error .bubble {
    background-color: #fee2e2;
    color: #991b1b;
    border-radius: 12px;
    padding: 10px 16px;
}

/* ===== Agent 卡片 ===== */
.agent-flow {
    font-size: 0.85rem;
    color: #6b7280;
    margin-bottom: 8px;
}

.agent-card {
    border-radius: 8px;
    border: 1px solid #e8ecf1;
    margin-bottom: 8px;
    overflow: hidden;
}

.agent-card .agent-header {
    padding: 6px 12px;
    font-weight: 600;
    font-size: 0.9rem;
}

.agent-card .agent-body {
    padding: 8px 12px;
    font-size: 0.88rem;
    max-height: 400px;
    overflow-y: auto;
}

.agent-card .agent-body pre {
    font-size: 0.8rem;
}

/* ===== 思考过程折叠区 ===== */
.thinking-section {
    background-color: #f1f5f9;
    border-radius: 8px;
    padding: 8px;
    margin-bottom: 8px;
}

/* ===== 文件展示 ===== */
.file-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background-color: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 4px 10px;
    margin: 2px;
    font-size: 0.85rem;
}

.file-badge img {
    max-height: 20px;
}

/* ===== 加载动画 ===== */
.loading-dots::after {
    content: '';
    animation: dots 1.5s steps(4, end) infinite;
}

@keyframes dots {
    0%   { content: ''; }
    25%  { content: '.'; }
    50%  { content: '..'; }
    75%  { content: '...'; }
    100% { content: ''; }
}

/* ===== 响应式 ===== */
@media (max-width: 768px) {
    .sidebar {
        min-width: 100%;
        max-width: 100%;
        height: auto;
    }
}
```

- [ ] **Step 2: 验证文件存在**

```bash
ls -la static/css/custom.css
```

- [ ] **Step 3: Commit**

```bash
git add static/css/custom.css
git commit -m "feat: add custom CSS for chat UI"
```

---

### Task 5: 创建前端 JavaScript

**Files:**
- Create: `static/js/chat.js`

**Interfaces:**
- Produces: 全局函数 `sendMessage()`, `loadKnowledgeStats()`, `setupLaneMode()`, `setupChatForm()`, `setupKnowledgeUI()`
- Consumes: `/api/chat`, `/api/knowledge/*`, `/api/report` 端点

- [ ] **Step 1: 创建 static/js/chat.js**

```javascript
// ===== 常量 =====
const ICONS = {
    "Planner": "📋", "Retriever": "🔍",
    "Coder": "💻", "Writer": "✍️",
    "Tester": "✅", "Summarizer": "📊",
    "Bot": "🤖", "Executor": "⚙️",
};

const COLORS = {
    "Planner": "#4f8cff", "Retriever": "#8b5cf6",
    "Coder": "#10b981", "Writer": "#f59e0b",
    "Tester": "#ef4444", "Summarizer": "#4f8cff",
    "Bot": "#10b981", "Executor": "#8b5cf6",
};

let messageHistory = [];

// ===== 初始化 =====
document.addEventListener("DOMContentLoaded", () => {
    loadKnowledgeStats();
    setupLaneMode();
    setupChatForm();
    setupKnowledgeUI();
    renderSystemStatus();
});

// ===== 系统状态 =====
function renderSystemStatus() {
    const el = document.getElementById("system-status");
    if (!el) return;
    // systemStatus 由 Jinja2 在页面注入为 JSON
    if (typeof systemStatus !== "undefined") {
        el.innerHTML = Object.entries(systemStatus)
            .map(([k, v]) => `<small class="text-muted">${k} · ${v}</small><br>`)
            .join("");
    }
}

// ===== 车道模式 =====
function setupLaneMode() {
    const updateStatus = () => {
        const mode = document.querySelector("input[name='lane_mode']:checked")?.value;
        const el = document.getElementById("lane-status");
        if (!el) return;
        if (mode === "fast") {
            el.innerHTML = '<span class="text-primary fw-bold">🚀 快车道</span>';
        } else {
            el.innerHTML = '<span class="text-success fw-bold">🔄 慢车道</span>';
        }
    };
    document.querySelectorAll("input[name='lane_mode']").forEach(r => {
        r.addEventListener("change", updateStatus);
    });
    updateStatus();
}

// ===== 聊天表单 =====
function setupChatForm() {
    const form = document.getElementById("chat-form");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = document.getElementById("chat-input");
        const message = input.value.trim();
        if (!message) return;
        await sendMessage(message);
        input.value = "";
    });
}

// ===== 发送消息 =====
async function sendMessage(message) {
    const laneMode = document.querySelector("input[name='lane_mode']:checked")?.value || "slow";

    appendUserMessage(message);

    const loadingId = appendLoadingMessage();

    try {
        const resp = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: message,
                lane_mode: laneMode,
                history: messageHistory,
            }),
        });

        removeLoadingMessage(loadingId);

        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            throw new Error(errData.error || `服务器错误 (${resp.status})`);
        }

        const data = await resp.json();
        appendAssistantMessage(data);
        messageHistory.push({ role: "user", content: message });
        messageHistory.push({ role: "assistant", content: data.reply });
    } catch (err) {
        removeLoadingMessage(loadingId);
        appendErrorMessage(err.message);
    }
}

// ===== 消息渲染 =====
function appendUserMessage(message) {
    const container = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "message-user";
    div.innerHTML = `<div class="bubble">${escapeHtml(message)}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function appendAssistantMessage(data) {
    const container = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "message-assistant";

    // Thinking 区域
    let thinkingHtml = "";
    if (data.thinking && data.thinking.length > 0) {
        const flow = data.thinking
            .filter(m => m.name)
            .map(m => `${ICONS[m.name] || "🔹"} ${m.name}`)
            .join(" → ");
        const cardsHtml = data.thinking
            .filter(m => m.content)
            .map(m => renderAgentCard(m))
            .join("");

        thinkingHtml = `
            <div class="thinking-section mb-2">
                <div class="agent-flow">🧠 ${flow}</div>
                ${cardsHtml}
            </div>
        `;
    }

    // 文件展示
    let filesHtml = "";
    if (data.generated_files && data.generated_files.length > 0) {
        filesHtml = '<div class="mb-2">' +
            data.generated_files.map(f => renderFileBadge(f)).join("") +
            '</div>';
    }

    // Report 按钮（非闲聊时显示）
    let reportHtml = "";
    if (data.thinking && data.thinking.length > 0 && data.task_type && data.task_type !== "闲聊" && data.task_type !== "问答") {
        reportHtml = `<button class="btn btn-sm btn-outline-secondary mt-2 report-btn">📥 生成详细报告</button>`;
    }

    div.innerHTML = `
        ${thinkingHtml}
        <div class="bubble">${escapeHtml(data.reply).replace(/\n/g, "<br>")}</div>
        ${filesHtml}
        ${reportHtml}
    `;

    // 绑定报告按钮
    div.querySelector(".report-btn")?.addEventListener("click", async function () {
        this.disabled = true;
        this.textContent = "生成中...";
        try {
            const resp = await fetch("/api/report", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ thinking: data.thinking }),
            });
            const report = await resp.json();
            const reportDiv = document.createElement("div");
            reportDiv.className = "mt-2 p-3 border rounded bg-white";
            reportDiv.innerHTML = `<strong>📊 详细报告</strong><hr>${markdownToHtml(report.content)}`;
            this.replaceWith(reportDiv);
        } catch {
            this.textContent = "生成失败，重试";
            this.disabled = false;
        }
    });

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function renderAgentCard(msg) {
    const color = COLORS[msg.name] || "#6b7280";
    const icon = ICONS[msg.name] || "🔹";
    return `
        <div class="agent-card">
            <div class="agent-header" style="background:${color}20; border-left:3px solid ${color};">
                ${icon} ${escapeHtml(msg.name)}
            </div>
            <div class="agent-body">${escapeHtml(msg.content).replace(/\n/g, "<br>")}</div>
        </div>
    `;
}

function renderFileBadge(file) {
    const ext = (file.ext || "").toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "bmp"].includes(ext)) {
        return `<span class="file-badge">🖼 <a href="/coding/${escapeHtml(file.name)}" target="_blank">${escapeHtml(file.name)}</a></span>`;
    }
    return `<span class="file-badge">📄 <a href="/coding/${escapeHtml(file.name)}" target="_blank">${escapeHtml(file.name)}</a></span>`;
}

function appendErrorMessage(errMsg) {
    const container = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "message-assistant message-error";
    div.innerHTML = `<div class="bubble">⚠️ 请求失败，请重试<br><small>${escapeHtml(errMsg)}</small></div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function appendLoadingMessage() {
    const id = "loading-" + Date.now();
    const container = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.id = id;
    div.className = "message-assistant";
    div.innerHTML = '<div class="bubble text-muted">思考中<span class="loading-dots"></span></div>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return id;
}

function removeLoadingMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

// ===== 知识库 UI =====
async function loadKnowledgeStats() {
    try {
        const resp = await fetch("/api/knowledge/stats");
        if (!resp.ok) return;
        const data = await resp.json();
        const docEl = document.getElementById("kb-doc-count");
        const chunkEl = document.getElementById("kb-chunk-count");
        if (docEl) docEl.textContent = data["文档数"] || 0;
        if (chunkEl) chunkEl.textContent = data["切片数"] || 0;
    } catch { /* 静默失败 */ }
}

function setupKnowledgeUI() {
    // 重建索引
    document.getElementById("kb-rebuild-btn")?.addEventListener("click", async function () {
        this.disabled = true;
        this.textContent = "重建中...";
        try {
            const resp = await fetch("/api/knowledge/rebuild", { method: "POST" });
            const data = await resp.json();
            if (data.success) {
                alert(`索引重建完成，新增 ${data.added} 条切片`);
            }
        } catch (err) {
            alert("重建失败: " + err.message);
        }
        this.disabled = false;
        this.textContent = "🔄 重建索引";
        loadKnowledgeStats();
    });

    // 上传文件
    document.getElementById("kb-upload-input")?.addEventListener("change", async function () {
        const file = this.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append("file", file);
        try {
            const resp = await fetch("/api/knowledge/upload", { method: "POST", body: formData });
            const data = await resp.json();
            if (data.success) {
                alert(`已上传: ${data.filename}`);
            } else {
                alert("上传失败: " + (data.error || "未知错误"));
            }
        } catch (err) {
            alert("上传失败: " + err.message);
        }
        this.value = "";
        loadKnowledgeStats();
    });
}

// ===== 工具函数 =====
function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function markdownToHtml(md) {
    // 简单 Markdown → HTML（代码块 + 标题 + 列表）
    let html = escapeHtml(md);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, "<pre class='bg-light p-2 rounded'><code>$2</code></pre>");
    html = html.replace(/^### (.+)$/gm, "<h6>$1</h6>");
    html = html.replace(/^## (.+)$/gm, "<h5>$1</h5>");
    html = html.replace(/^# (.+)$/gm, "<h4>$1</h4>");
    html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    return html;
}
```

- [ ] **Step 2: 验证文件存在**

```bash
ls -la static/js/chat.js
```

- [ ] **Step 3: Commit**

```bash
git add static/js/chat.js
git commit -m "feat: add chat.js for client-side interaction"
```

---

### Task 6: 创建 HTML 模板

**Files:**
- Create: `templates/base.html`
- Create: `templates/index.html`
- Create: `templates/components/sidebar.html`

**Interfaces:**
- Produces: 完整 HTML 页面结构
- Consumes: `static/css/custom.css`, `static/js/chat.js`, Bootstrap 5 CDN

- [ ] **Step 1: 创建 templates/base.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🤖 多智能体协作系统</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">
    <link href="/static/css/custom.css" rel="stylesheet">
</head>
<body>
    <div class="d-flex" style="height: 100vh;">
        <!-- 侧边栏 -->
        <div class="sidebar d-flex flex-column flex-shrink-0 p-3">
            {% include 'components/sidebar.html' %}
        </div>

        <!-- 主内容区 -->
        <main class="d-flex flex-column flex-grow-1" style="overflow: hidden;">
            {% block content %}{% endblock %}
        </main>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
    <script>
        // 由 Jinja2 注入系统状态数据
        const systemStatus = {
            {% for name, model_id in role_model.items() %}
            "{{ name }}": "{{ get_model_display(name) }}"{% if not loop.last %},{% endif %}
            {% endfor %}
        };
    </script>
    <script src="/static/js/chat.js"></script>
</body>
</html>
```

- [ ] **Step 2: 创建 templates/index.html**

```html
{% extends "base.html" %}
{% block content %}
<div class="d-flex flex-column h-100">
    <!-- 消息列表 -->
    <div id="chat-messages" class="flex-grow-1 overflow-auto p-3">
        <div class="text-center text-muted my-5 py-5">
            <h2>🤖 多智能体协作系统</h2>
            <p>输入任务开始对话 — 支持编程 / 写作 / 分析 / 问答 / 闲聊</p>
        </div>
    </div>

    <!-- 输入区 -->
    <div class="chat-input-area border-top p-3">
        <form id="chat-form" class="d-flex gap-2">
            <input type="text" id="chat-input" class="form-control form-control-lg"
                   placeholder="💬 描述你的任务（编程 / 写作 / 分析 / 问答 / 闲聊）"
                   autofocus autocomplete="off">
            <button type="submit" class="btn btn-primary px-4">
                <i class="bi bi-send-fill"></i>
            </button>
        </form>
    </div>
</div>
{% endblock %}
```

- [ ] **Step 3: 创建 templates/components/sidebar.html**

```html
<div class="text-center mb-3">
    <h4 style="color: #4f8cff;">🤖 Multi-Agent</h4>
    <p class="small" style="opacity: 0.7;">多智能体协作系统</p>
</div>
<hr>

<!-- 执行模式 -->
<h6>⚡ 执行模式</h6>
<div class="btn-group w-100 mb-2" role="group">
    <input type="radio" class="btn-check" name="lane_mode" id="lane-fast" value="fast" autocomplete="off">
    <label class="btn btn-outline-primary btn-sm" for="lane-fast">🚀 快车道</label>
    <input type="radio" class="btn-check" name="lane_mode" id="lane-slow" value="slow" autocomplete="off" checked>
    <label class="btn btn-outline-success btn-sm" for="lane-slow">🔄 慢车道</label>
</div>
<div id="lane-status" class="text-center mb-3"></div>
<hr>

<!-- 系统状态 -->
<h6>📊 系统状态</h6>
<div id="system-status" class="small mb-0"></div>
<hr>

<!-- 知识库 -->
<h6>📚 知识库</h6>
<div class="row mb-2">
    <div class="col-6"><small class="text-muted">文档: <span id="kb-doc-count">-</span></small></div>
    <div class="col-6"><small class="text-muted">切片: <span id="kb-chunk-count">-</span></small></div>
</div>
<button id="kb-rebuild-btn" class="btn btn-outline-secondary btn-sm w-100 mb-2">🔄 重建索引</button>
<label class="w-100 mb-0">
    <input type="file" id="kb-upload-input" class="form-control form-control-sm"
           accept=".pdf,.txt,.png,.jpg,.jpeg" style="font-size: 0.8rem;">
</label>
```

- [ ] **Step 4: 验证模板文件存在**

```bash
ls -la templates/base.html templates/index.html templates/components/sidebar.html
```

- [ ] **Step 5: Commit**

```bash
git add templates/
git commit -m "feat: add Jinja2 templates (base, index, sidebar)"
```

---

### Task 7: 重写 main.py（FastAPI 应用入口）

**Files:**
- Modify: `main.py`（完全重写）

**Interfaces:**
- Produces: `app` (FastAPI 实例)，供 `uvicorn main:app` 启动
- Routes:
  - `GET /` → HTML 页面
  - `POST /api/chat` → `{reply, thinking, task_type, generated_files}`
  - `POST /api/report` → `{content, path}`
- Mounts: `/static` → `static/` 目录
- Includes: knowledge router from Task 3

- [ ] **Step 1: 重写 main.py**

```python
"""
多智能体协作系统 — FastAPI Web 入口
运行：uvicorn main:app --reload --port 8501
"""

import os
import sys

_PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
if _PROJECT_DIR not in sys.path:
    sys.path.insert(0, _PROJECT_DIR)

os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
os.environ["NO_PROXY"] = "localhost,127.0.0.1"
os.environ["no_proxy"] = "localhost,127.0.0.1"
os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["PYTHONUTF8"] = "1"

import logging
logging.getLogger().handlers.clear()

import warnings
warnings.filterwarnings("ignore", category=UserWarning)

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

import config as _cfg

try:
    get_model_display = _cfg.get_model_display
    ROLE_MODEL = _cfg.ROLE_MODEL
except AttributeError:
    ROLE_MODEL = {k: "?" for k in [
        "Planner", "Retriever", "Coder", "Writer",
        "Tester", "Summarizer", "Bot",
    ]}

    def get_model_display(role):
        return "?"

# ──── FastAPI 应用 ────
app = FastAPI(title="多智能体协作系统", version="4.0")

# ──── 静态文件 & 模板 ────
app.mount("/static", StaticFiles(directory=os.path.join(_PROJECT_DIR, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(_PROJECT_DIR, "templates"))

# ──── 路由 ────
from app.knowledge import router as knowledge_router
app.include_router(knowledge_router, prefix="/api/knowledge", tags=["知识库"])


@app.get("/", response_class=HTMLResponse, tags=["页面"])
async def index(request: Request):
    """聊天主页"""
    return templates.TemplateResponse("index.html", {
        "request": request,
        "role_model": ROLE_MODEL,
        "get_model_display": get_model_display,
    })


@app.post("/api/chat", tags=["聊天"])
async def chat(request: Request):
    """处理用户消息，返回 Agent 协作结果"""
    from app.chat import run_chat_pipeline

    data = await request.json()
    user_input = data.get("message", "")
    lane_mode = data.get("lane_mode", "slow")
    history = data.get("history", [])

    try:
        result = run_chat_pipeline(user_input, history=history, lane_mode=lane_mode)
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse(
            {"reply": f"❌ 执行失败: {str(e)}", "thinking": [], "task_type": "错误", "generated_files": []},
            status_code=500,
        )


@app.post("/api/report", tags=["聊天"])
async def generate_report(request: Request):
    """从 thinking 记录生成详细报告"""
    from app.chat import generate_report_from_thinking

    data = await request.json()
    thinking = data.get("thinking", [])

    try:
        report = generate_report_from_thinking(thinking)
    except Exception:
        report = "# 报告生成失败\n\n请稍后重试。"

    os.makedirs(os.path.join(_PROJECT_DIR, "reports"), exist_ok=True)
    import time
    report_path = os.path.join(_PROJECT_DIR, "reports", f"report_{int(time.time())}.md")
    try:
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(report)
    except OSError:
        report_path = ""

    return JSONResponse({"content": report, "path": report_path})


# ──── 启动 ────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8501, reload=True)
```

- [ ] **Step 2: 验证应用可启动**

```bash
timeout 5 python -c "from main import app; print('FastAPI app loaded OK')" || echo "check output above"
```

Expected: `FastAPI app loaded OK`（无 import 错误）

- [ ] **Step 3: Commit**

```bash
git add main.py
git commit -m "feat: rewrite main.py as FastAPI app with chat + report routes"
```

---

### Task 8: 删除废弃文件

**Files:**
- Delete: `app/components.py`

- [ ] **Step 1: 删除 app/components.py**

```bash
rm app/components.py
```

- [ ] **Step 2: 验证无残留引用**

```bash
grep -r "from app.components import" --include="*.py" . || echo "No references found — OK"
```

Expected: `No references found — OK`

- [ ] **Step 3: Commit**

```bash
git add -u app/components.py
git commit -m "chore: remove Streamlit components.py (replaced by Jinja2 templates)"
```

---

### Task 9: 运行路由测试

**Files:**
- Test: `tests/test_knowledge_routes.py` (Task 3 已创建)

在这个 task 中，由于 Task 7 的 `main.py` 已完成，之前失败的测试现在应该通过。

- [ ] **Step 1: 运行知识库路由测试**

```bash
pytest tests/test_knowledge_routes.py -v
```

Expected: 3 passed

- [ ] **Step 2: 验证 chat 路由返回正确 JSON**

```bash
python -c "
from main import app
from fastapi.testclient import TestClient
client = TestClient(app)
resp = client.post('/api/chat', json={'message': 'hello', 'lane_mode': 'fast'})
print('Status:', resp.status_code)
data = resp.json()
print('Keys:', list(data.keys()))
assert 'reply' in data
assert 'thinking' in data
assert 'task_type' in data
print('OK — chat route works')
"
```

Expected: 输出 `OK — chat route works`

- [ ] **Step 3: 验证首页返回 HTML**

```bash
python -c "
from main import app
from fastapi.testclient import TestClient
client = TestClient(app)
resp = client.get('/')
assert resp.status_code == 200
assert 'text/html' in resp.headers['content-type']
assert '多智能体' in resp.text
print('OK — index page renders')
"
```

Expected: `OK — index page renders`

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: verify all routes work correctly"
```

---

### Task 10: 端到端启动验证

- [ ] **Step 1: 启动服务器**

```bash
python -m uvicorn main:app --host 127.0.0.1 --port 8501 &
sleep 3
```

- [ ] **Step 2: 验证首页可访问**

```bash
curl -s http://127.0.0.1:8501/ | head -20
```

Expected: 返回 HTML，包含 `<title>🤖 多智能体协作系统</title>`

- [ ] **Step 3: 验证知识库 API**

```bash
curl -s http://127.0.0.1:8501/api/knowledge/stats
```

Expected: `{"文档数": N, "切片数": N, "就绪": true/false}`

- [ ] **Step 4: 停止服务器**

```bash
kill %1 2>/dev/null || true
```

- [ ] **Step 5: 更新 README 启动命令**

将 README.md 中第 53 行 `streamlit run main.py` 改为 `uvicorn main:app --reload --port 8501`，将第 117 行技术栈中 `Streamlit ≥1.35` 改为 `FastAPI + Jinja2 + Bootstrap 5`。

```bash
# 验证修改
grep "uvicorn main:app" README.md
grep "FastAPI" README.md
```

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: update README for FastAPI migration"
```

---

## Verification Checklist

所有 task 完成后，验证以下内容：

- [ ] `pip install -r requirements.txt` 无报错
- [ ] `python -c "from main import app"` 成功加载
- [ ] `pytest tests/ -v` 全部通过
- [ ] `curl http://127.0.0.1:8501/` 返回 HTML
- [ ] `curl -X POST http://127.0.0.1:8501/api/chat -H 'Content-Type: application/json' -d '{"message":"你好","lane_mode":"fast"}'` 返回 JSON
- [ ] 浏览器打开页面，发送消息，看到回复
- [ ] 知识库上传文件、重建索引正常工作
- [ ] 快/慢车道切换正常
