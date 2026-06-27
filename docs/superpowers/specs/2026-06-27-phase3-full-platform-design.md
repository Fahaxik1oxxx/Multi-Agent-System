# Phase 2B + 3: 全平台完善 — 设计规格书

> 日期: 2026-06-27
> 版本: 1.0
> 状态: 设计确认中
> 上下文: Phase 2A (SSE + daisyUI) 已完成，Render 部署运行中

---

## 1. 目标

在 Phase 2A 基础上，分四个优先级完成平台所有剩余功能模块。P0 收尾体验缺陷，P1 打造答辩高光素材，P2 补全平台完整性，P3 答辩后远期。
本文档涵盖：P0 → P1 → P2 全部设计细节 + P3 概要。

---

## 2. 优先级总览

| 优先级 | 名称 | 周期 | 核心目标 |
|--------|------|------|---------|
| P0 | 现有功能收尾 | 2-3 天 | 会话持久化 + 文件上传 + Agent 卡片优化 |
| P1 | 答辩高光 | 5-6 天 | SSE 监控页 + 评估仪表盘 + 报告导出 + 右侧栏 + 编排画布 |
| P2 | 平台完整性 | 5-6 天 | Agent 设计器 + 模板市场 + 管理后台 + API 文档 |
| P3 | 锦上添花 | 答辩后 | 审计日志 |

---

## 3. 右侧可伸缩栏（贯穿 P0-P2）

ChatPage 新增第三列布局，可折叠/展开/拖拽调整宽度。

### 3.1 布局

```
┌─ Sidebar (w-72) ─┬────────── Chat ──────────┬── Right Panel ──┐
│                   │                          │ [折叠: 0px]     │
│  导航             │  Welcome / Messages      │                 │
│                   │                          │ [展开: 280px]   │
│                   │  ┌────────────────────┐  │                 │
│                   │  │ 对话气泡...         │  │  Tab 切换:      │
│                   │  └────────────────────┘  │  Agent配置      │
│                   │                          │  | 会话信息     │
│                   │  ┌────────────────────┐  │  | 文件        │
│                   │  │ 输入框              │  │                 │
│                   │  └────────────────────┘  │                 │
└───────────────────┴──────────────────────────┴─────────────────┘
```

### 3.2 交互

- **折叠/展开按钮**: 竖线中间的 24×24 圆形按钮，`◀` / `▶` hover 高亮
- **拖拽把手**: `cursor-col-resize`，mousedown→mousemove 动态改宽度，160px~480px 范围
- **过渡动画**: 200ms ease-in-out
- **默认状态**: 折叠（用户不会频繁改配置）

### 3.3 文件改动

| 文件 | 内容 |
|------|------|
| `frontend/src/components/layout/RightPanel.tsx` | 新建：右侧栏容器 + Tab + 拖拽把手 |
| `frontend/src/components/layout/RightPanel/AgentTab.tsx` | Agent 开关 Tab |
| `frontend/src/components/layout/RightPanel/SessionInfoTab.tsx` | 会话信息 Tab |
| `frontend/src/components/layout/RightPanel/FilesTab.tsx` | 文件管理 Tab |
| `frontend/src/pages/project/ChatPage.tsx` | 左右三栏布局改造 |
| `frontend/src/index.css` | 右侧栏 + 拖拽把手 CSS 变量 |

---

## 4. P0 — 现有功能收尾

### 4.1 会话持久化 + 侧栏历史列表

**问题**: ChatPage 刷新后消息丢失，无历史记录。

**方案**:

1. **自动保存**: SSE `done` 事件触发后，调用 `POST /api/sessions` 保存消息到后端
2. **侧栏历史**: 左侧 Sidebar 底部新增"会话历史"折叠区，列出当前项目下的最近会话（最多 20 条）
3. **加载历史**: 点击历史条目 → `GET /api/sessions/{id}` → 恢复消息列表

**数据流**:

