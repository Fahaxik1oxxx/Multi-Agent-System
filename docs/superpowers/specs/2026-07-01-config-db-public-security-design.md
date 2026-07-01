# Design Spec: 配置入库 + 公共项目 + 安全加固

**日期**: 2026-07-01
**版本**: 1.0
**状态**: 已审批

---

## 概述

将前端 localStorage 中的数据迁移到 SQLite 数据库，支持配置的公共发布和 GitHub 导出，同时加固安全基线。

---

## 一、数据库扩展 (Migration v10)

### 1.1 新表: `saved_configs`

替代 localStorage 中 `v3_configs_*`、`v3_prompt_templates`、`v3_proj_configs_*` 三个 key。

| 列 | 类型 | 约束 | 说明 |
|----|------|------|------|
| id | TEXT | PK, UUID | 配置唯一 ID |
| user_id | TEXT | FK → users, NOT NULL | 所属用户 |
| project_id | TEXT | FK → projects, NULLABLE | 关联项目 |
| name | TEXT | NOT NULL | 配置名称 |
| agents | TEXT | NOT NULL, DEFAULT '[]' | JSON 数组 |
| pipeline | TEXT | DEFAULT '{}' | JSON, 流水线 |
| prompts | TEXT | DEFAULT '{}' | JSON, 自定义 Prompt |
| is_public | INTEGER | DEFAULT 0 | 公共模板标志 |
| github_url | TEXT | DEFAULT '' | GitHub 导出地址 |
| created_at | TEXT | DEFAULT datetime | |
| updated_at | TEXT | DEFAULT datetime | |

**索引**: `(user_id)`, `(project_id)`, `(is_public, created_at)`

### 1.2 新表: `audit_logs`

| 列 | 类型 | 约束 | 说明 |
|----|------|------|------|
| id | TEXT | PK, UUID | |
| user_id | TEXT | NULLABLE | 操作人 |
| action | TEXT | NOT NULL | 事件类型 |
| detail | TEXT | DEFAULT '{}' | JSON 详情 |
| ip | TEXT | DEFAULT '' | 请求 IP |
| created_at | TEXT | DEFAULT datetime | |

**索引**: `(user_id, created_at)`, `(action, created_at)`, `(ip, created_at)`

### 1.3 现有表改动

- `users` 加 `goal TEXT DEFAULT ''` — 替代 localStorage `v3_current_goal`

### 1.4 废弃的 localStorage Key

迁移后以下 key 从前端删除：
`v3_configs_*`, `v3_proj_configs_*`, `v3_prompt_templates`, `v3_current_goal`, `v3_recent_projects`

---

## 二、配置 API

文件: `app/configs.py`, 前缀: `/api/configs`

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/configs` | 创建配置 | 需登录 |
| GET | `/api/configs` | 列表（支持 `?project_id=`） | 需登录 |
| GET | `/api/configs/{id}` | 详情 | 需登录 |
| PUT | `/api/configs/{id}` | 更新名称/agents/pipeline/prompts | 需登录+是作者 |
| DELETE | `/api/configs/{id}` | 删除 | 需登录+是作者 |
| POST | `/api/configs/{id}/publish` | 发布为公共模板 | 需登录+是作者 |
| POST | `/api/configs/{id}/unpublish` | 取消发布 | 需登录+是作者 |
| GET | `/api/configs/{id}/export` | 导出 JSON 下载 | 需登录+是作者 |
| POST | `/api/configs/{id}/export-github` | 导出到 GitHub Gist | 需登录+是作者 |

### 导出 JSON 格式

```json
{
  "name": "...",
  "agents": ["Planner", "Coder"],
  "pipeline": { "nodes": [...], "edges": [...] },
  "prompts": { "Planner": "...", "Coder": "..." },
  "exported_at": "2026-07-01T00:00:00Z"
}
```

---

## 三、公共模板市场

文件: `app/market.py`, 前缀: `/api/market`

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/market` | 公共模板列表（支持 `?search=`） | 无需 |
| GET | `/api/market/{id}` | 模板详情 | 无需 |
| POST | `/api/market/{id}/copy` | 复制到我的配置 | 需登录 |

前端: `TemplateMarket.tsx` 改为从 API 动态加载。

---

## 四、安全加固

### 4.1 注册密码 ≥ 6 位

`user/routes.py` 注册端点: 加 `if len(password) < 6: return 400 error`

### 4.2 CORS

`main.py` 加 CORSMiddleware，允许源通过环境变量 `CORS_ORIGINS` 配置。

### 4.3 登录失败锁定

在 `user/helpers.py` 或 `user/auth.py`:

- 同账号 5 次连续失败 → 锁定 15 分钟
- 同 IP 10 次连续失败 → 锁定 30 分钟
- 锁定期间直接返回 429，不提示"密码错误"
- 计数器基于 `audit_logs` 表的 `login_failed` 记录时间窗口内计数

### 4.4 审计日志

写入 `audit_logs` 的事件:
`login_failed`, `login_locked`, `config_publish`, `config_unpublish`, `config_delete`, `register`

### 4.5 `/coding` 目录保护

当前 `/coding` 静态文件无认证。改为通过 `/api/coding/{path}` 代理访问，加 `require_auth` 依赖。

---

## 五、前端迁移

| 改动 | 文件 |
|------|------|
| 配置 CRUD 改调 API | `V3AgentSelectPage.tsx` |
| 保存配置改调 API | `ConfigBuilderPage.tsx` |
| 编排保存改调 API | `OrchestrationPage.tsx` |
| Goal 改调 API | `V3Sidebar.tsx` |
| 模板市场动态加载 | `TemplateMarket.tsx` |
| 旧 localStorage 自动迁移 | `V3AgentSelectPage.tsx`（useEffect 检查旧 key → 调 API → 删除旧 key） |
| 删除 localStorage 工具函数 | `V3ChatPage.tsx`, `V3ProjectPage.tsx` 中清理 |

### 迁移逻辑

```
页面加载 → 检查 localStorage 是否有 v3_configs_${projectId}
→ 有: 逐条调 POST /api/configs 写入 DB → 成功后删除 localStorage key
→ 无: 正常从 API 加载
```

---

## 六、实施顺序

1. **数据库迁移 (v10)** — 建表，加 users.goal
2. **后端 API** — configs / market / export 端点
3. **安全加固** — 密码 / CORS / 锁定 / 审计日志
4. **前端迁移** — localStorage → API + 自动迁移逻辑
5. **模板市场改造** — 动态加载
6. **测试验证** — 各流程回归

---

## 七、不变更项

- JWT / bcrypt 机制不变
- slowapi 限流框架不变
- 用户注册流程不变（仅加密码长度校验）
- Org / Workspace 表结构不变
