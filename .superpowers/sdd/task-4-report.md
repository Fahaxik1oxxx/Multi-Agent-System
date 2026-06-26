# Task 4 Report: 用户设置增强 API

## 状态: 完成

## 变更摘要

在 `user/routes.py` 新增 Profile 与 API Key 管理端点，在 `main.py` 更新 `/api/chat` 端点以支持用户自定义 API Key。

## 修改文件

- `user/routes.py` — 新增 GET/PUT `/api/user/profile` 和 GET/PUT/DELETE `/api/user/api-key` 端点
- `main.py` — `/api/chat` 端点增加 `user_id` 和 `model_config_override` 参数支持

## 实现详情

### 1. Profile 端点 (`user/routes.py` lines 232-273)

- `GET /api/user/profile` — 返回 `{user_id, user_name, is_admin}`
- `PUT /api/user/profile` — 更新用户名和/或密码，含用户名冲突检查（409）

### 2. API Key 管理 (`user/routes.py` lines 276-332)

- `GET /api/user/api-key` — 返回 `{has_custom_key, using_system_default}`，不暴露完整 Key
- `PUT /api/user/api-key` — 保存/覆盖自定义 DeepSeek API Key，存储为模型 `a-deepseek`
- `DELETE /api/user/api-key` — 删除自定义 Key，回退到系统默认

### 3. Chat 端点更新 (`main.py` lines 104-144)

- 从 JWT Bearer token 解析 `user_id`
- 将 `user_id` 和 `model_config_override` 传入 `run_chat_pipeline`
- 注：`run_chat_pipeline` 的 `user_id`/`model_config_override` 参数为后续联动任务

## 测试结果

```
============================= 26 passed in 23.36s =============================
```

所有已有测试全部通过：

- `tests/test_fts5.py` — 17 passed
- `tests/test_knowledge_routes.py` — 9 passed

## Commit

```
1c2b1cf feat(api): 用户 Profile + API Key 管理端点
```

## 关注点

- `run_chat_pipeline` 在 `app/chat.py` 中需增加 `user_id` 和 `model_config_override` 参数签名才能端到端生效，这是后续联动任务。
- Profile PUT 端点对用户名更新使用了直接 SQL UPDATE，而非 Database 类封装方法，与代码库其余部分存在分层不一致。

## 报告路径

`D:\AI\Internship\Multi_Agent\.superpowers\sdd\task-4-report.md`

---

## 修正报告: Spec Compliance 修复 (2026-06-26)

### 问题 1: GET /api/user/profile 缺少 `created_at`

**根因**: `get_user_by_id()` 仅 SELECT `id, name`，未包含 `created_at` 字段。路由处理器也未在响应中返回此字段。

**修复**:
- `user/db.py` line 286: `get_user_by_id()` 的 SQL 查询从 `SELECT id, name` 改为 `SELECT id, name, created_at`
- `user/routes.py` lines 239-243: GET `/api/user/profile` 响应新增 `"created_at": u.get("created_at", "")`

### 问题 2: GET /api/user/api-key 缺少 `key_prefix`

**根因**: 处理器返回 `{has_custom_key, using_system_default}`，而 spec 要求返回 `{has_custom_key, key_prefix}`。

**修复**:
- `user/routes.py` lines 278-291: GET `/api/user/api-key` 处理器重写，通过 `next(...)` 定位自定义模型条目并计算 `key_prefix`（取 API key 前 7 位 + "..."），将响应字段 `using_system_default` 替换为 `key_prefix`

### 测试结果

```
============================= 26 passed in 24.23s =============================
```

所有 26 个已有测试全部通过，无回归。