```
SSE done 事件
  → useStreamChat 回调 onComplete
    → ChatPage 调用 sessionsApi.save({ messages, project_id })
      → SQLite sessions 表 (Phase 1 已存在)

页面加载
  → TanStack Query: sessionsApi.list(project_id)
    → Sidebar 显示列表 (按 updated_at DESC, 限 20 条)
  → 用户点击条目 → 加载 messages → setMessages()
```

**UI**:

```
Sidebar:
┌─────────┐
│ 导航     │
│ 工作空间 │
│ ...     │
├─────────┤
│ 会话历史 │  ← 折叠/展开
│ ─────── │
│ 06/27 编程助手        │
│ 06/26 数据分析报告    │
│ 06/25 一个简单的函数  │
│ ...     │
└─────────┘
```

**文件改动**:

| 文件 | 内容 |
|------|------|
| `frontend/src/components/layout/Sidebar.tsx` | 底部新增"会话历史"折叠区 |
| `frontend/src/hooks/useStreamChat.ts` | `done` 事件回调 `onComplete` |
| `frontend/src/pages/project/ChatPage.tsx` | 保存/加载历史逻辑 |
| `frontend/src/api/sessions.ts` | 已有 `/api/sessions` CRUD，确认接口兼容 |

### 4.2 文件上传前端对接

**问题**: 后端已有 `POST /api/knowledge/upload` 等 API，前端未对接。

**方案**:

1. **ChatPage 输入框旁加 📎 按钮** → 点击触发 `<input type="file">`
2. **上传后显示文件标签** 在输入框上方，点击 × 可移除
3. **发送消息时附带文件** → `startStream` 传入 `files: [...]`
4. **后端 SSE 端点** 已支持 multipart，确认后即可使用
5. **文件预览**: 右侧栏 Files Tab 显示项目文件列表（对接现有 `GET /api/knowledge/files`）

**UI**:

```
┌─ 输入区域 ──────────────────────────────┐
│                                           │
│  ┌──────────┐ ┌──────────┐               │
│  │ data.csv │ │ 代码.py  │  ← 文件标签    │
│  │       ×  │ │       ×  │               │
│  └──────────┘ └──────────┘               │
│  ┌─────────────────────────────┐         │
│  │ 输入框...                    │  📎     │
│  └─────────────────────────────┘         │
└───────────────────────────────────────────┘
```

**文件改动**:

| 文件 | 内容 |
|------|------|
| `frontend/src/pages/project/ChatPage.tsx` | 文件 input + 标签 + 上传逻辑 |
| `frontend/src/components/layout/RightPanel/FilesTab.tsx` | 右侧栏文件列表 |
| `frontend/src/api/knowledge.ts` | 新建：知识库/文件 API 封装 |

### 4.3 Agent 卡片交互优化

**问题**: 思考面板默认折叠，代码块一键复制缺少视觉反馈。

**方案**:

1. **思考面板默认展开第一个 Agent**，其余折叠。切换时平滑动画
2. **代码块复制按钮**: 已有逻辑，增加"已复制" toast 反馈
3. **Agent 卡片增加耗时标注**: 在 `agent_end` 事件中附带 `elapsed_ms`，卡片头显示耗时
4. **流式 token 计数**: `agent_end` 时附带 `token_count`，右侧栏会话信息 Tab 展示

**文件改动**:

| 文件 | 内容 |
|------|------|
| `router/stream_graph.py` | `_stream_llm` 记录 token 计数 + 耗时 |
| `frontend/src/pages/project/ChatPage.tsx` | 思考面板默认展开第一个 + 耗时显示 |
| `frontend/src/hooks/useStreamChat.ts` | `agent_end` 事件新增 `elapsed_ms`, `token_count` 字段 |

---

## 5. P1 — 答辩高光

### 5.1 SSE 实时监控页 (`/w/:wid/p/:pid/monitor`)

**功能**: 时间轴视图实时展示 8 个 Agent 的执行过程，类似 CI/CD Pipeline 视图。

