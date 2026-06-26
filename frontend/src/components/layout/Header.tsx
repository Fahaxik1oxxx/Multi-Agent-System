import { useLocation } from 'react-router-dom';
import { ChevronRight, Slash } from 'lucide-react';

const routeLabels: Record<string, string> = {
  '/': '工作空间总览',
  '/templates': '模板市场',
  '/settings': '个人设置',
  '/admin': '管理后台',
};

function getBreadcrumbs(pathname: string): string[] {
  const parts = pathname.split('/').filter(Boolean);
  const crumbs: string[] = [];

  if (parts[0] === 'w' && parts[1]) {
    crumbs.push('工作空间');
    if (parts[2] === 'p' && parts[3]) {
      crumbs.push('项目');
      if (parts[4] === 'chat') crumbs.push('对话');
    }
  } else {
    crumbs.push(routeLabels[pathname] || routeLabels['/']);
  }

  return crumbs;
}

export function Header() {
  const location = useLocation();
  const crumbs = getBreadcrumbs(location.pathname);

  return (
    <header className="flex h-14 items-center gap-2 border-b px-6">
      {crumbs.map((crumb, i) => (
        <span key={i} className="flex items-center gap-2 text-sm">
          {i > 0 && <Slash className="h-3 w-3 text-muted-foreground" />}
          <span className={i === crumbs.length - 1 ? 'font-medium' : 'text-muted-foreground'}>
            {crumb}
          </span>
        </span>
      ))}
    </header>
  );
}
