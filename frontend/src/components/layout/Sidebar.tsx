import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Puzzle, Settings, Shield, LogOut, Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: '工作空间' },
  { to: '/templates', icon: Puzzle, label: '模板市场' },
  { to: '/settings', icon: Settings, label: '个人设置' },
];

export function Sidebar() {
  const { user, logout } = useAuthStore();

  return (
    <div className="drawer-side" style={{ position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 50 }}>
      <label htmlFor="drawer" aria-label="关闭侧栏" className="drawer-overlay" />
      <div
        className="flex flex-col p-3 w-72 h-full overflow-y-hidden"
        style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid #eceef2' }}
      >
        {/* Logo */}
        <div className="flex items-center justify-center mb-2">
          <h4 className="sidebar-logo">Multi-Agent</h4>
        </div>

        {/* 新对话按钮 */}
        <button
          onClick={() => {
            const event = new CustomEvent('new-chat');
            window.dispatchEvent(event);
          }}
          className="new-chat-btn mx-auto mb-2"
        >
          <Plus size={16} />
          <span>开启新对话</span>
        </button>

        <div className="divider my-1" />

        {/* 导航 */}
        <nav className="flex flex-col gap-0.5">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium sidebar-hover ${
                  isActive
                    ? 'text-[#4f8cff] bg-[#4f8cff]/5'
                    : 'text-[#81858c]'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="divider my-1" />

        {/* 管理员入口 */}
        {user?.is_admin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium sidebar-hover ${
                isActive ? 'text-[#4f8cff] bg-[#4f8cff]/5' : 'text-[#81858c]'
              }`
            }
          >
            <Shield size={16} />
            管理后台
          </NavLink>
        )}

        {/* 用户信息 */}
        <div className="mt-auto pt-2">
          <div className="flex items-center justify-between px-2 py-1.5 rounded-box border border-base-300 sidebar-hover">
            <span className="w-6 h-6 rounded-full bg-gray-200 inline-flex items-center justify-center text-xs font-medium text-gray-500 shrink-0">
              {user?.user_name?.charAt(0).toUpperCase() || '游'}
            </span>
            <span className="text-xs text-[#81858c] truncate flex-1 ml-2">
              {user?.user_name || '游客'}
            </span>
            <button
              onClick={logout}
              className="text-[#9ca3af] hover:text-[#4b5563] transition-colors shrink-0"
              title="退出登录"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