**实现方案**:

- **复用现有 SSE 通道**: 监听同一 `GET /api/chat/stream/{id}` 的 `agent_start` / `agent_end` / `token` 事件
- **时间轴组件**: 垂直流水线布局，每条 Agent 一行，显示状态图标 + 耗时条形图
- **三种状态**: ⏳ 等待 (灰色) → 🔄 执行中 (蓝色脉冲) → ✅ 完成 (绿色) / ❌ 失败 (红色)
- **点击展开**: 点击某行展开该 Agent 的完整输出

**UI**:

```
┌─ 实时监控 ──────────────────────────────────────┐
│                                                   │
│  📊 任务: 编写一个股票数据分析脚本                  │
│  🏷️ 类型: 编程 | 复杂度: 高                        │
│                                                   │
│  ┌─ 执行流水线 ───────────────────────────────┐  │
│  │                                             │  │
│  │  🧋 Planner    ████████████  2.1s  ✅       │  │
│  │  🐍 Retriever  ██████        1.2s  ✅       │  │
│  │  🫻 Coder      ████████████████  3.5s  ✅   │  │
│  │  ⚙️ Executor   ██            0.4s  ✅       │  │
│  │  ✅ Tester     ████████      1.8s  ✅       │  │
│  │  🧊 Summarizer ██████        1.1s  🔄       │  │
│  │                                             │  │
│  │  总耗时: 10.1s  |  Token: 4,832              │  │
│  │                                             │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  [查看对话]  [导出报告]  [重新运行]                  │
└───────────────────────────────────────────────────┘
```

**路由**: 在项目聊天页内，可通过顶部 Tab (`对话 | 监控 | 仪表盘`) 切换，不跳转到独立页面。或者保留独立路由，通过 Sidebar 进入。

**文件改动**:

| 文件 | 内容 |
|------|------|
| `frontend/src/pages/project/MonitorPage.tsx` | 新建：监控页 |
| `frontend/src/components/monitor/PipelineTimeline.tsx` | 时间轴组件 |
| `frontend/src/components/monitor/AgentRow.tsx` | 单个 Agent 行组件 |
| `frontend/src/routes/index.tsx` | 新增 `/w/:wid/p/:pid/monitor` 路由 |

### 5.2 评估仪表盘 (`/w/:wid/p/:pid/eval`)

**功能**: 项目级别的统计仪表盘。

**数据来源**:

- 后端新增 `POST /api/eval/log` — SSE 每次 `done` 时自动调用记录一次执行
- 新增 `GET /api/eval/stats/{project_id}` — 聚合统计查询
- 新增 SQLite 表 `eval_logs`:

```sql
CREATE TABLE eval_logs (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id),
    session_id  TEXT,
    task_type   TEXT,       -- 编程/写作/分析/问答
    complexity  TEXT,       -- 高/中/低
    agent_count INTEGER,    -- 执行了多少个 Agent
    total_tokens INTEGER,
    elapsed_ms  INTEGER,
    has_error   INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now', 'localtime'))
);
```

**图表 (Recharts)**:

