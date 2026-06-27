import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, ShieldOff } from 'lucide-react';
import { adminApi, type AdminUser } from '@/api/admin';
import { toast } from 'sonner';

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export function AdminPage() {
  const queryClient = useQueryClient();

  const {
    data: users,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const res = await adminApi.listUsers();
      return res.data;
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isAdmin }: { id: string; isAdmin: boolean }) => {
      await adminApi.toggleAdmin(id, isAdmin);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('角色已更新');
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        '操作失败';
      toast.error(msg);
    },
  });

  const handleToggle = (user: AdminUser) => {
    const newAdminStatus = user.is_admin === 0;
    toggleMutation.mutate({ id: user.id, isAdmin: newAdminStatus });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1d1d1f]">管理后台</h1>
        <p className="text-[#81858c] text-sm mt-1">用户管理 · 权限控制</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <span className="loading loading-spinner loading-lg text-[#4f8cff]" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-[#81858c]">加载失败，请刷新重试</p>
        </div>
      ) : !users || users.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-[#81858c]">暂无用户数据</p>
        </div>
      ) : (
        <div className="card bg-base-100 border border-[#e0e4e8] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr className="border-b border-[#e0e4e8]">
                  <th className="text-xs font-medium text-[#81858c]">用户 ID</th>
                  <th className="text-xs font-medium text-[#81858c]">用户名</th>
                  <th className="text-xs font-medium text-[#81858c]">角色</th>
                  <th className="text-xs font-medium text-[#81858c]">注册时间</th>
                  <th className="text-xs font-medium text-[#81858c]">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-[#e0e4e8] hover:bg-[#f9fafb]">
                    <td className="font-mono text-xs text-[#81858c]">
                      {user.id.substring(0, 8)}
                    </td>
                    <td className="text-sm text-[#1d1d1f] font-medium">{user.name}</td>
                    <td>
                      {user.is_admin ? (
                        <span className="badge bg-[#4f8cff]/10 text-[#4f8cff] border-0 text-xs">
                          管理员
                        </span>
                      ) : (
                        <span className="badge badge-ghost text-xs">普通用户</span>
                      )}
                    </td>
                    <td className="text-sm text-[#81858c]">{formatDate(user.created_at)}</td>
                    <td>
                      <button
                        className="btn btn-ghost btn-xs gap-1.5 text-[#81858c] hover:text-[#1d1d1f]"
                        style={{ borderRadius: '8px' }}
                        onClick={() => handleToggle(user)}
                        disabled={toggleMutation.isPending}
                      >
                        {user.is_admin ? (
                          <>
                            <ShieldOff size={14} />
                            降级
                          </>
                        ) : (
                          <>
                            <Shield size={14} />
                            升管理员
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
