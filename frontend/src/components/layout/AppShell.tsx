import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export function AppShell() {
  return (
    <div className="drawer lg:drawer-open h-screen">
      <input id="drawer" type="checkbox" className="drawer-toggle" />
      <div className="drawer-content flex flex-col h-full min-h-0">
        {/* Mobile toggle */}
        <button
          onClick={() => {
            const el = document.getElementById('drawer') as HTMLInputElement;
            if (el) el.checked = !el.checked;
          }}
          className="btn btn-square btn-ghost btn-sm absolute top-2 left-1 z-10 lg:hidden"
          title="切换侧栏"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <Header />
        <main className="flex-1 overflow-y-auto" style={{ background: 'var(--bg-chat)' }}>
          <Outlet />
        </main>
      </div>
      <Sidebar />
    </div>
  );
}
