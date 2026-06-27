import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { toast } from 'sonner';
import { Plus, Users, ArrowLeft } from 'lucide-react';

export function TeamHome() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ['orgs'],
    queryFn: async () => {
      const res = await apiClient.get('/orgs');
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiClient.post('/orgs', { name, description: '' });
      return res.data;
    },
    onSuccess: (data) => {
      toast.success(`组织「${data.name}」已创建`);
      qc.invalidateQueries({ queryKey: ['orgs'] });
      setShowCreate(false);
      setOrgName('');
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || '创建失败'),
  });

  const joinMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiClient.post('/orgs/join', { code });
      return res.data;
    },
    onSuccess: (data) => {
      toast.success(`已加入「${data.name}」`);
      qc.invalidateQueries({ queryKey: ['orgs'] });
      setInviteCode('');
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || '加入失败'),
  });

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/')} className="text-[#81858c] hover:text-[#1d1d1f]">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold text-[#1d1d1f]">团队模式</h1>
      </div>

      {/* 我的组织 */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-[#1d1d1f]">我的组织</h2>
          <button
            className="btn btn-sm"
            onClick={() => setShowCreate(true)}
            style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '8px', border: 'none' }}
          >
            <Plus size={16} /> 创建
          </button>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-8"><span className="loading loading-spinner" /></div>
        ) : orgs.length === 0 ? (
          <p className="text-sm text-[#9ca3af] text-center py-8">暂无组织，创建一个吧</p>
        ) : (
          <div className="space-y-3">
            {orgs.map((org: any) => (
              <div
                key={org.id}
                className="flex items-center gap-4 p-4 bg-white rounded-xl border border-[#e0e4e8] cursor-pointer hover:border-[#4f8cff] hover:shadow-sm transition-all"
                onClick={() => navigate(`/team/${org.id}`)}
              >
                <div className="w-10 h-10 rounded-lg bg-[#4f8cff]/10 flex items-center justify-center shrink-0">
                  <Users size={20} className="text-[#4f8cff]" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-[#1d1d1f]">{org.name}</h3>
                  <p className="text-xs text-[#9ca3af]">
                    {org.member_count} 名成员 · 角色: {org.my_role}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 加入组织 */}
      <section className="bg-white rounded-xl border border-[#e0e4e8] p-4">
        <h2 className="text-lg font-semibold text-[#1d1d1f] mb-3">加入组织</h2>
        <div className="flex gap-2">
          <input
            type="text"
            className="input input-bordered flex-1"
            style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
            placeholder="输入 6 位邀请码"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            maxLength={6}
          />
          <button
            className="btn"
            disabled={inviteCode.length !== 6 || joinMutation.isPending}
            onClick={() => joinMutation.mutate(inviteCode)}
            style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }}
          >
            加入
          </button>
        </div>
      </section>

      {/* 创建弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-96 shadow-xl">
            <h3 className="text-lg font-semibold mb-4">创建组织</h3>
            <input
              type="text"
              className="input input-bordered w-full mb-4"
              style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
              placeholder="组织名称"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)} style={{ borderRadius: '8px' }}>取消</button>
              <button
                className="btn"
                disabled={!orgName.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate(orgName.trim())}
                style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '8px', border: 'none' }}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
