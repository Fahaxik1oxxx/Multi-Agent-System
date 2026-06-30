# Agent 池三态 + 编排联动 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Agent 池支持 开启/关闭/禁用 三态，关闭的 Agent 在 pipeline 中自动跳过。

**Architecture:** 编排保存时同步 agent_states → 流式请求携带 agent_states → stream_graph 构建时跳过 off 节点 → 前端三态 UI 联动。

**Tech Stack:** Python (FastAPI, LangGraph), TypeScript (React, TailwindCSS)

## Global Constraints

- 三态：开启(on)/关闭(off)/禁用(不在 agent_states 中)
- agent_states 存在 `projects.agent_config` JSON 字段
- 不在编排中的 Agent 前端不可点击
- Pipeline 跳过 off 节点时，边重连到下一个 on 节点

---

### Task 1: 后端 — 流式请求 + 跳过逻辑

**Files:**
- Modify: `router/router.py` — ChatRequest 新增 `agent_states`
- Modify: `router/stream_graph.py` — 构建时跳过 off 节点
- Modify: `router/stream.py` — 传递 agent_states 到 workflow

- [ ] **Step 1: ChatRequest 新增 agent_states 字段**

在 `router/router.py` 的 `ChatRequest` 类添加：
```python
agent_states: dict[str, str] = Field(default_factory=dict)
```

- [ ] **Step 2: stream_graph.py — 实现跳过逻辑**

在 `_build_dynamic_workflow` 函数开头添加跳过逻辑。遍历 pipeline edges，对每条 `A → B`：
- 若 B 的 agent_states 为 `"off"`，找到 B 的下一个非 off 后继 C，把边改为 `A → C`
- 若 A 的 agent_states 为 `"off"`，删除此边
- 递归处理，直到所有 off 节点被移除

```python
def _resolve_skip(edges, agent_states):
    """跳过 agent_states 为 'off' 的节点，重连边"""
    if not agent_states:
        return edges
    
    # 找到所有 off 节点
    off_nodes = {k for k, v in agent_states.items() if v == "off"}
    if not off_nodes:
        return edges
    
    # 构建邻接表
    out_edges = {}  # src → [dst, ...]
    for e in edges:
        out_edges.setdefault(e["source"], []).append(e["target"])
    
    # 重连：A → B(off) → 找到 B 的下一个非 off 后继
    new_edges = []
    for e in edges:
        src, tgt = e["source"], e["target"]
        if src in off_nodes:
            continue  # off 节点没有输出
        # 如果目标 off，沿链路找到第一个 on 节点
        resolved = tgt
        while resolved in off_nodes:
            next_nodes = out_edges.get(resolved, [])
            resolved = next_nodes[0] if next_nodes else resolved
            if resolved == tgt:  # 防止死循环
                break
        new_edges.append({"source": src, "target": resolved})
    return new_edges
```

在构建图之前调用：
```python
edges = _resolve_skip(pipeline.get("edges", []), agent_states)
```

- [ ] **Step 3: Commit**

```bash
git add router/router.py router/stream_graph.py
git commit -m "feat: agent_states 跳过 off 节点"
```

---

### Task 2: 前端 — useStreamChat 传递 agent_states

**Files:**
- Modify: `frontend/src/hooks/useStreamChat.ts` — startStream 参数 + API 请求体

- [ ] **Step 1: startStream 接受 agent_states 参数**

```typescript
const startStream = useCallback(async (
    message: string,
    laneMode: string = 'auto',
    projectId?: string,
    onComplete?: ...,
    webSearchEnabled: boolean = false,
    agentStates: Record<string, string> = {},
  ) => {
```

在 `/chat/start` 请求体中添加：
```typescript
agent_states: agentStates,
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useStreamChat.ts
git commit -m "feat(frontend): useStreamChat 传递 agent_states"
```

---

### Task 3: 前端 — Agent 池三态 UI

**Files:**
- Modify: `frontend/src/pages/chat/V3ChatPage.tsx` — Agent 池部分

- [ ] **Step 1: 从编排加载 agent_states**

