import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Home, User, Users, Settings, LogOut, Shield } from 'lucide-react';
import { SettingsModal } from '@/components/shared/SettingsModal';
import { PageModal } from '@/components/shared/PageModal';

const navItems = [
  { to: '/v3', icon: Home, label: '对话' },
  { to: '/v3/personal', icon: User, label: '个人空间' },
  { to: '/v3/team', icon: Users, label: '团队' },
];

export function V3Sidebar() {
  const { user, isGuest, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string>('account');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 监听打开智能体设计事件（来自其他页面）
  useEffect(() => {
    const handler = () => { setSettingsTab('agent-design'); setSettingsOpen(true); };
    window.addEventListener('open-agent-designer', handler);
    return () => window.removeEventListener('open-agent-designer', handler);
  }, []);

  return (
    <header className="shrink-0 bg-white border-b border-[#eceef2] h-12 flex items-center justify-between px-4" style={{ zIndex: 40 }}>
      {/* Logo + 导航 */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-[#4f8cff] to-[#6c5ce7] flex items-center justify-center text-white text-[10px] font-bold">M</div>
          <span className="text-xs font-semibold text-[#1d1d1f] hidden sm:inline">Multi-Agent</span>
        </div>
        <nav className="flex items-center gap-1.5">
          {navItems.map(({ to, icon: Icon, label }) => {
            const isActive = pathname === to || (to === '/v3/personal' && pathname.startsWith('/v3/personal/'));
            return (
              <button key={to} onClick={() => navigate(to)}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'text-[#4f8cff] bg-[#4f8cff]/5' : 'text-[#81858c] hover:text-[#4b5563] hover:bg-gray-100'
                }`}>
                <Icon size={18} />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* 右：用户 */}
      <div className="flex items-center gap-3">
        <div className="relative" ref={menuRef}>
          <button onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-1.5 text-xs text-[#81858c] hover:text-[#4b5563]">
            <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[9px] font-medium text-gray-500">
              {isGuest ? '?' : (user?.user_name?.charAt(0).toUpperCase() || '?')}
            </div>
            <span className="hidden sm:inline truncate max-w-[60px]">{isGuest ? '游客' : user?.user_name || '?'}</span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl shadow-lg border border-[#eceef2] py-1 z-50">
              <div className="px-3 py-2 border-b border-[#eceef2]">
                <div className="text-xs font-medium text-[#1d1d1f]">{isGuest ? '游客' : user?.user_name || '未知'}</div>
                <div className="text-[9px] text-[#9ca3af]">{isGuest ? '未登录' : user?.user_id || ''}</div>
              </div>
              <button onClick={() => { setMenuOpen(false); setSettingsTab('account'); setSettingsOpen(true); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[#4b5563] hover:bg-gray-50 text-left">
                <Settings size={14} /> 设置
              </button>
              <button onClick={() => { setMenuOpen(false); setSettingsTab('agent-design'); setSettingsOpen(true); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[#4b5563] hover:bg-gray-50 text-left">
                🧠 智能体设计
              </button>
              {user?.is_admin && (
                <button onClick={() => { setMenuOpen(false); navigate('/v3/admin'); }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[#4b5563] hover:bg-gray-50 text-left">
                  <Shield size={14} /> 管理后台
                </button>
              )}
              <div className="border-t border-[#eceef2]" />
              <button onClick={() => { logout(); window.location.href = '/login'; }}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[#ef4444] hover:bg-red-50 text-left">
                <LogOut size={14} /> 退出登录
              </button>
            </div>
          )}
      </div>
    </div>
    <PageModal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="⚙️ 设置" width="75vw">
      <SettingsModal initialTab={settingsTab} />
    </PageModal>
  </header>
);
}
