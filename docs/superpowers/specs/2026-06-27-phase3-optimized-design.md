# 多智能体协作平台 — Phase 3 优化设计规格书

> 版本：v4.0
> 基于：重构计划书 v3 + 已完成的 P0-P2 前端壳 + 后端 API
> 日期：2026-06-27

---

## 一、基线说明

### 1.1 已完成的资产（不动）

以下功能已全部实现并验证通过，本阶段不涉及改动：

| 模块 | 前端 | 后端 | 状态 |
|------|------|------|------|
| SSE 流式聊天 | `useStreamChat.ts` + `ChatPage.tsx` | `router/stream.py` + `stream_graph.py` | ✅ |
| 会话持久化 | 自动保存 + 历史搜索 | `user/routes.py` sessions CRUD + FTS5 | ✅ |
| 思维链面板 | 折叠/展开 + 彩色标签 + 多次运行不覆盖 | `thinking` JSON 字段 | ✅ |
| Markdown 渲染 | `marked` + `highlight.js` + 一键复制 | — | ✅ |
| 文件上传 | 附件按钮 + 拖拽上传 | `app/knowledge.py` | ✅ |
| 右侧栏 | `RightPanel.tsx` 可拖拽 160-480px + 三 Tab | — | ✅ |
| Agent 开关 | `AgentTab.tsx` 8 个 toggle | `workspace/routes.py` agent-config | ✅ |
| 编排画布 | React Flow DAG + 拖拽 + 连线 + Router 编辑 | 读取 agent-config | ✅ |
| 评估仪表盘 | `EvaluationPage.tsx` recharts 图表 | `eval/log` + `eval/stats/{id}` | ✅ |
| SSE 监控页 | `MonitorPage.tsx` 时间线 | — | ✅ |
| Agent 设计器 | `AgentDesigner.tsx` 提示词编辑器 | `user/config` 存储 | ✅ |
| 模板市场 | `TemplateMarket.tsx` 6 套模板 | — | ✅ |
| 管理后台 | `AdminPage.tsx` 用户管理 | `admin/users` + `toggle_admin` | ✅ |
| Scalar API 文档 | — | `/scalar` 端点 | ✅ |
| 报告导出 | 弹窗预览 + 下载 .md | `/api/report` | ✅ |

### 1.2 约束条件

| 约束 | 值 |
|------|-----|
| 服务器内存 | ≤500MB（Render Free 实例） |
| Uvicorn workers | 1 |
| 文件上传限制 | ≤5MB |
| sentence-transformers | 懒加载 |
| SSE 清理 | 30 分钟无活动自动清理 |

---

## 二、Phase 1 — 体验闭环（3.5 天）

> 目标：新用户从打开网站到完成第一次 Agent 对话的完整体验

### 2.1 登录页视觉升级

**文件**：改造 `frontend/src/pages/auth/LoginPage.tsx`

**布局**：

```
┌──────────────────────────────────────────────┐
│                                               │
│  ┌──────────────┐  ┌──────────────────┐      │
│  │  产品介绍区    │  │    登录表单       │      │
│  │              │  │                  │      │
│  │ 🤖 多智能体   │  │ 用户名 [        ]│      │
│  │ 协作平台      │  │ 密码   [        ]│      │
│  │ 7 Agent 协作  │  │                  │      │
│  │              │  │  [    登录      ]│      │
│  │ 特色1/2/3    │  │                  │      │
│  │              │  │ 没有账号？注册   │      │
│  │ "XX 位用户"   │  │ ─── 或者 ───   │      │
│  │              │  │ 游客试用 ▶       │      │
│  └──────────────┘  └──────────────────┘      │
└──────────────────────────────────────────────┘
```

**产品介绍区内容**：
- 项目名 + "多智能体协作平台"
- 3 个核心特色：🧠 7 Agent 协作 / 🔧 自定义工作流 / 👥 团队共享
- 底部统计："已有 XX 位用户"