```
┌─ 评估仪表盘 ────────────────────────────────────────┐
│                                                     │
│  ┌─ 概览卡片 ──────────────────────────────────┐   │
│  │  总执行次数  平均耗时   Token 总量   错误率    │   │
│  │    47        8.2s       182K       2.1%      │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  ┌─── 任务类型分布 ───────┐ ┌─── 耗时趋势 ────────┐ │
│  │  饼图 (PieChart)       │ │  折线图 (LineChart)  │ │
│  │  编程 ████████ 45%     │ │  Day1 Day2 Day3 ...  │ │
│  │  写作 ████ 22%         │ │  ── avg_elapsed      │ │
│  │  分析 ████ 20%         │ │  ── avg_tokens       │ │
│  │  问答 ██ 13%           │ │                      │ │
│  └────────────────────────┘ └──────────────────────┘ │
│                                                     │
│  ┌─── Agent 使用频率 ───────────────────────────┐  │
│  │  柱状图 (BarChart)                             │  │
│  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ Planner     │  │
│  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ Coder          │  │
│  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ Retriever      │  │
│  │  ...                                          │  │
│  └────────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**文件改动**:

| 文件 | 内容 |
|------|------|
| `user/db.py` | 迁移 v4: 新增 `eval_logs` 表 + CRUD |
| `workspace/routes.py` 或新 `eval/routes.py` | eval log/stats API |
| `router/stream.py` | `done` 后自动调用 eval log |
| `frontend/src/pages/project/EvaluationPage.tsx` | 新建：仪表盘页 |
| `frontend/package.json` | 新增 `recharts` 依赖 |

### 5.3 报告导出

**功能**: 一键导出对话流为 Markdown 文件或 PDF。

**Markdown 导出** (Phase 2A 已有 `/api/report`):

```markdown
# Multi-Agent 执行报告

**任务类型**: 编程 | **复杂度**: 高 | **耗时**: 10.1s

## Agent 执行过程

### Planner (2.1s)
> 1. 分析用户需求...

### Coder (3.5s)
> \`\`\`python
> import pandas as pd
> ...
> \`\`\`

## 最终输出

以下是完整的分析结果...
```

**前端触发**:

- 右侧栏"会话信息"Tab 底部 `[导出报告]` 按钮
- 监控页底部 `[导出报告]` 按钮
- 导出后触发浏览器下载，文件名: `report_{timestamp}.md`

**PDF 导出** (可选，优先级低于 Markdown):

- 使用 `html2canvas` + `jsPDF` 前端生成
- 或将 Markdown 渲染为 HTML → 打印为 PDF（浏览器 print）

**文件改动**:

| 文件 | 内容 |
|------|------|
| `frontend/src/lib/exportReport.ts` | 新建：Markdown 导出工具函数 |
| `frontend/src/components/layout/RightPanel/SessionInfoTab.tsx` | 导出按钮 |
| `frontend/src/pages/project/MonitorPage.tsx` | 导出按钮 |

### 5.4 Agent 动态开关（右侧栏 Tab 1）

详见第 3 节右侧栏 + 第 6 节 Agent 设计器。

---

## 6. P2 — 平台完整性

### 6.1 Agent 开关（右侧栏 Tab 1）

**功能**: 用户可在项目级别启用/停用特定 Agent。

**Agent 列表**:

| Agent | 是否可关闭 | 说明 |
|-------|-----------|------|
| Planner | ❌ 始终启用 | 任务规划是流程起点 |
| Retriever | ✅ 可关闭 | 关闭后跳过知识库检索 |
| Coder | ✅ 可关闭 | 关闭后编程任务降级为纯文本回答 |
| Writer | ✅ 可关闭 | 关闭后写作任务降级 |
| Executor | ✅ 可关闭 | 关闭后只生成代码不执行 |
| Tester | ✅ 可关闭 | 关闭后跳过 QA 审阅 |
| Summarizer | ❌ 始终启用 | 报告总结是流程终点 |
| Bot | ✅ 可关闭 | 关闭后低复杂度任务也走 Pipeline |

**后端动态图构建** (`router/stream_graph.py`):

