# 用户个人设置增强 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 设置页「账号」标签增加彩色首字母头像、邮箱、个人简介，顶部栏头像同步升级。

**Architecture:** 后端 users 表加 3 列 + API 扩展返回/更新字段 + 前端纯 CSS 生成头像（user_id 哈希→8 色调色板）+ SettingsModal 账号标签重新布局。

**Tech Stack:** Python (FastAPI, SQLite), TypeScript (React, TailwindCSS)

## Global Constraints

- 头像纯前端生成，不存储图片文件
- `avatar_seed` 为空时用 `user_id` 生成颜色
- 邮箱做基本格式校验（含 `@`）
- 留空字段不触发更新
- 顶部栏和设置页头像一致

---

## 文件结构

```
user/db.py                          # 改: users 表迁移加 3 列
user/routes.py                      # 改: get_profile 返回 + update_profile 接受新字段
frontend/src/api/user.ts            # 改: 类型更新
frontend/src/components/shared/
  SettingsModal.tsx                 # 改: 账号标签重新布局
frontend/src/components/layout/
  V3Sidebar.tsx                     # 改: 用户按钮头像升级彩色
```

---

### Task 1: 后端 — 数据库迁移

**Files:**
- Modify: `user/db.py:85-90`

**Interfaces:**
- Consumes: (none)
- Produces: users 表新增 `avatar_seed`, `bio`, `email` 列

- [ ] **Step 1: 修改 CREATE TABLE 语句**

在 `user/db.py` 的 `CREATE TABLE IF NOT EXISTS users` 中加入新列：

```python
CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    password   TEXT NOT NULL DEFAULT '',
    avatar_seed TEXT DEFAULT '',
    bio        TEXT DEFAULT '',
    email      TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
```

- [ ] **Step 2: 添加迁移逻辑**

在同一文件 `_migrate()` 或初始化函数中加入 ALTER TABLE（忽略列已存在错误）：

```python
for col, dtype in [("avatar_seed", "TEXT DEFAULT ''"), ("bio", "TEXT DEFAULT ''"), ("email", "TEXT DEFAULT ''")]:
    try:
        c.execute(f"ALTER TABLE users ADD COLUMN {col} {dtype}")
    except sqlite3.OperationalError:
        pass  # 列已存在
```

- [ ] **Step 3: 验证**

```bash
python -c "from user.db import Database; d=Database('data.db'); c=d.conn.execute('PRAGMA table_info(users)'); print([r[1] for r in c.fetchall()])"
```

预期输出含 `avatar_seed`, `bio`, `email`。

- [ ] **Step 4: Commit**

```bash
git add user/db.py
git commit -m "feat(db): users 表新增 avatar_seed, bio, email 列"
```

---

### Task 2: 后端 — API 扩展

**Files:**
- Modify: `user/routes.py:252-280`

**Interfaces:**
- Consumes: `db.get_user_by_id()` 返回含新列的行
- Produces: `get_profile` 返回 `avatar_seed`, `bio`, `email`；`update_profile` 接受 `bio`, `email`, `avatar_seed`

- [ ] **Step 1: 修改 `get_profile` 返回新字段**

```python
@user_router.get("/profile")
async def get_profile(request: Request, user: dict = Depends(require_auth)):
    db = _get_db(request)
    u = db.get_user_by_id(user["user_id"])
    is_admin = db.is_admin(user["user_id"])
    return JSONResponse(
        {
            "user_id": u["id"],
            "user_name": u["name"],
            "is_admin": is_admin,
            "created_at": u.get("created_at", ""),
            "avatar_seed": u.get("avatar_seed", "") or user["user_id"],
            "bio": u.get("bio", ""),
            "email": u.get("email", ""),
        }
    )
```

- [ ] **Step 2: 修改 `update_profile` 接受新字段**