**交互**：
- 表单验证：空字段提示
- 登录成功 → 跳转主界面快速开始页
- 游客试用 → 不校验直接进入受限聊天
- 注册链接 → 跳转注册页

**工作量**：1 天

---

### 2.2 游客模式

**文件**：`frontend/src/App.tsx`、`frontend/src/api/client.ts`、`frontend/src/pages/project/ChatPage.tsx`

**后端新增**：
- `POST /api/chat/guest` — 免认证聊天端点（无 session 持久化，30 分钟过期）
- `POST /api/auth/migrate` — 游客会话迁移到注册账号

**前端行为**：

| 场景 | 行为 |
|------|------|
| 无 token 访问 | 不跳登录，直接进入受限聊天 |
| 游客发消息 | 调用免认证端点，回复不保存 |
| 游客点受限功能 | 弹窗"注册后可用"（编排画布、模板市场、Agent 设计器、知识库上传） |
| 游客注册 | 自动迁移当前会话到新账号 |
| 游客刷新 | 存 sessionStorage，关标签页即丢 |

**authStore 改动**：
- 新增 `isGuest` 状态
- `useAuthStore().isGuest` 控制功能门禁

**工作量**：1.5 天

---

### 2.3 网络搜索工具

**文件**：新增 `tools.py` 中的 `web_search` 工具函数

**方案**：`duckduckgo_search` 库（无需 API Key），返回前 5 条结果的标题 + 摘要 + URL

```python
from duckduckgo_search import DDGS

def web_search(query: str, max_results: int = 5) -> str:
    """搜索网络，返回 Markdown 格式结果"""
    with DDGS() as ddgs:
        results = list(ddgs.text(query, max_results=max_results))
    if not results:
        return "未找到相关结果。"
    lines = []
    for i, r in enumerate(results, 1):
        lines.append(f"{i}. **{r['title']}**\n   {r['body']}\n   {r['href']}")
    return "\n\n".join(lines)
```

**集成点**：
- `agents.py`：Planner 和 Bot agent 的 tool list 中加入 `web_search`
- `requirements.txt`：添加 `duckduckgo_search`

**演示效果**：问"今天有什么关于 AI 的新闻"→ Agent 实时搜索 → 流式输出结果

**工作量**：0.5 天

---

### 2.4 Agent 读取上传文件

**问题**：当前 `read_file` 工具只读 `coding/` 目录，不读知识库目录。用户上传文件后 Agent 无法读取内容。

**方案 A（推荐）**：上传文件时额外存一份到 `coding/` 目录

**文件**：修改 `app/knowledge.py`

```python
# 在 upload_file 函数中，保存到知识库后额外复制到 coding/
import shutil
coding_dir = os.path.join(_PROJECT_DIR, "coding")
os.makedirs(coding_dir, exist_ok=True)
shutil.copy2(saved_path, os.path.join(coding_dir, safe_filename))
```

**改动**：3 行代码，`read_file` 工具无需改动即可读取

**演示效果**：上传一个 `data.txt` → 问 Agent "读取 data.txt 并分析内容" → Agent 读取成功

**工作量**：0.5 天

---

## 三、Phase 2 — 主界面 + 基础团队（4.5 天）

> 目标：登录后有清晰的导航入口，能创建组织邀请队友

### 3.1 主界面快速开始页

**文件**：新建 `frontend/src/pages/home/HomePage.tsx`，修改 `frontend/src/routes/index.tsx`

**布局**：

```
┌──────────┬──────────────────────────────────────────┐
│ 左侧导航  │              主内容区                     │
│ 80px     │                                          │
│          │  ┌─ 欢迎回来，用户名 ──────────────────┐  │
│ 🧑 个人  │  │                                     │  │
│          │  │ [有什么我可以帮你的？................] │  │
│ 👥 团队  │  │                       [➤ 发送]      │  │
│          │  │  自动 · 快速 · 协作                  │  │
│ 📚 知识库 │  └─────────────────────────────────────┘  │
│          │                                            │
│ ⚙️ 设置  │  快速选择工作流：                          │
│          │  [⚡ 自动] [🔥 快速] [🦖 协作]            │
│          │  [💻 编程优化] [📝 写作优化]               │
│          │                                            │
│ ──────── │  最近对话：                                │
│ 用户信息  │  📝 今天问了快排...    2分钟前             │
│          │  📝 分析数据报告...    1小时前             │
└──────────┴──────────────────────────────────────────┘
```

