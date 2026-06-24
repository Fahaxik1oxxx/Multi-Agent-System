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
let _currentSessionId = null;

// ===== 初始化 =====
document.addEventListener("DOMContentLoaded", async () => {
    loadKnowledgeStats();
    setupLaneMode();
    setupChatForm();
    setupKnowledgeUI();
    // 确保有用户 ID（游客自动注册），然后加载会话历史
    const uid = await ensureUserId();
    // 注册用户：加载数据库会话历史
    // 游客：加载 sessionStorage 会话历史（此时 isGuest 等函数已定义）
    if (typeof loadSessionHistory === 'function') {
        loadSessionHistory();
    }
});

// ===== 车道模式 =====
function setupLaneMode() {
    const updateStatus = () => {
        const mode = document.querySelector("input[name='lane_mode']:checked")?.value;
        const el = document.getElementById("lane-status");
        if (el) {
            if (mode === "fast") {
                el.innerHTML = '<span class="text-primary fw-bold">快速（直接回复）</span>';
            } else if (mode === "slow") {
                el.innerHTML = '<span class="text-success fw-bold">协作（多Agent协作）</span>';
            } else {
                el.innerHTML = '<span class="text-info fw-bold">自动（AI 判断）</span>';
            }
        }
        // 更新胶囊按钮 active 状态
        document.querySelectorAll('.mode-toggle-item').forEach(l => {
            l.classList.toggle('active', l.getAttribute('data-value') === mode);
        });
        // 更新悬浮弹窗 active 状态
        document.querySelectorAll('.lane-option').forEach(o => {
            o.classList.toggle('active', o.getAttribute('data-value') === mode);
        });
    };
    document.querySelectorAll("input[name='lane_mode']").forEach(r => {
        r.addEventListener('change', updateStatus);
    });
    updateStatus();
}

// ===== 思考面板展开/收起（CSS transition 动画） =====
function toggleThinkingPanel(id, btn) {
    var el = document.getElementById(id);
    var arrow = btn.querySelector('.toggle-arrow');
    if (!el || !arrow) return;
    if (el.classList.contains('open')) {
        el.classList.remove('open');
        arrow.classList.remove('open');
        el.style.maxHeight = '0';
    } else {
        el.classList.add('open');
        arrow.classList.add('open');
        el.style.maxHeight = 'none';
        var h = el.scrollHeight;
        el.style.maxHeight = '0';
        void el.offsetHeight;
        el.style.maxHeight = h + 'px';
        var onEnd = function() {
            el.style.maxHeight = 'none';
            el.removeEventListener('transitionend', onEnd);
        };
        el.addEventListener('transitionend', onEnd);
    }
}

// ===== 聊天表单 =====
function setupChatForm() {
    const form = document.getElementById("chat-form");
    if (!form) return;
    const input = document.getElementById("chat-input");

    // Enter 发送，Shift+Enter 换行
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            const message = input.value.trim();
            if (!message) return;
            sendMessage(message);
            input.value = "";
        }
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const message = input.value.trim();
        if (!message) return;
        await sendMessage(message);
        input.value = "";
    });
}

