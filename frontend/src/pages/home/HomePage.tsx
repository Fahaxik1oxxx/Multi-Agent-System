import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { workspacesApi } from '@/api/workspaces';
import { projectsApi } from '@/api/projects';
import { sessionsApi } from '@/api/sessions';
import { knowledgeApi } from '@/api/knowledge';
import { MessageSquare, Loader2, FolderKanban, Zap, Plus, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import type { Session } from '@/types/api';
import type { Project } from '@/types/workspace';

const modeTags = ['自动', '快速', '协作'] as const;

const DEFAULT_PROJECT_NAME = '快速对话';
const DEFAULT_AGENTS = ['Planner', 'Retriever', 'Coder', 'Writer', 'Executor', 'Tester', 'Summarizer', 'Bot'];

const PROJECT_SESSIONS_KEY = 'v3_proj_sessions';

/** 从 localStorage 构建 sessionId → projectId 映射 */
function buildSessionProjectMap(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(`${PROJECT_SESSIONS_KEY}_`)) {
        const projectId = key.slice(PROJECT_SESSIONS_KEY.length + 1);
        const ids: string[] = JSON.parse(localStorage.getItem(key) || '[]');
        ids.forEach(sid => map.set(sid, projectId));
      }
    }
  } catch {}
  return map;
}

