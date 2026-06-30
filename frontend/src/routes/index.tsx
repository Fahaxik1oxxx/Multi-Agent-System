import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AdminGuard } from '@/components/auth/AdminGuard';
import { V3AppShell } from '@/components/layout/V3AppShell';
import { V3PersonalLayout } from '@/components/layout/V3PersonalLayout';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { GuestChat } from '@/pages/project/GuestChat';
import { HomePage } from '@/pages/home/HomePage';
import { V3ProjectPage } from '@/pages/chat/V3ProjectPage';
import { V3AgentSelectPage } from '@/pages/chat/V3AgentSelectPage';
import { ConfigBuilderPage } from '@/pages/chat/ConfigBuilderPage';
import { V3ChatPage } from '@/pages/chat/V3ChatPage';
import { MonitorPage } from '@/pages/project/MonitorPage';
import { EvaluationPage } from '@/pages/project/EvaluationPage';
import { OrchestrationPage } from '@/pages/project/OrchestrationPage';
import { TemplateMarket } from '@/pages/templates/TemplateMarket';
import { AgentDesigner } from '@/pages/agent-design/AgentDesigner';
import { AdminPage } from '@/pages/admin/AdminPage';
import { TeamHome } from '@/pages/team/TeamHome';
import { TeamChat } from '@/pages/team/TeamChat';
import { KnowledgePage } from '@/pages/knowledge/KnowledgePage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/v3" replace />,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/register',
    element: <RegisterPage />,
  },
  {
    path: '/guest-chat',
    element: <GuestChat />,
  },
  {
    path: '/v3',
    element: (
      <AuthGuard>
        <V3AppShell />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'personal/:projectId/config-builder', element: <div className="p-6 max-w-2xl mx-auto"><ConfigBuilderPage /></div> },
      { path: 'personal/:projectId/agents', element: <V3AgentSelectPage /> },
      { path: 'personal/:projectId/chat', element: <V3ChatPage /> },
      { path: 'personal/:projectId/orchestra', element: <OrchestrationPage /> },
      { path: 'personal/:projectId/monitor', element: <MonitorPage /> },
      { path: 'personal/:projectId/eval', element: <EvaluationPage /> },
      { path: 'personal', element: <V3PersonalLayout />, children: [
        { index: true, element: <V3ProjectPage /> },
        { path: 'knowledge', element: <KnowledgePage /> },
        { path: 'templates', element: <TemplateMarket /> },
      ]},
      { path: 'personal/agents', element: <div className="p-6 max-w-5xl mx-auto"><AgentDesigner /></div> },
      { path: 'team', element: <TeamHome /> },
      { path: 'team/:orgId', element: <TeamChat /> },
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
