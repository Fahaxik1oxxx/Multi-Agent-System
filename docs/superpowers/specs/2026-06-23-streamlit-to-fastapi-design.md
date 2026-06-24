# 多智能体协作系统 — Streamlit → FastAPI Web 迁移设计

## 1. 目标

将前端从 Streamlit 迁移至 FastAPI + Jinja2 + Bootstrap 5 + 原生 JavaScript，保持所有核心业务逻辑不变。

## 2. 技术选型

| 维度 | 选择 | 理由 |
|------|------|------|
| Web 框架 | FastAPI | 现代 Python Web 标准，内置文件上传、依赖注入、自动 API 文档 |
| 模板引擎 | Jinja2 | FastAPI 默认支持，类似写 HTML，学习成本低 |
| CSS | Bootstrap 5 CDN | 现成组件（侧边栏/卡片/表单/栅格），少量定制 CSS 补充 |
| 交互 | 原生 JS fetch | 不引入前端框架，普通 HTTP JSON 请求/响应 |
| 实时性 | 一次性返回 | 等全部 Agent 跑完，一次性渲染结果 |

## 3. 架构

```
浏览器 (Bootstrap 5 + Jinja2 渲染)
┌──────────┐  ┌───────────────────────────┐
│ 侧边栏    │  │ 主聊天区                   │
│ - 模式切换│  │ - 消息列表                │
│ - 系统状态│  │ - Agent 卡片              │
│ - 知识库  │  │ - 聊天输入框              │
└──────────┘  └───────────────────────────┘
       │ POST /api/chat (JSON)
┌──────▼──────────────────────────────────┐
│  FastAPI 后端 (纯 Python)                │
│  main.py          FastAPI app + routes   │
│  app/chat.py      聊天管道 (不变)        │
│  workflow.py      LangGraph (不变)       │
│  agents/tools/executor/config (不变)     │
└─────────────────────────────────────────┘
```

## 4. 路由设计

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/` | 聊天页面（Jinja2 渲染） |
| `POST` | `/api/chat` | 发送消息，返回 `{reply, thinking, task_type, generated_files}` |
| `POST` | `/api/knowledge/upload` | 上传文档（PDF/TXT/图片） |
| `POST` | `/api/knowledge/rebuild` | 重建知识库索引 |
| `DELETE` | `/api/knowledge/{filename}` | 删除文档 |
| `GET` | `/api/knowledge/stats` | 返回 `{文档数, 切片数}` |
| `POST` | `/api/report` | 从 thinking 生成详细 Markdown 报告 |

## 5. 前端模板结构

```
templates/
├── base.html              # 布局骨架：侧边栏 + 主区域
├── index.html             # 聊天页面（继承 base）
└── components/
    ├── sidebar.html       # 模式切换、系统状态、知识库管理
    ├── message.html       # 单条聊天消息气泡
    ├── agent_card.html    # Agent 思考卡片（彩色标签）
    └── file_badge.html    # 生成文件展示

static/
├── css/custom.css         # Agent 配色、聊天气泡、侧边栏暗色风格
└── js/chat.js             # 发送消息、渲染结果、知识库 CRUD
```

## 6. 文件改动清单

| 文件 | 动作 | 说明 |
|------|:--:|------|
| `main.py` | 重写 | Streamlit 入口 → FastAPI app + 所有路由 |
| `app/components.py` | 删除 | Streamlit 组件 → 改为 `templates/components/` 下的 Jinja2 宏（不保留为 Python 文件） |
| `app/knowledge.py` | 重写 | Streamlit 侧边栏 UI → FastAPI 路由 + 文件上传处理 |
| `agents.py` | 微改 | `@st.cache_resource` → `functools.lru_cache` |
| `requirements.txt` | 微改 | `streamlit` → `fastapi` + `uvicorn` + `jinja2` + `python-multipart` |

**不动的文件（零 Streamlit 依赖）：**

| 文件 | 说明 |
|------|------|
| `workflow.py` | LangGraph 工作流 |
| `tools.py` | LangChain 工具集合 |
| `executor.py` | 代码执行沙箱 |
| `config.py` | LLM 模型配置 |
| `app/chat.py` | 聊天管道 `run_chat_pipeline()` |
| `rag/` | ChromaDB 知识库 |

**新增文件：**

| 文件 | 说明 |
|------|------|
| `templates/base.html` | Bootstrap 5 布局骨架 |
| `templates/index.html` | 聊天主页面 |
| `templates/components/sidebar.html` | 侧边栏 |
| `templates/components/message.html` | 消息组件 |
| `templates/components/agent_card.html` | Agent 卡片 |
| `templates/components/file_badge.html` | 文件展示 |
| `static/css/custom.css` | 定制样式 |
| `static/js/chat.js` | 聊天交互 |

## 7. 数据流

```
用户输入消息
  → chat.js 拦截表单 submit
  → fetch POST /api/chat { "message": "...", "lane_mode": "slow"|"fast", "history": [...] }
  → FastAPI 调用 run_chat_pipeline()
  → LangGraph 编排全部 Agent 执行
  → 返回 JSON { reply, thinking, task_type, generated_files }
  → chat.js 动态创建消息气泡 + Agent 卡片，追加到聊天区
```

无 WebSocket / SSE，全程普通 HTTP 请求。前端通过 JS 动态 DOM 操作实现消息追加。

## 8. 错误处理

| 场景 | 处理方式 |
|------|------|
| API 网络错误 | JS catch → 消息气泡变红，显示"请求失败，请重试" |
| 后端异常 (500) | FastAPI 返回 `{error: "..."}` → JS 显示具体原因 |
| LLM 超时 / Key 无效 | `run_chat_pipeline` 内已有 try/catch，返回错误文本 |
| 知识库操作失败 | 返回 `{success: false, error: "..."}` → JS toast 提示 |
| 文件上传过大 | FastAPI `RequestValidationError` 自动拦截 |

## 9. 测试策略

| 层级 | 工具 | 覆盖场景 |
|------|------|------|
| 路由测试 | pytest + httpx.AsyncClient | 所有 API 端点 200/错误码 |
| 工作流测试 | 沿用现有 | `run_chat_pipeline` 回归 |
| 前端验证 | 浏览器手动测试 | 发消息、切换车道、知识库上传/删除/重建 |

## 10. 迁移后的启动方式

```bash
# 安装依赖
pip install -r requirements.txt

# 启动（替代 streamlit run main.py）
uvicorn main:app --reload --port 8501
```

浏览器打开 `http://localhost:8501`。

## 11. 不做的事情

- 不引入 WebSocket / SSE（用户选择一次性展示）
- 不引入前端框架（React / Vue）
- 不引入 Node.js 构建工具链
- 不动核心业务逻辑（workflow / agents / tools / executor / config / chat）