export function HomePage() {
  const { user, isGuest } = useAuthStore();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [activeMode, setActiveMode] = useState<string>('自动');
  const [recentSessions, setRecentSessions] = useState<{ session: Session; projectId: string; projectName: string }[]>([]);
  const [defaultProjectId, setDefaultProjectId] = useState<string | null>(null);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [recentProjectIds, setRecentProjectIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // 初始化：获取或创建默认项目（带防重复锁）
  const initLockRef = useRef(false);
  useEffect(() => {
    if (isGuest || initLockRef.current) return;
    initLockRef.current = true;

    const initProject = async () => {
      try {
        // 获取工作空间
        const wsRes = await workspacesApi.list();
        const workspaces = wsRes.data || [];
        let wsId = workspaces[0]?.id;

        if (!wsId) {
          const created = await workspacesApi.create({ name: '我的工作空间', description: '默认工作空间' });
          wsId = created.data.id;
        }

        // 查找或创建"快速对话"项目
        const projRes = await projectsApi.list(wsId);
        const projects = projRes.data || [];
        let defaultProj = projects.find((p: any) => p.name === DEFAULT_PROJECT_NAME);

        if (!defaultProj) {
          const created = await projectsApi.create(wsId, { name: DEFAULT_PROJECT_NAME, description: '首页快速对话' });
          defaultProj = created.data;
        }

        const pid = defaultProj.id || defaultProj;
        setDefaultProjectId(pid);

        // 自动配置默认 Agent（首次创建时）
        if (!defaultProj.agent_config || defaultProj.agent_config === '{}') {
          try {
            await projectsApi.updateAgentConfig(pid, DEFAULT_AGENTS);
          } catch {}
        }
      } catch {
        // 静默失败
      }
    };

    initProject();
  }, [isGuest]);

  // 加载最近 3 条会话 + 所有项目 + 最近项目
  useEffect(() => {
    if (isGuest) return;
    const load = async () => {
      try {
        // 获取项目列表和名称映射
        const wsRes = await workspacesApi.list();
        const wsId = wsRes.data?.[0]?.id;
        let projectNameMap = new Map<string, string>();
        let projectsList: Project[] = [];
        if (wsId) {
          const projRes = await projectsApi.list(wsId);
          projectsList = projRes.data || [];
          projectsList.forEach((p: any) => projectNameMap.set(p.id, p.name));
        }
        setAllProjects(projectsList);

        // 读取最近访问的项目
        try {
          const stored = JSON.parse(localStorage.getItem('v3_recent_projects') || '[]');
          setRecentProjectIds(stored.filter((id: string) => projectsList.some(p => p.id === id)));
        } catch {}

        // 获取会话列表
        const sessionsRes = await sessionsApi.list();
        const all: Session[] = sessionsRes.data || [];

        // 建立会话→项目映射
        const sessionProjectMap = buildSessionProjectMap();

        // 取最近 3 条，附带项目信息
        const top3 = all
          .sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime())
          .slice(0, 3)
          .map(s => ({
            session: s,
            projectId: sessionProjectMap.get(s.id) || defaultProjectId || '',
            projectName: projectNameMap.get(sessionProjectMap.get(s.id) || '') || DEFAULT_PROJECT_NAME,
          }));

        setRecentSessions(top3);
      } catch {}
    };
    load();
  }, [isGuest, defaultProjectId]);

  const navigateToChat = (targetProjectId?: string, sessionId?: string) => {
    const pid = targetProjectId || defaultProjectId;
    if (!pid) return;
    const path = `/v3/personal/${pid}/chat`;
    localStorage.setItem('quick_chat_project', pid);
    if (sessionId) {
      sessionStorage.setItem('v3_load_session', sessionId);
    }
    if (input.trim()) {
      sessionStorage.setItem('v3_pending_message', input.trim());
    }
    navigate(path, { replace: true });
  };

  const handleSend = () => {
    if (!input.trim() || !defaultProjectId) return;
    navigateToChat(defaultProjectId);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await knowledgeApi.upload(file);
      toast.success(`已上传: ${file.name}`);
    } catch {
      toast.error('上传失败');
    }
    setUploading(false);
    if (e.target) e.target.value = '';
  };

  const handleWorkflowClick = () => {
    if (!defaultProjectId) return;
    navigateToChat(defaultProjectId);
  };

  const handleSessionClick = (projectId: string, sessionId: string) => {
    navigateToChat(projectId, sessionId);
  };

  const greeting = isGuest ? '欢迎体验' : `欢迎回来，${user?.user_name || '用户'}`;

  return (
    <div className="flex flex-col items-center px-6 pt-24" style={{ minHeight: 'calc(100vh - 48px)' }}>
      <div className="w-full max-w-2xl">
        {/* 欢迎语 */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#1d1d1f]">{greeting}</h1>
          <p className="text-base text-[#81858c] mt-2">有什么我可以帮你的？</p>
        </div>

        {/* 输入框 */}
        <div className="bg-white rounded-2xl border border-[#e0e4e8] shadow-sm hover:shadow-md transition-shadow focus-within:border-[#4f8cff] focus-within:shadow-md mb-6">
          <textarea
            ref={inputRef}
            className="textarea textarea-ghost w-full resize-none text-base outline-none min-h-[56px] px-5 pt-3"
            placeholder="输入你的问题，多 Agent 协作解答..."
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div className="flex items-center justify-between px-4 pb-3">
            <div className="flex items-center gap-1.5">
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full text-[#81858c] hover:bg-[#f0f4ff] hover:text-[#4f8cff] transition-colors disabled:opacity-50"
                title="上传文件到知识库">
                <Paperclip size={14} />
              </button>
              <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.txt,.png,.jpg,.jpeg" onChange={handleFileUpload} />
              <div className="w-px h-4 bg-[#e0e4e8]" />
              {modeTags.map((mode) => (
                <button
                  key={mode}
                  onClick={() => setActiveMode(mode)}
                  className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                    activeMode === mode
                      ? 'bg-[#4f8cff] text-white'
                      : 'bg-[#f0f4ff] text-[#81858c] hover:bg-[#e0e8ff]'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim() || !defaultProjectId}
              className="btn btn-sm"
              style={{
                background: input.trim() && defaultProjectId ? 'linear-gradient(135deg, #4f8cff, #6c5ce7)' : '#e0e4e8',
                color: input.trim() && defaultProjectId ? '#fff' : '#9ca3af',
                borderRadius: '10px',
                border: 'none',
                minWidth: '64px',
              }}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : '发送'}
            </button>
          </div>
        </div>

        {/* 最近项目 */}
        {!isGuest && recentProjectIds.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2.5">
              <div className="flex-1 border-t border-[#eceef2]" />
              <span className="text-[10px] text-[#b0b8c1]">最近项目</span>
              <div className="flex-1 border-t border-[#eceef2]" />
              <button onClick={() => navigate('/v3/personal')} className="text-[10px] text-[#4f8cff] hover:underline ml-2 shrink-0">管理</button>
            </div>
            <div className="flex gap-2 justify-center">
              {recentProjectIds.slice(0, 3).map(pid => {
                const p = allProjects.find(pr => pr.id === pid);
                if (!p) return null;
                const isQuick = p.name === DEFAULT_PROJECT_NAME;
                return (
                  <button key={pid} onClick={() => navigateToChat(pid)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#eceef2] bg-white hover:border-[#4f8cff] hover:shadow-sm transition-all text-left">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isQuick ? 'bg-[#4f8cff]/10' : 'bg-[#f0f4ff]'}`}>
                      {isQuick ? <Zap size={14} className="text-[#4f8cff]" /> : <FolderKanban size={14} className="text-[#4f8cff]" />}
                    </div>
                    <div>
                      <div className="text-xs font-medium text-[#1d1d1f]">{p.name}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 最近对话（降存在感） */}
        {!isGuest && recentSessions.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 border-t border-[#eceef2]" />
              <span className="text-[10px] text-[#b0b8c1]">最近对话</span>
              <div className="flex-1 border-t border-[#eceef2]" />
            </div>
            <div className="space-y-0.5">
              {recentSessions.map(({ session, projectId, projectName }) => (
                <button
                  key={session.id}
                  onClick={() => handleSessionClick(projectId, session.id)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors text-left group"
                >
                  <MessageSquare size={10} className="text-[#d0d4d8] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] text-[#b0b8c1] truncate block">{session.title || '新对话'}</span>
                    <span className="text-[9px] text-[#b0b8c1]/50 truncate block">{projectName}</span>
                  </div>
                  <span className="text-[9px] text-[#d0d4d8] shrink-0">{session.count}条</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 游客提示 */}
        {isGuest && (
          <div className="text-center mt-8 p-4 rounded-xl bg-[#f9fafb] border border-[#e0e4e8]">
            <p className="text-xs text-[#b0b8c1]">
              💡 游客模式下会话不会保存。
              <a href="/register" className="text-[#4f8cff] hover:underline ml-1">注册</a>
              {' '}即可保存全部对话
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
