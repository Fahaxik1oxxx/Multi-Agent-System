import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userApi } from '@/api/user';
import { useAuthStore } from '@/stores/authStore';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { avatarColor } from '@/lib/avatar';

const TABS = [
  { id: 'account', label: '账号', icon: '🧑' },
  { id: 'model', label: '模型与映射', icon: '🤖' },
];

const ROLES = ['Planner', 'Retriever', 'Coder', 'Writer', 'Executor', 'Tester', 'Summarizer', 'Bot'];

export function SettingsModal({ initialTab }: { initialTab?: string }) {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(initialTab || 'account');

  // ── 账号 ──
  const [editName, setEditName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editBio, setEditBio] = useState('');

  // ── 模型 ──
  const [customForm, setCustomForm] = useState({ key: '', model: '', base_url: '', api_key: '' });
  const [showForm, setShowForm] = useState(false);

  // ── 角色映射 ──
  const [roleModels, setRoleModels] = useState<Record<string, string>>({});

  // ── 查询 ──
  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const res = await userApi.getProfile();
      setEditName(res.data.user_name);
      setEditEmail(res.data.email || '');
      setEditBio(res.data.bio || '');
      return res.data;
    },
  });

  const { data: config } = useQuery({
    queryKey: ['user-config'],
    queryFn: async () => { const res = await userApi.getConfig(); return res.data; },
  });

  useEffect(() => { if (config?.roles) setRoleModels({ ...config.roles }); }, [config?.roles]);

  const systemModels = config?.system_models
    ? Object.entries(config.system_models).map(([key, val]: [string, any]) => ({ key, model: val.model, base_url: val.base_url }))
    : [];
  const customModels = Array.isArray(config?.models) ? config.models : [];
  const modelKeys = systemModels.map((m: any) => m.key).filter(Boolean);
  const customKeys = customModels.map((m: any) => m.key).filter(Boolean);
  const allModels = [...new Set([...modelKeys, ...customKeys])];

  // ── mutations ──
  const profileMutation = useMutation({
    mutationFn: async () => {
      if (editEmail && !editEmail.includes('@')) {
        toast.error('邮箱格式不正确（需包含 @）');
        return;
      }
      const data: Record<string, string> = {};
      if (editName && editName !== user?.user_name) data.name = editName;
      if (editPassword) data.password = editPassword;
      if (editEmail !== (profile?.email || '')) data.email = editEmail;
      if (editBio !== (profile?.bio || '')) data.bio = editBio;
      if (Object.keys(data).length === 0) throw new Error('无变更');
      await userApi.updateProfile(data);
    },
    onSuccess: () => { toast.success('已更新'); setEditPassword(''); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '更新失败';
      if (msg !== '无变更') toast.error(msg);
    },
  });

  const saveRolesMutation = useMutation({
    mutationFn: async () => {
      await userApi.saveConfig({ roles: roleModels });
    },
    onSuccess: () => {
      toast.success('角色映射已保存');
      queryClient.invalidateQueries({ queryKey: ['user-config'] });
    },
    onError: (err: unknown) =>
      toast.error((err as any)?.response?.data?.error || '保存失败'),
  });

  return (
    <div className="flex h-full">
      {/* 左侧选项卡 */}
      <div className="w-36 shrink-0 border-r border-[#eceef2] p-2 space-y-0.5 overflow-y-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-left transition-colors ${
              tab === t.id ? 'bg-[#4f8cff]/8 text-[#4f8cff] font-medium' : 'text-[#81858c] hover:bg-gray-50'
            }`}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* 右侧内容 */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">

        {/* ═══ 账号 ═══ */}
        {tab === 'account' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[#1d1d1f]">账号</h3>

            <div className="flex gap-4">
              <div style={{
                width: 64, height: 64, borderRadius: '50%',
                background: avatarColor(profile?.avatar_seed || profile?.user_id || ''),
                color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 27, fontWeight: 700,
                userSelect: 'none', flexShrink: 0,
              }}>{(profile?.user_name || '?').charAt(0).toUpperCase()}</div>

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

            <div className="flex gap-4 text-[10px] text-[#9ca3af]">
              <span>用户 ID: {profile?.user_id ?? ''}</span>
              <span>注册时间: {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('zh-CN') : ''}</span>
            </div>

            <button className="btn btn-xs" disabled={profileMutation.isPending} onClick={() => profileMutation.mutate()}
              style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '8px', border: 'none' }}>保存</button>
          </div>
        )}

        {/* ═══ 模型（系统模型 + API Key + 自定义模型）═══ */}
        {tab === 'model' && (
          <div className="space-y-5">
            {/* 系统模型（只读） */}
            <div>
              <h3 className="text-sm font-semibold text-[#1d1d1f] mb-2">
                系统模型
                <span className="text-[10px] text-[#81858c] font-normal ml-2">只读，由服务端配置</span>
              </h3>
              <div className="grid gap-2">
                {systemModels.length > 0 ? systemModels.map((m: any) => (
                  <div key={m.key} className="p-3 bg-[#f5f6f8] rounded-xl border border-[#e8ebef]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="badge badge-xs bg-[#e0e4e8] text-[#5f636b] border-0 font-mono">{m.key}</span>
                      <span className="text-xs font-medium text-[#1d1d1f]">{m.model}</span>
                    </div>
                    <div className="text-[10px] text-[#81858c] truncate">{m.base_url}</div>
                  </div>
                )) : <p className="text-xs text-[#b0b8c1]">加载中...</p>}
              </div>
            </div>

            {/* 自定义模型 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-[#1d1d1f]">自定义模型</h3>
                <button className="btn btn-xs btn-ghost text-[#4f8cff]" onClick={() => setShowForm(!showForm)}>
                  <Plus size={12} /> {showForm ? '收起' : '添加'}
                </button>
              </div>
              {showForm && (
                <div className="space-y-2 p-3 bg-[#f9fafb] rounded-xl mb-3">
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input input-bordered input-xs text-xs" placeholder="标识" style={{ borderRadius: '6px', borderColor: '#e0e4e8' }}
                      value={customForm.key} onChange={e => setCustomForm(p => ({ ...p, key: e.target.value }))} />
                    <input className="input input-bordered input-xs text-xs" placeholder="模型名" style={{ borderRadius: '6px', borderColor: '#e0e4e8' }}
                      value={customForm.model} onChange={e => setCustomForm(p => ({ ...p, model: e.target.value }))} />
                    <input className="input input-bordered input-xs text-xs" placeholder="Base URL" style={{ borderRadius: '6px', borderColor: '#e0e4e8' }}
                      value={customForm.base_url} onChange={e => setCustomForm(p => ({ ...p, base_url: e.target.value }))} />
                    <input className="input input-bordered input-xs text-xs" placeholder="API Key" type="password" style={{ borderRadius: '6px', borderColor: '#e0e4e8' }}
                      value={customForm.api_key} onChange={e => setCustomForm(p => ({ ...p, api_key: e.target.value }))} />
                  </div>
                  <button className="btn btn-xs" disabled={!customForm.key || !customForm.model || !customForm.api_key}
                    onClick={() => {
                      userApi.addCustomModel(customForm).then(() => { toast.success('已添加'); setCustomForm({ key: '', model: '', base_url: '', api_key: '' }); setShowForm(false); queryClient.invalidateQueries({ queryKey: ['user-config'] }); })
                        .catch((err: any) => toast.error(err?.response?.data?.error || '添加失败'));
                    }}
                    style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '6px', border: 'none' }}>添加</button>
                </div>
              )}
              {customModels.length > 0 && (
                <div className="grid gap-2">
                  {customModels.map((m: any) => (
                    <div key={m.key} className="p-3 bg-white rounded-xl border border-[#e8ebef] shadow-sm">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="badge badge-xs bg-[#e8f0ff] text-[#4f8cff] border-0 font-mono shrink-0">{m.key}</span>
                          <span className="text-xs font-medium text-[#1d1d1f] truncate">{m.model}</span>
                        </div>
                        <button className="text-[#c0c4cc] hover:text-[#ef4444] shrink-0 ml-2 transition-colors"
                          onClick={() => userApi.deleteCustomModel(m.key).then(() => { toast.success('已删除'); queryClient.invalidateQueries({ queryKey: ['user-config'] }); }).catch(() => toast.error('删除失败'))}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="text-[10px] text-[#81858c] truncate">{m.base_url}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* 角色模型映射 */}
              <div className="space-y-1.5 pt-3 border-t border-[#f0f2f5]">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold text-[#1d1d1f]">角色模型映射</h3>
                  <span className="text-[10px] text-[#81858c]">为每个 Agent 选择不同模型</span>
                </div>
                {ROLES.map(role => (
                  <div key={role} className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[#1d1d1f] w-16 shrink-0">{role}</span>
                    <select className="select select-bordered select-xs w-full text-xs" style={{ borderRadius: '6px', borderColor: '#e0e4e8' }}
                      value={roleModels[role] || (config?.roles?.[role] || '')}
                      onChange={e => setRoleModels(p => ({ ...p, [role]: e.target.value }))}>
                      {allModels.map((mk: string) => <option key={mk} value={mk}>{mk}</option>)}
                    </select>
                  </div>
                ))}
                <button className="btn btn-xs mt-2" disabled={saveRolesMutation.isPending}
                  onClick={() => saveRolesMutation.mutate()}
                  style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '6px', border: 'none' }}>
                  {saveRolesMutation.isPending ? '保存中...' : '保存映射'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