**左侧竖排导航**（独立组件 `HomeSidebar`）：
- 🧑 个人模式 → `/personal`
- 👥 团队模式 → `/team`
- 📚 知识库 → `/knowledge`
- ⚙️ 设置 → `/settings`

**中间快速聊天**：
- 默认"自动"模式，输入后直接发送
- 点击发送 → 跳转到个人聊天页 `/personal` 并自动发送消息

**工作流卡片**：点击进入预设工作流（对应模板市场的模板）

**最近对话列表**：从 sessions API 拉取，点击恢复会话

**左侧栏收起/展开**：
- 左侧导航栏增加收起按钮（左上角 `◀` / `▶`）
- 收起后仅显示图标（48px 宽），展开恢复 80px
- 聊天页复用同一套收起逻辑（drawer 收起或侧栏收起）

**路由变更**：

```
旧 → 新
/ → 工作空间总览                  / → 主界面快速开始
/w/:wsId                         /personal/:wsId/:pid/chat → 聊天（完整左右侧栏）
                                 /team → 组织列表
                                 /knowledge → 知识库管理
                                 /settings → 模型管理（已有）
```

**工作量**：2 天

---

### 3.2 组织管理后端

**文件**：新增 `workspace/organizations.py` 路由，修改 `user/db.py`

**数据表**（migration v5）：

```sql
CREATE TABLE IF NOT EXISTS organizations (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    invite_code TEXT NOT NULL UNIQUE,  -- 6 位邀请码
    owner_id    TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS org_members (
    org_id    TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    role      TEXT NOT NULL DEFAULT 'member',  -- owner | member | viewer
    joined_at TEXT DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (org_id, user_id),
    FOREIGN KEY (org_id) REFERENCES organizations(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

**API 端点**：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/orgs` | 我的组织列表 |
| POST | `/api/orgs` | 创建组织 |
| GET | `/api/orgs/{org_id}` | 组织详情 + 成员列表 |
| PUT | `/api/orgs/{org_id}` | 更新组织信息 |
| DELETE | `/api/orgs/{org_id}` | 删除组织（仅 owner） |
| POST | `/api/orgs/{org_id}/members` | 邀请成员 |
| DELETE | `/api/orgs/{org_id}/members/{user_id}` | 移除成员 |
| POST | `/api/orgs/join` | 通过邀请码加入 |

**邀请码**：6 位随机字母数字，创建时自动生成

**工作量**：1.5 天

---

### 3.3 组织管理前端

**文件**：新建 `frontend/src/pages/team/TeamHome.tsx`

**布局**：

```
┌── 团队模式 ───────────────────────────────────┐
│  ← 主菜单                                      │
├───────────────────────────────────────────────┤
│                                                │
│  我的组织                                       │
│  ┌──────────────────────────┐  ┌────────┐     │
│  │ 👥 软件工程实训小组       │  │ [+创建]│     │
│  │ 5 名 · 最后活跃 2 分钟前  │  └────────┘     │
│  └──────────────────────────┘                  │
│                                                │
│  加入组织                                      │
│  ┌──────────────────────┐                     │
│  │ 邀请码 [        ] [加入] │                 │
│  └──────────────────────┘                     │
└───────────────────────────────────────────────┘
```

**点击组织** → 进入团队聊天页 `/team/:orgId`

**工作量**：0.5 天

---

## 四、Phase 3 — 团队聊天 + 补齐（5.5 天）

> 目标：团队内实时协作 + @agent 智能命令

### 4.1 团队聊天后端

