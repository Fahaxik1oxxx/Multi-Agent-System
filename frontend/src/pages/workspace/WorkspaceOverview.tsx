import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { workspacesApi } from '@/api/workspaces';
import { WorkspaceCard } from '@/components/shared/WorkspaceCard';
import { CreateDialog } from '@/components/shared/CreateDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';

export function WorkspaceOverview() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: workspaces, isLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: async () => {
      const res = await workspacesApi.list();
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      const res = await workspacesApi.create({ name, description });
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      toast.success(`工作空间 "${data.name}" 创建成功`);
      navigate(`/w/${data.id}`);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '创建失败';
      toast.error(msg);
    },
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">工作空间</h1>
          <p className="text-muted-foreground mt-1">管理你的团队和智能体项目</p>
        </div>
        <CreateDialog
          title="创建工作空间"
          description="工作空间是团队协作的容器，创建后可以邀请成员加入"
          triggerLabel="创建工作空间"
          namePlaceholder="例如：课程设计团队"
          onSubmit={async (name, description) => {
            await createMutation.mutateAsync({ name, description });
          }}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : workspaces && workspaces.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workspaces.map((ws) => (
            <WorkspaceCard key={ws.id} workspace={ws} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="还没有工作空间"
          description="创建你的第一个工作空间，开始与团队一起使用智能体"
          action={
            <CreateDialog
              title="创建工作空间"
              description="工作空间是团队协作的容器"
              triggerLabel="创建第一个工作空间"
              onSubmit={async (name, description) => {
                await createMutation.mutateAsync({ name, description });
              }}
            />
          }
        />
      )}
    </div>
  );
}
