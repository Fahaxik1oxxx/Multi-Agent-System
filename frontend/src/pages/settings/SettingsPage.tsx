import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Key, Trash2, Eye, EyeOff } from 'lucide-react';
import { userApi } from '@/api/user';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

export function SettingsPage() {
  const { user, setAuth } = useAuthStore();

  // Profile
  const [editName, setEditName] = useState('');
  const [editPassword, setEditPassword] = useState('');

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const res = await userApi.getProfile();
      setEditName(res.data.user_name);
      return res.data;
    },
  });

  const profileMutation = useMutation({
    mutationFn: async () => {
      const data: { name?: string; password?: string } = {};
      if (editName && editName !== user?.user_name) data.name = editName;
      if (editPassword) data.password = editPassword;
      if (Object.keys(data).length === 0) throw new Error('无变更');
      await userApi.updateProfile(data);
    },
    onSuccess: () => {
      toast.success('个人信息已更新');
      setEditPassword('');
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message || '更新失败';
      if (msg === '无变更') return;
      const apiErr = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(apiErr || msg);
    },
  });

  // API Key
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  const { data: keyStatus } = useQuery({
    queryKey: ['api-key-status'],
    queryFn: async () => {
      const res = await userApi.getApiKeyStatus();
      return res.data;
    },
  });

  const saveKeyMutation = useMutation({
    mutationFn: async (key: string) => {
      await userApi.saveApiKey(key);
    },
    onSuccess: () => {
      toast.success('API Key 已保存');
      setApiKey('');
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        '保存失败';
      toast.error(msg);
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: () => userApi.deleteApiKey(),
    onSuccess: () => toast.success('已恢复使用系统默认 API Key'),
    onError: () => toast.error('操作失败'),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1d1d1f]">个人设置</h1>
        <p className="text-[#81858c] mt-1">管理你的账号信息和 API Key</p>
      </div>

      {/* Profile */}
      <div className="card bg-base-100 border border-[#e0e4e8] shadow-sm">
        <div className="card-body">
          <h2 className="card-title text-[#1d1d1f]">基本信息</h2>
          <p className="text-sm text-[#81858c]">修改用户名或密码</p>
          <div className="space-y-4 mt-2">
            <div>
              <label className="label py-1">
                <span className="label-text text-sm text-[#81858c]">用户 ID</span>
              </label>
              <input
                className="input input-bordered w-full font-mono text-sm"
                style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                value={profile?.user_id ?? ''}
                disabled
              />
            </div>
            <div>
              <label className="label py-1">
                <span className="label-text text-sm text-[#81858c]">用户名</span>
              </label>
              <input
                className="input input-bordered w-full"
                style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={user?.user_name}
              />
            </div>
            <div>
              <label className="label py-1">
                <span className="label-text text-sm text-[#81858c]">新密码（留空不修改）</span>
              </label>
              <input
                type="password"
                className="input input-bordered w-full"
                style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                placeholder="至少 6 位"
              />
            </div>
            <button
              className="btn"
              disabled={profileMutation.isPending}
              onClick={() => profileMutation.mutate()}
              style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }}
            >
              {profileMutation.isPending ? <span className="loading loading-spinner loading-sm" /> : null}
              保存更改
            </button>
          </div>
        </div>
      </div>

      {/* API Key */}
      <div className="card bg-base-100 border border-[#e0e4e8] shadow-sm">
        <div className="card-body">
          <h2 className="card-title text-[#1d1d1f] flex items-center gap-2">
            <Key size={20} />
            API Key 管理
          </h2>
          <p className="text-sm text-[#81858c]">
            配置你的 LLM API Key。留空则使用平台默认免费 Key。
            {!keyStatus?.has_custom_key && (
              <span className="badge badge-ghost ml-2">当前使用系统默认</span>
            )}
            {keyStatus?.has_custom_key && (
              <span className="badge badge-primary ml-2">正在使用自定义 Key</span>
            )}
          </p>
          <div className="space-y-4 mt-2">
            <div>
              <label className="label py-1">
                <span className="label-text text-sm text-[#81858c]">DeepSeek API Key</span>
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKey ? 'text' : 'password'}
                    className="input input-bordered w-full pr-10"
                    style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9ca3af] hover:text-[#6b7280]"
                    onClick={() => setShowKey(!showKey)}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <button
                  className="btn"
                  disabled={!apiKey.trim() || saveKeyMutation.isPending}
                  onClick={() => saveKeyMutation.mutate(apiKey)}
                  style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }}
                >
                  保存
                </button>
              </div>
            </div>
            {keyStatus?.has_custom_key && (
              <button
                className="btn btn-outline btn-sm"
                style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                onClick={() => deleteKeyMutation.mutate()}
              >
                <Trash2 size={16} />
                删除自定义 Key，使用系统默认
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