**文件**：新增 `workspace/team_chat.py` 路由，修改 `user/db.py`

**数据表**（migration v5 扩展）：

```sql
CREATE TABLE IF NOT EXISTS org_channels (
    id      TEXT PRIMARY KEY,
    org_id  TEXT NOT NULL,
    name    TEXT NOT NULL DEFAULT 'general',
    FOREIGN KEY (org_id) REFERENCES organizations(id)
);

CREATE TABLE IF NOT EXISTS org_messages (
    id         TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    content    TEXT NOT NULL,
    is_agent   INTEGER DEFAULT 0,  -- 0=用户 1=Agent 回复
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (channel_id) REFERENCES org_channels(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS org_todos (
    id          TEXT PRIMARY KEY,
    org_id      TEXT NOT NULL,
    content     TEXT NOT NULL,
    assignee_id TEXT,
    completed   INTEGER DEFAULT 0,
    created_by  TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (org_id) REFERENCES organizations(id),
    FOREIGN KEY (assignee_id) REFERENCES users(id)
);
```

**API 端点**：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/orgs/{org_id}/channels` | 频道列表 |
| POST | `/api/orgs/{org_id}/channels` | 创建频道 |
| GET | `/api/orgs/{org_id}/channels/{ch_id}/messages` | 消息列表 |
| POST | `/api/orgs/{org_id}/channels/{ch_id}/messages` | 发送消息（含 @agent 命令解析） |
| GET | `/api/orgs/{org_id}/todos` | 待办列表 |
| POST | `/api/orgs/{org_id}/todos` | 创建待办 |
| PUT | `/api/orgs/{org_id}/todos/{todo_id}` | 更新/完成待办 |

**消息推送**：SSE 端点 `/api/orgs/{org_id}/stream` → 新消息实时推送到所有在线成员

**工作量**：1.5 天

---

### 4.2 团队聊天三栏界面

**文件**：新建 `frontend/src/pages/team/TeamChat.tsx`

**布局**：

```
┌──────────────┬──────────────────────────────┬──────────────┐
│ 左侧栏        │         团队聊天              │ 右侧栏        │
│ 共享知识库    │                              │ 待办列表      │
│ 📂 项目资料  │  # 日常 | # 开发 | # BUG     │ ☐ 修复登录   │
│ 📄 API 文档  │                              │ ☐ 编写 API   │
│ 📷 架构图    │ 用户A: 这个接口有 bug          │ ☐ 部署 v2    │
│              │ 用户B: 我看一下日志            │              │
│ [📤 上传]    │                              │ ✚ 新建待办   │
│              │ 用户C @agent 总结今天讨论      │ ──────────  │
│              │ ─── Agent ────               │ 成员在线     │
│              │ 📋 今日总结: ...              │ 🟢 用户A    │
│              │                              │ 🟢 用户B    │
│              │ 📎 用户A 上传了 架构图.png     │              │
│              │                              │              │
│              │ [输入框...] @agent [发送]      │              │
└──────────────┴──────────────────────────────┴──────────────┘
```

**核心组件**：
- `ChannelBar` — 频道切换标签
- `MessageList` — 消息流（区分用户消息 / Agent 回复 / 文件分享）
- `TodoPanel` — 待办列表 + 在线成员
- `TeamInput` — 输入框 + @agent 自动补全提示

**SSE 连接**：连接 `/api/orgs/{org_id}/stream`，新消息实时追加

**工作量**：2 天

---

### 4.3 @agent 命令

**文件**：`workspace/team_chat.py` 中的命令解析逻辑

| 命令 | 行为 | 实现 |
|------|------|------|
| `@agent 总结一下` | 调 LLM 总结最近 20 条消息 | `summarize_channel_history()` |
| `@agent 创建待办: xxx @user` | 解析文本，创建待办并 @ 成员 | `parse_todo_command()` |
| `@agent 搜索 xxx` | 按文件名搜知识库 | 复用现有 `search_knowledge` 工具 |

**命令解析**：前端检测 `@agent` 前缀 → 后端接收 → 正则提取命令类型 + 参数 → 执行对应操作 → 结果作为 Agent 消息写入频道

**工作量**：1 天

---

### 4.4 知识库独立页面

**文件**：新建 `frontend/src/pages/knowledge/KnowledgePage.tsx`

**内容**：
- 个人模式：文件列表 + 向量索引状态（已索引 / 未索引）
- 团队模式：组织的共享知识库文件列表
- 上传按钮 + 拖拽区域
- 文件搜索 + 删除

**复用**：`FilesTab.tsx` 的组件逻辑

**工作量**：0.5 天

---

### 4.5 模型管理增强

**文件**：改造 `frontend/src/pages/settings/SettingsPage.tsx`

**新增区域**：
- 当前模型池展示（系统默认 + 用户自定义）
- 添加自定义模型表单（key / model / base_url / api_key）
- 角色 → 模型映射选择器（每个 Agent 角色可独立选择模型）
- 删除自定义模型

**工作量**：0.5 天

---

## 五、演示用户路径

```
1. 打开网站 → 产品介绍页（7 Agent / 自定义工作流 / 团队共享）
2. 点击"游客试用" → 直接进入受限聊天
3. 游客问"今天有什么 AI 新闻" → Agent 实时网络搜索 → 流式输出
4. 游客点击"编排画布" → 弹窗"注册后可用"
5. 注册 → 自动登录，会话迁移到账号 → 进入主界面
6. 主界面 → 点击"个人模式" → 完整聊天
7. 发"写一个快排" → SSE 流式 → 右侧栏显示 Agent 状态
8. 关闭 Tester → 重新发送 → 跳过测试
9. 导出报告 .md
10. 切换到编排画布 → React Flow 拖拽节点 → 保存流水线
11. 切换到模板市场 → 选模板创建项目
12. 返回主界面 → 创建组织 → 复制邀请码
13. 新窗口以另一用户加入组织 → 团队聊天
14. @agent 总结今天讨论 → 生成总结
15. @agent 创建待办: 修复登录bug @队友 → 待办栏显示
16. 知识库上传文件 → 刷新列表
17. 模型管理页面配置 → 切换 Agent 模型
```

**全程约 15 分钟，覆盖全部功能。**

---

## 六、内存约束检查

| 新增模块 | 内存影响 | 风险 |
|----------|---------|------|
| 游客模式 | +0（复用现有端点） | 🟢 |
| 网络搜索 | +0（外部 HTTP 调用） | 🟢 |
| 组织/频道/消息表 | +极少量 SQLite | 🟢 |
| 团队 SSE 推送 | 每连接 ~1-2MB | 🟡 限制最多 5 个并发 SSE |
| @agent 总结 | 临时 LLM 调用 ~200MB | 🟡 串行化，总结完成后释放 |

**控制策略**：
- 团队 SSE 连接限制：`max_connections=5`
- LLM 调用串行化（同一时间只有 1 个 Agent 运行）
- 大型临时对象显式 `del` + `gc.collect()`
- ChromaDB 向量索引使用 LRU 缓存

---

## 七、总工作量汇总

| 阶段 | 内容 | 时间 |
|------|------|------|
| **Phase 1** | 登录页 + 游客模式 + 网络搜索 + Agent 读文件 | 3.5 天 |
| **Phase 2** | 主界面快速开始 + 组织管理后端 + 组织管理前端 + 左侧栏收起 | 4.5 天 |
| **Phase 3** | 团队聊天后端 + 团队聊天前端 + @agent 命令 + 知识库页 + 模型管理 | 5.5 天 |
| **合计** | | **13.5 天（~2.5 周）** |

```
Week 1: Phase 1 全部 + Phase 2 组织后端
Week 2: Phase 2 主界面 + 组织前端 + Phase 3 团队聊天后端
Week 3: Phase 3 团队聊天前端 + @agent + 补齐 + 演示打磨
```