```python
@user_router.put("/profile")
async def update_profile(request: Request, user: dict = Depends(require_auth)):
    data = await request.json()
    db = _get_db(request)
    new_name = (data.get("name") or "").strip()
    new_password = data.get("password", "")
    bio = (data.get("bio") or "").strip()
    email = (data.get("email") or "").strip()
    avatar_seed = (data.get("avatar_seed") or "").strip()

    if new_name:
        existing = db.get_user(new_name)
        if existing and existing["id"] != user["user_id"]:
            return JSONResponse({"error": "用户名已被占用"}, status_code=409)
        db.update_user_name(user["user_id"], new_name)

    if new_password:
        if len(new_password) < 6:
            return JSONResponse({"error": "密码至少 6 位"}, status_code=400)
        db.update_user_password(user["user_id"], new_password)

    if email and "@" not in email:
        return JSONResponse({"error": "邮箱格式不正确"}, status_code=400)

    fields = {}
    if bio: fields["bio"] = bio
    if email: fields["email"] = email
    if avatar_seed: fields["avatar_seed"] = avatar_seed
    if fields:
        db.update_user_fields(user["user_id"], fields)

    return JSONResponse({"status": "ok"})
```

- [ ] **Step 3: 在 `user/db.py` 添加 `update_user_fields` 方法**

```python
def update_user_fields(self, user_id: str, fields: dict):
    sets = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [user_id]
    self.conn.execute(f"UPDATE users SET {sets} WHERE id = ?", values)
    self.conn.commit()
```

- [ ] **Step 4: Commit**

```bash
git add user/routes.py user/db.py
git commit -m "feat(api): profile 返回/更新 avatar_seed, bio, email"
```

---

### Task 3: 前端 — API 类型更新

**Files:**
- Modify: `frontend/src/api/user.ts`

- [ ] **Step 1: 更新类型定义**

```typescript
import apiClient from './client';

export interface UserProfile {
  user_id: string;
  user_name: string;
  is_admin: boolean;
  created_at: string;
  avatar_seed: string;
  bio: string;
  email: string;
}

export const userApi = {
  getProfile: () =>
    apiClient.get<UserProfile>('/user/profile'),

  updateProfile: (data: {
    name?: string;
    password?: string;
    bio?: string;
    email?: string;
    avatar_seed?: string;
  }) =>
    apiClient.put('/user/profile', data),

  // ... 其余保持不变
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/user.ts
git commit -m "feat(frontend): 更新 UserProfile 类型含 avatar_seed, bio, email"
```

---

### Task 4: 前端 — 头像组件 + 账号页面

**Files:**
- Modify: `frontend/src/components/shared/SettingsModal.tsx`

- [ ] **Step 1: 添加头像颜色生成函数（SettingsModal 顶部）**

```tsx
const AVATAR_COLORS = ['#4f8cff', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#6366f1'];

function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function AvatarCircle({ seed, name, size = 64 }: { seed: string; name: string; size?: number }) {
  const bg = avatarColor(seed);
  const initial = (name || '?').charAt(0).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: bg, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, fontWeight: 700,
      userSelect: 'none', flexShrink: 0,
    }}>{initial}</div>
  );
}
```

- [ ] **Step 2: 重新设计账号标签 JSX（替换现有的 `tab === 'account'` 内容）**

```tsx
{tab === 'account' && (
  <div className="space-y-4">
    <h3 className="text-sm font-semibold text-[#1d1d1f]">账号</h3>

    {/* 头像 + 表单 */}
    <div className="flex gap-4">
      <AvatarCircle seed={profile?.avatar_seed || ''} name={profile?.user_name || ''} size={64} />
      <div className="flex-1 space-y-2.5">
        <div>
          <label className="text-[10px] text-[#81858c] block mb-0.5">用户名</label>
          <input className="input input-bordered w-full text-xs"
            style={{ borderRadius: '8px', borderColor: '#e0e4e8' }}
            value={editName} onChange={e => setEditName(e.target.value)} />
        </div>
        <div>
          <label className="text-[10px] text-[#81858c] block mb-0.5">邮箱</label>
          <input className="input input-bordered w-full text-xs"
            style={{ borderRadius: '8px', borderColor: '#e0e4e8' }}
            value={editEmail} onChange={e => setEditEmail(e.target.value)}
            placeholder="example@mail.com" />
        </div>
        <div>
          <label className="text-[10px] text-[#81858c] block mb-0.5">个人简介</label>
          <input className="input input-bordered w-full text-xs"
            style={{ borderRadius: '8px', borderColor: '#e0e4e8' }}
            value={editBio} onChange={e => setEditBio(e.target.value)}
            placeholder="介绍一下自己..." />
        </div>
        <div>
          <label className="text-[10px] text-[#81858c] block mb-0.5">新密码（留空不修改）</label>
          <input type="password" className="input input-bordered w-full text-xs"
            style={{ borderRadius: '8px', borderColor: '#e0e4e8' }}
            value={editPassword} onChange={e => setEditPassword(e.target.value)}
            placeholder="至少 6 位" />
        </div>
      </div>
    </div>

    {/* 只读信息 */}
    <div className="flex gap-4 text-[10px] text-[#9ca3af]">
      <span>用户 ID: {profile?.user_id ?? ''}</span>
      <span>注册时间: {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('zh-CN') : ''}</span>
    </div>

    <button className="btn btn-xs" disabled={profileMutation.isPending} onClick={() => profileMutation.mutate()}
      style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '8px', border: 'none' }}>
      保存
    </button>
  </div>
)}
```