```python
def build_stream_workflow(enabled: set = None) -> StateGraph:
    """根据启用的 Agent 集合动态构建 LangGraph。
    
    始终启用: Planner, Summarizer
    可切换: Retriever, Coder, Writer, Executor, Tester, Bot
    """
    if enabled is None:
        enabled = {"Planner", "Retriever", "Coder", "Writer",
                   "Executor", "Tester", "Summarizer", "Bot"}
    
    wf = StateGraph(StreamWorkflowState)
    
    # 始终添加 Planner 和 Summarizer
    wf.add_node("planner", planner_node)
    wf.add_node("summarizer", summarizer_node)
    wf.set_conditional_entry_point(_route_lane)
    
    # Bot 模式（低复杂度）
    if "Bot" in enabled:
        wf.add_node("bot", bot_node)
        wf.add_edge("bot", END)
    # 若 Bot 被禁用，低复杂度也走 Pipeline
    # _route_lane 逻辑需要适配
    
    wf.add_edge("planner", "retriever" if "Retriever" in enabled else 
               "coder" if "Coder" in enabled else
               "writer" if "Writer" in enabled else "summarizer")
    
    # 动态连接可选的 Retriever
    if "Retriever" in enabled:
        wf.add_node("retriever", retriever_node)
        next_after_retriever = "coder" if "Coder" in enabled else \
                               "writer" if "Writer" in enabled else "summarizer"
        wf.add_conditional_edges("retriever", 
            lambda s: next_after_retriever if s.get("task_type") != "写作" else 
                      ("writer" if "Writer" in enabled else "summarizer"))
    
    # 动态连接可选的 Coder → Executor → Tester
    if "Coder" in enabled:
        wf.add_node("coder", coder_node)
        if "Executor" in enabled:
            wf.add_node("executor", executor_node)
            wf.add_edge("coder", "executor")
            if "Tester" in enabled:
                wf.add_node("tester", tester_node)
                wf.add_conditional_edges("executor", _route_after_executor)
                wf.add_conditional_edges("tester", _route_test)
            else:
                wf.add_conditional_edges("executor", 
                    lambda s: "summarizer" if s.get("need_report") else END)
        else:
            # 有 Coder 无 Executor: Coder → Tester 或 Summarizer
            if "Tester" in enabled:
                wf.add_node("tester", tester_node)
                wf.add_edge("coder", "tester")
                wf.add_conditional_edges("tester", _route_test)
            else:
                wf.add_edge("coder", "summarizer")
    else:
        # 无 Coder，检查 Writer
        if "Writer" in enabled:
            wf.add_node("writer", writer_node)
            if "Tester" in enabled:
                wf.add_node("tester", tester_node)
                wf.add_edge("writer", "tester")
                wf.add_conditional_edges("tester", _route_test)
            else:
                wf.add_edge("writer", "summarizer")
    
    wf.add_edge("summarizer", END)
    return wf.compile()
```

**后端 API** (`workspace/routes.py` 追加):

```
GET  /api/projects/{project_id}/agent-config
     → { enabled_agents: [...], disabled_agents: [...] }

PUT  /api/projects/{project_id}/agent-config
     → body: { enabled_agents: [...] }
     → 更新 projects.agent_config 字段
```

**前端 UI** (右侧栏 Tab 1):

```
┌─ Agent 配置 ──────────────────────┐
│                                    │
│  🧋 Planner      [始终启用]        │
│  🐍 Retriever    ━━━━●━━━━        │
│  🫻 Coder        ━━━━●━━━━        │
│  ✍️ Writer       ━━━━○━━━━        │
│  ⚙️ Executor     ━━━━●━━━━        │
│  ✅ Tester       ━━━━●━━━━        │
│  🧊 Summarizer   [始终启用]        │
│  🤖 Bot          ━━━━●━━━━        │
│                                    │
│  [恢复默认]  [复制到其他项目]       │
└────────────────────────────────────┘
```

- daisyUI `toggle` 组件，品牌色 `#4f8cff`
- Planner/Summarizer 灰底标签 `始终启用`
- 改动即时通过 `PUT` API 保存

**文件改动**:

| 文件 | 内容 |
|------|------|
| `router/stream_graph.py` | `build_stream_workflow(enabled)` 动态图构建 |
| `router/stream.py` | 从 data 中读取 `enabled_agents` 传入 build |
| `workspace/routes.py` | agent-config GET/PUT API |
| `frontend/src/components/layout/RightPanel/AgentTab.tsx` | Toggle 列表 |
| `frontend/src/api/projects.ts` | 新增 `getAgentConfig` / `updateAgentConfig` |