在 `refreshAgentConfig` 中，除了 `enabled_agents`，也读取 `agent_states`：

```typescript
const [agentStates, setAgentStates] = useState<Record<string, string>>({});

// 在 refreshAgentConfig 中：
if (config?.agent_states) {
    setAgentStates(config.agent_states);
} else if (config?.enabled_agents) {
    // 兼容旧格式
    const states: Record<string, string> = {};
    config.enabled_agents.forEach((k: string) => states[k] = 'on');
    setAgentStates(states);
}
```

- [ ] **Step 2: 修改 Agent 池按钮渲染**

将原有 `enabledAgents.includes(name)` 判断改为三态：

```tsx
const state = agentStates[name]; // "on" | "off" | undefined
const isOn = state === 'on';
const isOff = state === 'off';
const isDisabled = state === undefined;

<button
  onClick={isDisabled ? undefined : () => toggleAgent(name)}
  className={`flex flex-col items-center py-1.5 rounded-lg text-[10px] transition-all ${
    isOn
      ? 'bg-white border border-[#e0e4e8] text-[#1d1d1f] shadow-sm'
      : isOff
      ? 'bg-amber-50 border border-amber-200 text-[#92400e]'
      : 'bg-gray-50 text-[#b0b8c1] grayscale opacity-40 border border-transparent cursor-not-allowed'
  }`}
  title={isDisabled ? '该 Agent 不在编排中' : isOff ? '已关闭，点击开启' : '已开启，点击关闭'}
>
  <span className={`text-base leading-none mb-0.5 ${isOff ? '' : isOn ? '' : 'grayscale opacity-40'}`}>
    {meta.icon}
  </span>
  <span className="leading-tight">
    {name}
    {isOff && <span className="block text-[8px] text-amber-500">已关闭</span>}
    {isDisabled && <span className="block text-[8px]">未编排</span>}
  </span>
</button>
```

- [ ] **Step 3: toggleAgent 改为切换 on/off**

```typescript
const toggleAgent = (name: string) => {
    const next = { ...agentStates };
    next[name] = next[name] === 'on' ? 'off' : 'on';
    setAgentStates(next);
    // 同步保存到后端
    projectsApi.updateAgentConfig(projectId, {
        agent_states: next,
    }).catch(() => {});
};
```

- [ ] **Step 4: 编排保存后同步**

在 `orchestra-saved` 事件处理中，重新加载 agent_states。

- [ ] **Step 5: 发送消息时传递 agent_states**

修改 `handleSend` 和 `startStream` 调用，传入 `agentStates`。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/chat/V3ChatPage.tsx
git commit -m "feat(frontend): Agent 池三态 UI — 开启/关闭/禁用"
```

---

### Task 4: 编排保存同步 agent_states

**Files:**
- Modify: `frontend/src/pages/project/OrchestrationPage.tsx`

- [ ] **Step 1: 保存编排时构建 agent_states**

在 `saveMutation.mutationFn` 中：
```typescript
const agentStates: Record<string, string> = {};
// pipeline 中的所有 agent 默认 on
for (const node of p.nodes) {
    if (node.type === 'agent') {
        agentStates[node.data.agent] = 'on';
    }
}
// 保留已有的 off 状态
if (initialData?.agent_states) {
    for (const [k, v] of Object.entries(initialData.agent_states)) {
        if (v === 'off' && agentStates[k]) {
            agentStates[k] = 'off';
        }
    }
}

await projectsApi.updateAgentConfig(projectId, {
    pipeline: p,
    agent_states: agentStates,
});
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/project/OrchestrationPage.tsx
git commit -m "feat: 编排保存自动同步 agent_states"
```

---

## 验证

- [ ] Agent 不在编排中 → 灰态不可点击
- [ ] Agent 在编排中 → 默认绿色开启
- [ ] 点击 Agent → 黄态关闭
- [ ] 再次点击 → 恢复绿色开启
- [ ] 发送消息 → pipeline 跳过关闭的 Agent
- [ ] 编排保存 → Agent 池立即同步状态
