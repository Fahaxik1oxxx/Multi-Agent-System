# 用户管理体系重构 实现计划

**目标：** 清理遗留代码，重构用户管理为 `user/` 包，统一配置系统，消除前后端 key/display_name 不一致。

**范围：** 纯后端用户模块重构 + 前端配置面板适配，不涉及 RAG 知识库。

---

### Task 1: 清理遗留桥接文件

删除以下无任何引用的文件：
- `db.py`（根目录）— 仅一行 `from user.db import Database`
- `app/auth.py` — 从 `user.*` re-export 的桥接

### Task 2: user/ 包职责分层

- `user/auth.py` — 纯函数：bcrypt 哈希 + JWT 编解码
- `user/db.py` — 纯 CRUD：三张表（users/sessions/user_configs）
- `user/helpers.py` — FastAPI 依赖注入：`require_auth`、`_get_db`
- `user/routes.py` — 业务逻辑 + API 路由

清理：
- `db.py` 中 `list_sessions` 的标题提取逻辑移到 `routes.py`
- `upsert_session`/`upsert_user_config` 返回原始类型而非 `{"status": "ok"}`
- 移除 `LoginRateLimiter`（清空其他校验规则）
- users 表去掉 `email` 列

### Task 3: 配置系统统一

- `config.py` 作为唯一默认源
- 新增 `GET /api/auth/system-config` 公开接口，返回 `ROLE_MODEL` + `MODEL_POOL`
- 自定义模型格式由 `{"name": ...}` 改为 `{"key": ..., "model": ..., "base_url": ..., "api_key": ...}`
- 下拉菜单用 key 做 value，显示名作文本
- `currentRoles` 存 key 而非 display_name
- 游客 localStorage 双轨，注册用户同步后端

### Task 4: 前后端细节修复

- 登录/注册 tab 切换清空输入框
- 退出登录清空配置缓存，回退系统默认
- 模型管理面板：系统模型/自定义模型分离展示，弹窗添加

### Task 5: 数据库追踪脚本

- 新增 `watch_db.py`，检测 `data.db` mtime 变化后 dump 到 `db_debug.log`

### 未完成

- 知识库聊天检索路径仍写死 `user_id="shared"`（后续解决）
