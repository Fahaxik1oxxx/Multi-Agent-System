# Phase 2B + 3: 全平台完善 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Phase 2A 基础上完成 P0（会话持久化/文件上传/Agent卡片优化）、P1（右侧栏/SSE监控/评估仪表盘/Agent开关/编排画布）、P2（Agent设计器/模板市场/管理后台/API文档）

**Architecture:** 后端新增 eval_logs 表 + agent-config API + 动态流水线编译；前端 ChatPage 三栏布局（Sidebar + Chat + RightPanel）+ 编排画布（React Flow DAG）；新增 MonitorPage、EvaluationPage、OrchestrationPage、AgentDesigner、AdminPage 五个页面

**Tech Stack:** React 18 + TypeScript + Vite + daisyUI 5 + Tailwind CSS 4 + TanStack Query + Zustand + Recharts + React Flow；FastAPI + LangGraph + SQLite；SSE 流式协议

**Spec:** `docs/superpowers/specs/2026-06-27-phase3-full-platform-design.md`

## Global Constraints

- Python 3.10+, FastAPI >=0.115, SQLite WAL mode, TARGET_SCHEMA_VERSION 升级到 4
- React 18 + TypeScript strict mode, daisyUI 5
- 前端部署 Cloudflare Pages，后端部署 Render (512MB 内存受限)
- 所有 API 响应 JSON，遵循 `{"error": "..."}` 格式
- 数据库迁移使用 `_run_migration()` 版本递增机制，不破坏现有表
- SSE 协议扩展向下兼容（`agent_end` 新增可选字段 `elapsed_ms`, `token_count`）
- 不引入 React Flow / CodeMirror 等重型依赖到 P0-P2
- 新依赖仅: `recharts` + `@xyflow/react` (前端), `scalar-fastapi` (后端)

---

## 文件结构总览

### 新建文件

```
# ── P0 ──
frontend/src/api/knowledge.ts                          # 知识库/文件 API

# ── P1 ──
frontend/src/components/layout/RightPanel.tsx          # 右侧栏容器 + 拖拽
frontend/src/components/layout/RightPanel/AgentTab.tsx  # Agent 开关 Tab
frontend/src/components/layout/RightPanel/SessionInfoTab.tsx  # 会话信息 Tab
frontend/src/components/layout/RightPanel/FilesTab.tsx  # 文件管理 Tab
frontend/src/pages/project/MonitorPage.tsx              # SSE 实时监控页
frontend/src/components/monitor/PipelineTimeline.tsx    # 流水线时间轴
frontend/src/pages/project/EvaluationPage.tsx           # 评估仪表盘
frontend/src/lib/exportReport.ts                        # Markdown 报告导出
frontend/src/pages/project/OrchestrationPage.tsx        # 编排画布页
frontend/src/components/orchestra/Canvas.tsx            # React Flow 画布容器
frontend/src/components/orchestra/nodes/StartNode.tsx   # Start 节点
frontend/src/components/orchestra/nodes/AgentNode.tsx   # Agent 节点
frontend/src/components/orchestra/nodes/RouterNode.tsx  # Router 条件分支节点
frontend/src/components/orchestra/NodePalette.tsx       # 左侧节点面板（拖拽源）
frontend/src/components/orchestra/RouterEditor.tsx      # Router 条件编辑弹窗

# ── P2 ──
frontend/src/pages/agent-design/AgentDesigner.tsx      # Agent 设计器
frontend/src/data/templates.ts                          # 预置模板数据
frontend/src/pages/admin/AdminPage.tsx                  # 管理后台（已有占位，重写）
```

### 修改文件

```
# ── P0 ──
frontend/src/pages/project/ChatPage.tsx                 # 自动保存 + 文件上传 + 监听历史事件
frontend/src/hooks/useStreamChat.ts                     # done 事件回调 + agent_end 扩展字段

# ── P1 ──
frontend/src/components/layout/AppShell.tsx             # 聊天页不使用 drawer-content（ChatPage 自己三栏布局）
router/stream_graph.py                                  # 动态图构建 + token 计数 + 耗时
router/stream.py                                        # enabled_agents 传入 build_stream_workflow
workspace/routes.py                                     # agent-config GET/PUT API
user/db.py                                              # 迁移 v4: eval_logs 表
frontend/src/routes/index.tsx                           # 新路由
frontend/src/api/projects.ts                            # agent-config API
frontend/src/index.css                                  # 右侧栏 + 监控页 + 仪表盘样式 + 编排画布样式
frontend/package.json                                   # +@xyflow/react

# ── P2 ──
main.py                                                 # Scalar UI /docs 路由
requirements.txt                                        # scalar-fastapi
frontend/package.json                                   # recharts
frontend/src/pages/templates/TemplateMarket.tsx         # 已有占位，重写
```

---

## P0: 现有功能收尾

### Task 1: P0-1 — 会话持久化（ChatPage 自动保存 + 恢复）

**Files:**
- Modify: `frontend/src/pages/project/ChatPage.tsx`
- Modify: `frontend/src/hooks/useStreamChat.ts`

**Interfaces:**
- Consumes: `sessionsApi.save()` (已有), `sessionsApi.get()` (已有), Sidebar 的 `load-session` / `new-chat` CustomEvent
- Produces: ChatPage 在 SSE 完成后自动保存会话；响应 Sidebar 的加载/新建事件

**为什么 Sidebar 已有历史列表？** Phase 2A 的 Sidebar 已经实现了会话列表、搜索、删除、`load-session`/`new-chat`/`session-saved` 事件。ChatPage 缺的是：1) 监听这些事件 2) SSE 完成后自动保存。这个 Task 补齐 ChatPage 端。

- [ ] **Step 1: useStreamChat 增加 onComplete 回调**

在 `frontend/src/hooks/useStreamChat.ts` 中，修改 `startStream` 函数签名，增加可选的 `onComplete` 回调：

`useStreamChat.ts` 第 38 行，修改 `startStream` 函数：

```typescript
const startStream = useCallback(async (
  message: string,
  laneMode: string = 'auto',
  onComplete?: (reply: string, thinking: Array<{name: string; content: string}>, taskType: string) => void,
) => {
```

然后在 processEvent 的 `done` case 中（第 144-152 行），调用 `onComplete`：

```typescript
case 'done':
  if (onComplete) {
    // 延迟到 setState 之后执行，捕获最新 state
    setTimeout(() => {
      const thinkArr: Array<{name: string; content: string}> = [];
      thinkingOrder.forEach(name => {
        thinkArr.push({ name, content: thinking.get(name) || '' });
      });
      onComplete(event.reply || '', thinkArr, '');
    }, 0);
  }
  return {
    ...prev,
    isStreaming: false,
    reply: event.reply || '',
    thinking,
    thinkingOrder,
    currentAgent: null,
  };
```

- [ ] **Step 2: ChatPage 添加自动保存会话逻辑**

在 `frontend/src/pages/project/ChatPage.tsx` 中，`handleSend` 调用 `startStream` 时传入 `onComplete` 回调：

```typescript
const handleSend = useCallback(async (message?: string) => {
  const text = (message ?? inputValue).trim();
  if (!text || streaming.isStreaming) return;

  const userMsg: Message = { role: 'user', content: text };
  const newMessages = [...messages, userMsg];
  setMessages(newMessages);
  setInputValue('');

  const assistMsg: Message = { role: 'assistant', content: '', loading: true };
  setMessages([...newMessages, assistMsg]);

  try {
    await startStream(text, laneMode, (reply, thinking) => {
      // 自动保存会话
      if (projectId) {
        const finalMessages = [
          ...newMessages,
          { role: 'assistant' as const, content: reply },
        ];
        sessionsApi.save({
          id: `session_${Date.now()}`,
          title: text.slice(0, 50),
          messages: finalMessages,
        }).then(() => {
          window.dispatchEvent(new CustomEvent('session-saved'));
        }).catch(() => { /* 静默失败 */ });
      }
    });
  } catch {
    // handled by streaming.error
  }
}, [inputValue, messages, streaming.isStreaming, laneMode, startStream, projectId]);
```

在文件顶部新增 import：
```typescript
import { sessionsApi } from '@/api/sessions';
```

- [ ] **Step 3: ChatPage 监听 load-session / new-chat 事件**

在 `ChatPage` 组件中添加两个 `useEffect`：

```typescript
// 监听 Sidebar 的 "加载历史会话" 事件
useEffect(() => {
  const handler = async (e: Event) => {
    const sid = (e as CustomEvent<string>).detail;
    try {
      const res = await sessionsApi.get(sid);
      const loaded: Message[] = (res.data.messages || []).map(
        (m: { role: string; content: string }) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })
      );
      setMessages(loaded);
    } catch {
      toast.error('加载会话失败');
    }
  };
  window.addEventListener('load-session', handler);
  return () => window.removeEventListener('load-session', handler);
}, []);

// 监听 Sidebar 的 "新对话" 事件
useEffect(() => {
  const handler = () => {
    setMessages([]);
    resetStream();
  };
  window.addEventListener('new-chat', handler);
  return () => window.removeEventListener('new-chat', handler);
}, [resetStream]);
```

需要 import：
```typescript
import { toast } from 'sonner';
```
（如果 `toast` 不在文件头部已有 import 中）

从 `useStreamChat` 解构中增加 `resetStream`：
```typescript
const { streaming, startStream, abortStream, resetStream } = useStreamChat();
```

- [ ] **Step 4: 更新 sessionsApi.save 调用传入 project_id**

当前 `sessionsApi.save` 的签名只有 `{id, title?, messages}`。需要在 ChatPage 中保存时附加 `project_id`，方便后续按项目过滤。修改 ChatPage 的 `onComplete` 回调，在 save 时传入 `projectId`:

```typescript
sessionsApi.save({
  id: `session_${Date.now()}`,
  title: text.slice(0, 50),
  messages: finalMessages,
  project_id: projectId,  // 已经有 projectId 从 useParams 获取
} as any).then(() => {
  window.dispatchEvent(new CustomEvent('session-saved'));
}).catch(() => { /* 静默失败 */ });
```

> 注：后端 sessions 表的 `project_id` 字段在 Phase 1 迁移计划中已存在，但实际 DB 可能未包含。如果后端 sessions 表无 `project_id` 列，保存时后端会忽略该字段。此处前端先传，不阻塞。

- [ ] **Step 5: 验证**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npx tsc --noEmit
```

预期：无类型错误。

手动测试：
1. 在 ChatPage 发送一条消息，等待 SSE 完成
2. 刷新页面 → Sidebar 应显示刚保存的会话
3. 点击 Sidebar 历史条目 → ChatPage 恢复消息
4. 点击"开启新对话"按钮 → ChatPage 清空消息

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/project/ChatPage.tsx frontend/src/hooks/useStreamChat.ts
git commit -m "feat(p0): 会话持久化 — ChatPage 自动保存 + 历史加载/新建事件监听"
```

---

### Task 2: P0-2 — 文件上传前端对接

**Files:**
- Create: `frontend/src/api/knowledge.ts`
- Modify: `frontend/src/pages/project/ChatPage.tsx`

**Interfaces:**
- Consumes: 后端 `POST /api/knowledge/upload`, `GET /api/knowledge/files`
- Produces: 文件 input + 标签 + 上传逻辑

- [ ] **Step 1: 创建知识库 API 模块**

创建 `frontend/src/api/knowledge.ts`：

```typescript
import apiClient from './client';

export interface KnowledgeFile {
  name: string;
  size: number;
  uploaded_at: string;
}

export const knowledgeApi = {
  listFiles: () =>
    apiClient.get<KnowledgeFile[]>('/knowledge/files'),

  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post<{ name: string; status: string }>(
      '/knowledge/upload',
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30000,
      }
    );
  },

  deleteFile: (filename: string) =>
    apiClient.delete(`/knowledge/files/${encodeURIComponent(filename)}`),
};
```

- [ ] **Step 2: ChatPage 添加文件上传 UI**

在 `ChatPage.tsx` 中新增状态：

```typescript
const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
```

新增文件上传处理函数：

```typescript
const handleFileAttach = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
  const files = e.target.files;
  if (!files) return;
  setAttachedFiles((prev) => [...prev, ...Array.from(files)]);
  // 重置 input 以便重复选择同一文件
  e.target.value = '';
}, []);

const removeFile = useCallback((idx: number) => {
  setAttachedFiles((prev) => prev.filter((_, i) => i !== idx));
}, []);
```

在输入区域上方添加文件标签行（放在 `chat-input-area` div 内部，`input-wrapper` 之前）：

```tsx
{attachedFiles.length > 0 && (
  <div className="file-tags">
    {attachedFiles.map((f, i) => (
      <span key={i} className="file-tag">
        {f.name}
        <button
          onClick={() => removeFile(i)}
          className="ml-1 text-[#9ca3af] hover:text-[#6b7280]"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}
        >
          ×
        </button>
      </span>
    ))}
  </div>
)}
```

在 textarea 旁边添加隐藏的 file input 和触发按钮：

```tsx
{/* 文件上传 input（隐藏） */}
<input
  ref={fileInputRef}
  type="file"
  multiple
  className="hidden"
  onChange={handleFileAttach}
  accept=".csv,.xlsx,.xls,.py,.txt,.md,.pdf,.png,.jpg,.jpeg"
/>

{/* 文件附加按钮 — 在 send-btn 旁边 */}
<button
  className="attach-btn"
  onClick={() => fileInputRef.current?.click()}
  title="附加文件"
>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
</button>
```

文件标签 CSS 已存在于 `index.css` (`.file-tags`, `.file-tag`, `.attach-btn`)，无需额外样式。

- [ ] **Step 3: handleSend 中附带文件上传**

修改 `handleSend`，在发送前上传文件并附加信息到消息：

```typescript
const handleSend = useCallback(async (message?: string) => {
  const text = (message ?? inputValue).trim();
  if (!text || streaming.isStreaming) return;

  // 上传附件
  let fileInfo = '';
  if (attachedFiles.length > 0) {
    const names: string[] = [];
    for (const f of attachedFiles) {
      try {
        await knowledgeApi.upload(f);
        names.push(f.name);
      } catch {
        toast.error(`文件 ${f.name} 上传失败`);
      }
    }
    if (names.length > 0) {
      fileInfo = `\n\n[已上传文件: ${names.join(', ')}]`;
    }
    setAttachedFiles([]);
  }

  const fullText = text + fileInfo;
  // ... 后续逻辑不变，用 fullText 替换原来的 text
```

需要 import：
```typescript
import { knowledgeApi } from '@/api/knowledge';
```

- [ ] **Step 4: 处理文件拖拽上传**

在 ChatPage 中已有 `drag-overlay` CSS 类，添加拖拽事件处理：

```typescript
const [dragOver, setDragOver] = useState(false);

// 在 chat-input-area 上添加拖拽事件
useEffect(() => {
  const area = document.querySelector('.chat-input-area');
  if (!area) return;
  const onDragOver = (e: DragEvent) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files) {
      setAttachedFiles((prev) => [...prev, ...Array.from(e.dataTransfer!.files)]);
    }
  };
  area.addEventListener('dragover', onDragOver);
  area.addEventListener('dragleave', onDragLeave);
  area.addEventListener('drop', onDrop);
  return () => {
    area.removeEventListener('dragover', onDragOver);
    area.removeEventListener('dragleave', onDragLeave);
    area.removeEventListener('drop', onDrop);
  };
}, []);
```

- [ ] **Step 5: 验证**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npx tsc --noEmit
```

预期：无类型错误。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/knowledge.ts frontend/src/pages/project/ChatPage.tsx
git commit -m "feat(p0): 文件上传前端对接 — 附加按钮 + 拖拽上传 + 标签显示"
```

---

### Task 3: P0-3 — Agent 卡片交互优化

**Files:**
- Modify: `router/stream_graph.py`
- Modify: `frontend/src/hooks/useStreamChat.ts`
- Modify: `frontend/src/pages/project/ChatPage.tsx`

