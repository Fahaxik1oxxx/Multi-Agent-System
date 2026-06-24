# 游客会话本地存储 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 游客对话存入浏览器 sessionStorage（关标签页即清），注册用户仍存入 SQLite；登录时自动迁移。

**Architecture:** 通过 `isGuest()` 判断用户类型，在会话的保存/加载/切换/删除四个操作点分流：游客走 sessionStorage，注册用户走现有 API。不修改任何后端代码。

**Tech Stack:** 纯前端 JavaScript，sessionStorage API，无新增依赖。

## Global Constraints

- 不修改任何后端 API
- 不修改数据库表结构
- 注册用户所有行为不变
- 游客判定：`!localStorage.getItem("auth_user")`
- sessionStorage key: `"guest_sessions"`

---

### Task 1: 添加游客会话工具函数

**Files:**
- Modify: `static/js/chat.js` — 在文件末尾添加

**Produces:**
- `isGuest()` → `boolean`
- `loadGuestSessions()` → `Array<{id, title, messages, updated}>`
- `saveGuestSessions(sessions: Array)` → `void`

- [ ] **Step 1: 在 chat.js 末尾添加三个工具函数**

```javascript
// ===== 游客会话（sessionStorage） =====
function isGuest() {
    return !localStorage.getItem("auth_user");
}

function loadGuestSessions() {
    try {
        return JSON.parse(sessionStorage.getItem("guest_sessions") || "[]");
    } catch (e) {
        return [];
    }
}

function saveGuestSessions(sessions) {
    try {
        sessionStorage.setItem("guest_sessions", JSON.stringify(sessions));
    } catch (e) {
        console.warn("sessionStorage 写入失败（可能超出容量）:", e);
    }
}
```

- [ ] **Step 2: 验证** — 在浏览器控制台执行 `isGuest()` 应返回 `true`（未登录时）

---

### Task 2: 游客保存会话到 sessionStorage

**Files:**
- Modify: `static/js/chat.js` — `saveCurrentSession()` 函数 (~L380)

**Consumes:** `isGuest()`, `loadGuestSessions()`, `saveGuestSessions()`

- [ ] **Step 1: 修改 `saveCurrentSession()`**

找到：
```javascript
async function saveCurrentSession() {
    if (!messageHistory.length) return;
    const uid = await ensureUserId();
    if (!uid) return;
    try {
        const sid = _currentSessionId || String(Date.now());
        const title = messageHistory[0]?.content?.slice(0, 50) || "新对话";
        await fetch("/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: sid, user_id: uid, messages: messageHistory, title: title }),
        });
        _currentSessionId = sid;
        if (typeof loadSessionHistory === 'function') loadSessionHistory();
    } catch (e) {
        console.error("保存会话失败:", e);
    }
}
```

替换为：
```javascript
async function saveCurrentSession() {
    if (!messageHistory.length) return;

    // 游客 → sessionStorage
    if (isGuest()) {
        const sessions = loadGuestSessions();
        const sid = _currentSessionId || String(Date.now());
        const title = messageHistory[0]?.content?.slice(0, 50) || "新对话";
        const existing = sessions.findIndex(s => s.id === sid);
        const entry = {
            id: sid,
            title: title,
            messages: [...messageHistory],
            updated: new Date().toISOString(),
        };
        if (existing >= 0) {
            sessions[existing] = entry;
        } else {
            sessions.unshift(entry);
        }
        saveGuestSessions(sessions);
        _currentSessionId = sid;
        if (typeof loadSessionHistory === 'function') loadSessionHistory();
        return;
    }

    // 注册用户 → 现有逻辑
    const uid = await ensureUserId();
    if (!uid) return;
    try {
        const sid = _currentSessionId || String(Date.now());
        const title = messageHistory[0]?.content?.slice(0, 50) || "新对话";
        await fetch("/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: sid, user_id: uid, messages: messageHistory, title: title }),
        });
        _currentSessionId = sid;
        if (typeof loadSessionHistory === 'function') loadSessionHistory();
    } catch (e) {
        console.error("保存会话失败:", e);
    }
}
```

- [ ] **Step 2: 验证** — 游客模式发一条消息，打开 DevTools → Application → Session Storage，确认 `guest_sessions` 中存在会话记录

