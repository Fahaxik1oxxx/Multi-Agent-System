import { createBrowserRouter } from 'react-router-dom';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AdminGuard } from '@/components/auth/AdminGuard';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { WorkspaceOverview } from '@/pages/workspace/WorkspaceOverview';
import { WorkspaceDetail } from '@/pages/workspace/WorkspaceDetail';
import { ChatPage } from '@/pages/project/ChatPage';
import { SettingsPage } from '@/pages/settings/SettingsPage';
import { TemplateMarket } from '@/pages/templates/TemplateMarket';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/register',
    element: <RegisterPage />,
  },
  {
    path: '/',
    element: (
      <AuthGuard>
        <AppShell />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <WorkspaceOverview /> },
      { path: 'w/:workspaceId', element: <WorkspaceDetail /> },
      { path: 'w/:workspaceId/p/:projectId/chat', element: <ChatPage /> },
      { path: 'templates', element: <TemplateMarket /> },
      { path: 'settings', element: <SettingsPage /> },
      {
        path: 'admin',
        element: (
          <AdminGuard>
            <div className="p-6">
              <h1 className="text-2xl font-bold text-[#1d1d1f]">管理后台</h1>
              <p className="text-[#81858c] mt-2">Phase 2 待开发</p>
            </div>
          </AdminGuard>
        ),
      },
    ],
  },
]);
