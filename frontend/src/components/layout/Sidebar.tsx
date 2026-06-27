import { useState, useEffect, useCallback, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Puzzle, Settings, Shield, LogOut, Plus, Search, Trash2, MessageSquare, Bot } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { sessionsApi } from '@/api/sessions';
import type { Session } from '@/types/api';
import { toast } from 'sonner';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: '工作空间' },
  { to: '/agents', icon: Bot, label: 'Agent 设计器' },
  { to: '/templates', icon: Puzzle, label: '模板市场' },
  { to: '/settings', icon: Settings, label: '个人设置' },
];

export function Sidebar() {
  const { user, logout } = useAuthStore();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Session[] | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await sessionsApi.list();
      setSessions(res.data || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const handler = () => fetchSessions();
    window.addEventListener('session-saved', handler);
    return () => window.removeEventListener('session-saved', handler);
  }, [fetchSessions]);

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!q.trim()) {
      setSearchResults(null);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await sessionsApi.search(q.trim());
        setSearchResults(res.data || []);
      } catch {
        setSearchResults([]);
      }
    }, 300);
  }, []);

  const loadSession = useCallback((sid: string) => {
    window.dispatchEvent(new CustomEvent('load-session', { detail: sid }));
  }, []);

  const deleteSession = useCallback(async (e: React.MouseEvent, sid: string) => {
    e.stopPropagation();
    try {
      await sessionsApi.delete(sid);
      toast.success('会话已删除');
      fetchSessions();
    } catch {
      toast.error('删除失败');
    }
  }, [fetchSessions]);

  const displaySessions = searchResults ?? sessions;

  return (
    <div className="drawer-side">
      <label htmlFor="drawer" aria-label="关闭侧栏" className="drawer-overlay" />
      <div
        className="flex flex-col p-3 w-72 h-full"
        style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid #eceef2' }}
      >
        {/* Logo */}
        <div className="flex items-center justify-center mb-2 shrink-0">
          <h4 className="sidebar-logo">Multi-Agent</h4>
        </div>

        {/* 新对话按钮 */}
        <button
          onClick={() => {
            const event = new CustomEvent('new-chat');
            window.dispatchEvent(event);
          }}
          className="new-chat-btn mx-auto mb-2 shrink-0"
        >
          <Plus size={16} />
          <span>开启新对话</span>
        </button>

        <div className="divider my-1 shrink-0" />

        {/* 导航 */}
        <nav className="flex flex-col gap-0.5 shrink-0">
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

        {/* 管理员入口 */}
        {user?.is_admin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium sidebar-hover shrink-0 ${
                isActive ? 'text-[#4f8cff] bg-[#4f8cff]/5' : 'text-[#81858c]'
              }`
            }
          >
            <Shield size={16} />
            管理后台
          </NavLink>
        )}

        {/* 会话搜索 */}
        <div className="relative mt-2 shrink-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
          <input
            className="w-full h-9 rounded-lg border border-[#e0e4e8] bg-white pl-9 pr-3 text-xs outline-none transition-colors focus:border-[#4f8cff]"
            placeholder="搜索历史会话..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>

        {/* 历史会话列表 */}
        <div className="flex-1 overflow-y-auto mt-1 min-h-0">
          {displaySessions.length === 0 ? (
            <p className="text-xs text-[#b0b8c1] text-center mt-8">
              {searchQuery ? '无匹配会话' : '暂无历史会话'}
            </p>
          ) : (
            displaySessions.map((s) => (
              <div
                key={s.id}
                className="history-item group"
                onClick={() => loadSession(s.id)}
                title={s.title}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <MessageSquare size={14} className="shrink-0 text-[#9ca3af]" />
                  <span className="truncate text-xs">{s.title || '空对话'}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="history-ops text-[10px]">{s.count}条</span>
                  <button
                    className="history-ops"
                    onClick={(e) => deleteSession(e, s.id)}
                    title="删除"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="divider my-1 shrink-0" />

        {/* 用户信息 */}
        <div className="shrink-0">
          <div className="flex items-center justify-between px-2 py-1.5 rounded-box border border-base-300 sidebar-hover">
            <span className="w-6 h-6 rounded-full bg-gray-200 inline-flex items-center justify-center text-xs font-medium text-gray-500 shrink-0">
              {user?.user_name?.charAt(0).toUpperCase() || '?'}
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
