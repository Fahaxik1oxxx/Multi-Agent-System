# 游客会话本地存储方案

## 目标

将游客（未登录）用户的对话从 SQLite 数据库迁移到浏览器 `sessionStorage`，注册用户保持不变。

- 游客对话不写入数据库，不存在服务端
- 游客刷新页面不丢失对话（sessionStorage 特性）
- 游客关闭标签页后对话清除
- 游客登录后，对话自动迁移到数据库

## 用户类型判定

```
isGuest = !localStorage.getItem("auth_user")
```

- `auth_user` 存在 → 注册用户 → 使用 SQLite
- `auth_user` 不存在 → 游客 → 使用 sessionStorage

## 数据流

### 保存会话

```
saveCurrentSession()
  ├─ isGuest → 写入 sessionStorage["guest_sessions"]（JSON 数组），跳过 API
  └─ !isGuest → 现有逻辑：POST /api/sessions → SQLite
```

sessionStorage 数据结构（与后端 sessions 表对齐）：

```json
[
  {
    "id": "1719234567890",
    "title": "帮我写一段Python代码",
    "messages": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}],
    "updated": "2026-06-24T16:00:00.000Z"
  }
]
```

### 加载历史

```
loadSessionHistory()
  ├─ isGuest → 从 sessionStorage["guest_sessions"] 读取，按时间分组渲染
  └─ !isGuest → 现有逻辑：GET /api/sessions?user_id= → 渲染
```

游客模式不显示"暂无对话记录"行，而是正常显示 sessionStorage 中的会话列表。无记录时显示"暂无对话记录"。

### 登录迁移

```
submitAuth() 登录成功后:
  1. 读取 sessionStorage["guest_sessions"]
  2. 如果存在：批量 POST /api/sessions（逐条保存，关联登录用户的 user_id）
  3. 清除 sessionStorage.removeItem("guest_sessions")
  4. 刷新侧栏 loadSessionHistory()
```

### 退出登录

```
logout():
  → 清空侧栏列表，显示"请先登录以查看历史"
  → 不做其他变更（游客对话已在 sessionStorage 中，如未关闭标签页则仍存在）
```

### 切换会话 / 删除会话

游客模式下：

- `switchSession(sid)`：从 sessionStorage 中查找会话，渲染消息到聊天区
- `deleteSession(sid)`：从 sessionStorage 中移除对应会话，刷新列表

## 改动清单

| 文件 | 位置 | 改动 |
|------|------|------|
| `static/js/chat.js` | `saveCurrentSession()` | 增加 `isGuest` 分支，写入 sessionStorage |
| `static/js/chat.js` | `ensureUserId()` | guest 时跳过 API 调用，返回空字符串 |
| `templates/components/sidebar.html` | `loadSessionHistory()` | 增加 guest 分支，从 sessionStorage 读取 |
| `templates/components/sidebar.html` | `switchSession()` | guest 分支，从 sessionStorage 查找 |
| `templates/components/sidebar.html` | `deleteSession()` | guest 分支，操作 sessionStorage |
| `templates/components/sidebar.html` | `submitAuth()` | 登录成功后迁移 sessionStorage → DB |
| `templates/components/sidebar.html` | `logout()` | 退出后重置侧栏 |

## 边界情况

1. **sessionStorage 容量**：浏览器通常限制 5MB，文本对话足够。超出时静默失败，console.warn
2. **多标签页**：sessionStorage 每个标签页独立，不影响
3. **浏览器隐私模式**：sessionStorage 正常工作
4. **游客发送消息但未保存**：`messageHistory` 变量不持久化，需刷新前发送至少一条消息触发 `saveCurrentSession()` 才会落入 sessionStorage

## 不变项

- 后端 API 无任何改动
- 数据库表结构无改动
- 注册用户的现有一切行为不变
- 聊天消息收发逻辑不变

## 不涉及

- 密码加密 / 真实认证系统
- 多设备同步
- 会话导出 / 导入
