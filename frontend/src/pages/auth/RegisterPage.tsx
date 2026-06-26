import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

export function RegisterPage() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !password) return;
    if (password !== confirm) {
      toast.error('两次密码不一致');
      return;
    }
    if (password.length < 6) {
      toast.error('密码至少 6 位');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.register({ name: name.trim(), password });
      setAuth(res.data.token, {
        user_id: res.data.user_id,
        user_name: res.data.name,
        is_admin: false,
      });
      toast.success('注册成功！');
      navigate('/', { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        '注册失败';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f9fc] p-4">
      <div className="card bg-base-100 w-full max-w-sm shadow-sm border border-[#e0e4e8]">
        <div className="card-body">
          <div className="text-center mb-2">
            <h2 className="text-xl font-bold text-[#1d1d1f]">创建账号</h2>
            <p className="text-sm text-[#81858c] mt-1">加入 Multi-Agent 公共平台</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label py-1">
                <span className="label-text text-sm text-[#81858c]">用户名</span>
              </label>
              <input
                type="text"
                className="input input-bordered w-full"
                style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                placeholder="3-20 个字符"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="label py-1">
                <span className="label-text text-sm text-[#81858c]">密码</span>
              </label>
              <input
                type="password"
                className="input input-bordered w-full"
                style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                placeholder="至少 6 位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label py-1">
                <span className="label-text text-sm text-[#81858c]">确认密码</span>
              </label>
              <input
                type="password"
                className="input input-bordered w-full"
                style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                placeholder="再次输入密码"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              className="btn w-full"
              disabled={loading}
              style={{
                background: 'var(--brand-primary)',
                color: '#fff',
                borderRadius: '10px',
                border: 'none',
              }}
            >
              {loading ? <span className="loading loading-spinner loading-sm" /> : null}
              注册
            </button>
          </form>
          <p className="text-center text-sm text-[#81858c] mt-2">
            已有账号？{' '}
            <Link to="/login" className="text-[#4f8cff] hover:underline">
              去登录
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
