import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workspacesApi } from '@/api/workspaces';
import { projectsApi } from '@/api/projects';
import { ProjectCard } from '@/components/shared/ProjectCard';
import { CreateDialog } from '@/components/shared/CreateDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { ArrowLeft, UserPlus, Trash2, Loader2 } from 'lucide-react';
import { useState, useRef } from 'react';
import { hasPermission } from '@/lib/permissions';
import { toast } from 'sonner';

export function WorkspaceDetail() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inviteDialogRef = useRef<HTMLDialogElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: async () => {
      const res = await workspacesApi.get(workspaceId!);
      return res.data;
    },
    enabled: !!workspaceId,
  });

  const deleteProjectMutation = useMutation({
    mutationFn: (projectId: string) => projectsApi.delete(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] });
      toast.success('项目已删除');
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      const res = await projectsApi.create(workspaceId!, { name, description });
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] });
      toast.success(`项目 "${data.name}" 创建成功`);
      navigate(`/w/${workspaceId}/p/${data.id}/chat`);
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        '创建失败';
      toast.error(msg);
    },
  });

  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('member');

  const inviteMutation = useMutation({
    mutationFn: async () => {
      await workspacesApi.invite(workspaceId!, {
        user_name: inviteName,
        role: inviteRole,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] });
      toast.success(`${inviteName} 已加入工作空间`);
      inviteDialogRef.current?.close();
      setInviteName('');
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        '邀请失败';
      toast.error(msg);
    },
  });

  const myRole = data?.my_role ?? null;
  const canInvite = hasPermission(myRole as Parameters<typeof hasPermission>[0], 'invite');
  const canCreate = hasPermission(myRole as Parameters<typeof hasPermission>[0], 'edit');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="loading loading-spinner loading-lg text-[#4f8cff]" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <button className="btn btn-ghost btn-sm mb-4" onClick={() => navigate('/')}>
          <ArrowLeft size={16} /> 返回
        </button>
        <EmptyState title="工作空间不存在" description="该工作空间可能已被删除" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* 返回 + 标题 */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <button className="btn btn-ghost btn-sm mb-2 -ml-2" onClick={() => navigate('/')}>
            <ArrowLeft size={16} /> 返回
          </button>
          <h1 className="text-2xl font-bold text-[#1d1d1f]">{data.name}</h1>
          <p className="text-[#81858c] mt-1">{data.description || '暂无描述'}</p>
        </div>
        <div className="flex gap-2">
          {canInvite && (
            <button
              className="btn btn-outline btn-sm"
              style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
              onClick={() => inviteDialogRef.current?.showModal()}
            >
              <UserPlus size={16} /> 邀请成员
            </button>
          )}
        </div>
      </div>

      {/* 邀请成员弹窗 */}
      <dialog ref={inviteDialogRef} className="modal">
        <div className="modal-box" style={{ borderRadius: '16px', padding: 0, overflow: 'hidden' }}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <h3 className="text-base font-semibold text-[#1d1d1f]">邀请成员</h3>
            <form method="dialog">
              <button className="w-7 h-7 rounded-full border-none bg-transparent text-[#9ca3af] cursor-pointer flex items-center justify-center text-sm hover:bg-[#f3f4f6] hover:text-[#4b5563]">
                ✕
              </button>
            </form>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1 text-[#81858c]">用户名</label>
              <input
                className="input input-bordered w-full"
                style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="输入已注册用户的用户名"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-[#81858c]">角色</label>
              <select
                className="select select-bordered w-full"
                style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
              >
                <option value="member">Member — 可编辑项目</option>
                <option value="viewer">Viewer — 只读</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 px-5 pb-5">
            <form method="dialog">
              <button className="btn btn-ghost btn-sm" style={{ borderRadius: '10px' }}>取消</button>
            </form>
            <button
              className="btn btn-sm"
              disabled={!inviteName.trim()}
              onClick={() => inviteMutation.mutate()}
              style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }}
            >
              邀请
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>

      {/* 成员列表 */}
      <div className="mb-8">
        <h2 className="text-sm font-medium text-[#81858c] mb-3">
          成员 ({data.members?.length ?? 0})
        </h2>
        <div className="flex flex-wrap gap-2">
          {data.members?.map((m) => (
            <span key={m.user_id} className="badge badge-ghost gap-1">
              {m.name}
              <span className="text-xs opacity-50">
                ({m.role === 'owner' ? 'Owner' : m.role === 'member' ? 'Member' : 'Viewer'})
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* 项目列表 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-[#81858c]">
            项目 ({data.projects?.length ?? 0})
          </h2>
          {canCreate && (
            <CreateDialog
              title="创建项目"
              description="项目是智能体实验的容器，包含对话会话和配置"
              triggerLabel="创建项目"
              namePlaceholder="例如：代码助手 v2.0"
              onSubmit={async (name, description) => {
                await createProjectMutation.mutateAsync({ name, description });
              }}
            />
          )}
        </div>
        {data.projects && data.projects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                myRole={myRole}
                onDelete={(id) => deleteProjectMutation.mutate(id)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="还没有项目"
            description="创建第一个项目，开始配置和运行智能体"
            action={
              canCreate && (
                <CreateDialog
                  title="创建项目"
                  description="项目是智能体实验的容器"
                  triggerLabel="创建第一个项目"
                  onSubmit={async (name, description) => {
                    await createProjectMutation.mutateAsync({ name, description });
                  }}
                />
              )
            }
          />
        )}
      </div>
    </div>
  );
}