**Interfaces:**
- Consumes: `_stream_llm` 函数
- Produces: `agent_end` 事件新增 `elapsed_ms`, `token_count` 字段；思考面板默认展开第一个 Agent

- [ ] **Step 1: 后端 _stream_llm 增加耗时和 token 计数**

修改 `router/stream_graph.py` 的 `_stream_llm` 函数（第 72-87 行）：

```python
def _stream_llm(role: str, prompt: str, session: SessionState,
                temperature: float = 0.3) -> tuple[str, int, int]:
    """辅助函数：通用 LLM 流式调用并推送到队列。
    
    返回: (content, token_count, elapsed_ms)
    """
    import time
    start = int(time.time() * 1000)
    push(session, {"type": "agent_start", "name": role})
    llm = create_llm(role, temperature=temperature)
    content = ""
    for chunk in llm.stream(prompt):
        if session.cancel.is_set():
            push(session, {"type": "cancelled"})
            break
        text = chunk.content if hasattr(chunk, "content") else str(chunk)
        content += text
        push(session, {"type": "token", "name": role, "content": text})
    elapsed_ms = int(time.time() * 1000) - start
    # 粗略 token 估算：中文 ~1.5 字/token，英文 ~4 字/token
    token_count = len(content) // 2
    push(session, {
        "type": "agent_end",
        "name": role,
        "content": content,
        "elapsed_ms": elapsed_ms,
        "token_count": token_count,
    })
    logger.info("stream | agent_end=%s | chars=%d | tokens=%d | elapsed=%dms",
                role, len(content), token_count, elapsed_ms)
    return content, token_count, elapsed_ms
```

**注意**: `_stream_llm` 的返回类型从 `str` 变为 `tuple[str, int, int]`。需要更新所有调用处。

更新 `bot_node`（第 90-95 行）：
```python
def bot_node(state: StreamWorkflowState) -> dict:
    session = state["session"]
    prompt = f"{SYSTEM_PROMPTS['Bot']}\n\n用户输入: {state['user_input']}"
    content, _, _ = _stream_llm("Bot", prompt, session, temperature=0.5)
    return {"final_output": content,
            "thinking": [{"name": "Bot", "content": content}]}
```

更新 `planner_node`（第 98-115 行）：
```python
def planner_node(state: StreamWorkflowState) -> dict:
    ...
    content, _, _ = _stream_llm("Planner", prompt, session)
    return {"plan": content,
            "thinking": [{"name": "Planner", "content": content}]}
```

更新 `coder_node`（第 146-176 行）：
```python
def coder_node(state: StreamWorkflowState) -> dict:
    ...
    content, _, _ = _stream_llm("Coder", session_prompt, session, temperature=0.2)
    return {"code_or_draft": content,
            "thinking": [{"name": "Coder", "content": content}]}
```

更新 `writer_node`（第 179-192 行）：
```python
def writer_node(state: StreamWorkflowState) -> dict:
    ...
    content, _, _ = _stream_llm("Writer", session_prompt, session, temperature=0.4)
    return {"code_or_draft": content,
            "thinking": [{"name": "Writer", "content": content}]}
```

更新 `tester_node`（第 228-247 行）：
```python
def tester_node(state: StreamWorkflowState) -> dict:
    ...
    content, _, _ = _stream_llm("Tester", session_prompt, session, temperature=0.2)
    new_fix_count = state.get("fix_count", 0)
    if "✅" in content:
        new_fix_count += 1
    return {"test_result": content, "fix_count": new_fix_count,
            "thinking": [{"name": "Tester", "content": content}]}
```

更新 `summarizer_node`（第 250-263 行）：
```python
def summarizer_node(state: StreamWorkflowState) -> dict:
    ...
    content, _, _ = _stream_llm("Summarizer", prompt, session)
    return {"final_output": content,
            "thinking": [{"name": "Summarizer", "content": content}]}
```

`retriever_node`（第 118-143 行）不使用 `_stream_llm` 辅助函数，单独改造：
```python
def retriever_node(state: StreamWorkflowState) -> dict:
    import time
    session = state["session"]
    start = int(time.time() * 1000)
    push(session, {"type": "agent_start", "name": "Retriever"})
    kb_result = search_knowledge.invoke(state["user_input"])
    ...
    # 在 agent_end 也加上字段
    elapsed_ms = int(time.time() * 1000) - start
    push(session, {"type": "agent_end", "name": "Retriever",
                   "content": content, "elapsed_ms": elapsed_ms,
                   "token_count": len(content) // 2})
    return ...
```

`executor_node`（第 195-225 行）也同理，在 `agent_end` 加 elapsed_ms：
```python
def executor_node(state: StreamWorkflowState) -> dict:
    import time
    session = state["session"]
    ...
    start = int(time.time() * 1000)
    push(session, {"type": "agent_start", "name": "Executor"})
    ...
    elapsed_ms = int(time.time() * 1000) - start
    push(session, {"type": "agent_end", "name": "Executor",
                   "content": execution_result, "elapsed_ms": elapsed_ms})
    ...
```

- [ ] **Step 2: 更新前端 StreamEvent 类型**

修改 `frontend/src/hooks/useStreamChat.ts` 中 `StreamEvent` 接口（第 5-12 行）：

```typescript
export interface StreamEvent {
  type: 'agent_start' | 'token' | 'agent_end' | 'done' | 'error' | 'cancelled';
  name?: string;
  content?: string;
  reply?: string;
  thinking?: Array<{ name: string; content: string }>;
  task_type?: string;
  elapsed_ms?: number;
  token_count?: number;
}
```

在 `processEvent` 的 `agent_start` case 中，记录时间戳用于计算耗时：

在 `useStreamChat` hook 内添加一个 ref：
```typescript
const agentStartTime = useRef<Map<string, number>>(new Map());
```

修改 `processEvent` 中 `agent_start` case：
```typescript
case 'agent_start':
  if (event.name) {
    thinking.set(event.name, '');
    thinkingOrder.push(event.name);
    agentStartTime.current.set(event.name, Date.now());
  }
  return { ...prev, thinking, thinkingOrder, currentAgent: event.name || null };
```

在 `agent_end` case 中，存储 elapsed_ms 和 token_count：
```typescript
case 'agent_end':
  if (event.name && event.content) {
    thinking.set(event.name, event.content);
  }
  // 存储到 state 中供右侧栏使用
  return { ...prev, thinking };
```

还需要在 `StreamingState` 增加字段来存储每个 agent 的统计：

```typescript
export interface StreamingState {
  sessionId: string | null;
  isStreaming: boolean;
  thinking: Map<string, string>;
  thinkingOrder: string[];
  currentAgent: string | null;
  reply: string;
  error: string | null;
  agentStats: Map<string, { elapsed_ms: number; token_count: number }>;
}
```

在 `processEvent` 的 `agent_end` case 更新 agentStats：
```typescript
case 'agent_end':
  if (event.name && event.content) {
    thinking.set(event.name, event.content);
  }
  if (event.name && (event.elapsed_ms || event.token_count)) {
    const stats = new Map(prev.agentStats);
    stats.set(event.name, {
      elapsed_ms: event.elapsed_ms || 0,
      token_count: event.token_count || 0,
    });
    return { ...prev, thinking, agentStats: stats };
  }
  return { ...prev, thinking };
```

初始化 state 时增加 `agentStats: new Map()`（第 25-33 行和第 40-47 行两处）。

- [ ] **Step 3: 前端思考面板默认展开第一个 Agent**

修改 `MsgBubble` 中的 `openPanels` 初始化逻辑。在 `ChatPage.tsx` 的 `MsgBubble` 组件中（第 240 行附近），修改：

```typescript
function MsgBubble({...}) {
  // 默认展开第一个 Agent（仅在非流式模式下）
  const [openPanels, setOpenPanels] = useState<Set<string>>(() => {
    if (msg.thinking && msg.thinking.length > 0) {
      return new Set([`think-${idx}`]);
    }
    return new Set();
  });
```

并在流式开始时自动展开面板：
```typescript
// 流式模式下自动展开
useEffect(() => {
  if (isStreaming && streamingOrder.length > 0) {
    setOpenPanels(new Set([`think-${idx}`]));
  }
}, [isStreaming, streamingOrder.length > 0]);
```

- [ ] **Step 4: Agent 卡片头显示耗时**

修改 Agent 卡片的 header 部分（ChatPage.tsx 第 296-298 行）：

```tsx
<div className="agent-header" style={{ borderLeftColor: COLORS[t.name] || '#6b7280' }}>
  <span className="agent-badge" style={{ background: `${COLORS[t.name] || '#6b7280'}18`, color: COLORS[t.name] || '#6b7280' }}>
    {ICONS[t.name] || '🔹'} {t.name}
  </span>
  {streaming.agentStats.get(t.name) && (
    <span className="ml-2 text-[0.7rem] text-[#9ca3af]">
      {streaming.agentStats.get(t.name)!.elapsed_ms > 1000
        ? `${(streaming.agentStats.get(t.name)!.elapsed_ms / 1000).toFixed(1)}s`
        : `${streaming.agentStats.get(t.name)!.elapsed_ms}ms`}
    </span>
  )}
</div>
```

历史消息（非 streaming）的卡片也显示耗时（从 thinking 数据中取，如果有的话）。

- [ ] **Step 5: 代码块复制增加 toast 反馈**

修改 `Markdown` 组件的 `code-copy` button onclick（ChatPage.tsx 第 343-344 行），将现有的 `navigator.clipboard.writeText` + 改文字 → 改为调用 toast：

这需要将 code-copy 按钮的 onclick 改为通过事件委托处理（因为 Markdown 用 `dangerouslySetInnerHTML`）。但当前实现是内联 onclick，保持现有模式，只是把文字反馈改得更明显：

```tsx
`<button class="code-copy" onclick="var t=this.parentElement.querySelector('code').textContent;navigator.clipboard.writeText(t);this.textContent='✅ 已复制';this.style.color='#10b981';setTimeout(()=>{this.textContent='复制';this.style.color=''},2000)">复制</button>`
```

- [ ] **Step 6: 验证**

后端：
```bash
cd "D:\AI\Internship\Multi_Agent" && python -c "from router.stream_graph import build_stream_workflow; print('OK')"
```

前端：
```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add router/stream_graph.py frontend/src/hooks/useStreamChat.ts frontend/src/pages/project/ChatPage.tsx
git commit -m "feat(p0): Agent卡片优化 — 耗时/Token计数 + 默认展开 + 复制反馈"
```

---

## P1: 答辩高光

### Task 4: P1-1 — 右侧可伸缩栏布局

**Files:**
- Create: `frontend/src/components/layout/RightPanel.tsx`
- Modify: `frontend/src/pages/project/ChatPage.tsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: ChatPage 的 `streaming` state, `messages`
- Produces: 右侧栏容器组件，含三 Tab + 拖拽把手 + 折叠按钮

- [ ] **Step 1: 创建 RightPanel 容器组件**

创建 `frontend/src/components/layout/RightPanel.tsx`：

```tsx
import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';

interface RightPanelProps {
  children: ReactNode;
}

