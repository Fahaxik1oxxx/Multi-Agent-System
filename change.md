# 新增功能：联网搜索（Web Search）开关

基于 commit `23d29e1`（`frontend-ui-recovery` 分支），未提交改动汇总。

---

## 后端（5 个文件）

### 1. `router/router.py`

| 改动 | 原因 |
|------|------|
| `ChatRequest` 新增 `web_search_enabled: bool = Field(default=False)` | 前端通过 POST body 告知是否开启联网搜索 |

### 2. `router/stream.py`

| 改动 | 原因 |
|------|------|
| `StreamWorkflowState` 初始状态传入 `web_search_enabled` 和 `web_search_results=""` | 将前端开关和空搜索结果传给 LangGraph 初始状态 |

### 3. `router/stream_graph.py`（核心改动）

| 改动 | 原因 |
|------|------|
| `StreamWorkflowState` 新增 `web_search_enabled: bool` 和 `web_search_results: str` | LangGraph state 承载开关和搜索结果 |
| 新增 `web_search_node()` 预搜索节点 | 在 LLM 流水线前执行搜索（LLM 未绑定 tools） |
| `web_search_node` 使用 LLM 提取搜索关键词 | 将口语化问题转为搜索引擎关键词，提高 Bing 相关性 |
| `web_search_node` 生成多组搜索词（原句、月+原句、日期+原句）去重搜索 | 多角度搜索提高召回率 |
| `web_search_node` 结果去重 + `[webpage N]` 格式化 + 限 8 条 | 避免重复，提供结构化引用格式 |
| 图入口改为 `__start__ → web_search → _route_lane` | 每条消息先走搜索节点决定是否搜索 |
| `bot_node` / `planner_node`：仅当 `web_search_results` 非空时注入「当前时间 + 搜索结果 + 3 条严格约束」 | 搜索开启时要求 Bot 基于搜索结果回答；关闭时 Bot 用自身知识正常回答 |
| `retriever_node` / `coder_node` / `writer_node`：搜索开启时注入搜索结果 | 各节点在有搜索数据时可参考 |

### 4. `tools.py`

| 改动 | 原因 |
|------|------|
| `web_search()` 从 DuckDuckGo 重写为 Bing 网页抓取 | Django 的 duckduckgo_search 在国内不可用 |
| 解析引擎：`requests` + `re`（`<li class="b_algo">`） | `lxml.cssselect` 无法安装（PEP 668） |

### 5. `agents.py`

| 改动 | 原因 |
|------|------|
| Bot 系统提示：删除 `"使用 web_search 工具搜索后回答"` | 旧提示让 LLM 调用不存在的 tool，导致编造结果 |
| Planner 系统提示：删除 `"首先使用 web_search 工具搜索获取最新数据"` | 同上 |

---

## 前端（4 个文件）

### 6. `frontend/src/hooks/useStreamChat.ts`

| 改动 | 原因 |
|------|------|
| `startStream()` 新增参数 `webSearchEnabled: boolean = false`（放在 `onComplete` 之后） | 向后兼容 |
| `startStream` POST body 中传入 `web_search_enabled` | 将开关传给后端 |

### 7. `frontend/src/pages/chat/V3ChatPage.tsx`

| 改动 | 原因 |
|------|------|
| 新增 `WebSearch` 到 `AGENT_META` / `ICONS` / `COLORS` | thinking 面板正确显示图标和颜色 |
| 新增 `webSearchEnabled` 状态（默认 false） | 开关状态 |
| 欢迎区和底部输入区分别添加 🌐 联网搜索开关 pill | 用户手动切换 |
| `handleSend` 传 `webSearchEnabled` 给 `startStream` | 发送时携带开关 |

### 8. `frontend/src/components/shared/Markdown.tsx`

| 改动 | 原因 |
|------|------|
| 解析前将 `[citation:N]` 替换为 `<sup class="citation">[N]</sup>` | LLM 回答中可能含引用标记，渲染为蓝色上标避免显示原始文本 |

### 9. `frontend/src/index.css`

| 改动 | 原因 |
|------|------|
| 新增 `.markdown-body sup.citation` 样式 | 蓝色 `#4f8cff`、小号加粗，美化 citation 外观 |
