# Agent 池三态 + 编排联动

**日期**: 2026-07-01
**状态**: 已批准

---

## 背景

当前 Agent 池只有 开启/关闭 两种状态，与编排画布的关系不明确。用户关闭一个 Agent 后 pipeline 仍会执行它。

## 设计

### 1. 三态定义

| 状态 | 图标 | 含义 | 触发条件 |
|---|---|---|---|
| 开启 | 🟢 | 正常执行 | 在编排中 + 用户打开 |
| 关闭 | 🟡 | Pipeline 跳过 | 在编排中 + 用户关闭 |
| 禁用 | ⚫ | 不可操作 | 不在编排中 |

### 2. 数据存储

存在 `projects.agent_config` JSON 字段：

```json
{
  "pipeline": { "nodes": [...], "edges": [...] },
  "agent_states": {
    "Planner": "on",
    "Coder": "off",
    "Tester": "on"
  }
}
```

不在 `agent_states` 中的 Agent = 禁用。

### 3. 前端 — Agent 池 UI

Agent 池显示 8 个 Agent，每个根据状态显示不同样式：
- **开启**：`bg-white border border-[#e0e4e8]` 正常色
- **关闭**：`bg-amber-50 border border-amber-200` 黄色调
- **禁用**：`bg-gray-50 text-[#b0b8c1] grayscale opacity-40` 灰色不可点击

编排保存时自动同步 agent_states（新增 Agent 默认 on）。

### 4. 后端 — Pipeline 跳过

流式请求新增 `agent_states` 字段传递到 stream_graph。

`_build_dynamic_workflow` 构建图时：
- 遍历所有边，如果目标节点状态为 `"off"`，将边重定向到下一个 `"on"` 的后继节点
- 如果源节点状态为 `"off"`，删除该边

### 5. API 变更

`POST /api/chat/start` 请求体新增：
```json
{
  "agent_states": { "Planner": "on", "Coder": "off", ... }
}
```

---

## 影响范围

| 文件 | 改动 |
|---|---|
| `frontend/src/pages/chat/V3ChatPage.tsx` | Agent 池三态 UI + agent_states 状态管理 |
| `frontend/src/pages/project/OrchestrationPage.tsx` | 保存时同步 agent_states |
| `frontend/src/hooks/useStreamChat.ts` | startStream 传递 agent_states |
| `router/router.py` | ChatRequest 新增 agent_states |
| `router/stream_graph.py` | 构建时跳过 off 节点 |
| `frontend/src/api/projects.ts` | updateAgentConfig 类型更新 |

---

## 测试要点

- [ ] Agent 不在编排中时显示禁用灰态
- [ ] 编排中加入 Agent 后自动变为开启
- [ ] 关闭 Agent 后 pipeline 跳过该节点
- [ ] 编排保存后 Agent 池立即同步
- [ ] 连续关闭多个 Agent 时 pipeline 正确跳过
