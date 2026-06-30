import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workspacesApi } from '@/api/workspaces';
import { projectsApi } from '@/api/projects';
import { sessionsApi } from '@/api/sessions';
import { Plus, FolderKanban, Loader2, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import type { Project } from '@/types/workspace';

const DEFAULT_PROJECT_NAME = '快速对话';

const PROJECT_SESSIONS_KEY = 'v3_proj_sessions';

/** 获取项目关联的会话 ID 列表 */
function getProjectSessionIds(projectId: string): string[] {
  try { return JSON.parse(localStorage.getItem(`${PROJECT_SESSIONS_KEY}_${projectId}`) || '[]'); }
  catch { return []; }
}

/** 清理项目相关的所有 localStorage 缓存 */
function cleanupProjectStorage(projectId: string) {
  localStorage.removeItem(`${PROJECT_SESSIONS_KEY}_${projectId}`);
  localStorage.removeItem(`quick_session_${projectId}`);
  if (localStorage.getItem('quick_chat_project') === projectId) {
    localStorage.removeItem('quick_chat_project');
  }
}

export function V3ProjectPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  // 获取工作空间
  const { data: workspaces, isLoading: wsLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: async () => { const res = await workspacesApi.list(); return res.data || []; },
  });

  const workspaceId = workspaces?.[0]?.id;

  // 项目列表
  const { data: projects, isLoading: projLoading } = useQuery({
    queryKey: ['v3-projects', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const res = await projectsApi.list(workspaceId);
      return res.data || [];
    },
    enabled: !!workspaceId,
  });

  // 创建工作空间
  const createWsMutation = useMutation({
    mutationFn: () => workspacesApi.create({ name: '我的工作空间', description: '自动创建' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
  });

  // 创建项目
  const createProjectMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error('无工作空间');
      return projectsApi.create(workspaceId, { name: newName, description: newDesc || undefined });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['v3-projects', workspaceId] });
      toast.success(`项目 "${data.data.name}" 创建成功`);
      setShowCreate(false); setNewName(''); setNewDesc('');
      navigate(`/v3/personal/${data.data.id}/agents`);
    },
    onError: (err) => toast.error((err as any)?.response?.data?.error || '创建失败'),
  });

  // 删除项目（含关联会话清理）
  const deleteProjectMutation = useMutation({
    mutationFn: async (id: string) => {
      const sessionIds = getProjectSessionIds(id);
      const results = await Promise.allSettled(
        sessionIds.map(sid => sessionsApi.delete(sid))
      );
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        throw new Error(`${failed.length}/${sessionIds.length} 个会话删除失败`);
      }
      await projectsApi.delete(id);
      cleanupProjectStorage(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['v3-projects', workspaceId] });
      toast.success('项目已删除（含关联会话记录）');
    },
    onError: (err) => toast.error((err as any)?.message || '删除失败'),
  });

  // 自动创建工作空间
  if (!wsLoading && workspaces && workspaces.length === 0 && !createWsMutation.isPending) {
    createWsMutation.mutate();
  }

  const isLoading = wsLoading || projLoading;

  // 检测重复的快速对话项目（之前版本留下的）
  const quickChatProjects = (projects || []).filter((p: any) => p.name === DEFAULT_PROJECT_NAME);
  const hasDuplicateQuickChat = quickChatProjects.length > 1;

  // 按快速对话置顶排序
  const sortedProjects = [...(projects || [])].sort((a, b) => {
    if (a.name === DEFAULT_PROJECT_NAME) return -1;
    if (b.name === DEFAULT_PROJECT_NAME) return 1;
    return 0;
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* 项目标题 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#1d1d1f]">项目</h1>
          <p className="text-sm text-[#81858c] mt-1">选择一个项目开始智能体协作</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn btn-sm"
          style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '10px', border: 'none' }}>
          <Plus size={14} /> 创建项目
        </button>
      </div>

      {/* 重复快速对话警告 */}
      {hasDuplicateQuickChat && (
        <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center justify-between">
          <span>检测到 {quickChatProjects.length} 个「快速对话」项目，只保留一个即可</span>
          <button
            className="btn btn-xs bg-amber-200 hover:bg-amber-300 border-none text-amber-800"
            onClick={async () => {
              // 保留第一个，删除其余
              const keep = quickChatProjects[0];
              for (const p of quickChatProjects.slice(1)) {
                try { await projectsApi.delete(p.id); } catch {}
              }
              queryClient.invalidateQueries({ queryKey: ['v3-projects', workspaceId] });
              toast.success(`已保留「${keep.name}」，删除 ${quickChatProjects.length - 1} 个重复项`);
            }}
          >
            清理重复
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin text-[#4f8cff]" /></div>
      ) : sortedProjects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sortedProjects.map((p: Project) => {
            const isQuickChat = p.name === DEFAULT_PROJECT_NAME;
            return (
              <div
                key={p.id}
                className={`relative group rounded-xl border transition-all ${
                  isQuickChat
                    ? 'border-[#4f8cff]/30 bg-[#f0f4ff] hover:border-[#4f8cff]'
                    : 'border-[#e0e4e8] bg-white hover:border-[#4f8cff]'
                } hover:shadow-sm`}
              >
                {/* 点击进入项目 */}
                <button
                  onClick={() => {
                    if (isQuickChat) { navigate(`/v3/personal/${p.id}/chat`); return; }
                    const hasConfig = p.agent_config && p.agent_config !== '{}';
                    navigate(hasConfig ? `/v3/personal/${p.id}/chat` : `/v3/personal/${p.id}/agents`);
                  }}
                  className="flex items-start gap-3 p-4 text-left w-full"
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    isQuickChat ? 'bg-[#4f8cff]/15' : 'bg-[#f0f4ff]'
                  }`}>
                    {isQuickChat ? (
                      <Zap size={20} className="text-[#4f8cff]" />
                    ) : (
                      <FolderKanban size={20} className="text-[#4f8cff]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${isQuickChat ? 'text-[#4f8cff]' : 'text-[#1d1d1f]'}`}>{p.name}</span>
                      {isQuickChat && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#4f8cff]/10 text-[#4f8cff]">默认</span>
                      )}
                    </div>
                    {p.description && <div className="text-xs text-[#81858c] mt-0.5 truncate">{p.description}</div>}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-[#b0b8c1]">{new Date(p.created_at).toLocaleDateString()}</span>
                      {p.agent_config && p.agent_config !== '{}' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#e8f5e9] text-[#2e7d32]">已配置</span>
                      )}
                    </div>
                  </div>
                </button>

                {/* 删除按钮（非快速对话） */}
                {!isQuickChat && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`确定删除项目「${p.name}」？`)) {
                        deleteProjectMutation.mutate(p.id);
                      }
                    }}
                    className="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[#9ca3af] hover:text-[#ef4444] hover:bg-red-50"
                    title="删除项目"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">📂</div>
          <p className="text-[#81858c] text-sm">还没有项目</p>
          <p className="text-xs text-[#b0b8c1] mt-1">创建第一个项目开始使用智能体</p>
        </div>
      )}

      {/* 创建项目弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-[#1d1d1f] mb-4">创建项目</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#81858c] mb-1">项目名称</label>
                <input className="input input-bordered w-full text-sm" style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                  placeholder="例如：代码助手" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#81858c] mb-1">描述（可选）</label>
                <input className="input input-bordered w-full text-sm" style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                  placeholder="简要描述项目用途" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button className="btn btn-ghost btn-sm" style={{ borderRadius: '10px' }} onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn btn-sm" disabled={!newName.trim() || createProjectMutation.isPending}
                style={{
                  background: newName.trim() ? 'linear-gradient(135deg, #4f8cff, #6c5ce7)' : '#e0e4e8',
                  color: newName.trim() ? '#fff' : '#9ca3af', borderRadius: '10px', border: 'none',
                }}
                onClick={() => createProjectMutation.mutate()}>
                {createProjectMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
