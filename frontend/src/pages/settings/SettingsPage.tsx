import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Key, Trash2, Eye, EyeOff, Save, Plus, Cpu } from 'lucide-react';
import { userApi } from '@/api/user';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

const ROLES = ['Planner', 'Retriever', 'Coder', 'Writer', 'Executor', 'Tester', 'Summarizer', 'Bot'];

export function SettingsPage() {
  const { user } = useAuthStore();

  // ── Profile ──
  const [editName, setEditName] = useState('');
  const [editPassword, setEditPassword] = useState('');

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => { const res = await userApi.getProfile(); setEditName(res.data.user_name); return res.data; },
  });

  const profileMutation = useMutation({
    mutationFn: async () => {
      const data: { name?: string; password?: string } = {};
      if (editName && editName !== user?.user_name) data.name = editName;
      if (editPassword) data.password = editPassword;
      if (Object.keys(data).length === 0) throw new Error('无变更');
      await userApi.updateProfile(data);
    },
    onSuccess: () => { toast.success('个人信息已更新'); setEditPassword(''); },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message || '更新失败';
      if (msg === '无变更') return;
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || msg);
    },
  });

  // ── API Key ──
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  const { data: keyStatus } = useQuery({
    queryKey: ['api-key-status'],
    queryFn: async () => { const res = await userApi.getApiKeyStatus(); return res.data; },
  });

  const { data: config } = useQuery({
    queryKey: ['user-config'],
    queryFn: async () => { const res = await userApi.getConfig(); return res.data; },
  });

  const saveKeyMutation = useMutation({
    mutationFn: async (key: string) => { await userApi.saveApiKey(key); },
    onSuccess: () => { toast.success('API Key 已保存'); setApiKey(''); },
    onError: (err: unknown) => toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || '保存失败'),
  });

  const deleteKeyMutation = useMutation({
    mutationFn: () => userApi.deleteApiKey(),
    onSuccess: () => toast.success('已恢复使用系统默认 API Key'),
    onError: () => toast.error('操作失败'),
  });

  // ── 角色模型映射（可编辑） ──
  const [roleModels, setRoleModels] = useState<Record<string, string>>({});
  const [customModelForm, setCustomModelForm] = useState({ key: '', model: '', base_url: '', api_key: '' });
  const [showForm, setShowForm] = useState(false);

  // 初始化角色映射
  useState(() => {
    if (config?.roles) setRoleModels({ ...config.roles });
  });

  const saveRoleMutation = useMutation({
    mutationFn: async () => { await userApi.updateProfile({ name: editName }); },
    onSuccess: () => toast.success('角色映射已更新（需配合后端）'),
  });

  // 可用模型列表（系统默认 + 自定义）：后端可能返回数组或对象
  const systemModels = Array.isArray(config?.system_models) ? config.system_models : [];
  const customModels = Array.isArray(config?.models) ? config.models : [];
  const modelKeys = systemModels.map((m: any) => m.key).filter(Boolean);
  const customKeys = customModels.map((m: any) => m.key).filter(Boolean);
  const allModels = [...new Set([...modelKeys, ...customKeys])];

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1d1d1f]">设置</h1>
        <p className="text-[#81858c] mt-1">管理账号、API Key 和模型配置</p>
      </div>

      {/* 系统默认模型 */}
      <div className="bg-white rounded-xl border border-[#e0e4e8] p-4">
        <div className="flex items-center gap-2 mb-2">
          <Cpu size={18} className="text-[#4f8cff]" />
          <h2 className="text-sm font-semibold text-[#1d1d1f]">系统默认模型</h2>
        </div>
        <p className="text-xs text-[#81858c] mb-2">当前平台使用的 LLM 配置</p>
        {modelKeys.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2 bg-[#f9fafb] rounded-lg">
              <span className="text-[#81858c]">模型</span>
              <div className="font-medium text-[#1d1d1f]">{systemModels[0]?.model || '—'}</div>
            </div>
            <div className="p-2 bg-[#f9fafb] rounded-lg">
              <span className="text-[#81858c]">接口</span>
              <div className="font-medium text-[#1d1d1f] truncate">{systemModels[0]?.base_url || '—'}</div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-[#b0b8c1]">加载中...</p>
        )}
      </div>

      {/* 基本信息 */}
      <div className="bg-white rounded-xl border border-[#e0e4e8] p-4">
        <h2 className="text-sm font-semibold text-[#1d1d1f] mb-1">基本信息</h2>
        <p className="text-xs text-[#81858c] mb-3">修改用户名或密码</p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-[#81858c] block mb-1">用户 ID</label>
            <input className="input input-bordered w-full font-mono text-sm" style={{ borderRadius: '10px', borderColor: '#e0e4e8' }} value={profile?.user_id ?? ''} disabled />
          </div>
          <div>
            <label className="text-xs text-[#81858c] block mb-1">用户名</label>
            <input className="input input-bordered w-full text-sm" style={{ borderRadius: '10px', borderColor: '#e0e4e8' }} value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-[#81858c] block mb-1">新密码（留空不修改）</label>
            <input type="password" className="input input-bordered w-full text-sm" style={{ borderRadius: '10px', borderColor: '#e0e4e8' }} value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="至少 6 位" />
          </div>
          <button className="btn btn-sm" disabled={profileMutation.isPending} onClick={() => profileMutation.mutate()}
            style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '10px', border: 'none' }}>
            保存更改
          </button>
        </div>
      </div>

      {/* API Key */}
      <div className="bg-white rounded-xl border border-[#e0e4e8] p-4">
        <h2 className="text-sm font-semibold text-[#1d1d1f] flex items-center gap-1.5 mb-1">
          <Key size={16} /> API Key
        </h2>
        <p className="text-xs text-[#81858c] mb-3">
          配置 LLM API Key。
          {keyStatus?.has_custom_key
            ? <span className="badge badge-primary badge-xs ml-1">使用自定义 Key</span>
            : <span className="badge badge-ghost badge-xs ml-1">使用系统默认</span>
          }
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input type={showKey ? 'text' : 'password'} className="input input-bordered w-full pr-10 text-sm" style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
              value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9ca3af] hover:text-[#6b7280]" onClick={() => setShowKey(!showKey)}>
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <button className="btn btn-sm" disabled={!apiKey.trim() || saveKeyMutation.isPending} onClick={() => saveKeyMutation.mutate(apiKey)}
            style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '10px', border: 'none' }}>保存</button>
        </div>
        {keyStatus?.has_custom_key && (
          <button className="btn btn-xs btn-ghost mt-2 text-[#ef4444]" onClick={() => deleteKeyMutation.mutate()}>
            <Trash2 size={12} /> 删除自定义 Key
          </button>
        )}
      </div>

      {/* 角色模型映射 */}
      <div className="bg-white rounded-xl border border-[#e0e4e8] p-4">
        <h2 className="text-sm font-semibold text-[#1d1d1f] mb-1">角色模型映射</h2>
        <p className="text-xs text-[#81858c] mb-3">为每个 Agent 角色选择不同的模型</p>
        <div className="space-y-1.5">
          {ROLES.map((role) => (
            <div key={role} className="flex items-center gap-2">
              <span className="text-xs font-medium text-[#1d1d1f] w-20 shrink-0">{role}</span>
              <select
                className="select select-bordered select-xs w-full text-xs"
                style={{ borderRadius: '8px', borderColor: '#e0e4e8' }}
                value={roleModels[role] || (config?.roles?.[role] || '')}
                onChange={(e) => setRoleModels((prev) => ({ ...prev, [role]: e.target.value }))}
              >
                <option value="">系统默认</option>
                {allModels.map((mk: string) => (
                  <option key={mk} value={mk}>{mk}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <button className="btn btn-xs mt-3" disabled={saveRoleMutation.isPending} onClick={() => saveRoleMutation.mutate()}
          style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '8px', border: 'none' }}>
          <Save size={12} /> 保存映射
        </button>
      </div>

      {/* 智能体设计 */}
      <div className="bg-white rounded-xl border border-[#e0e4e8] p-4">
        <h2 className="text-sm font-semibold text-[#1d1d1f] mb-1">智能体设计</h2>
        <p className="text-xs text-[#81858c] mb-3">自定义每个 Agent 的 System Prompt</p>
        <button onClick={() => window.dispatchEvent(new CustomEvent('open-agent-designer'))} className="btn btn-sm"
          style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '8px', border: 'none' }}>
          打开智能体设计器
        </button>
      </div>

      {/* 自定义模型 */}
      <div className="bg-white rounded-xl border border-[#e0e4e8] p-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-[#1d1d1f]">自定义模型</h2>
          <button className="btn btn-xs btn-ghost text-[#4f8cff]" onClick={() => setShowForm(!showForm)}>
            <Plus size={12} /> {showForm ? '收起' : '添加'}
          </button>
        </div>
        <p className="text-xs text-[#81858c] mb-3">添加自定义 LLM 模型（名称 / URL / Key）</p>

        {showForm && (
          <div className="space-y-2 mb-3 p-3 bg-[#f9fafb] rounded-xl">
            <div className="grid grid-cols-2 gap-2">
              <input className="input input-bordered input-xs text-xs" placeholder="标识 (如 my-gpt)" style={{ borderRadius: '8px', borderColor: '#e0e4e8' }}
                value={customModelForm.key} onChange={(e) => setCustomModelForm(p => ({ ...p, key: e.target.value }))} />
              <input className="input input-bordered input-xs text-xs" placeholder="模型名 (如 gpt-4o)" style={{ borderRadius: '8px', borderColor: '#e0e4e8' }}
                value={customModelForm.model} onChange={(e) => setCustomModelForm(p => ({ ...p, model: e.target.value }))} />
              <input className="input input-bordered input-xs text-xs" placeholder="Base URL (可选)" style={{ borderRadius: '8px', borderColor: '#e0e4e8' }}
                value={customModelForm.base_url} onChange={(e) => setCustomModelForm(p => ({ ...p, base_url: e.target.value }))} />
              <input className="input input-bordered input-xs text-xs" placeholder="API Key" type="password" style={{ borderRadius: '8px', borderColor: '#e0e4e8' }}
                value={customModelForm.api_key} onChange={(e) => setCustomModelForm(p => ({ ...p, api_key: e.target.value }))} />
            </div>
            <button className="btn btn-xs mt-1" disabled={!customModelForm.key || !customModelForm.model || !customModelForm.api_key}
              onClick={() => {
                userApi.addCustomModel(customModelForm).then(() => {
                  toast.success('自定义模型已添加');
                  setCustomModelForm({ key: '', model: '', base_url: '', api_key: '' });
                  setShowForm(false);
                }).catch((err: any) => toast.error(err?.response?.data?.error || '添加失败'));
              }}
              style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '8px', border: 'none' }}>
              添加
            </button>
          </div>
        )}

        {customModels.length > 0 && (
          <div className="space-y-1">
            {customModels.map((m: any) => (
              <div key={m.key} className="flex items-center gap-2 text-xs p-2 bg-[#f9fafb] rounded-lg">
                <span className="font-medium text-[#1d1d1f] w-16 truncate">{m.key}</span>
                <span className="text-[#81858c] truncate flex-1">{m.model}</span>
                <button className="text-[#ef4444] hover:text-red-700"
                  onClick={() => userApi.deleteCustomModel(m.key).then(() => toast.success('已删除')).catch(() => toast.error('删除失败'))}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