---

### Task 3: 游客加载/切换/删除会话

**Files:**
- Modify: `templates/components/sidebar.html` — `loadSessionHistory()`, `switchSession()`, `deleteSession()`

**Consumes:** `isGuest()`, `loadGuestSessions()`, `saveGuestSessions()`（来自 Task 1）

- [ ] **Step 1: 修改 `loadSessionHistory()`** — 在函数开头（获取 uid 之前）添加 guest 分支

找到 `async function loadSessionHistory()` 在 `let uid = localStorage.getItem("mc_uid") || "";` 之前插入：
```javascript
async function loadSessionHistory() {
    const el = document.getElementById("session-list");
    if (!el) return;

    // 游客 → 从 sessionStorage 加载
    if (isGuest()) {
        const sessions = loadGuestSessions();
        if (!sessions.length) {
            el.innerHTML = '<div class="text-xs opacity-40 text-center py-2">暂无对话记录</div>';
            return;
        }
        const groups = {};
        sessions.forEach(s => {
            const cat = getTimeCategory(s.updated);
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(s);
        });
        let html = "";
        TIME_GROUPS.forEach(g => {
            const items = groups[g];
            if (!items || !items.length) return;
            html += `<div class="text-xs opacity-40 mb-0.5 mt-1.5">${g}</div>`;
            items.forEach(s => {
                const title = s.title && s.title !== "空对话" ? s.title : `对话 (${s.messages.length} 条消息)`;
                html += `<div class="history-item" onclick="switchSession('${s.id}')">
                    <span class="truncate">${escapeHtmlSidebar(title)}</span>
                    <span class="history-ops" onclick="event.stopPropagation();deleteSession('${s.id}')">⋮</span>
                </div>`;
            });
        });
        el.innerHTML = html;
        return;
    }

    // 注册用户 → 现有逻辑（以下保持不变）
    let uid = localStorage.getItem("mc_uid") || "";
    // ... 后续代码不变
```

- [ ] **Step 2: 修改 `switchSession()`** — 在函数开头添加 guest 分支

找到 `async function switchSession(sid) {`，在 `try {` 之前插入：
```javascript
async function switchSession(sid) {
    // 游客 → 从 sessionStorage 加载
    if (isGuest()) {
        const sessions = loadGuestSessions();
        const s = sessions.find(s => s.id === sid);
        if (!s) return;
        const container = document.getElementById("chat-messages");
        if (!container) return;
        container.innerHTML = "";
        if (typeof _currentSessionId !== 'undefined') _currentSessionId = sid;
        if (typeof messageHistory !== 'undefined') messageHistory = [];
        (s.messages || []).forEach(m => {
            const cls = m.role === "user" ? "message-user" : "message-assistant";
            container.innerHTML += `<div class="${cls}"><div class="bubble">${escapeHtmlSidebar(m.content || "")}</div></div>`;
            if (typeof messageHistory !== 'undefined') messageHistory.push(m);
        });
        container.scrollTop = container.scrollHeight;
        return;
    }

    // 注册用户 → 现有逻辑
    try {
        // ... 后续代码不变
```

- [ ] **Step 3: 修改 `deleteSession()`** — 在函数开头添加 guest 分支

找到 `async function deleteSession(sid) {`，在 `if (!confirm(...))` 之前插入：
```javascript
async function deleteSession(sid) {
    // 游客 → 从 sessionStorage 删除
    if (isGuest()) {
        if (!confirm("删除此对话？")) return;
        const sessions = loadGuestSessions();
        saveGuestSessions(sessions.filter(s => s.id !== sid));
        loadSessionHistory();
        return;
    }

    // 注册用户 → 现有逻辑
    if (!confirm("删除此对话？")) return;
    // ... 后续代码不变
```

- [ ] **Step 4: 验证** — 游客模式下：切换会话显示正确消息、删除会话后列表更新

---

### Task 4: 登录时迁移游客对话

**Files:**
- Modify: `templates/components/sidebar.html` — `submitAuth()` 函数，登录成功分支

**Consumes:** `isGuest()`, `loadGuestSessions()`, `saveGuestSessions()`

