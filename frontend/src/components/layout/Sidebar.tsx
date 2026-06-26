import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderOpen,
  Bot,
  Puzzle,
  Settings,
  Shield,
  LogOut,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: '工作空间' },
  { to: '/templates', icon: Puzzle, label: '模板市场' },
  { to: '/settings', icon: Settings, label: '个人设置' },
];

export function Sidebar() {
  const { user, logout } = useAuthStore();
  const { currentWorkspaceId } = useWorkspaceStore();

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-card">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 px-4 border-b">
        <Bot className="h-6 w-6 text-primary" />
        <span className="font-semibold text-sm">Multi-Agent</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div className="border-t p-3">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.user_name ?? '未登录'}</p>
            <p className="text-xs text-muted-foreground">
              {user?.is_admin ? '管理员' : '用户'}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={logout} title="退出登录">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