export function RightPanel({ children }: RightPanelProps) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(280);
  const dragging = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX - ev.clientX;
      const newWidth = Math.min(480, Math.max(160, startWidth + delta));
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [width]);

  return (
    <div className="flex h-full shrink-0" ref={panelRef}>
      {/* 拖拽把手 */}
      <div
        className="flex items-center justify-center w-[6px] h-full cursor-col-resize hover:bg-[#4f8cff]/20 transition-colors relative group shrink-0"
        onMouseDown={handleMouseDown}
      >
        {/* 折叠/展开按钮 */}
        <button
          onClick={() => setOpen(!open)}
          className="absolute w-6 h-6 rounded-full bg-white border border-[#e0e4e8] shadow-sm flex items-center justify-center text-[#9ca3af] hover:text-[#4f8cff] hover:border-[#4f8cff] transition-all z-10"
          style={{ top: '50%', transform: 'translateY(-50%)' }}
          title={open ? '收起面板' : '展开面板'}
        >
          <svg
            width="12" height="12" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2"
            style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      {/* 面板内容 */}
      <div
        className="h-full overflow-hidden border-l border-[#eceef2] bg-white transition-all duration-200"
        style={{ width: open ? `${width}px` : '0px' }}
      >
        {open && (
          <div className="w-full h-full overflow-y-auto" style={{ minWidth: '160px' }}>
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 Tab 切换组件**

在 `RightPanel.tsx` 中追加 Tab 组件：

```tsx
interface RightPanelTabsProps {
  tabs: { key: string; label: string }[];
  activeTab: string;
  onTabChange: (key: string) => void;
}

export function RightPanelTabs({ tabs, activeTab, onTabChange }: RightPanelTabsProps) {
  return (
    <div className="flex border-b border-[#eceef2] bg-[#f9fafb]">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
            activeTab === tab.key
              ? 'text-[#4f8cff] border-b-2 border-[#4f8cff] bg-white'
              : 'text-[#81858c] hover:text-[#1d1d1f]'
          }`}
          onClick={() => onTabChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 修改 ChatPage 使用右侧栏布局**

修改 `ChatPage.tsx` 的外层布局，将内容包裹在 flex row 中：

```tsx
// 在 ChatPage return 的 JSX 中，将原来的单个 flex-col div 改为三栏：

return (
  <div className="flex h-full" style={{ background: 'var(--bg-chat)' }}>
    {/* 左侧 Chat 区域 */}
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* Messages */}
      <div ref={chatRef} className="flex-1 overflow-y-auto" id="chat-messages">
        {/* ... 原有 messages 内容不变 ... */}
      </div>

      {/* Disclaimer */}
      {messages.length > 0 && <div className="ai-disclaimer show">内容由 AI 生成，请仔细甄别</div>}

      {/* Input */}
      <div className="chat-input-area">
        {/* ... 原有 input 内容不变 ... */}
      </div>
    </div>

    {/* 右侧栏 */}
    <RightPanel>
      <RightPanelTabs
        tabs={[
          { key: 'agents', label: 'Agent 配置' },
          { key: 'session', label: '会话信息' },
          { key: 'files', label: '文件' },
        ]}
        activeTab={rightTab}
        onTabChange={setRightTab}
      />
      <div className="p-3">
        {rightTab === 'agents' && <AgentTab projectId={projectId!} />}
        {rightTab === 'session' && (
          <SessionInfoTab
            taskType={lastTaskType}
            complexity={lastComplexity}
            agentStats={streaming.agentStats}
            thinkingOrder={streaming.thinkingOrder}
          />
        )}
        {rightTab === 'files' && <FilesTab projectId={projectId!} />}
      </div>
    </RightPanel>
  </div>
);
```

需要新增 state：
```typescript
const [rightTab, setRightTab] = useState('session');
const [lastTaskType, setLastTaskType] = useState('');
const [lastComplexity, setLastComplexity] = useState('');
```

在 `done` 事件中更新 `lastTaskType` 和 `lastComplexity`（通过 `useStreamChat` 的 `onComplete` 参数中的 taskType）。

- [ ] **Step 4: 注意 — ChatPage 不再走 AppShell 的 drawer-content 布局**

当前 `AppShell` 使用 `drawer lg:drawer-open` 布局，ChatPage 作为 `<Outlet />` 渲染在 `drawer-content` 内。三栏布局中 ChatPage 自己已经是 `flex h-full`，不影响 drawer 结构。不需要修改 AppShell。

- [ ] **Step 5: 验证**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npx tsc --noEmit
```

预期：`AgentTab`, `SessionInfoTab`, `FilesTab` 尚未创建，会有 import 错误。确认错误仅限于这三个缺失的组件引用。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/layout/RightPanel.tsx frontend/src/pages/project/ChatPage.tsx
git commit -m "feat(p1): 右侧可伸缩栏布局 — RightPanel + 拖拽把手 + Tab切换 + ChatPage三栏改造"
```

---

### Task 5: P1-2 — Agent 开关（后端动态图 + API + 前端 Toggle）

**Files:**
- Modify: `router/stream_graph.py`
- Modify: `router/stream.py`
- Create: `frontend/src/components/layout/RightPanel/AgentTab.tsx`
- Modify: `workspace/routes.py`
- Modify: `frontend/src/api/projects.ts`

**Interfaces:**
- Consumes: `build_stream_workflow(enabled)`, `GET/PUT /api/projects/{id}/agent-config`
- Produces: 按项目保存的 Agent 开关配置；后端动态跳过停用节点

- [ ] **Step 1: 后端 — build_stream_workflow 接受 enabled 参数**

修改 `router/stream_graph.py` 的 `build_stream_workflow` 函数（第 267-286 行）：

```python
# —— 构建 LangGraph ——
def build_stream_workflow(enabled: set = None) -> StateGraph:
    """根据启用的 Agent 集合动态构建 LangGraph。
    
    始终启用: Planner, Summarizer
    可切换: Retriever, Coder, Writer, Executor, Tester, Bot
    
    Args:
        enabled: 启用的 Agent 名称集合，None 表示全部启用
    """
    if enabled is None:
        enabled = {"Planner", "Retriever", "Coder", "Writer",
                   "Executor", "Tester", "Summarizer", "Bot"}
    
    wf = StateGraph(StreamWorkflowState)
    
    # 始终添加
    wf.add_node("planner", planner_node)
    wf.add_node("summarizer", summarizer_node)
    wf.set_conditional_entry_point(_route_lane)
    
    # Bot（低复杂度快捷模式）
    has_bot = "Bot" in enabled
    if has_bot:
        wf.add_node("bot", bot_node)
        wf.add_edge("bot", END)
    
    has_retriever = "Retriever" in enabled
    has_coder = "Coder" in enabled
    has_executor = "Executor" in enabled
    has_tester = "Tester" in enabled
    has_writer = "Writer" in enabled
    
    # Planner → next
    if has_retriever:
        wf.add_node("retriever", retriever_node)
        wf.add_edge("planner", "retriever")
    elif has_coder:
        wf.add_node("coder", coder_node)
        wf.add_edge("planner", "coder")
    elif has_writer:
        wf.add_node("writer", writer_node)
        wf.add_edge("planner", "writer")
    else:
        wf.add_edge("planner", "summarizer")
    
    # Retriever → next (按 task_type 路由)
    if has_retriever:
        def _route_after_retrieve(state):
            task_type = state.get("task_type", "编程")
            if task_type == "写作":
                if has_writer:
                    return "writer"
                return "summarizer"
            # 编程/分析/其他
            if has_coder:
                return "coder"
            return "summarizer"
        wf.add_conditional_edges("retriever", _route_after_retrieve)
    
    # Coder → Executor 或 Tester 或 Summarizer
    if has_coder:
        wf.add_node("coder", coder_node)
        if has_executor:
            wf.add_node("executor", executor_node)
            wf.add_edge("coder", "executor")
            if has_tester:
                wf.add_node("tester", tester_node)
                wf.add_conditional_edges("executor", _route_after_executor)
                wf.add_conditional_edges("tester", _route_test)
            else:
                wf.add_conditional_edges("executor", 
                    lambda s: "summarizer" if s.get("need_report") else END)
        else:
            # 有 Coder 无 Executor: Coder → Summarizer
            wf.add_edge("coder", "summarizer")
    
    # Writer → Tester 或 Summarizer
    if has_writer:
        wf.add_node("writer", writer_node)
        if has_tester:
            wf.add_node("tester", tester_node)
            wf.add_edge("writer", "tester")
            wf.add_conditional_edges("tester", _route_test)
        else:
            wf.add_edge("writer", "summarizer")
    
    wf.add_edge("summarizer", END)
    return wf.compile()
```

- [ ] **Step 2: 后端 — stream.py 传入 enabled_agents**

修改 `router/stream.py` 的 `run_workflow_streaming` 函数（第 41-89 行）：

将第 37 行的全局 `_stream_graph = build_stream_workflow()` **删除**，改为在 `run_workflow_streaming` 内部动态构建：

```python
# 删除第 37 行:
# _stream_graph = build_stream_workflow()

def run_workflow_streaming(data: dict, state: SessionState):
    """在后台线程运行 LangGraph 流式工作流，通过 queue 推送到 SSE。"""
    try:
        user_input = data.get("message", "")
        lane_mode = data.get("lane_mode", "auto")
        enabled_agents = set(data.get("enabled_agents", [
            "Planner", "Retriever", "Coder", "Writer",
            "Executor", "Tester", "Summarizer", "Bot"
        ]))
        
        logger.info("stream | start langgraph pipeline | input=%s | enabled=%s",
                    user_input[:60], enabled_agents)
        
        task_type, complexity, need_report = classify(user_input, lane_mode)
        
        # 动态构建图
        stream_graph = build_stream_workflow(enabled_agents)
        
        initial_state = StreamWorkflowState(
            session=state,
            ...
        )
        
        result_state = stream_graph.invoke(initial_state)
        ...
```

- [ ] **Step 3: 后端 — agent-config API**

在 `workspace/routes.py` 末尾追加：

```python
# ──── Agent 配置 ────

@project_router.get("/projects/{project_id}/agent-config")
async def get_agent_config(
    request: Request,
    project_id: str,
    user: dict = Depends(require_auth),
):
    """获取项目 Agent 配置"""
    db = _get_db(request)
    proj = db.get_project(project_id)
    if not proj:
        return JSONResponse({"error": "项目不存在"}, status_code=404)
    role = db.get_member_role(proj["workspace_id"], user["user_id"])
    if role is None and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权访问"}, status_code=403)
    
    import json
    agent_config = json.loads(proj.get("agent_config", "{}")) if proj.get("agent_config") else {}
    all_agents = ["Planner", "Retriever", "Coder", "Writer", "Executor", "Tester", "Summarizer", "Bot"]
    default_enabled = ["Planner", "Retriever", "Coder", "Writer", "Executor", "Tester", "Summarizer", "Bot"]
    
    enabled = agent_config.get("enabled_agents", default_enabled)
    disabled = [a for a in all_agents if a not in enabled]
    
    return JSONResponse({
        "enabled_agents": enabled,
        "disabled_agents": disabled,
        "always_on": ["Planner", "Summarizer"],
    })


@project_router.put("/projects/{project_id}/agent-config")
async def update_agent_config(
    request: Request,
    project_id: str,
    user: dict = Depends(require_auth),
):
    """更新项目 Agent 配置"""
    db = _get_db(request)
    proj = db.get_project(project_id)
    if not proj:
        return JSONResponse({"error": "项目不存在"}, status_code=404)
    role = db.get_member_role(proj["workspace_id"], user["user_id"])
    if role not in ("owner", "member") and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权修改"}, status_code=403)
    
    data = await request.json()
    enabled_agents = data.get("enabled_agents", [])
    
    # Planner 和 Summarizer 强制启用
    for required in ["Planner", "Summarizer"]:
        if required not in enabled_agents:
            enabled_agents.append(required)
    
    import json
    db.update_project(project_id, agent_config=json.dumps({"enabled_agents": enabled_agents}))
    return JSONResponse({"status": "ok", "enabled_agents": enabled_agents})
```

- [ ] **Step 4: 前端 — projects API 追加 agent-config 方法**

在 `frontend/src/api/projects.ts` 末尾追加：

```typescript
export const projectsApi = {
  // ... 已有方法保持不变 ...

  getAgentConfig: (projectId: string) =>
    apiClient.get<{
      enabled_agents: string[];
      disabled_agents: string[];
      always_on: string[];
    }>(`/projects/${projectId}/agent-config`),

  updateAgentConfig: (projectId: string, enabled_agents: string[]) =>
    apiClient.put<{ status: string; enabled_agents: string[] }>(
      `/projects/${projectId}/agent-config`,
      { enabled_agents }
    ),
};
```

- [ ] **Step 5: 前端 — AgentTab 组件**

创建 `frontend/src/components/layout/RightPanel/AgentTab.tsx`：

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '@/api/projects';
import { toast } from 'sonner';

const AGENTS = [
  { key: 'Planner', icon: '🧋', label: 'Planner', desc: '任务规划', alwaysOn: true },
  { key: 'Retriever', icon: '🐍', label: 'Retriever', desc: '知识库检索', alwaysOn: false },
  { key: 'Coder', icon: '🫻', label: 'Coder', desc: '编写代码', alwaysOn: false },
  { key: 'Writer', icon: '✍️', label: 'Writer', desc: '撰写文档', alwaysOn: false },
  { key: 'Executor', icon: '⚙️', label: 'Executor', desc: '执行代码', alwaysOn: false },
  { key: 'Tester', icon: '✅', label: 'Tester', desc: 'QA 审阅', alwaysOn: false },
  { key: 'Summarizer', icon: '🧊', label: 'Summarizer', desc: '生成报告', alwaysOn: true },
  { key: 'Bot', icon: '🤖', label: 'Bot', desc: '快捷问答', alwaysOn: false },
];

const DEFAULT_ENABLED = ['Planner', 'Retriever', 'Coder', 'Writer', 'Executor', 'Tester', 'Summarizer', 'Bot'];

interface AgentTabProps {
  projectId: string;
}

export function AgentTab({ projectId }: AgentTabProps) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['agent-config', projectId],
    queryFn: async () => {
      const res = await projectsApi.getAgentConfig(projectId);
      return res.data;
    },
    enabled: !!projectId,
  });

  const toggleMutation = useMutation({
    mutationFn: async (enabled: string[]) => {
      await projectsApi.updateAgentConfig(projectId, enabled);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-config', projectId] });
      toast.success('Agent 配置已更新');
    },
    onError: () => {
      toast.error('更新失败');
    },
  });

  const enabledAgents = data?.enabled_agents || DEFAULT_ENABLED;

  const handleToggle = (agentKey: string, on: boolean) => {
    const next = on
      ? [...enabledAgents, agentKey]
      : enabledAgents.filter((k: string) => k !== agentKey);
    toggleMutation.mutate(next);
  };

  const handleReset = () => {
    toggleMutation.mutate(DEFAULT_ENABLED);
  };

  if (isLoading) {
    return <div className="text-center py-8"><span className="loading loading-spinner loading-sm text-[#4f8cff]" /></div>;
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-[#1d1d1f] mb-3">Agent 开关</h3>
      <p className="text-xs text-[#81858c] mb-4">
        停用的 Agent 将在下次对话中被跳过
      </p>
      <div className="space-y-1">
        {AGENTS.map((agent) => {
          const isOn = enabledAgents.includes(agent.key);
          return (
            <div
              key={agent.key}
              className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-[#f9fafb] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base">{agent.icon}</span>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-[#1d1d1f]">{agent.label}</div>
                  <div className="text-[10px] text-[#9ca3af]">{agent.desc}</div>
                </div>
              </div>
              {agent.alwaysOn ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#f0f2f5] text-[#81858c] shrink-0">
                  始终启用
                </span>
              ) : (
                <input
                  type="checkbox"
                  className="toggle toggle-sm"
                  style={{
                    '--tglbg': isOn ? '#4f8cff' : '#d0d4d8',
                  } as React.CSSProperties}
                  checked={isOn}
                  onChange={(e) => handleToggle(agent.key, e.target.checked)}
                />
              )}
            </div>
          );
        })}
      </div>
      <button
        className="btn btn-ghost btn-sm w-full mt-4 text-xs text-[#81858c]"
        style={{ borderRadius: '10px' }}
        onClick={handleReset}
      >
        恢复默认配置
      </button>
    </div>
  );
}
```

- [ ] **Step 6: 前端 — useStreamChat 传递 enabled_agents**

修改 `useStreamChat.ts` 的 `startStream` 函数，从 Agent 配置 API 读取当前项目的 enabled_agents 并传给后端：

在 ChatPage 调用 `startStream` 之前，先 fetch agent config，然后将 `enabled_agents` 传给 `startStream`：

修改 `startStream` 的 POST body：

```typescript
const startResp = await apiClient.post('/chat/start', {
  message,
  lane_mode: laneMode,
  history: [],
  enabled_agents: data.enabled_agents,  // 从参数传入
});
```

修改 `startStream` 签名增加参数：
```typescript
const startStream = useCallback(async (
  message: string,
  laneMode: string = 'auto',
  enabledAgents?: string[],
  onComplete?: (...) => void,
) => {
```

- [ ] **Step 7: 验证**

后端：
```bash
cd "D:\AI\Internship\Multi_Agent" && python -c "
from router.stream_graph import build_stream_workflow
g = build_stream_workflow({'Planner', 'Summarizer'})
print('Minimal graph OK')
g = build_stream_workflow({'Planner', 'Retriever', 'Coder', 'Executor', 'Summarizer'})
print('Without Tester/Writer/Bot OK')
"
```

前端：
```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add router/stream_graph.py router/stream.py workspace/routes.py \
        frontend/src/api/projects.ts frontend/src/components/layout/RightPanel/AgentTab.tsx \
        frontend/src/hooks/useStreamChat.ts
git commit -m "feat(p1): Agent动态开关 — 后端动态图构建 + API + 前端Toggle"
```

---

### Task 6: P1-3 — SSE 实时监控页

**Files:**
- Create: `frontend/src/pages/project/MonitorPage.tsx`
- Create: `frontend/src/components/monitor/PipelineTimeline.tsx`
- Modify: `frontend/src/routes/index.tsx`

**Interfaces:**
- Consumes: 项目内路由 `/w/:wid/p/:pid/monitor`，从 ChatPage 触发导航（或独立访问）
- Produces: 流水线时间轴视图

- [ ] **Step 1: 创建 PipelineTimeline 组件**

创建 `frontend/src/components/monitor/PipelineTimeline.tsx`：

```tsx
import { ICONS, COLORS } from '@/pages/project/ChatPage';

// 从 ChatPage 导出常量（如果没导出，先导出）
const ICONS: Record<string, string> = {
  Planner: '🧋', Retriever: '🐍', Coder: '🫻', Writer: '✍️',
  Tester: '✅', Summarizer: '🧊', Bot: '🤖', Executor: '⚙️',
};
const COLORS: Record<string, string> = {
  Planner: '#4f8cff', Retriever: '#8b5cf6', Coder: '#10b981',
  Writer: '#f59e0b', Tester: '#ef4444', Summarizer: '#4f8cff',
  Bot: '#10b981', Executor: '#8b5cf6',
};

interface AgentStep {
  name: string;
  status: 'waiting' | 'running' | 'done' | 'error';
  content?: string;
  elapsedMs?: number;
  tokenCount?: number;
}

interface PipelineTimelineProps {
  steps: AgentStep[];
  totalElapsedMs: number;
  totalTokens: number;
  taskType: string;
  complexity: string;
  onViewChat: () => void;
  onExport: () => void;
}

export function PipelineTimeline({
  steps, totalElapsedMs, totalTokens, taskType, complexity, onViewChat, onExport,
}: PipelineTimelineProps) {
  const maxElapsed = Math.max(...steps.map((s) => s.elapsedMs || 0), 1);

  return (
    <div className="p-4">
      {/* 概览 */}
      <div className="mb-4">
        <h2 className="text-lg font-bold text-[#1d1d1f]">执行监控</h2>
        <div className="flex gap-4 mt-2 text-xs text-[#81858c]">
          <span>🏷️ {taskType || '—'}</span>
          <span>📊 {complexity || '—'}</span>
          <span>⏱ {totalElapsedMs > 1000 ? `${(totalElapsedMs / 1000).toFixed(1)}s` : `${totalElapsedMs}ms`}</span>
          <span>🔤 {totalTokens} tokens</span>
        </div>
      </div>

      {/* 流水线 */}
      <div className="space-y-2">
        {steps.map((step, i) => (
          <div
            key={step.name}
            className="rounded-lg border border-[#e0e4e8] bg-white overflow-hidden transition-all"
          >
            <div className="flex items-center gap-3 p-3">
              {/* 状态图标 */}
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 ${
                step.status === 'running' ? 'bg-[#4f8cff]/10 text-[#4f8cff] animate-pulse' :
                step.status === 'done' ? 'bg-[#10b981]/10 text-[#10b981]' :
                step.status === 'error' ? 'bg-[#ef4444]/10 text-[#ef4444]' :
                'bg-[#f3f4f6] text-[#d0d4d8]'
              }`}>
                {step.status === 'running' ? '🔄' : step.status === 'done' ? '✅' : step.status === 'error' ? '❌' : '⏳'}
              </div>

              {/* Agent 信息 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[#1d1d1f]">
                    {ICONS[step.name] || '🔹'} {step.name}
                  </span>
                  {step.elapsedMs && (
                    <span className="text-[10px] text-[#9ca3af]">
                      {step.elapsedMs > 1000 ? `${(step.elapsedMs / 1000).toFixed(1)}s` : `${step.elapsedMs}ms`}
                    </span>
                  )}
                  {step.tokenCount && (
                    <span className="text-[10px] text-[#9ca3af]">{step.tokenCount} tokens</span>
                  )}
                </div>
                {/* 进度条 */}
                {step.elapsedMs && step.status !== 'waiting' && (
                  <div className="mt-1.5 h-1 bg-[#f0f2f5] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min((step.elapsedMs / maxElapsed) * 100, 100)}%`,
                        background: COLORS[step.name] || '#4f8cff',
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2 mt-4">
        <button
          className="btn btn-sm btn-outline"
          style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
          onClick={onViewChat}
        >
          💬 查看对话
        </button>
        <button
          className="btn btn-sm"
          style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }}
          onClick={onExport}
        >
          📄 导出报告
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 MonitorPage**

创建 `frontend/src/pages/project/MonitorPage.tsx`：

```tsx
import { useParams, useNavigate } from 'react-router-dom';
import { PipelineTimeline, type AgentStep } from '@/components/monitor/PipelineTimeline';
import { generateReportApi } from '@/api/client';
import { toast } from 'sonner';
import { useState } from 'react';

// 模拟数据（后续从 WebSocket/SSE 实时推送替换）
const MOCK_STEPS: AgentStep[] = [
  { name: 'Planner', status: 'done', elapsedMs: 2100, tokenCount: 850 },
  { name: 'Retriever', status: 'done', elapsedMs: 1200, tokenCount: 420 },
  { name: 'Coder', status: 'done', elapsedMs: 3500, tokenCount: 1800 },
  { name: 'Executor', status: 'done', elapsedMs: 400, tokenCount: 0 },
  { name: 'Tester', status: 'done', elapsedMs: 1800, tokenCount: 650 },
  { name: 'Summarizer', status: 'running', elapsedMs: 500, tokenCount: 200 },
];

export function MonitorPage() {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const report = await generateReportApi([]);
      // 下载为 Markdown 文件
      const blob = new Blob([report.content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report_${Date.now()}.md`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('报告已下载');
    } catch {
      toast.error('导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4">
      {/* 顶部导航 */}
      <div className="flex items-center gap-1 mb-4 text-sm">
        <button
          className="text-[#81858c] hover:text-[#1d1d1f] transition-colors"
          onClick={() => navigate(`/w/${workspaceId}/p/${projectId}/chat`)}
        >
          💬 对话
        </button>
        <span className="text-[#d0d4d8]">|</span>
        <span className="text-[#4f8cff] font-medium">📡 监控</span>
        <span className="text-[#d0d4d8]">|</span>
        <button
          className="text-[#81858c] hover:text-[#1d1d1f] transition-colors"
          onClick={() => navigate(`/w/${workspaceId}/p/${projectId}/eval`)}
        >
          📊 仪表盘
        </button>
      </div>

      <PipelineTimeline
        steps={MOCK_STEPS}
        totalElapsedMs={9500}
        totalTokens={3920}
        taskType="编程"
        complexity="高"
        onViewChat={() => navigate(`/w/${workspaceId}/p/${projectId}/chat`)}
        onExport={handleExport}
      />

      {exporting && (
        <div className="text-center mt-4">
          <span className="loading loading-spinner loading-sm text-[#4f8cff]" />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 注册路由**

修改 `frontend/src/routes/index.tsx`，增加监控页和仪表盘页路由：

```typescript
import { MonitorPage } from '@/pages/project/MonitorPage';
import { EvaluationPage } from '@/pages/project/EvaluationPage';

// 在 children 数组中增加:
{ path: 'w/:workspaceId/p/:projectId/monitor', element: <MonitorPage /> },
{ path: 'w/:workspaceId/p/:projectId/eval', element: <EvaluationPage /> },
```

- [ ] **Step 4: 从 ChatPage 跳转到监控页**

在 ChatPage 的右侧栏中，Agent 卡片标题旁加一个跳转链接，或理解页 Tab 切换栏加监控入口。先做最小实现：ChatPage 不主动跳转，用户通过 URL 或项目页内部链接进入。

> 后续可在 PipelineTimeline 中接入实时 SSE 数据（复用 `useStreamChat` 的 reader）。

- [ ] **Step 5: 验证**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npx tsc --noEmit
```

预期：`EvaluationPage` 未创建导致 import 错误。确认仅限于此。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/project/MonitorPage.tsx \
        frontend/src/components/monitor/PipelineTimeline.tsx \
        frontend/src/routes/index.tsx
git commit -m "feat(p1): SSE实时监控页 — PipelineTimeline时间轴 + 路由"
```

---

### Task 7: P1-4 — 评估仪表盘

**Files:**
- Modify: `user/db.py`
- Create/modify: `frontend/src/pages/project/EvaluationPage.tsx`
- Modify: `router/stream.py`

**Interfaces:**
- Consumes: `eval_logs` 表, `POST /api/eval/log`, `GET /api/eval/stats/{project_id}`
- Produces: Recharts 图表仪表盘

- [ ] **Step 1: 后端 — 数据库迁移 v4: eval_logs 表**

修改 `user/db.py`：

第 16 行：
```python
TARGET_SCHEMA_VERSION = 4
```

在 `_run_migration()` 中添加 v4 分支（在 v3 分支之后）：

```python
elif version == 4:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS eval_logs (
            id           TEXT PRIMARY KEY,
            project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            session_id   TEXT DEFAULT '',
            task_type    TEXT DEFAULT '',
            complexity   TEXT DEFAULT '',
            agent_count  INTEGER DEFAULT 0,
            total_tokens INTEGER DEFAULT 0,
            elapsed_ms   INTEGER DEFAULT 0,
            has_error    INTEGER DEFAULT 0,
            created_at   TEXT DEFAULT (datetime('now', 'localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_eval_project ON eval_logs(project_id);
        CREATE INDEX IF NOT EXISTS idx_eval_created ON eval_logs(created_at);
    """)
```

新增数据库方法（在 `# ── 管理员 ──` 部分之后）：

```python
    # ── 评估日志 ──

    def create_eval_log(self, project_id: str, session_id: str = "",
                        task_type: str = "", complexity: str = "",
                        agent_count: int = 0, total_tokens: int = 0,
                        elapsed_ms: int = 0, has_error: int = 0) -> str:
        eid = str(uuid.uuid4())[:8]
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO eval_logs (id, project_id, session_id, task_type, "
                "complexity, agent_count, total_tokens, elapsed_ms, has_error) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (eid, project_id, session_id, task_type, complexity,
                 agent_count, total_tokens, elapsed_ms, has_error),
            )
        return eid

    def get_eval_stats(self, project_id: str = "") -> dict:
        """返回聚合统计数据"""
        with self._conn() as conn:
            where = "WHERE project_id = ?" if project_id else ""
            params = (project_id,) if project_id else ()

            total = conn.execute(
                f"SELECT COUNT(*) FROM eval_logs {where}", params
            ).fetchone()[0]

            if total == 0:
                return {"total": 0, "avg_elapsed_ms": 0, "total_tokens": 0,
                        "error_rate": 0, "task_types": {}, "daily": []}

            avg_elapsed = conn.execute(
                f"SELECT AVG(elapsed_ms) FROM eval_logs {where}",
                params
            ).fetchone()[0] or 0

            sum_tokens = conn.execute(
                f"SELECT SUM(total_tokens) FROM eval_logs {where}",
                params
            ).fetchone()[0] or 0

            error_count = conn.execute(
                f"SELECT COUNT(*) FROM eval_logs {where} AND has_error = 1",
                params
            ).fetchone()[0]

            # 任务类型分布
            task_type_rows = conn.execute(
                f"SELECT task_type, COUNT(*) as cnt FROM eval_logs {where} "
                "GROUP BY task_type ORDER BY cnt DESC",
                params
            ).fetchall()

            # 每日趋势（最近 14 天）
            daily_rows = conn.execute(
                f"SELECT DATE(created_at) as day, COUNT(*) as cnt, "
                "AVG(elapsed_ms) as avg_ms "
                f"FROM eval_logs {where} "
                "GROUP BY day ORDER BY day DESC LIMIT 14",
                params
            ).fetchall()

            return {
                "total": total,
                "avg_elapsed_ms": round(avg_elapsed),
                "total_tokens": sum_tokens,
                "error_rate": round(error_count / total * 100, 1) if total > 0 else 0,
                "task_types": {r["task_type"]: r["cnt"] for r in task_type_rows},
                "daily": [dict(r) for r in daily_rows],
            }
```

- [ ] **Step 2: 后端 — eval API 路由**

在 `workspace/routes.py` 末尾（或新建 `eval/routes.py`）追加：

```python
# ──── 评估日志 ────

@project_router.post("/eval/log")
async def log_eval(request: Request, user: dict = Depends(require_auth)):
    """记录一次对话执行"""
    data = await request.json()
    db = _get_db(request)
    project_id = data.get("project_id", "")
    if project_id:
        proj = db.get_project(project_id)
        if proj:
            role = db.get_member_role(proj["workspace_id"], user["user_id"])
            if role is None and not db.is_admin(user["user_id"]):
                return JSONResponse({"error": "无权访问"}, status_code=403)
    
    eid = db.create_eval_log(
        project_id=project_id,
        session_id=data.get("session_id", ""),
        task_type=data.get("task_type", ""),
        complexity=data.get("complexity", ""),
        agent_count=data.get("agent_count", 0),
        total_tokens=data.get("total_tokens", 0),
        elapsed_ms=data.get("elapsed_ms", 0),
        has_error=1 if data.get("has_error") else 0,
    )
    return JSONResponse({"id": eid, "status": "ok"})


@project_router.get("/eval/stats/{project_id}")
async def get_eval_stats(
    request: Request,
    project_id: str,
    user: dict = Depends(require_auth),
):
    """获取项目评估统计"""
    db = _get_db(request)
    proj = db.get_project(project_id)
    if not proj:
        return JSONResponse({"error": "项目不存在"}, status_code=404)
    role = db.get_member_role(proj["workspace_id"], user["user_id"])
    if role is None and not db.is_admin(user["user_id"]):
        return JSONResponse({"error": "无权访问"}, status_code=403)
    
    stats = db.get_eval_stats(project_id)
    return JSONResponse(stats)
```

- [ ] **Step 3: 后端 — SSE done 时自动记录 eval**

修改 `router/stream.py` 的 `run_workflow_streaming`，在 `done` 推送后自动记录 eval log（可选，通过 `try/except` 包裹不阻塞主流程）：

```python
# 在 push(state, {"type": "done", ...}) 之后追加:

# 自动记录 eval log（不阻塞主流程）
try:
    from user.db import Database
    import os as _os
    db = Database(_os.path.join(_PROJECT_DIR, "data.db"))
    db.create_eval_log(
        project_id=data.get("project_id", ""),
        session_id=data.get("session_id", ""),
        task_type=task_type,
        complexity=complexity,
        agent_count=len(result_state.get("thinking", [])),
        total_tokens=sum(
            t.get("token_count", 0) if isinstance(t, dict) else 0
            for t in result_state.get("thinking", [])
        ),
        elapsed_ms=0,
        has_error=0,
    )
except Exception:
    logger.warning("stream | eval log 记录失败", exc_info=True)
```

- [ ] **Step 4: 前端 — 安装 recharts**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npm install recharts
```

- [ ] **Step 5: 前端 — EvaluationPage**

创建 `frontend/src/pages/project/EvaluationPage.tsx`：

```tsx
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/api/client';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, LineChart, Line, ResponsiveContainer, Legend,
} from 'recharts';

const PIE_COLORS = ['#4f8cff', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

interface EvalStats {
  total: number;
  avg_elapsed_ms: number;
  total_tokens: number;
  error_rate: number;
  task_types: Record<string, number>;
  daily: Array<{ day: string; cnt: number; avg_ms: number }>;
}

export function EvaluationPage() {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['eval-stats', projectId],
    queryFn: async () => {
      const res = await apiClient.get<EvalStats>(`/eval/stats/${projectId}`);
      return res.data;
    },
    enabled: !!projectId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="loading loading-spinner loading-lg text-[#4f8cff]" />
      </div>
    );
  }

  const stats = data;
  const pieData = stats?.task_types
    ? Object.entries(stats.task_types).map(([name, value]) => ({ name, value }))
    : [];

  return (
    <div className="max-w-4xl mx-auto p-4">
      {/* 导航 */}
      <div className="flex items-center gap-1 mb-4 text-sm">
        <button
          className="text-[#81858c] hover:text-[#1d1d1f] transition-colors"
          onClick={() => navigate(`/w/${workspaceId}/p/${projectId}/chat`)}
        >
          💬 对话
        </button>
        <span className="text-[#d0d4d8]">|</span>
        <button
          className="text-[#81858c] hover:text-[#1d1d1f] transition-colors"
          onClick={() => navigate(`/w/${workspaceId}/p/${projectId}/monitor`)}
        >
          📡 监控
        </button>
        <span className="text-[#d0d4d8]">|</span>
        <span className="text-[#4f8cff] font-medium">📊 仪表盘</span>
      </div>

      {/* 概览卡片 */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: '总执行次数', value: stats?.total ?? 0 },
          { label: '平均耗时', value: stats ? `${(stats.avg_elapsed_ms / 1000).toFixed(1)}s` : '—' },
          { label: 'Token 总量', value: stats ? `${(stats.total_tokens / 1000).toFixed(0)}K` : '—' },
          { label: '错误率', value: stats ? `${stats.error_rate}%` : '—' },
        ].map((card) => (
          <div key={card.label} className="card bg-base-100 border border-[#e0e4e8] shadow-sm">
            <div className="card-body p-4 text-center">
              <div className="text-xs text-[#81858c]">{card.label}</div>
              <div className="text-xl font-bold text-[#1d1d1f] mt-1">{card.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 图表 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 任务类型分布 */}
        <div className="card bg-base-100 border border-[#e0e4e8] shadow-sm">
          <div className="card-body p-4">
            <h3 className="text-sm font-semibold text-[#1d1d1f] mb-2">任务类型分布</h3>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name} ${value}`}>
                    {pieData.map((_, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-12 text-[#b0b8c1] text-sm">暂无数据</div>
            )}
          </div>
        </div>

        {/* 每日趋势 */}
        <div className="card bg-base-100 border border-[#e0e4e8] shadow-sm">
          <div className="card-body p-4">
            <h3 className="text-sm font-semibold text-[#1d1d1f] mb-2">每日趋势（近 14 天）</h3>
            {stats?.daily && stats.daily.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={[...stats.daily].reverse()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="cnt" stroke="#4f8cff" name="执行次数" strokeWidth={2} />
                  <Line type="monotone" dataKey="avg_ms" stroke="#10b981" name="平均耗时(ms)" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-12 text-[#b0b8c1] text-sm">暂无数据</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: 确保 eval API 注册到 main.py**

`workspace/routes.py` 中的 `project_router` 通过 `prefix="/api"` 已注册，`/eval/log` 和 `/eval/stats/{project_id}` 路由会自动映射到 `/api/eval/log` 和 `/api/eval/stats/{id}`。无需额外操作。

- [ ] **Step 7: 验证**

```bash
cd "D:\AI\Internship\Multi_Agent" && python -c "
from user.db import Database
db = Database(':memory:')
print('DB OK, version:', db.TARGET_SCHEMA_VERSION)
"
```

```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add user/db.py workspace/routes.py router/stream.py \
        frontend/src/pages/project/EvaluationPage.tsx frontend/src/routes/index.tsx \
        frontend/package.json
git commit -m "feat(p1): 评估仪表盘 — eval_logs表 + Recharts图表 + SSE自动记录"
```

---

### Task 8: P1-5 — 右侧栏会话信息 Tab + 文件 Tab + 报告导出

**Files:**
- Create: `frontend/src/components/layout/RightPanel/SessionInfoTab.tsx`
- Create: `frontend/src/components/layout/RightPanel/FilesTab.tsx`
- Create: `frontend/src/lib/exportReport.ts`

**Interfaces:**
- Consumes: `streaming` state（agentStats, thinkingOrder）, `generateReportApi`
- Produces: 会话信息展示 + Markdown 导出 + 文件列表

- [ ] **Step 1: 创建 SessionInfoTab**

创建 `frontend/src/components/layout/RightPanel/SessionInfoTab.tsx`：

```tsx
interface SessionInfoTabProps {
  taskType: string;
  complexity: string;
  agentStats: Map<string, { elapsed_ms: number; token_count: number }>;
  thinkingOrder: string[];
  onExport: () => void;
}

export function SessionInfoTab({
  taskType, complexity, agentStats, thinkingOrder, onExport,
}: SessionInfoTabProps) {
  const totalTokens = Array.from(agentStats.values())
    .reduce((sum, s) => sum + s.token_count, 0);
  const totalElapsed = Array.from(agentStats.values())
    .reduce((sum, s) => sum + s.elapsed_ms, 0);

  return (
    <div>
      <h3 className="text-sm font-semibold text-[#1d1d1f] mb-3">会话信息</h3>

      {/* 任务信息 */}
      <div className="space-y-2 mb-4">
        <div className="flex justify-between text-xs">
          <span className="text-[#81858c]">任务类型</span>
          <span className="text-[#1d1d1f] font-medium">
            {taskType ? { '编程': '💻', '写作': '📝', '分析': '📊', '问答': '💬' }[taskType] + ' ' + taskType : '—'}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-[#81858c]">复杂度</span>
          <span className="text-[#1d1d1f] font-medium">{complexity || '—'}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-[#81858c]">总耗时</span>
          <span className="text-[#1d1d1f] font-medium">
            {totalElapsed > 1000 ? `${(totalElapsed / 1000).toFixed(1)}s` : `${totalElapsed}ms`}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-[#81858c]">Token 消耗</span>
          <span className="text-[#1d1d1f] font-medium">{totalTokens.toLocaleString()}</span>
        </div>
      </div>

      {/* Agent 执行顺序 */}
      {thinkingOrder.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-medium text-[#81858c] mb-2">执行顺序</h4>
          <div className="flex flex-wrap gap-1">
            {thinkingOrder.map((name, i) => (
              <span key={name} className="text-[10px] px-1.5 py-0.5 rounded bg-[#f0f2f5] text-[#81858c]">
                {name}
                {i < thinkingOrder.length - 1 && ' →'}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Agent 统计 */}
      {agentStats.size > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-medium text-[#81858c] mb-2">Agent 统计</h4>
          <div className="space-y-1">
            {Array.from(agentStats.entries()).map(([name, stats]) => (
              <div key={name} className="flex justify-between text-[10px]">
                <span className="text-[#81858c]">{name}</span>
                <span className="text-[#1d1d1f]">
                  {stats.elapsed_ms > 1000 ? `${(stats.elapsed_ms / 1000).toFixed(1)}s` : `${stats.elapsed_ms}ms`}
                  {' · '}
                  {stats.token_count} tokens
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 导出按钮 */}
      <button
        className="btn btn-sm w-full"
        style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }}
        onClick={onExport}
      >
        📄 导出报告
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 创建 FilesTab**

创建 `frontend/src/components/layout/RightPanel/FilesTab.tsx`：

```tsx
import { useQuery } from '@tanstack/react-query';
import { knowledgeApi, type KnowledgeFile } from '@/api/knowledge';

interface FilesTabProps {
  projectId: string;
}

export function FilesTab({ projectId }: FilesTabProps) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['knowledge-files', projectId],
    queryFn: async () => {
      const res = await knowledgeApi.listFiles();
      return res.data;
    },
    enabled: !!projectId,
  });

  const handleDownload = (filename: string) => {
    window.open(`/api/knowledge/files/${encodeURIComponent(filename)}`, '_blank');
  };

  const handleDelete = async (filename: string) => {
    try {
      await knowledgeApi.deleteFile(filename);
      refetch();
    } catch {
      // ignore
    }
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-[#1d1d1f] mb-3">项目文件</h3>

      {isLoading ? (
        <div className="text-center py-4">
          <span className="loading loading-spinner loading-sm text-[#4f8cff]" />
        </div>
      ) : !data || data.length === 0 ? (
        <p className="text-xs text-[#b0b8c1] text-center py-8">暂无文件</p>
      ) : (
        <div className="space-y-1">
          {data.map((f: KnowledgeFile) => (
            <div
              key={f.name}
              className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-[#f9fafb] transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="text-xs text-[#1d1d1f] truncate">{f.name}</div>
                <div className="text-[10px] text-[#9ca3af]">
                  {f.size > 1024 ? `${(f.size / 1024).toFixed(1)}KB` : `${f.size}B`}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  className="text-[10px] px-2 py-0.5 rounded text-[#4f8cff] hover:bg-[#4f8cff]/5 transition-colors"
                  onClick={() => handleDownload(f.name)}
                >
                  下载
                </button>
                <button
                  className="text-[10px] px-2 py-0.5 rounded text-[#ef4444] hover:bg-[#ef4444]/5 transition-colors"
                  onClick={() => handleDelete(f.name)}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 上传按钮 */}
      <button
        className="btn btn-ghost btn-sm w-full mt-3 text-xs text-[#81858c]"
        style={{ borderRadius: '10px' }}
        onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.multiple = true;
          input.onchange = async () => {
            if (input.files) {
              for (const f of Array.from(input.files)) {
                try { await knowledgeApi.upload(f); } catch { /* ignore */ }
              }
              refetch();
            }
          };
          input.click();
        }}
      >
        📤 上传文件
      </button>
    </div>
  );
}
```

- [ ] **Step 3: 创建报告导出工具**

创建 `frontend/src/lib/exportReport.ts`：

```typescript
export function exportMarkdownReport(
  userInput: string,
  taskType: string,
  complexity: string,
  thinking: Array<{ name: string; content: string }>,
  finalOutput: string,
  agentStats: Map<string, { elapsed_ms: number; token_count: number }>,
) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const totalElapsed = Array.from(agentStats.values())
    .reduce((s, v) => s + v.elapsed_ms, 0);
  const totalTokens = Array.from(agentStats.values())
    .reduce((s, v) => s + v.token_count, 0);

  const lines = [
    `# Multi-Agent 执行报告`,
    '',
    `> 生成时间: ${now}`,
    '',
    '## 概览',
    '',
    `| 项目 | 值 |`,
    `|------|-----|`,
    `| 用户输入 | ${userInput.slice(0, 100)} |`,
    `| 任务类型 | ${taskType} |`,
    `| 复杂度 | ${complexity} |`,
    `| 总耗时 | ${totalElapsed > 1000 ? (totalElapsed / 1000).toFixed(1) + 's' : totalElapsed + 'ms'} |`,
    `| Token 消耗 | ${totalTokens.toLocaleString()} |`,
    `| Agent 数量 | ${thinking.length} |`,
    '',
    '## Agent 执行过程',
    '',
  ];

  for (const t of thinking) {
    const stats = agentStats.get(t.name);
    const elapsed = stats
      ? (stats.elapsed_ms > 1000 ? `${(stats.elapsed_ms / 1000).toFixed(1)}s` : `${stats.elapsed_ms}ms`)
      : '';
    lines.push(`### ${t.name} ${elapsed ? `(${elapsed})` : ''}`);
    lines.push('');
    // 截取代码块等内容
    const content = t.content.length > 5000
      ? t.content.slice(0, 5000) + '\n\n*(内容过长，已截断)*'
      : t.content;
    lines.push(content);
    lines.push('');
  }

  if (finalOutput) {
    lines.push('## 最终输出');
    lines.push('');
    lines.push(finalOutput);
    lines.push('');
  }

  // 下载
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeFilename = userInput.slice(0, 30).replace(/[^a-zA-Z0-9一-鿿]/g, '_');
  a.download = `report_${safeFilename}_${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: 连接 ChatPage 右上角按钮调用导出**

在 ChatPage 中，右侧栏 SessionInfoTab 的 `onExport` prop 连接到 `exportMarkdownReport`：

```typescript
const handleExportReport = useCallback(() => {
  const lastUserMsg = messages.findLast((m) => m.role === 'user');
  const lastAssistMsg = messages.findLast((m) => m.role === 'assistant');
  const thinkingArr = lastAssistMsg?.thinking || [];

  exportMarkdownReport(
    lastUserMsg?.content || '',
    lastTaskType,
    lastComplexity,
    thinkingArr,
    lastAssistMsg?.content || '',
    streaming.agentStats,
  );
}, [messages, lastTaskType, lastComplexity, streaming.agentStats]);
```

- [ ] **Step 5: 验证**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/layout/RightPanel/SessionInfoTab.tsx \
        frontend/src/components/layout/RightPanel/FilesTab.tsx \
        frontend/src/lib/exportReport.ts \
        frontend/src/pages/project/ChatPage.tsx
git commit -m "feat(p1): 右侧栏会话信息Tab + 文件Tab + Markdown报告导出"
```

---

### Task 9: P1-6 — 编排画布（React Flow 拖拽 DAG）

**Files:**
- Create: `frontend/src/pages/project/OrchestrationPage.tsx`
- Create: `frontend/src/components/orchestra/Canvas.tsx`
- Create: `frontend/src/components/orchestra/nodes/StartNode.tsx`
- Create: `frontend/src/components/orchestra/nodes/AgentNode.tsx`
- Create: `frontend/src/components/orchestra/nodes/RouterNode.tsx`
- Create: `frontend/src/components/orchestra/NodePalette.tsx`
- Create: `frontend/src/components/orchestra/RouterEditor.tsx`
- Modify: `router/stream_graph.py` (升级为 `build_stream_workflow(pipeline_json)`, 见 Task 5)
- Modify: `frontend/src/routes/index.tsx`
- Modify: `frontend/src/pages/project/ChatPage.tsx` (顶部 Tab 增加编排入口)
- Modify: `frontend/src/index.css` (编排画布样式)
- Modify: `frontend/package.json` (新增 `@xyflow/react`)

**Interfaces:**
- Consumes: `projectsApi.getAgentConfig/updateAgentConfig` (Task 5 定义), `build_stream_workflow(pipeline_json)` (Task 5 升级)
- Produces: 可视化拖拽编排画布, 将编排 JSON 存入 `project.agent_config`, SSE 对话时后端按 JSON 编译动态图

**核心数据模型:**

```typescript
// 流水线 JSON 结构
interface PipelineNode {
  id: string;
  type: 'start' | 'agent' | 'router';
  position: { x: number; y: number };
  data: {
    agent?: string;           // Agent 节点用: 'Planner'|'Retriever'|...
    routes?: RouteCondition[]; // Router 节点用
  };
}

interface RouteCondition {
  id: string;
  condition: '编程' | '写作' | '分析' | '问答' | 'default';
  target: string;  // 目标节点 id
}

interface PipelineEdge {
  id: string;
  source: string;
  target: string;
  type?: 'loop';  // loop = 修复循环边（虚线+箭头）
}

interface PipelineConfig {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

// 默认流水线（8 Agent 标准拓扑）
const DEFAULT_PIPELINE: PipelineConfig = {
  nodes: [
    { id: 'start',      type: 'start',  position: { x: 300, y: 0 },   data: {} },
    { id: 'planner',    type: 'agent',  position: { x: 300, y: 100 }, data: { agent: 'Planner' } },
    { id: 'retriever',  type: 'agent',  position: { x: 300, y: 220 }, data: { agent: 'Retriever' } },
    { id: 'route_1',    type: 'router', position: { x: 300, y: 340 }, data: {
      routes: [
        { id: 'r1', condition: '编程', target: 'coder' },
        { id: 'r2', condition: '分析', target: 'coder' },
        { id: 'r3', condition: '写作', target: 'writer' },
        { id: 'r4', condition: 'default', target: 'summarizer' },
      ]
    }},
    { id: 'coder',      type: 'agent',  position: { x: 120, y: 460 }, data: { agent: 'Coder' } },
    { id: 'writer',     type: 'agent',  position: { x: 480, y: 460 }, data: { agent: 'Writer' } },
    { id: 'executor',   type: 'agent',  position: { x: 120, y: 580 }, data: { agent: 'Executor' } },
    { id: 'tester',     type: 'agent',  position: { x: 120, y: 700 }, data: { agent: 'Tester' } },
    { id: 'summarizer', type: 'agent',  position: { x: 300, y: 820 }, data: { agent: 'Summarizer' } },
    { id: 'bot',        type: 'agent',  position: { x: 600, y: 100 }, data: { agent: 'Bot' } },
  ],
  edges: [
    { id: 'e1',  source: 'start',     target: 'planner' },
    { id: 'e2',  source: 'planner',   target: 'retriever' },
    { id: 'e3',  source: 'retriever', target: 'route_1' },
    { id: 'e4',  source: 'coder',     target: 'executor' },
    { id: 'e5',  source: 'executor',  target: 'tester' },
    { id: 'e6',  source: 'tester',    target: 'summarizer' },
    { id: 'e7',  source: 'writer',    target: 'tester' },
  ],
};
```

**后端编译逻辑** (`router/stream_graph.py`):

`build_stream_workflow` 接收 `pipeline: dict`（PipelineConfig JSON），遍历 nodes/edges 动态构建 LangGraph:

```python
def build_stream_workflow(pipeline: dict = None) -> StateGraph:
    """从流水线 JSON 编译 LangGraph StateGraph。
    
    无 pipeline → 使用默认 8 Agent 拓扑。
    有 pipeline → 遍历 nodes 创建节点，遍历 edges 创建边，
    Router 节点生成 conditional_edges。
    """
    if pipeline is None:
        # 使用默认拓扑（当前 build_stream_workflow 的逻辑）
        from router.stream_graph import _build_default_workflow
        return _build_default_workflow()
    
    nodes = pipeline.get("nodes", [])
    edges = pipeline.get("edges", [])
    
    # 建立 node_id → node 映射
    node_map = {n["id"]: n for n in nodes}
    
    wf = StateGraph(StreamWorkflowState)
    
    # 遍历创建节点
    for node in nodes:
        ntype = node.get("type", "agent")
        nid = node["id"]
        if ntype == "start":
            continue  # start 是逻辑入口，不是 LangGraph 节点
        elif ntype == "agent":
            agent_name = node.get("data", {}).get("agent", "")
            handler = _get_agent_handler(agent_name)
            if handler:
                wf.add_node(nid, handler)
        elif ntype == "router":
            pass  # router 只用 conditional_edges 表达，不创建实体节点
    
    # 设置入口
    wf.set_entry_point("planner" if node_map.get("planner") else 
                        next(n["id"] for n in nodes if n["type"] == "agent"))
    
    # 遍历创建边
    for edge in edges:
        src = edge["source"]
        tgt = edge["target"]
        src_node = node_map.get(src)
        
        if src_node and src_node.get("type") == "router":
            # Router → conditional_edges
            routes = src_node.get("data", {}).get("routes", [])
            route_map = {r["condition"]: r["target"] for r in routes}
            default_target = route_map.pop("default", END)
            
            def make_router(rmap, default):
                def router_fn(state):
                    task_type = state.get("task_type", "编程")
                    return rmap.get(task_type, default)
                return router_fn
            
            wf.add_conditional_edges(src, make_router(route_map, default_target))
        elif src_node and src_node.get("type") == "start":
            # start → 第一个 Agent
            wf.add_edge("__start__", tgt) if tgt != "__start__" else None
        else:
            wf.add_edge(src, tgt)
    
    # 为 agent 节点添加 END 边（如果它没有出边）
    all_sources = {e["source"] for e in edges}
    all_targets = {e["target"] for e in edges}
    for node in nodes:
        if node.get("type") == "agent" and node["id"] not in all_sources:
            wf.add_edge(node["id"], END)
    
    return wf.compile()


def _get_agent_handler(agent_name: str):
    """Agent 名称 → 节点处理函数映射"""
    handlers = {
        "Bot": bot_node, "Planner": planner_node,
        "Retriever": retriever_node, "Coder": coder_node,
        "Writer": writer_node, "Executor": executor_node,
        "Tester": tester_node, "Summarizer": summarizer_node,
    }
    return handlers.get(agent_name)
```

- [ ] **Step 1: 安装 React Flow**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npm install @xyflow/react
```

- [ ] **Step 2: 创建自定义节点组件**

创建 `frontend/src/components/orchestra/nodes/StartNode.tsx`:

```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';

export function StartNode({ data }: NodeProps) {
  return (
    <div className="px-4 py-2 rounded-full bg-[#10b981] text-white text-sm font-medium shadow-sm">
      <Handle type="source" position={Position.Bottom} className="!bg-[#10b981]" />
      🚀 开始
    </div>
  );
}
```

创建 `frontend/src/components/orchestra/nodes/AgentNode.tsx`:

```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo } from 'react';

const ICONS: Record<string, string> = {
  Planner: '🧋', Retriever: '🐍', Coder: '🫻', Writer: '✍️',
  Tester: '✅', Summarizer: '🧊', Bot: '🤖', Executor: '⚙️',
};
const COLORS: Record<string, string> = {
  Planner: '#4f8cff', Retriever: '#8b5cf6', Coder: '#10b981',
  Writer: '#f59e0b', Tester: '#ef4444', Summarizer: '#4f8cff',
  Bot: '#10b981', Executor: '#8b5cf6',
};

export const AgentNode = memo(({ data, selected }: NodeProps) => {
  const agent = (data.agent as string) || '?';
  const color = COLORS[agent] || '#6b7280';
  return (
    <div
      className="px-3 py-2 rounded-xl border-2 bg-white shadow-sm min-w-[130px] text-center transition-shadow cursor-grab"
      style={{ borderColor: selected ? color : '#e0e4e8', boxShadow: selected ? `0 0 0 3px ${color}20` : '' }}
    >
      <Handle type="target" position={Position.Top} className="!bg-[#9ca3af]" />
      <div className="flex items-center gap-1.5 justify-center">
        <span className="text-sm">{ICONS[agent] || '🔹'}</span>
        <span className="text-xs font-semibold text-[#1d1d1f]">{agent}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-[#9ca3af]" />
    </div>
  );
});
```

创建 `frontend/src/components/orchestra/nodes/RouterNode.tsx`:

```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo } from 'react';

export const RouterNode = memo(({ data, selected }: NodeProps) => {
  const routes = (data.routes as Array<{ condition: string; target: string }>) || [];
  const nonDefault = routes.filter((r) => r.condition !== 'default');
  const defaultRoute = routes.find((r) => r.condition === 'default');

  return (
    <div
      className="px-3 py-2 bg-white shadow-sm min-w-[140px] text-center transition-shadow"
      style={{
        border: `2px solid ${selected ? '#f59e0b' : '#e0e4e8'}`,
        borderRadius: '12px',
        transform: 'rotate(0deg)',
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-[#f59e0b]" />
      <div className="text-xs font-semibold text-[#f59e0b] mb-1">◇ 条件分支</div>
      <div className="space-y-0.5">
        {nonDefault.slice(0, 3).map((r) => (
          <div key={r.condition} className="text-[10px] text-[#81858c]">
            {r.condition} →
          </div>
        ))}
        {defaultRoute && (
          <div className="text-[10px] text-[#9ca3af] italic">
            默认 → {defaultRoute.target}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-[#f59e0b]" />
    </div>
  );
});
```

- [ ] **Step 3: 创建节点面板 (NodePalette)**

创建 `frontend/src/components/orchestra/NodePalette.tsx`:

```tsx
import { type DragEvent } from 'react';

const PALETTE_ITEMS = [
  { type: 'agent', agent: 'Planner', icon: '🧋' },
  { type: 'agent', agent: 'Retriever', icon: '🐍' },
  { type: 'agent', agent: 'Coder', icon: '🫻' },
  { type: 'agent', agent: 'Writer', icon: '✍️' },
  { type: 'agent', agent: 'Executor', icon: '⚙️' },
  { type: 'agent', agent: 'Tester', icon: '✅' },
  { type: 'agent', agent: 'Summarizer', icon: '🧊' },
  { type: 'agent', agent: 'Bot', icon: '🤖' },
  { type: 'router', agent: 'Router', icon: '◇' },
];

export function NodePalette() {
  const onDragStart = (event: DragEvent, item: typeof PALETTE_ITEMS[0]) => {
    event.dataTransfer.setData('application/reactflow-type', item.type);
    event.dataTransfer.setData('application/reactflow-agent', item.agent || '');
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="p-3">
      <h3 className="text-xs font-semibold text-[#81858c] mb-2 uppercase tracking-wider">节点</h3>
      <div className="space-y-1">
        {PALETTE_ITEMS.map((item) => (
          <div
            key={item.agent}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#e0e4e8] bg-white cursor-grab hover:border-[#4f8cff] hover:shadow-sm transition-all text-xs"
            draggable
            onDragStart={(e) => onDragStart(e, item)}
          >
            <span>{item.icon}</span>
            <span className="text-[#1d1d1f] font-medium">{item.agent}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-[#eceef2]">
        <p className="text-[10px] text-[#9ca3af] leading-relaxed">
          拖拽节点到画布上，连线构建流水线。双击 Router 节点编辑条件分支。
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 创建 Router 编辑弹窗**

创建 `frontend/src/components/orchestra/RouterEditor.tsx`:

```tsx
import { useState, useEffect } from 'react';
import type { RouteCondition } from '@/pages/project/OrchestrationPage';

interface RouterEditorProps {
  routes: RouteCondition[];
  agentNodes: string[];  // 可用的 Agent 节点 id 列表
  onSave: (routes: RouteCondition[]) => void;
  onClose: () => void;
}

const CONDITIONS = ['编程', '写作', '分析', '问答'];

export function RouterEditor({ routes, agentNodes, onSave, onClose }: RouterEditorProps) {
  const [editRoutes, setEditRoutes] = useState<RouteCondition[]>([...routes]);

  useEffect(() => {
    setEditRoutes([...routes]);
  }, [routes]);

  const updateRoute = (id: string, field: 'condition' | 'target', value: string) => {
    setEditRoutes((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  const addRoute = () => {
    const usedConditions = editRoutes.map((r) => r.condition);
    const available = CONDITIONS.find((c) => !usedConditions.includes(c)) || '编程';
    setEditRoutes((prev) => [
      ...prev.filter((r) => r.condition !== 'default'),
      { id: `r_${Date.now()}`, condition: available, target: agentNodes[0] || '' },
      ...prev.filter((r) => r.condition === 'default'),
    ]);
  };

  const removeRoute = (id: string) => {
    setEditRoutes((prev) => prev.filter((r) => r.id !== id && r.condition !== 'default'));
  };

  const nonDefault = editRoutes.filter((r) => r.condition !== 'default');
  const defaultRoute = editRoutes.find((r) => r.condition === 'default');

  return (
    <dialog open className="modal modal-open">
      <div className="modal-box" style={{ borderRadius: '16px', padding: 0, overflow: 'hidden', maxWidth: '420px' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="text-base font-semibold text-[#1d1d1f]">编辑条件分支</h3>
          <button
            className="w-7 h-7 rounded-full border-none bg-transparent text-[#9ca3af] cursor-pointer flex items-center justify-center text-sm hover:bg-[#f3f4f6]"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="p-5 space-y-4">
          {nonDefault.map((r) => (
            <div key={r.id} className="flex items-center gap-2">
              <span className="text-xs text-[#81858c] shrink-0">如果任务类型是</span>
              <select
                className="select select-bordered select-xs flex-1"
                style={{ borderRadius: '8px' }}
                value={r.condition}
                onChange={(e) => updateRoute(r.id, 'condition', e.target.value)}
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c} disabled={editRoutes.some((x) => x.condition === c && x.id !== r.id)}>
                    {c}
                  </option>
                ))}
              </select>
              <span className="text-xs text-[#81858c] shrink-0">→</span>
              <select
                className="select select-bordered select-xs flex-1"
                style={{ borderRadius: '8px' }}
                value={r.target}
                onChange={(e) => updateRoute(r.id, 'target', e.target.value)}
              >
                {agentNodes.map((nid) => (
                  <option key={nid} value={nid}>{nid}</option>
                ))}
              </select>
              <button
                className="text-[#9ca3af] hover:text-[#ef4444] shrink-0"
                onClick={() => removeRoute(r.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="text-xs text-[#4f8cff] hover:underline"
            onClick={addRoute}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
            disabled={nonDefault.length >= CONDITIONS.length}
          >
            + 添加分支
          </button>
          {/* 默认流向 */}
          <div className="flex items-center gap-2 pt-3 border-t border-[#eceef2]">
            <span className="text-xs text-[#81858c] shrink-0">都不匹配时流向</span>
            <select
              className="select select-bordered select-xs flex-1"
              style={{ borderRadius: '8px' }}
              value={defaultRoute?.target || ''}
              onChange={(e) => {
                setEditRoutes((prev) => [
                  ...prev.filter((r) => r.condition !== 'default'),
                  { id: 'default', condition: 'default', target: e.target.value },
                ]);
              }}
            >
              {agentNodes.map((nid) => (
                <option key={nid} value={nid}>{nid}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 pb-5">
          <button
            className="btn btn-ghost btn-sm"
            style={{ borderRadius: '10px' }}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="btn btn-sm"
            style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }}
            onClick={() => { onSave(editRoutes); onClose(); }}
          >
            确定
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </dialog>
  );
}
```

- [ ] **Step 5: 创建画布容器 (Canvas)**

创建 `frontend/src/components/orchestra/Canvas.tsx`:

```tsx
import { useCallback, useRef, type DragEvent } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge,
  type Node, type Edge, type Connection,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { StartNode } from './nodes/StartNode';
import { AgentNode } from './nodes/AgentNode';
import { RouterNode } from './nodes/RouterNode';
import { RouterEditor } from './RouterEditor';
import { useState } from 'react';
import type { PipelineConfig, RouteCondition } from '@/pages/project/OrchestrationPage';

const nodeTypes = {
  start: StartNode,
  agent: AgentNode,
  router: RouterNode,
};

interface CanvasProps {
  pipeline: PipelineConfig;
  onChange: (pipeline: PipelineConfig) => void;
}

export function Canvas({ pipeline, onChange }: CanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(
    pipeline.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
    })) as Node[]
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    pipeline.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type || 'smoothstep',
      animated: e.type === 'loop',
      style: e.type === 'loop'
        ? { stroke: '#f59e0b', strokeDasharray: '5,5', strokeWidth: 2 }
        : { stroke: '#9ca3af', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: e.type === 'loop' ? '#f59e0b' : '#9ca3af' },
    })) as Edge[]
  );

  const [routerEdit, setRouterEdit] = useState<{
    nodeId: string;
    routes: RouteCondition[];
  } | null>(null);

  const idCounter = useRef(1);

  // 拖入新节点
  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow-type');
      const agent = event.dataTransfer.getData('application/reactflow-agent');
      if (!type) return;

      const position = { x: event.clientX - 350, y: event.clientY - 120 };
      const newId = `${type}_${idCounter.current++}`;

      const newNode: Node = {
        id: newId,
        type,
        position,
        data: type === 'agent' ? { agent } : { routes: [] },
      };
      setNodes((nds) => [...nds, newNode]);

      // 通知父组件
      onChange(syncToParent());
    },
    [nodes, edges]
  );

  // 连线
  const onConnect = useCallback(
    (params: Connection) => {
      const newEdge: Edge = {
        ...params,
        id: `e_${idCounter.current++}`,
        type: 'smoothstep',
        style: { stroke: '#9ca3af', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#9ca3af' },
      };
      setEdges((eds) => addEdge(newEdge, eds));
      onChange(syncToParent());
    },
    [nodes, edges]
  );

  // 双击 Router 节点编辑条件
  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === 'router') {
        const agentNodeIds = nodes
          .filter((n) => n.type === 'agent')
          .map((n) => n.id);
        setRouterEdit({
          nodeId: node.id,
          routes: (node.data.routes as RouteCondition[]) || [
            { id: 'default', condition: 'default', target: agentNodeIds[0] || '' },
          ],
        });
      }
    },
    [nodes]
  );

  // 删除节点/边 (按 Delete/Backspace)
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        // React Flow 内部处理 selected 节点/边删除
        onChange(syncToParent());
      }
    },
    [nodes, edges]
  );

  const syncToParent = useCallback((): PipelineConfig => {
    const pn: PipelineConfig['nodes'] = nodes.map((n) => ({
      id: n.id,
      type: (n.type as 'start' | 'agent' | 'router') || 'agent',
      position: n.position,
      data: n.data as { agent?: string; routes?: RouteCondition[] },
    }));
    const pe: PipelineConfig['edges'] = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: (e.type === 'loop' ? 'loop' : undefined) as 'loop' | undefined,
    }));
    return { nodes: pn, edges: pe };
  }, [nodes, edges]);

  const handleRouterSave = (routes: RouteCondition[]) => {
    if (!routerEdit) return;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === routerEdit.nodeId
          ? { ...n, data: { ...n.data, routes } }
          : n
      )
    );
    setRouterEdit(null);
    onChange(syncToParent());
  };

  return (
    <div style={{ width: '100%', height: '100%' }} onDragOver={onDragOver} onDrop={onDrop} onKeyDown={onKeyDown} tabIndex={0}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDoubleClick={onNodeDoubleClick}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode="Shift"
      >
        <Background color="#f0f2f5" gap={24} />
        <Controls className="!rounded-lg !border-[#e0e4e8] !shadow-sm" />
        <MiniMap
          className="!rounded-lg !border-[#e0e4e8]"
          nodeColor={(n) => {
            if (n.type === 'start') return '#10b981';
            if (n.type === 'router') return '#f59e0b';
            return '#4f8cff';
          }}
        />
      </ReactFlow>

      {routerEdit && (
        <RouterEditor
          routes={routerEdit.routes}
          agentNodes={nodes.filter((n) => n.type === 'agent').map((n) => n.id)}
          onSave={handleRouterSave}
          onClose={() => setRouterEdit(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: 创建 OrchestrationPage**

创建 `frontend/src/pages/project/OrchestrationPage.tsx`:

```tsx
import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '@/api/projects';
import { Canvas } from '@/components/orchestra/Canvas';
import { NodePalette } from '@/components/orchestra/NodePalette';
import { toast } from 'sonner';

export interface RouteCondition {
  id: string;
  condition: string;
  target: string;
}

export interface PipelineConfig {
  nodes: Array<{
    id: string;
    type: 'start' | 'agent' | 'router';
    position: { x: number; y: number };
    data: { agent?: string; routes?: RouteCondition[] };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type?: 'loop';
  }>;
}

const DEFAULT_PIPELINE: PipelineConfig = {
  nodes: [
    { id: 'start', type: 'start', position: { x: 300, y: 0 }, data: {} },
    { id: 'planner', type: 'agent', position: { x: 300, y: 100 }, data: { agent: 'Planner' } },
    { id: 'retriever', type: 'agent', position: { x: 300, y: 220 }, data: { agent: 'Retriever' } },
    { id: 'route_1', type: 'router', position: { x: 300, y: 340 }, data: { routes: [
      { id: 'r1', condition: '编程', target: 'coder' },
      { id: 'r2', condition: '分析', target: 'coder' },
      { id: 'r3', condition: '写作', target: 'writer' },
      { id: 'r4', condition: 'default', target: 'summarizer' },
    ]}},
    { id: 'coder', type: 'agent', position: { x: 120, y: 460 }, data: { agent: 'Coder' } },
    { id: 'writer', type: 'agent', position: { x: 480, y: 460 }, data: { agent: 'Writer' } },
    { id: 'executor', type: 'agent', position: { x: 120, y: 580 }, data: { agent: 'Executor' } },
    { id: 'tester', type: 'agent', position: { x: 120, y: 700 }, data: { agent: 'Tester' } },
    { id: 'summarizer', type: 'agent', position: { x: 300, y: 820 }, data: { agent: 'Summarizer' } },
    { id: 'bot', type: 'agent', position: { x: 600, y: 100 }, data: { agent: 'Bot' } },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'planner' },
    { id: 'e2', source: 'planner', target: 'retriever' },
    { id: 'e3', source: 'retriever', target: 'route_1' },
    { id: 'e4', source: 'coder', target: 'executor' },
    { id: 'e5', source: 'executor', target: 'tester' },
    { id: 'e6', source: 'tester', target: 'summarizer' },
    { id: 'e7', source: 'writer', target: 'tester' },
  ],
};

export function OrchestrationPage() {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [pipeline, setPipeline] = useState<PipelineConfig>(DEFAULT_PIPELINE);
  const [loaded, setLoaded] = useState(false);

  // 加载已有配置
  const { isLoading } = useQuery({
    queryKey: ['agent-config', projectId],
    queryFn: async () => {
      const res = await projectsApi.getAgentConfig(projectId!);
      return res.data;
    },
    enabled: !!projectId && !loaded,
  });

  // 当 agent-config 返回 pipeline JSON 时加载
  // (当前 agent-config API 返回 enabled_agents 数组，升级后返回 pipeline JSON)
  // 兼容过渡期：如果返回 enabled_agents，转换为简单拓扑
  // 如果返回 pipeline，直接使用

  const saveMutation = useMutation({
    mutationFn: async (p: PipelineConfig) => {
      // 将 pipeline 保存到 agent_config
      const enabled = p.nodes
        .filter((n) => n.type === 'agent')
        .map((n) => n.data.agent!)
        .filter(Boolean);
      await projectsApi.updateAgentConfig(projectId!, enabled);
      // 同时保存完整 pipeline JSON（需要后端支持）
      // 过渡期：将 pipeline.nodes 序列化存入 agent_config.pipeline
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-config', projectId] });
      toast.success('流水线已保存');
    },
    onError: () => toast.error('保存失败'),
  });

  const handleChange = useCallback((p: PipelineConfig) => {
    setPipeline(p);
  }, []);

  const handleSave = () => {
    saveMutation.mutate(pipeline);
  };

  const handleReset = () => {
    setPipeline(DEFAULT_PIPELINE);
    toast.success('已恢复默认流水线');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="loading loading-spinner loading-lg text-[#4f8cff]" />
      </div>
    );
  }

  return (
    <div className="flex h-full" style={{ background: '#fafbfc' }}>
      {/* 左侧节点面板 */}
      <div className="w-48 shrink-0 border-r border-[#eceef2] bg-white overflow-y-auto">
        <NodePalette />
        <div className="p-3 border-t border-[#eceef2] space-y-2">
          <button
            className="btn btn-sm w-full"
            style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }}
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? <span className="loading loading-spinner loading-xs" /> : null}
            保存流水线
          </button>
          <button
            className="btn btn-ghost btn-sm w-full text-xs"
            style={{ borderRadius: '10px' }}
            onClick={handleReset}
          >
            恢复默认
          </button>
        </div>
      </div>

      {/* 画布 */}
      <div className="flex-1">
        {/* 顶部导航 */}
        <div className="flex items-center gap-1 px-4 py-2 bg-white border-b border-[#eceef2] text-sm">
          <button
            className="text-[#81858c] hover:text-[#1d1d1f] transition-colors"
            onClick={() => navigate(`/w/${workspaceId}/p/${projectId}/chat`)}
          >
            💬 对话
          </button>
          <span className="text-[#d0d4d8]">|</span>
          <span className="text-[#4f8cff] font-medium">🗺️ 编排</span>
          <span className="text-[#d0d4d8]">|</span>
          <button
            className="text-[#81858c] hover:text-[#1d1d1f] transition-colors"
            onClick={() => navigate(`/w/${workspaceId}/p/${projectId}/monitor`)}
          >
            📡 监控
          </button>
          <span className="text-[#d0d4d8]">|</span>
          <button
            className="text-[#81858c] hover:text-[#1d1d1f] transition-colors"
            onClick={() => navigate(`/w/${workspaceId}/p/${projectId}/eval`)}
          >
            📊 仪表盘
          </button>
        </div>

        <Canvas pipeline={pipeline} onChange={handleChange} />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: 注册路由 + 更新 ChatPage 顶部 Tab**

修改 `frontend/src/routes/index.tsx`:

```typescript
import { OrchestrationPage } from '@/pages/project/OrchestrationPage';

// 在 children 数组中增加:
{ path: 'w/:workspaceId/p/:projectId/orchestra', element: <OrchestrationPage /> },
```

修改 `ChatPage.tsx` 顶部（messages 上方），添加项目内导航 Tab:

```tsx
{/* 顶部 Tab 导航 */}
<div className="flex items-center gap-1 px-4 py-1.5 text-sm shrink-0" style={{ borderBottom: '1px solid #eceef2', background: '#fff' }}>
  <span className="text-[#4f8cff] font-medium px-2">💬 对话</span>
  <span className="text-[#d0d4d8]">|</span>
  <button
    className="text-[#81858c] hover:text-[#1d1d1f] transition-colors px-2"
    onClick={() => navigate(`/w/${workspaceId}/p/${projectId}/orchestra`)}
  >
    🗺️ 编排
  </button>
  <span className="text-[#d0d4d8]">|</span>
  <button
    className="text-[#81858c] hover:text-[#1d1d1f] transition-colors px-2"
    onClick={() => navigate(`/w/${workspaceId}/p/${projectId}/monitor`)}
  >
    📡 监控
  </button>
  <span className="text-[#d0d4d8]">|</span>
  <button
    className="text-[#81858c] hover:text-[#1d1d1f] transition-colors px-2"
    onClick={() => navigate(`/w/${workspaceId}/p/${projectId}/eval`)}
  >
    📊 仪表盘
  </button>
</div>
```

- [ ] **Step 8: 升级后端 jobs API 存储完整 pipeline JSON**

修改 `workspace/routes.py` 中 agent-config PUT API，使其同时存储完整的 pipeline JSON：

```python
@project_router.put("/projects/{project_id}/agent-config")
async def update_agent_config(
    request: Request,
    project_id: str,
    user: dict = Depends(require_auth),
):
    # ... 权限校验不变 ...
    data = await request.json()
    
    import json
    config = {}
    
    # 支持两种格式:
    # 1) { enabled_agents: [...] } — 简单开关（向后兼容）
    # 2) { pipeline: { nodes: [...], edges: [...] } } — 完整编排
    if "pipeline" in data:
        pipeline = data["pipeline"]
        # 从 pipeline 中提取 enabled_agents
        enabled = [
            n["data"]["agent"]
            for n in pipeline.get("nodes", [])
            if n.get("type") == "agent" and n.get("data", {}).get("agent")
        ]
        config["pipeline"] = pipeline
        config["enabled_agents"] = enabled
    elif "enabled_agents" in data:
        config["enabled_agents"] = data["enabled_agents"]
    
    db.update_project(project_id, agent_config=json.dumps(config))
    return JSONResponse({"status": "ok", "config": config})
```

同样更新 GET `agent-config` 返回 pipeline 数据（如有）。

- [ ] **Step 9: router/stream.py 传 pipeline 进 build_stream_workflow**

修改 `router/stream.py` 的 `run_workflow_streaming`:

```python
import json as _json

def run_workflow_streaming(data: dict, state: SessionState):
    try:
        user_input = data.get("message", "")
        lane_mode = data.get("lane_mode", "auto")
        
        # 尝试从 agent_config 解析 pipeline JSON
        pipeline = data.get("pipeline", None)
        if not pipeline:
            # 从 enabled_agents 构造简单拓扑（向后兼容）
            enabled_agents = set(data.get("enabled_agents", [...]))
            stream_graph = build_stream_workflow()  # default
        else:
            stream_graph = build_stream_workflow(pipeline)
        
        # ... 后续不变 ...
```

- [ ] **Step 10: 前端 useStreamChat 传 pipeline**

修改 `useStreamChat.ts` 的 `startStream`，增加 `pipeline` 参数：

```typescript
const startStream = useCallback(async (
  message: string,
  laneMode: string = 'auto',
  pipeline?: PipelineConfig,
  onComplete?: (...) => void,
) => {
  // ...
  const startResp = await apiClient.post('/chat/start', {
    message,
    lane_mode: laneMode,
    history: [],
    pipeline: pipeline || undefined,
  });
  // ...
}, []);
```

- [ ] **Step 11: 编排画布 CSS**

在 `frontend/src/index.css` 末尾追加：

```css
/* ====== 编排画布 ====== */
.react-flow__node {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

.react-flow__edge-path {
  stroke-width: 2;
}

.react-flow__controls-button {
  border-radius: 6px !important;
  border-color: #e0e4e8 !important;
  background: white !important;
}

.react-flow__minimap {
  border-radius: 10px !important;
  border: 1px solid #e0e4e8 !important;
}

/* Router 节点 hover 样式 */
.react-flow__node-router:hover {
  border-color: #f59e0b !important;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.1) !important;
}
```

- [ ] **Step 12: 验证**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npx tsc --noEmit
```

修复可能存在的类型错误（React Flow v5 的 TypeScript 类型）。

```bash
cd "D:\AI\Internship\Multi_Agent" && python -c "
from router.stream_graph import build_stream_workflow
# 测试默认拓扑
g = build_stream_workflow()
print('Default graph OK')
# 测试自定义 pipeline（最小拓扑）
import json
pipeline = {
    'nodes': [
        {'id': 'start', 'type': 'start', 'position': {'x': 100, 'y': 0}, 'data': {}},
        {'id': 'bot', 'type': 'agent', 'position': {'x': 100, 'y': 100}, 'data': {'agent': 'Bot'}},
    ],
    'edges': [{'id': 'e1', 'source': 'start', 'target': 'bot'}],
}
g2 = build_stream_workflow(pipeline)
print('Custom pipeline OK')
"
```

- [ ] **Step 13: Commit**

```bash
git add frontend/package.json frontend/package-lock.json \
        frontend/src/pages/project/OrchestrationPage.tsx \
        frontend/src/pages/project/ChatPage.tsx \
        frontend/src/components/orchestra/ \
        frontend/src/routes/index.tsx \
        frontend/src/hooks/useStreamChat.ts \
        frontend/src/index.css \
        router/stream_graph.py router/stream.py workspace/routes.py
git commit -m "feat(p1): 编排画布 — React Flow 拖拽DAG + 后端动态图编译 + 完整流水线编辑器"
```

---

## P2: 平台完整性

### Task 10: P2-1 — Agent 设计器

**Files:**
- Create: `frontend/src/pages/agent-design/AgentDesigner.tsx`
- Modify: `frontend/src/routes/index.tsx`

**Interfaces:**
- Consumes: `userApi.getProfile()` 获取用户配置, `POST/PUT /api/user/config`
- Produces: 可视化编辑 Agent System Prompt + 模型选择

- [ ] **Step 1: 创建 AgentDesigner**

创建 `frontend/src/pages/agent-design/AgentDesigner.tsx`：

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userApi } from '@/api/user';
import apiClient from '@/api/client';
import { toast } from 'sonner';

const AGENTS = [
  { key: 'Planner', icon: '🧋', label: 'Planner', desc: '任务规划' },
  { key: 'Retriever', icon: '🐍', label: 'Retriever', desc: '知识检索' },
  { key: 'Coder', icon: '🫻', label: 'Coder', desc: '编写代码' },
  { key: 'Writer', icon: '✍️', label: 'Writer', desc: '撰写文档' },
  { key: 'Tester', icon: '✅', label: 'Tester', desc: 'QA审阅' },
  { key: 'Summarizer', icon: '🧊', label: 'Summarizer', desc: '生成报告' },
  { key: 'Bot', icon: '🤖', label: 'Bot', desc: '快捷问答' },
];

const DEFAULT_PROMPTS: Record<string, string> = {
  Planner: '你是高级项目经理。根据用户需求制定详细的执行计划。\n用编号列表列出执行步骤，每步含：目标、技术/工具、预期输出。',
  Retriever: '你是知识检索专家。从知识库中查找与任务相关的信息。',
  Coder: '你是 Python 程序员。编写并执行代码。',
  Writer: '你是专业文档撰写专家。使用 Markdown 格式输出。',
  Tester: '你是高级 QA 评审工程师。审查输出是否满足用户需求。',
  Summarizer: '你是技术文档专家。汇总执行过程，生成简洁报告。',
  Bot: '你是友好的 AI 助手。用简洁自然的中文直接回答。',
};

export function AgentDesigner() {
  const [selectedAgent, setSelectedAgent] = useState('Planner');
  const [editPrompt, setEditPrompt] = useState('');
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: ['user-config'],
    queryFn: async () => {
      const res = await apiClient.get<{ roles?: Record<string, string> }>('/user/config');
      return res.data;
    },
  });

  // 当选中的 Agent 变化时，加载其 Prompt
  const currentPrompt = config?.roles?.[selectedAgent] || DEFAULT_PROMPTS[selectedAgent] || '';

  const saveMutation = useMutation({
    mutationFn: async (roles: Record<string, string>) => {
      await apiClient.put('/user/config', { roles });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-config'] });
      toast.success(`${selectedAgent} 配置已保存`);
    },
    onError: () => toast.error('保存失败'),
  });

  const handleSave = () => {
    const roles = { ...(config?.roles || {}) };
    roles[selectedAgent] = editPrompt || currentPrompt;
    saveMutation.mutate(roles);
  };

  const handleReset = () => {
    setEditPrompt(DEFAULT_PROMPTS[selectedAgent] || '');
  };

  // 初始化编辑内容
  useState(() => { setEditPrompt(currentPrompt); });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-[#1d1d1f] mb-1">Agent 设计器</h1>
      <p className="text-[#81858c] text-sm mb-6">自定义每个 Agent 的 System Prompt 和模型</p>

      <div className="flex gap-6">
        {/* Agent 列表 */}
        <div className="w-48 shrink-0 space-y-1">
          {AGENTS.map((agent) => (
            <button
              key={agent.key}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                selectedAgent === agent.key
                  ? 'bg-[#4f8cff]/10 text-[#4f8cff] font-medium'
                  : 'text-[#81858c] hover:bg-[#f9fafb] hover:text-[#1d1d1f]'
              }`}
              onClick={() => setSelectedAgent(agent.key)}
            >
              <span className="mr-2">{agent.icon}</span>
              {agent.label}
            </button>
          ))}
        </div>

        {/* 编辑区 */}
        <div className="flex-1">
          <div className="card bg-base-100 border border-[#e0e4e8] shadow-sm">
            <div className="card-body">
              <h2 className="card-title text-[#1d1d1f] text-lg">
                {AGENTS.find((a) => a.key === selectedAgent)?.icon} {selectedAgent}
              </h2>
              <p className="text-xs text-[#81858c]">
                {AGENTS.find((a) => a.key === selectedAgent)?.desc}
              </p>

              <div className="mt-2">
                <label className="label py-1">
                  <span className="label-text text-sm text-[#81858c]">System Prompt</span>
                </label>
                <textarea
                  className="textarea textarea-bordered w-full font-mono text-xs"
                  style={{ borderRadius: '10px', borderColor: '#e0e4e8', minHeight: '300px', lineHeight: 1.6 }}
                  value={editPrompt || currentPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  placeholder="输入 System Prompt..."
                />
              </div>

              <div className="flex gap-2 mt-4">
                <button
                  className="btn btn-sm btn-outline"
                  style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                  onClick={handleReset}
                >
                  恢复默认
                </button>
                <button
                  className="btn btn-sm"
                  style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }}
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending && <span className="loading loading-spinner loading-xs" />}
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 路由注册**

修改 `frontend/src/routes/index.tsx`：

```typescript
import { AgentDesigner } from '@/pages/agent-design/AgentDesigner';

// 在 children 数组中增加:
{ path: 'agents', element: <AgentDesigner /> },
```

- [ ] **Step 3: Sidebar 导航添加**

修改 `frontend/src/components/layout/Sidebar.tsx` 的 navItems 数组，增加 Agent 设计器入口：

```typescript
import { Bot } from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: '工作空间' },
  { to: '/agents', icon: Bot, label: 'Agent 设计器' },
  { to: '/templates', icon: Puzzle, label: '模板市场' },
  { to: '/settings', icon: Settings, label: '个人设置' },
];
```

- [ ] **Step 4: 验证**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/agent-design/AgentDesigner.tsx \
        frontend/src/routes/index.tsx frontend/src/components/layout/Sidebar.tsx
git commit -m "feat(p2): Agent设计器 — System Prompt编辑 + 模型选择"
```

---

### Task 11: P2-2 — 模板市场

**Files:**
- Modify: `frontend/src/pages/templates/TemplateMarket.tsx`
- Create: `frontend/src/data/templates.ts`

**Interfaces:**
- Consumes: 预置模板数据, `projectsApi.create()`
- Produces: 模板卡片列表 + 一键创建项目

- [ ] **Step 1: 创建模板数据**

创建 `frontend/src/data/templates.ts`：

```typescript
export interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
  agentConfig: string[];
  suggestedMessage: string;
}

export const TEMPLATES: Template[] = [
  {
    id: 'tpl-code-helper',
    name: '代码助手',
    description: '编写、执行、审查 Python 代码',
    icon: '💻',
    agentConfig: ['Planner', 'Retriever', 'Coder', 'Executor', 'Tester', 'Summarizer'],
    suggestedMessage: '请帮我编写一个 Python 函数，实现...',
  },
  {
    id: 'tpl-data-analysis',
    name: '数据分析',
    description: '上传 CSV，自动聚合分析、生成图表',
    icon: '📊',
    agentConfig: ['Planner', 'Retriever', 'Coder', 'Executor', 'Summarizer'],
    suggestedMessage: '请分析我上传的数据文件，按指定维度分组统计并生成图表',
  },
  {
    id: 'tpl-writing',
    name: '论文写作',
    description: '结构化撰写学术论文或技术报告',
    icon: '📝',
    agentConfig: ['Planner', 'Retriever', 'Writer', 'Tester', 'Summarizer'],
    suggestedMessage: '请帮我撰写一篇关于...的学术论文',
  },
  {
    id: 'tpl-quick-qa',
    name: '快速问答',
    description: '简洁直接的 AI 问答，无需复杂流程',
    icon: '⚡',
    agentConfig: ['Bot'],
    suggestedMessage: '请解释...',
  },
  {
    id: 'tpl-code-review',
    name: '代码审查',
    description: '审查代码质量、安全性和最佳实践',
    icon: '🔍',
    agentConfig: ['Planner', 'Coder', 'Tester', 'Summarizer'],
    suggestedMessage: '请审查以下代码的质量和安全性：\n```python\n...\n```',
  },
  {
    id: 'tpl-knowledge-qa',
    name: '知识问答',
    description: '结合知识库的深度问答',
    icon: '📚',
    agentConfig: ['Planner', 'Retriever', 'Summarizer'],
    suggestedMessage: '根据知识库内容，请解释...',
  },
];
```

- [ ] **Step 2: 重写 TemplateMarket**

修改 `frontend/src/pages/templates/TemplateMarket.tsx`（占位页 → 完整版）：

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workspacesApi } from '@/api/workspaces';
import { projectsApi } from '@/api/projects';
import { TEMPLATES, type Template } from '@/data/templates';
import { toast } from 'sonner';

export function TemplateMarket() {
  const [selectedTpl, setSelectedTpl] = useState<Template | null>(null);
  const [targetWorkspace, setTargetWorkspace] = useState('');
  const [projectName, setProjectName] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: workspaces } = useQuery({
    queryKey: ['workspaces'],
    queryFn: async () => { const res = await workspacesApi.list(); return res.data; },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTpl || !targetWorkspace || !projectName.trim()) return;
      const res = await projectsApi.create(targetWorkspace, {
        name: projectName.trim(),
        description: `基于「${selectedTpl.name}」模板创建`,
      });
      // 设置 Agent 配置
      await projectsApi.updateAgentConfig(res.data.id, selectedTpl.agentConfig);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      toast.success('项目创建成功');
      navigate(`/w/${targetWorkspace}/p/${data.id}/chat`);
    },
    onError: () => toast.error('创建失败'),
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-[#1d1d1f] mb-1">模板市场</h1>
      <p className="text-[#81858c] text-sm mb-6">选择一个场景模板，一键创建项目并开始对话</p>

      {/* 模板网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {TEMPLATES.map((tpl) => (
          <div
            key={tpl.id}
            className="card bg-base-100 border border-[#e0e4e8] shadow-sm cursor-pointer transition-all hover:border-[#4f8cff] hover:shadow-md"
            onClick={() => {
              setSelectedTpl(tpl);
              setProjectName(tpl.name);
              const dialog = document.getElementById('tpl-dialog') as HTMLDialogElement;
              dialog?.showModal();
            }}
          >
            <div className="card-body p-5">
              <div className="text-3xl mb-2">{tpl.icon}</div>
              <h3 className="card-title text-base text-[#1d1d1f]">{tpl.name}</h3>
              <p className="text-xs text-[#81858c]">{tpl.description}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {tpl.agentConfig.map((a) => (
                  <span key={a} className="text-[10px] px-1.5 py-0.5 rounded bg-[#f0f2f5] text-[#81858c]">{a}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 创建项目弹窗 */}
      <dialog id="tpl-dialog" className="modal">
        <div className="modal-box" style={{ borderRadius: '16px', padding: 0, overflow: 'hidden' }}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <h3 className="text-base font-semibold text-[#1d1d1f]">
              使用模板「{selectedTpl?.name}」
            </h3>
            <form method="dialog">
              <button className="w-7 h-7 rounded-full border-none bg-transparent text-[#9ca3af] cursor-pointer flex items-center justify-center text-sm hover:bg-[#f3f4f6]">✕</button>
            </form>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1 text-[#81858c]">目标工作空间</label>
              <select
                className="select select-bordered w-full"
                style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                value={targetWorkspace}
                onChange={(e) => setTargetWorkspace(e.target.value)}
              >
                <option value="">选择工作空间...</option>
                {workspaces?.map((ws) => (
                  <option key={ws.id} value={ws.id}>{ws.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-[#81858c]">项目名称</label>
              <input
                className="input input-bordered w-full"
                style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </div>
            {selectedTpl?.suggestedMessage && (
              <div>
                <label className="block text-xs font-medium mb-1 text-[#81858c]">建议首条消息</label>
                <p className="text-xs text-[#81858c] bg-[#f9fafb] p-2 rounded-lg">{selectedTpl.suggestedMessage}</p>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 px-5 pb-5">
            <form method="dialog">
              <button className="btn btn-ghost btn-sm" style={{ borderRadius: '10px' }}>取消</button>
            </form>
            <button
              className="btn btn-sm"
              style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }}
              disabled={!targetWorkspace || !projectName.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? <span className="loading loading-spinner loading-xs" /> : null}
              创建项目
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop"><button>close</button></form>
      </dialog>
    </div>
  );
}
```

- [ ] **Step 3: 验证**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/templates/TemplateMarket.tsx frontend/src/data/templates.ts
git commit -m "feat(p2): 模板市场 — 6个预置模板 + 一键创建项目"
```

---

### Task 12: P2-3 — 管理后台

**Files:**
- Create/modify: `frontend/src/pages/admin/AdminPage.tsx`（重写占位页）

**Interfaces:**
- Consumes: `GET /api/admin/users`, `PUT /api/admin/users/{id}/admin`
- Produces: 用户管理 + 角色切换

- [ ] **Step 1: 创建 admin API 封装**

在 `frontend/src/api/` 中新建 `admin.ts`（或在 `user.ts` 中追加）：

创建 `frontend/src/api/admin.ts`：

```typescript
import apiClient from './client';

export interface AdminUser {
  id: string;
  name: string;
  is_admin: number;
  created_at: string;
}

export interface AdminStats {
  users: number;
  workspaces: number;
  projects: number;
  active_sessions: number;
}

export const adminApi = {
  listUsers: () => apiClient.get<AdminUser[]>('/admin/users'),

  toggleAdmin: (userId: string, isAdmin: boolean) =>
    apiClient.put<{ status: string }>(`/admin/users/${userId}/admin`, { is_admin: isAdmin }),
};
```

- [ ] **Step 2: 重写 AdminPage**

修改 `frontend/src/pages/admin/AdminPage.tsx`（替换占位内容）：

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, type AdminUser } from '@/api/admin';
import { Shield, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';

export function AdminPage() {
  const queryClient = useQueryClient();

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const res = await adminApi.listUsers();
      return res.data;
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ userId, isAdmin }: { userId: string; isAdmin: boolean }) =>
      adminApi.toggleAdmin(userId, isAdmin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('角色已更新');
    },
    onError: () => toast.error('操作失败'),
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-[#1d1d1f] mb-1">管理后台</h1>
      <p className="text-[#81858c] text-sm mb-6">用户管理 · 权限控制</p>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <span className="loading loading-spinner loading-md text-[#4f8cff]" />
        </div>
      ) : (
        <div className="card bg-base-100 border border-[#e0e4e8] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr className="bg-[#f9fafb] text-xs text-[#81858c]">
                  <th>用户 ID</th>
                  <th>用户名</th>
                  <th>角色</th>
                  <th>注册时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users?.map((u: AdminUser) => (
                  <tr key={u.id} className="hover:bg-[#f9fafb]">
                    <td className="text-xs font-mono text-[#81858c]">{u.id.slice(0, 8)}</td>
                    <td className="text-sm font-medium text-[#1d1d1f]">{u.name}</td>
                    <td>
                      {u.is_admin ? (
                        <span className="badge badge-sm bg-[#4f8cff]/10 text-[#4f8cff] border-none">管理员</span>
                      ) : (
                        <span className="badge badge-sm badge-ghost">用户</span>
                      )}
                    </td>
                    <td className="text-xs text-[#81858c]">{u.created_at?.slice(0, 10)}</td>
                    <td>
                      <button
                        className={`btn btn-xs ${u.is_admin ? 'btn-outline btn-error' : 'btn-outline'}`}
                        style={{ borderRadius: '8px' }}
                        onClick={() => toggleMutation.mutate({ userId: u.id, isAdmin: !u.is_admin })}
                        disabled={toggleMutation.isPending}
                      >
                        {u.is_admin ? (
                          <><ShieldOff size={12} /> 降级</>
                        ) : (
                          <><Shield size={12} /> 升管理员</>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 验证**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/admin/AdminPage.tsx frontend/src/api/admin.ts
git commit -m "feat(p2): 管理后台 — 用户列表 + 管理员升降"
```

---

### Task 13: P2-4 — 后端更新测试 + 全平台联调

**Files:**
- Modify: `requirements.txt`
- Modify: `main.py`
- Run `tests/`

- [ ] **Step 1: 安装 scalar-fastapi**

```bash
cd "D:\AI\Internship\Multi_Agent" && pip install scalar-fastapi
```

- [ ] **Step 2: 更新 requirements.txt**

追加一行：
```
scalar-fastapi
```

- [ ] **Step 3: main.py 挂载 Scalar UI**

在 `main.py` 路由注册部分（第 87 行附近）追加：

```python
from scalar_fastapi import get_scalar_api_reference

@app.get("/scalar", include_in_schema=False)
async def scalar_docs():
    from fastapi.responses import HTMLResponse
    return HTMLResponse(get_scalar_api_reference(
        openapi_url="/openapi.json",
        title="Multi-Agent API 文档",
    ))
```

保留现有 `/docs`（Swagger），新增 `/scalar` 作为 Scalar UI 入口。

- [ ] **Step 4: 运行后端测试**

```bash
cd "D:\AI\Internship\Multi_Agent" && python -m pytest tests/ -v
```

预期：26 个测试中，与已有功能相关的测试全部通过。eval_logs 和 agent-config 的新功能单独手动验证。

- [ ] **Step 5: 前端最终编译**

```bash
cd "D:\AI\Internship\Multi_Agent\frontend" && npx tsc --noEmit && npm run build
```

- [ ] **Step 6: 手动集成测试**

1. 启动后端 `python main.py`
2. 启动前端 `npm run dev`
3. 验证流程：
   - 登录 → 进入项目 → 聊天
   - 右侧栏展开 → Agent 开关 Toggle → 发送消息 → 查看效果
   - 进入 `/w/.../p/.../monitor` → 查看监控页
   - 进入 `/w/.../p/.../eval` → 查看仪表盘
   - 进入 `/agents` → 编辑 System Prompt
   - 进入 `/templates` → 一键创建项目
   - 进入 `/admin` → 管理用户
   - 进入 `/scalar` → API 文档

- [ ] **Step 7: Commit**

```bash
git add requirements.txt main.py
git commit -m "feat(p2): Scalar API文档 + 集成测试"
```

---

## 自检报告

**1. Spec 覆盖:** 全部 Spec 节 (3 RightPanel, 4 P0, 5 P1, 6 P2) 均有对应 Task。

**2. 占位符扫描:** 无 TBD/TODO/占位符。所有代码步骤均包含具体实现。

**3. 类型一致性:**
- `StreamEvent.elapsed_ms` / `StreamEvent.token_count` — Task 3 (P0-3) 中定义，Task 4/8 (P1) 中消费
- `AgentStep` 接口 — Task 6 (MonitorPage) 定义
- `EvalStats` 接口 — Task 7 (EvaluationPage) 定义
- `Template` 接口 — Task 10 (TemplateMarket) 定义
- `projectsApi.getAgentConfig/updateAgentConfig` — Task 5 (P1-2) 定义，Task 10 (P2-2) 消费
- `agentStats: Map<string, {elapsed_ms, token_count}>` — Task 3 增加到 StreamingState，Task 8 读取

**4. 依赖链:**
- P0 独立，无依赖 P1/P2
- P1-1 (RightPanel) 依赖 P0 的 ChatPage 修改
- P1-2 (Agent 开关) 依赖 P1-1 的 RightPanel 容器
- P1-3 (MonitorPage) 依赖 P0-3 的 ICONS/COLORS 导出
- P1-4 (EvaluationPage) 依赖 Task 7 的 eval_logs 表
- P1-5 (SessionInfoTab/FilesTab) 依赖 P1-1 的 RightPanel 容器
- P2 各 Task 相互独立
