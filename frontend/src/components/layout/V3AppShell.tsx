import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { V3Sidebar } from './V3Sidebar';
import { useAuthStore } from '@/stores/authStore';
import { ArrowLeft } from 'lucide-react';
import { useCallback } from 'react';

function getParentPath(pathname: string): string | null {
  const s = pathname.split('/').filter(Boolean);
  if (s.length < 2) return null;
  if (s[1] === 'personal' && s[3] === 'orchestra') return `/v3/personal/${s[2]}/chat`;
  if (s[1] === 'personal' && s[3] === 'monitor') return `/v3/personal/${s[2]}/chat`;
  if (s[1] === 'personal' && s[3] === 'config-builder') return `/v3/personal/${s[2]}/agents`;
  if (s[1] === 'templates') return '/v3/personal';
  if (s[1] === 'personal' && s[3] === 'templates') return '/v3/personal';
  if (s[1] === 'personal' && s.length >= 4) return '/v3/personal';
  if (s[1] === 'team' && s.length >= 3) return '/v3/team';
  const parent = s.slice(0, -1).join('/');
  return '/' + parent;
}

function getBreadcrumbs(pathname: string): { label: string; path?: string }[] | null {
  const s = pathname.split('/').filter(Boolean);
  if (s.length < 2) return null;
  const section = s[1];
  if (section === 'personal') {
    if (s.length === 2) return [{ label: '个人空间' }, { label: '项目' }];
    if (s[3] === 'agents') return [{ label: '个人空间', path: '/v3/personal' }, { label: '智能体设计' }];
    if (s[3] === 'chat') return [{ label: '个人空间', path: '/v3/personal' }, { label: '项目', path: '/v3/personal' }, { label: '对话' }];
    if (s[3] === 'orchestra') return [{ label: '个人空间', path: '/v3/personal' }, { label: '项目', path: '/v3/personal' }, { label: '编排' }];
    if (s[3] === 'monitor') return [{ label: '个人空间', path: '/v3/personal' }, { label: '项目', path: '/v3/personal' }, { label: '监控' }];
  }
  if (section === 'knowledge') return [{ label: '个人空间', path: '/v3/personal' }, { label: '知识库' }];
  if (section === 'templates') return [{ label: '个人空间', path: '/v3/personal' }, { label: '模板市场' }];
  if (section === 'personal' && s[3] === 'templates') return [{ label: '个人空间', path: '/v3/personal' }, { label: '模板市场' }];
  if (section === 'team') {
    if (s.length === 2) return [{ label: '团队' }, { label: '组织' }];
    if (s[3]) return [{ label: '团队', path: '/v3/team' }, { label: '聊天' }];
  }
  return null;
}

export function V3AppShell() {
  const { isGuest, exitGuest } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;
  const crumbs = getBreadcrumbs(pathname);
  const s = pathname.split('/').filter(Boolean);
  const isSubPage = s.length > 2;

  const goBack = useCallback(() => {
    const prev = crumbs?.slice().reverse().find(c => c.path);
    if (prev?.path) { navigate(prev.path); return; }
    const parent = getParentPath(pathname);
    if (parent && parent !== '/v3') { navigate(parent); return; }
    navigate('/v3');
  }, [crumbs, navigate, pathname]);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* 顶部导航栏 */}
      <V3Sidebar />

      {/* 面包屑（chat 页面有自己的侧栏导航，无需显示） */}
      {crumbs && isSubPage && !pathname.endsWith('/chat') && (
        <div className="flex items-center gap-2 px-4 py-1 bg-[#f9fafb] border-b border-[#eceef2] text-xs overflow-x-auto shrink-0">
          <button onClick={goBack} className="flex items-center gap-1 text-[#4f8cff] hover:text-[#3a6fd8] shrink-0 whitespace-nowrap">
            <ArrowLeft size={12} /> 返回
          </button>
          <span className="text-[#d0d4d8] shrink-0">|</span>
          {crumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1 shrink-0">
              {i > 0 && <span className="text-[#d0d4d8] mx-0.5">/</span>}
              {crumb.path ? (
                <button onClick={() => navigate(crumb.path!)} className="text-[#81858c] hover:text-[#4f8cff] whitespace-nowrap">{crumb.label}</button>
              ) : (
                <span className="text-[#4b5563] font-medium whitespace-nowrap">{crumb.label}</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* 游客横幅 */}
      {isGuest && (
        <div className="flex items-center justify-between px-4 py-1 bg-[#4f8cff]/10 border-b border-[#4f8cff]/20 shrink-0">
          <span className="text-xs text-[#4f8cff]">🧪 游客模式 — 会话不保存</span>
          <div className="flex gap-2 items-center">
            <button onClick={() => { exitGuest(); window.location.href = '/login'; }} className="text-xs text-[#81858c] hover:text-[#4b5563] underline">退出</button>
            <a href="/register" className="btn btn-xs" style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '6px', border: 'none' }}>注册</a>
          </div>
        </div>
      )}

      {/* 内容区 */}
      <main className="flex-1 overflow-y-auto" style={{ background: 'var(--bg-chat)' }}>
        <Outlet />
      </main>
    </div>
  );
}
