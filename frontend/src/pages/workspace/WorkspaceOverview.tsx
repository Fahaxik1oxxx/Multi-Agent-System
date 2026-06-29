import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { workspacesApi } from '@/api/workspaces';
import { WorkspaceCard } from '@/components/shared/WorkspaceCard';
import { CreateDialog } from '@/components/shared/CreateDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { toast } from 'sonner';

export function WorkspaceOverview() {
  const { isGuest } = useAuthStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: workspaces, isLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: async () => {
      const res = await workspacesApi.list();
      return res.data;
    },
    enabled: !isGuest,
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
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        '创建失败';
      toast.error(msg);
    },
  });

  // 游客模式：展示欢迎卡片
  if (isGuest) {
    return (
      <div className="p-6 max-w-5xl mx-auto flex flex-col items-center justify-center min-h-[70vh]">
        <div className="text-center max-w-lg">
          <div className="text-6xl mb-4">🤖</div>
          <h1 className="text-2xl font-bold text-[#1d1d1f] mb-2">欢迎体验多智能体协作平台</h1>
          <p className="text-[#81858c] mb-6">
            输入任何问题，8 个 Agent 为你协作解答。无需注册，立即开始。
          </p>
          <p className="text-xs text-[#b0b8c1]">
            💡 注册后可保存会话、使用知识库、创建团队
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f]">工作空间</h1>
          <p className="text-[#81858c] mt-1">管理你的团队和智能体项目</p>
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
            <div key={i} className="h-40 animate-pulse rounded-lg bg-gray-100" />
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
