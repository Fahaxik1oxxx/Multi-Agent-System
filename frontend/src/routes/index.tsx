import { createBrowserRouter } from 'react-router-dom';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AdminGuard } from '@/components/auth/AdminGuard';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { WorkspaceOverview } from '@/pages/workspace/WorkspaceOverview';
import { WorkspaceDetail } from '@/pages/workspace/WorkspaceDetail';
import { ChatPage } from '@/pages/project/ChatPage';
import { MonitorPage } from '@/pages/project/MonitorPage';
import { EvaluationPage } from '@/pages/project/EvaluationPage';
import { OrchestrationPage } from '@/pages/project/OrchestrationPage';
import { SettingsPage } from '@/pages/settings/SettingsPage';
import { TemplateMarket } from '@/pages/templates/TemplateMarket';
import { AgentDesigner } from '@/pages/agent-design/AgentDesigner';
import { AdminPage } from '@/pages/admin/AdminPage';

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
      { path: 'w/:workspaceId/p/:projectId/monitor', element: <MonitorPage /> },
      { path: 'w/:workspaceId/p/:projectId/eval', element: <EvaluationPage /> },
      { path: 'w/:workspaceId/p/:projectId/orchestra', element: <OrchestrationPage /> },
      { path: 'templates', element: <TemplateMarket /> },
      { path: 'agents', element: <AgentDesigner /> },
      { path: 'settings', element: <SettingsPage /> },
      {
        path: 'admin',
        element: (
          <AdminGuard>
            <AdminPage />
          </AdminGuard>
        ),
      },
    ],
  },
]);
