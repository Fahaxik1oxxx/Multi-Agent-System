import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workspacesApi } from '@/api/workspaces';
import { projectsApi } from '@/api/projects';
import { ProjectCard } from '@/components/shared/ProjectCard';
import { CreateDialog } from '@/components/shared/CreateDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, UserPlus, Trash2, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { hasPermission } from '@/lib/permissions';
import { toast } from 'sonner';

export function WorkspaceDetail() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '创建失败';
      toast.error(msg);
    },
  });

  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteOpen, setInviteOpen] = useState(false);

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
      setInviteOpen(false);
      setInviteName('');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '邀请失败';
      toast.error(msg);
    },
  });

  const myRole = data?.my_role ?? null;
  const canInvite = hasPermission(myRole as Parameters<typeof hasPermission>[0], 'invite');
  const canCreate = hasPermission(myRole as Parameters<typeof hasPermission>[0], 'edit');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => navigate('/')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> 返回
        </Button>
        <EmptyState title="工作空间不存在" description="该工作空间可能已被删除" />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* 返回 + 标题 */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <Button variant="ghost" className="mb-2 -ml-2" onClick={() => navigate('/')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> 返回
          </Button>
          <h1 className="text-2xl font-bold">{data.name}</h1>
          <p className="text-muted-foreground mt-1">{data.description || '暂无描述'}</p>
        </div>
        <div className="flex gap-2">
          {canInvite && (
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <UserPlus className="mr-2 h-4 w-4" /> 邀请成员
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>邀请成员</DialogTitle>
                  <DialogDescription>输入已注册用户的用户名</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>用户名</Label>
                    <Input
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                      placeholder="输入用户名"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>角色</Label>
                    <Select value={inviteRole} onValueChange={setInviteRole}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Member — 可编辑项目</SelectItem>
                        <SelectItem value="viewer">Viewer — 只读</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => inviteMutation.mutate()} disabled={!inviteName.trim()}>
                    邀请
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* 成员列表 */}
      <div className="mb-8">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">
          成员 ({data.members?.length ?? 0})
        </h2>
        <div className="flex flex-wrap gap-2">
          {data.members?.map((m) => (
            <Badge key={m.user_id} variant="secondary" className="flex items-center gap-1">
              {m.name}
              <span className="text-xs opacity-50">
                ({m.role === 'owner' ? 'Owner' : m.role === 'member' ? 'Member' : 'Viewer'})
              </span>
            </Badge>
          ))}
        </div>
      </div>

      {/* 项目列表 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted-foreground">
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