### 6.2 Agent 设计器 (`/agents`)

**功能**: 可视化编辑 Agent 的 System Prompt + 模型选择 + 工具绑定。

**实现**:

- 使用 `<textarea>` + 语法高亮（简单方案），不引入 CodeMirror 减少包体积
- 如果后续需要 CodeMirror，Phase 3 再装
- 配置存储到 `user_config` 的 `roles` JSON 字段（Phase 1 已有 `upsert_user_config` 方法）

**UI**:

```
┌─ Agent 设计器 ──────────────────────────────────────────────┐
│                                                              │
│  ┌─ Agent 列表 ───┐ ┌─ 编辑区 ────────────────────────────┐ │
│  │                │ │                                      │ │
│  │ ● Planner      │ │  System Prompt                       │ │
│  │ ○ Retriever    │ │  ┌────────────────────────────────┐  │ │
│  │ ○ Coder        │ │  │ 你是高级项目经理。根据用户...    │  │ │
│  │ ○ Writer       │ │  │                                │  │ │
│  │ ○ Tester       │ │  │                                │  │ │
│  │ ○ Summarizer   │ │  │                                │  │ │
│  │ ○ Bot          │ │  └────────────────────────────────┘  │ │
│  │                │ │                                      │ │
│  │                │ │  模型选择                             │ │
│  │                │ │  ┌──────────┐                        │ │
│  │                │ │  │ deepseek │ ▼                      │ │
│  │                │ │  └──────────┘                        │ │
│  │                │ │                                      │ │
│  │                │ │  [恢复默认]  [保存]                    │ │
│  └────────────────┘ └──────────────────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**文件改动**:

| 文件 | 内容 |
|------|------|
| `frontend/src/pages/agent-design/AgentDesigner.tsx` | 新建：设计器页面 |
| `frontend/src/routes/index.tsx` | 新增 `/agents` 路由 |

### 6.3 模板市场 (`/templates`)

**功能**: 预置 5+ 场景模板，一键创建项目。

**模板结构**:

```json
{
  "id": "tpl-data-analysis",
  "name": "数据分析助手",
  "description": "上传 CSV 自动分组聚合、生成图表",
  "icon": "📊",
  "agent_config": {
    "enabled_agents": ["Planner", "Retriever", "Coder", "Executor", "Tester", "Summarizer"],
    "system_prompt_overrides": {}
  },
  "suggested_message": "请分析我上传的 sales.csv，按月份分组计算销售额，并生成柱状图"
}
```

**预置模板**:

| 模板 | 图标 | Agent 组合 |
|------|------|-----------|
| 代码助手 | 💻 | Planner + Retriever + Coder + Executor + Tester + Summarizer |
| 数据分析 | 📊 | Planner + Retriever + Coder + Executor + Summarizer |
| 论文写作 | 📝 | Planner + Retriever + Writer + Tester + Summarizer |
| 快速问答 | ⚡ | Bot only |
| 代码审查 | 🔍 | Planner + Coder + Tester + Summarizer |
| 知识问答 | 📚 | Planner + Retriever + Summarizer |

**一键创建流程**:

```
用户点击模板卡片
  → 弹出对话框：选择目标工作空间 + 输入项目名称
    → POST /api/w/{wid}/projects + agent_config 预设
      → 跳转到新项目的 ChatPage
