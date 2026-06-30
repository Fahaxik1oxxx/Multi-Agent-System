# 用户个人设置增强 — 头像 + 简介 + 邮箱

**日期**: 2026-06-30
**状态**: 已批准

---

## 背景

当前设置页「账号」标签只有用户名和密码两个可编辑字段，缺少现代应用标配的个人资料功能。用户头像目前是顶部栏一个灰色圆 + 首字母的简陋实现。

## 设计

### 1. 后端 — 数据库 + API

**`user/db.py` — users 表新增 3 列：**

```sql
ALTER TABLE users ADD COLUMN avatar_seed TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN bio TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN email TEXT DEFAULT '';
```

迁移逻辑：执行 `ALTER TABLE ... ADD COLUMN`，如果列已存在则跳过（`db.py` 初始化时检查）。

**`user/routes.py` — `get_profile` 返回新字段：**

```json
{
  "user_id": "...",
  "user_name": "...",
  "is_admin": false,
  "created_at": "2026-06-30",
  "avatar_seed": "",
  "bio": "",
  "email": ""
}
```

**`user/routes.py` — `update_profile` 扩展参数：**

接受可选字段：`name`, `password`, `bio`, `email`, `avatar_seed`。只更新传入的非空字段。email 格式做基本校验（含 `@`）。

### 2. 前端 — 头像生成

**头像逻辑（纯前端，不依赖后端存储）：**

- 取 `avatar_seed`（有值用值，无值用 `user_id`）做哈希
- 哈希映射到预设的 8 色调色板（蓝/紫/绿/橙/粉/青/红/靛）
- 首字母取 `user_name` 的首字符大写
- 渲染为 64px 圆形，彩色背景 + 白色大字

顶部栏 `V3Sidebar` 用户按钮中的首字母圆同步升级为同样式（32px 小版）。

### 3. 前端 — 账号页面布局

SettingsModal「账号」标签改为左右两栏：

| 左侧 | 右侧 |
|---|---|
| 64px 彩色首字母头像 | 用户名输入框 |
| | 邮箱输入框 |
| | 简介输入框 |
| | 新密码输入框（留空不修改） |
| | 用户 ID（只读，灰色小字） |
| | 注册时间（只读，灰色小字） |
| | [保存] 按钮 |

### 4. 前端 — API 类型更新

**`frontend/src/api/user.ts`** — `getProfile` 返回类型增加 `avatar_seed`, `bio`, `email`, `created_at`。

---

## 影响范围

| 文件 | 改动类型 |
|---|---|
| `user/db.py` | users 表加 3 列 |
| `user/routes.py` | get_profile 返回 + update_profile 接受新字段 |
| `frontend/src/api/user.ts` | 类型更新 |
| `frontend/src/components/shared/SettingsModal.tsx` | 账号标签重新设计 |
| `frontend/src/components/layout/V3Sidebar.tsx` | 用户按钮头像升级彩色 |

---

## 测试要点

- [ ] 头像根据 user_id 生成不同颜色
- [ ] 设置 avatar_seed 后颜色固定可复现
- [ ] 编辑用户名/邮箱/简介/密码，保存后生效
- [ ] 邮箱格式做基本校验
- [ ] 留空字段不触发更新
- [ ] 顶部栏头像与设置页头像一致
- [ ] 旧用户升级后 avatar_seed 为空，自动用 user_id 生成