- [ ] **Step 1: 在 `submitAuth()` 登录成功分支添加迁移逻辑**

找到 `submitAuth()` 中登录成功的分支（`msg.textContent = "";` 之前）：
```javascript
            // ... 现有登录成功逻辑 ...
            document.getElementById("user-display").textContent = email;
            document.getElementById("user-avatar").textContent = email.charAt(0).toUpperCase();
            document.getElementById("login-modal").close();

            // 迁移游客对话到数据库
            if (isGuest()) {
                const guestSessions = loadGuestSessions();
                if (guestSessions.length > 0) {
                    const uid = localStorage.getItem("mc_uid");
                    for (const s of guestSessions) {
                        try {
                            await fetch("/api/sessions", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    id: s.id,
                                    user_id: uid,
                                    messages: s.messages,
                                    title: s.title,
                                }),
                            });
                        } catch (e) {
                            console.warn("迁移游客会话失败:", s.id, e);
                        }
                    }
                    sessionStorage.removeItem("guest_sessions");
                }
            }

            msg.textContent = "";
            loadSessionHistory();
```

- [ ] **Step 2: 验证** — 游客模式下发几条消息 → 登录 → 确认侧栏出现刚才的对话，sessionStorage 中 `guest_sessions` 已清空

---

### Task 5: 退出登录重置侧栏

**Files:**
- Modify: `templates/components/sidebar.html` — `logout()` 函数

- [ ] **Step 1: 修改 `logout()`，清空聊天区和侧栏**

找到 `function logout()`，在 `document.getElementById("login-modal").close();` 之后、`const el = ...` 之前插入：
```javascript
function logout() {
    if (!confirm("确认退出登录？")) return;
    localStorage.removeItem("auth_user");
    localStorage.removeItem("mc_uid");
    localStorage.removeItem("mc_uname");
    document.getElementById("user-display").textContent = "游客";
    document.getElementById("user-avatar").textContent = "游";
    document.getElementById("login-modal").close();

    // 清空聊天区
    const chatEl = document.getElementById("chat-messages");
    if (chatEl) {
        chatEl.innerHTML = `
            <div class="chat-welcome">
                <h2 class="chat-welcome-title">多智能体协作系统</h2>
                <p class="chat-welcome-sub">输入任务开始对话 · 支持编程 / 写作 / 分析 / 问答 / 闲聊</p>
            </div>
        `;
    }
    // 重置会话变量
    if (typeof messageHistory !== 'undefined') messageHistory = [];
    if (typeof _currentSessionId !== 'undefined') _currentSessionId = null;

    // 清空侧栏
    const el = document.getElementById("session-list");
    if (el) el.innerHTML = '<div class="text-xs opacity-40 text-center py-2">暂无对话记录</div>';
}
```

- [ ] **Step 2: 验证** — 注册用户登录 → 有一些对话 → 退出登录 → 聊天区回到欢迎页，侧栏显示"暂无对话记录"

---

### Task 6: 游客模式下 ensureUserId 跳过 API 调用

**Files:**
- Modify: `static/js/chat.js` — `ensureUserId()` 函数 (~L409)

- [ ] **Step 1: 在 `ensureUserId()` 开头添加 guest 快速返回**

找到 `async function ensureUserId()`，在 `let uid = ...` 之前插入：
```javascript
async function ensureUserId() {
    // 游客不需要 user_id（不调用后端会话 API）
    if (isGuest()) return "";

    let uid = localStorage.getItem("mc_uid");
    // ... 后续代码不变
```

- [ ] **Step 2: 验证** — 游客模式发消息，Network 面板确认没有 `/api/users` 请求

---

### Task 7: 提交所有改动

- [ ] **Step 1: 提交**

```bash
git add static/js/chat.js templates/components/sidebar.html
git commit -m "feat: 游客对话迁移到 sessionStorage，注册用户保持数据库存储"
```

- [ ] **Step 2: 回归验证** — 启动服务器，分别以游客和注册用户身份完成完整流程：
  1. 游客：发消息 → 刷新页面（对话保留）→ 关闭标签页重开（对话消失）
  2. 游客 → 登录：对话迁移到侧栏
  3. 注册用户：发消息 → 刷新（对话保留）→ 退出登录（侧栏清空）