// ===== 发送消息 =====
async function sendMessage(message) {
    const laneMode = document.querySelector("input[name='lane_mode']:checked")?.value || "auto";

    appendUserMessage(message);

    const loadingId = appendLoadingMessage();

    try {
        // 读取当前模型配置
        let modelConfig = {};
        try { modelConfig = JSON.parse(localStorage.getItem("mc_roles") || "{}"); } catch(e) {}

        const resp = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: message,
                lane_mode: laneMode,
                history: messageHistory,
                model_config: modelConfig,
            }),
        });

        removeLoadingMessage(loadingId);

        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            throw new Error(errData.error || errData.reply || `服务器错误 (${resp.status})`);
        }

        const data = await resp.json();
        appendAssistantMessage(data);
        messageHistory.push({ role: "user", content: message });
        messageHistory.push({ role: "assistant", content: data.reply });
        // 自动保存会话
        saveCurrentSession();
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

    // Thinking 区域（可折叠）
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

        const collapseId = "thinking-" + Date.now();
        thinkingHtml = `
            <div class="thinking-section">
                <button class="thinking-toggle" onclick="toggleThinkingPanel('${collapseId}',this)">
                    <span class="toggle-arrow">
                        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
                    </span>
                    🧠 ${flow}
                </button>
                <div id="${collapseId}" class="thinking-collapse">
                    ${cardsHtml}
                </div>
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
                <div class="bubble">${markdownToHtml(data.reply)}</div>
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
            <div class="agent-header" style="border-left-color:${color};">
                <span class="agent-badge" style="background:${color}18; color:${color};">${icon} ${escapeHtml(msg.name)}</span>
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
    div.innerHTML = '<div class="bubble loading-bubble">思考中<span class="loading-dots"></span></div>';
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
            if (!resp.ok) {
                const text = await resp.text();
                throw new Error(text.slice(0, 200));
            }
            const data = await resp.json();
            if (data.success) {
                alert(`索引重建完成，新增 ${data.added} 条切片`);
            }
        } catch (err) {
            alert("重建失败: " + err.message);
        }
        this.disabled = false;
        this.textContent = "重建索引";
        loadKnowledgeStats();
        if (typeof loadKnowledgeFiles === 'function') loadKnowledgeFiles();
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
        if (typeof loadKnowledgeFiles === 'function') loadKnowledgeFiles();
    });
}

function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// ===== Markdown → HTML（代码块带复制按钮 + 语言标签） =====
function markdownToHtml(md) {
    let html = escapeHtml(md);
    // 代码块（带语言标签 + 复制按钮）
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(match, lang, code) {
        var id = 'cb-' + Math.random().toString(36).slice(2, 8);
        var label = lang || 'code';
        return '<div class="code-block" id="' + id + '">' +
            '<div class="code-lang">' + label + '</div>' +
            '<button class="code-copy" onclick="var p=document.getElementById(\'' + id + '\');var t=p.querySelector(\'code\').textContent;navigator.clipboard.writeText(t).then(function(){var b=p.querySelector(\'.code-copy\');b.textContent=\'已复制\';setTimeout(function(){b.textContent=\'复制\'},2000)})">复制</button>' +
            '<pre><code>' + code.trim() + '</code></pre>' +
            '</div>';
    });
    html = html.replace(/^### (.+)$/gm, "<h6>$1</h6>");
    html = html.replace(/^## (.+)$/gm, "<h5>$1</h5>");
    html = html.replace(/^# (.+)$/gm, "<h4>$1</h4>");
    html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    return html;
}

// ===== 会话保存（适配 db.py 后端） =====
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

// ===== 用户工具函数 =====
function getUserId() {
    return localStorage.getItem("mc_uid") || "";
}

function getUserName() {
    return localStorage.getItem("mc_uname") || "";
}

async function ensureUserId() {
    // 游客不需要 user_id（不调用后端会话 API）
    if (isGuest()) return "";

    let uid = localStorage.getItem("mc_uid");
    if (uid) return uid;
    // 游客自动注册：使用 "游客" + 短标识作为用户名
    const guestName = "游客_" + Math.random().toString(36).slice(2, 8);
    try {
        const resp = await fetch("/api/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: guestName }),
        });
        const data = await resp.json();
        if (!data.error) {
            localStorage.setItem("mc_uid", data.user_id);
            localStorage.setItem("mc_uname", data.name);
            return data.user_id;
        }
    } catch (e) {
        console.error("自动注册游客失败:", e);
    }
    return "";
}

// ===== 覆盖 sidebar.html 中的 newChat =====
const _origNewChat = window.newChat;
window.newChat = function() {
    if (_origNewChat) _origNewChat();
    messageHistory = [];
    _currentSessionId = null;
};

// ===== 游客会话（sessionStorage） =====
function isGuest() {
    return !localStorage.getItem("auth_token");
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
