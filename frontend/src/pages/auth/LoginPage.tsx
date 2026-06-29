import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';
import { Bot, GitBranch, Users, ArrowRight } from 'lucide-react';

const features = [
  { icon: Bot, title: '8 Agent 协作', desc: 'Planner · Coder · Tester 等多角色智能体流水线协作' },
  { icon: GitBranch, title: '自定义工作流', desc: '拖拽编排画布，自由设计 Agent 执行顺序和路由条件' },
  { icon: Users, title: '团队共享', desc: '创建组织，邀请成员，共享知识库和 Agent 流水线' },
];

export function LoginPage() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { setAuth, enterGuest } = useAuthStore();

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/v3';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !password) return;
    setLoading(true);
    try {
      const res = await authApi.login({ name: name.trim(), password });
      setAuth(res.data.token, {
        user_id: res.data.user_id,
        user_name: res.data.name,
        is_admin: false,
      });
      toast.success(`欢迎回来, ${res.data.name}`);
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        '登录失败';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = () => {
    enterGuest();
    navigate('/v3', { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#f0f4ff] to-[#f8f9fc] p-4">
      <div className="flex w-full max-w-4xl overflow-hidden rounded-2xl shadow-xl border border-[#e0e4e8] bg-white">
        {/* 左侧 — 产品介绍 */}
        <div className="hidden md:flex w-1/2 flex-col justify-center p-10 bg-gradient-to-br from-[#4f8cff] to-[#6c5ce7] text-white">
          <div className="mb-6">
            <h1 className="text-3xl font-bold mb-2">🤖 多智能体协作平台</h1>
            <p className="text-white/80 text-sm">基于 LangGraph 的 8 Agent 协作引擎</p>
          </div>
          <div className="space-y-5">
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex gap-3">
                <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
                  <Icon size={18} />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{title}</h3>
                  <p className="text-white/70 text-xs">{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 text-white/60 text-xs">
            已服务多位用户 · 开源项目
          </div>
        </div>

        {/* 右侧 — 登录表单 */}
        <div className="w-full md:w-1/2 p-10 flex flex-col justify-center">
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold text-[#1d1d1f]">登录</h2>
            <p className="text-sm text-[#81858c] mt-1">欢迎回来</p>
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
                placeholder="输入用户名"
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
                placeholder="输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              className="btn w-full"
              disabled={loading}
              style={{
                background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)',
                color: '#fff',
                borderRadius: '10px',
                border: 'none',
              }}
            >
              {loading ? <span className="loading loading-spinner loading-sm" /> : null}
              登录
            </button>
          </form>
          <p className="text-center text-sm text-[#81858c] mt-3">
            还没有账号？{' '}
            <Link to="/register" className="text-[#4f8cff] hover:underline">
              立即注册
            </Link>
          </p>
          <div className="flex items-center my-3">
            <div className="flex-1 border-t border-[#e0e4e8]" />
            <span className="px-3 text-xs text-[#9ca3af]">或者</span>
            <div className="flex-1 border-t border-[#e0e4e8]" />
          </div>
          <button
            onClick={handleGuest}
            className="btn btn-outline w-full"
            style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
          >
            游客试用 <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
