import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const TABS = [
  { path: '/v3/personal', label: '📁 项目' },
  { path: '/v3/personal/knowledge', label: '📚 知识库' },
  { path: '/v3/personal/templates', label: '🧩 模板市场' },
];

export function V3PersonalLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = TABS.find(t => location.pathname === t.path) || TABS[0];

  return (
    <div className="flex flex-col h-full">
      {/* 标签栏 - 固定在顶部 */}
      <div className="shrink-0 bg-white border-b border-[#eceef2] px-6">
        <div className="flex gap-0 justify-center">
          {TABS.map(tab => (
            <button key={tab.path} onClick={() => navigate(tab.path)}
              className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                activeTab.path === tab.path
                  ? 'text-[#4f8cff] border-b-2 border-[#4f8cff]'
                  : 'text-[#81858c] hover:text-[#4b5563]'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 子页面内容 */}
      <div className="flex-1 overflow-y-auto" style={{ background: 'var(--bg-chat)' }}>
        <Outlet />
      </div>
    </div>
  );
}