- [ ] **Step 3: 添加新 state 变量并更新 mutation 和初始化逻辑**

在组件顶部加入 state：
```tsx
const [editEmail, setEditEmail] = useState('');
const [editBio, setEditBio] = useState('');
```

在 `getProfile` 的 `queryFn` 中初始化：
```tsx
queryFn: async () => {
  const res = await userApi.getProfile();
  setEditName(res.data.user_name);
  setEditEmail(res.data.email || '');
  setEditBio(res.data.bio || '');
  return res.data;
},
```

`profileMutation` 更新为：
```tsx
mutationFn: async () => {
  const data: Record<string, string> = {};
  if (editName && editName !== user?.user_name) data.name = editName;
  if (editPassword) data.password = editPassword;
  if (editEmail !== (profile?.email || '')) data.email = editEmail;
  if (editBio !== (profile?.bio || '')) data.bio = editBio;
  if (Object.keys(data).length === 0) throw new Error('无变更');
  await userApi.updateProfile(data);
},
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/shared/SettingsModal.tsx
git commit -m "feat(frontend): 设置页账号标签 — 头像 + 邮箱 + 简介"
```

---

### Task 5: 前端 — 顶部栏头像升级

**Files:**
- Modify: `frontend/src/components/layout/V3Sidebar.tsx:69-72`

- [ ] **Step 1: 替换用户按钮中的灰色圆为彩色头像**

当前代码（第 69-72 行）：
```tsx
<div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[9px] font-medium text-gray-500">
  {isGuest ? '?' : (user?.user_name?.charAt(0).toUpperCase() || '?')}
</div>
```

改为：
```tsx
<div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
  style={{ background: avatarColor(user?.user_id || 'guest') }}>
  {isGuest ? '?' : (user?.user_name?.charAt(0).toUpperCase() || '?')}
</div>
```

并在 V3Sidebar 顶部引入 `avatarColor` 函数和 `AVATAR_COLORS` 常量（从 SettingsModal 复制，或提取到共享文件）。

- [ ] **Step 2: 将 `avatarColor` 和 `AVATAR_COLORS` 提取到共享位置**

创建 `frontend/src/lib/avatar.ts`：
```typescript
export const AVATAR_COLORS = ['#4f8cff', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#6366f1'];

export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function avatarInitial(name: string): string {
  return (name || '?').charAt(0).toUpperCase();
}
```

SettingsModal 和 V3Sidebar 均从 `@/lib/avatar` 导入。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/avatar.ts frontend/src/components/layout/V3Sidebar.tsx
git commit -m "feat(frontend): 顶部栏用户头像升级彩色，提取共享 avatar 工具"
```

---

## 验证

- [ ] 启动后端：`uvicorn main:app --port 8000`
- [ ] 启动前端：`cd frontend && npm run dev`
- [ ] 打开设置 → 账号，确认显示彩色首字母头像
- [ ] 编辑邮箱、简介、密码，保存后刷新确认持久化
- [ ] 确认顶部栏头像与设置页头像颜色一致
- [ ] 新注册用户自动获得随机彩色头像
