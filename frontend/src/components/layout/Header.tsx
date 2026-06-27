import { useLocation, Link } from 'react-router-dom';

const routeLabels: Record<string, string> = {
  '/': '工作空间总览',
  '/templates': '模板市场',
  '/settings': '个人设置',
  '/admin': '管理后台',
};

function getBreadcrumbs(pathname: string): { label: string; path: string }[] {
  const parts = pathname.split('/').filter(Boolean);
  const crumbs: { label: string; path: string }[] = [{ label: '首页', path: '/' }];

  if (parts[0] === 'w' && parts[1]) {
    crumbs.push({ label: '工作空间', path: `/w/${parts[1]}` });
    if (parts[2] === 'p' && parts[3]) {
      crumbs.push({ label: '项目', path: `/w/${parts[1]}/p/${parts[3]}/chat` });
      if (parts[4] === 'chat') crumbs.push({ label: '对话', path: '' });
      else if (parts[4] === 'orchestra') crumbs.push({ label: '编排', path: '' });
      else if (parts[4] === 'monitor') crumbs.push({ label: '监控', path: '' });
    }
  } else if (pathname !== '/') {
    crumbs.push({ label: routeLabels[pathname] || pathname, path: '' });
  }

  return crumbs;
}

export function Header() {
  const location = useLocation();
  const crumbs = getBreadcrumbs(location.pathname);

  return (
    <header className="navbar min-h-0 h-14 border-b px-6" style={{ background: 'var(--bg-chat)' }}>
      <div className="flex-1">
        <div className="breadcrumbs text-sm py-0">
          <ul>
            {crumbs.map((crumb, i) => (
              <li key={i}>
                {i < crumbs.length - 1 ? (
                  <Link to={crumb.path} className="text-[#81858c] hover:text-[#4f8cff]">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="font-medium text-[#1d1d1f]">{crumb.label}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </header>
  );
}