```

**文件改动**:

| 文件 | 内容 |
|------|------|
| `frontend/src/pages/templates/TemplateMarket.tsx` | 已有占位页，重写为完整版 |
| `frontend/src/data/templates.ts` | 新建：预置模板数据 |
| `frontend/src/components/shared/TemplateCard.tsx` | 新建：模板卡片 |

### 6.4 管理后台 (`/admin`)

**功能**: 平台管理员专用。

**页面内容**:

```
┌─ 管理后台 ───────────────────────────────────────────┐
│                                                       │
│  ┌─ 概览卡片 ────────────────────────────────────┐  │
│  │  用户数      工作空间     项目数    活跃会话    │  │
│  │    12          5           23         3       │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│  ┌─ 用户列表 ────────────────────────────────────┐  │
│  │  ID    用户名   角色      注册时间    操作      │  │
│  │  abc1  admin   管理员    06/15      [降级]    │  │
│  │  def2  user1   普通用户  06/20      [升管理员] │  │
│  │  ghi3  user2   普通用户  06/22      [升管理员] │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│  ┌─ 系统配置 ────────────────────────────────────┐  │
│  │  DEEPSEEK_API_KEY  ●●●●●●●●●●●sk-xxxx  [编辑]  │  │
│  │  HF_ENDPOINT       https://hf-mirror.com       │  │
│  └────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

**后端 API**: Phase 1 已有 `/api/admin/users` + `/api/admin/users/{id}/admin`。

**文件改动**:

| 文件 | 内容 |
|------|------|
| `frontend/src/pages/admin/AdminPage.tsx` | 已有占位，重写为完整版 |
| `frontend/src/components/admin/UserTable.tsx` | 新建：用户列表表格 |
| `frontend/src/components/admin/StatsCards.tsx` | 新建：概览卡片 |

### 6.5 API 文档页 (Scalar UI)

FastAPI 自带 Swagger 在 `/docs`，将其替换为 Scalar UI：

```python
# main.py
from scalar_fastapi import get_scalar_api_reference

@app.get("/docs", include_in_schema=False)
async def scalar_docs():
    return HTMLResponse(get_scalar_api_reference(
        openapi_url="/openapi.json",
        title="Multi-Agent API 文档",
    ))
```

**文件改动**:

| 文件 | 内容 |
|------|------|
| `requirements.txt` | 新增 `scalar-fastapi` |
| `main.py` | 自定义 `/docs` 路由，挂载 Scalar UI |

---

## 7. P3 — 锦上添花（答辩后）

### 7.1 编排画布 (React Flow DAG)

拖拽式可视化 Agent 协作拓扑设计器。React Flow 安装 ~150KB gzipped，实现成本高但技术深度最强。建议答辩后再做。

### 7.2 审计日志

在 `audit_logs` 表中记录操作（用户创建/删除、权限变更、API Key 变更等），管理后台可查询。功能性模块，展示效果弱于仪表盘。

---

## 8. 路由最终全景

```
/                               → WorkspaceOverview
/login                          → LoginPage
/register                       → RegisterPage
/w/:workspaceId                 → WorkspaceDetail
/w/:workspaceId/p/:projectId/chat      → ChatPage (含右侧栏)
/w/:workspaceId/p/:projectId/monitor   → MonitorPage
/w/:workspaceId/p/:projectId/eval      → EvaluationPage
/agents                         → AgentDesigner
/templates                      → TemplateMarket
/settings                       → SettingsPage
/admin                          → AdminPage (AdminGuard)
```

---

## 9. 新增依赖总汇

### 后端 (`requirements.txt`)

```
scalar-fastapi          # API 文档 UI（Phase 1 已排除不必要依赖，这里重新评估）
```

### 前端 (`package.json`)

```
recharts                # P1 评估仪表盘图表
```

---

## 10. 新增数据库迁移

### v4: eval_logs 表

```sql
CREATE TABLE IF NOT EXISTS eval_logs (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id   TEXT,
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
```

---

## 11. 自检清单

- [x] 无 TBD/TODO 残留
- [x] P0-P3 优先级明确，每层独立可交付
- [x] 所有新增路由与现有 RBAC 模型一致
- [x] 右侧栏 + Agent 开关 + 动态图构建 三者设计统一
- [x] 新增依赖最小化（仅 recharts + scalar-fastapi）
- [x] 数据库迁移全新增表，不破坏现有结构
- [x] SSE 协议扩展向下兼容（agent_end 新增可选字段）
- [x] 不引入 React Flow / CodeMirror 等重型依赖到 P0-P2
