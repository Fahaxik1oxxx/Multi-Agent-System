import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { toast } from 'sonner';
import { Plus, Users, ArrowLeft, Share2, Trash2, MoreVertical, LogOut, Star } from 'lucide-react';
import { ConfirmModal } from '@/components/shared/ConfirmModal';

const PINNED_KEY = 'v3_pinned_orgs';

function getPinned(): string[] {
  try { return JSON.parse(localStorage.getItem(PINNED_KEY) || '[]'); } catch { return []; }
}

function togglePinned(id: string): string[] {
  const pinned = getPinned();
  const next = pinned.includes(id) ? pinned.filter(x => x !== id) : [id, ...pinned];
  localStorage.setItem(PINNED_KEY, JSON.stringify(next));
  return next;
}

export function TeamHome() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [menuOrgId, setMenuOrgId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>(getPinned);
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; action: () => void } | null>(null);

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ['orgs'],
    queryFn: async () => {
      const res = await apiClient.get('/orgs');
      return res.data;
    },
  });

  // 排序：置顶 > 我创建的 > 我加入的
  const sortedOrgs = useMemo(() => {
    const owned = orgs.filter((o: any) => o.my_role === 'owner');
    const joined = orgs.filter((o: any) => o.my_role !== 'owner');
    const sortFn = (a: any, b: any) => {
      const aPinned = pinnedIds.includes(a.id) ? 0 : 1;
      const bPinned = pinnedIds.includes(b.id) ? 0 : 1;
      if (aPinned !== bPinned) return aPinned - bPinned;
      return 0;
    };
    owned.sort(sortFn);
    joined.sort(sortFn);
    return { owned, joined };
  }, [orgs, pinnedIds]);

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiClient.post('/orgs', { name, description: '' });
      return res.data;
    },
    onSuccess: () => {
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

  const deleteMutation = useMutation({
    mutationFn: async (orgId: string) => {
      await apiClient.delete(`/orgs/${orgId}`);
    },
    onSuccess: () => {
      toast.success('组织已删除');
      qc.invalidateQueries({ queryKey: ['orgs'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || '删除失败'),
  });

  const copyInviteCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      toast.success(`已复制邀请码: ${code}`, { duration: 5000 });
    }).catch(() => {
      toast.success(`邀请码: ${code}`, { duration: 8000 });
    });
    setMenuOrgId(null);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOrgId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const leaveOrgMutation = useMutation({
    mutationFn: async (orgId: string) => {
      await apiClient.post(`/orgs/${orgId}/leave`);
    },
    onSuccess: () => {
      toast.success('已退出组织');
      qc.invalidateQueries({ queryKey: ['orgs'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || '退出失败'),
  });

  const OrgCard = ({ org }: { org: any }) => {
    const pinned = pinnedIds.includes(org.id);
    return (
      <div className="flex items-center gap-4 p-4 bg-white rounded-xl border border-[#e0e4e8] hover:border-[#4f8cff] hover:shadow-sm transition-all group">
        <div className="w-10 h-10 rounded-lg bg-[#4f8cff]/10 flex items-center justify-center shrink-0 cursor-pointer"
             onClick={() => navigate(`/v3/team/${org.id}`)}>
          <Users size={20} className="text-[#4f8cff]" />
        </div>
        <div className="flex-1 min-w-0 cursor-pointer"
             onClick={() => navigate(`/v3/team/${org.id}`)}>
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-[#1d1d1f]">{org.name}</h3>
            {pinned && <Star size={12} className="text-[#f59e0b] fill-[#f59e0b]" />}
          </div>
          <p className="text-xs text-[#9ca3af]">
            {org.member_count} 名成员 · 角色: {org.my_role}
          </p>
        </div>
        <div className="relative shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOrgId(menuOrgId === org.id ? null : org.id); }}
            className="btn btn-sm btn-ghost px-1.5"
            style={{ borderRadius: '8px' }}
          >
            <MoreVertical size={16} className="text-[#81858c]" />
          </button>
          {menuOrgId === org.id && (
            <div ref={menuRef}
              className="absolute right-0 top-full mt-1 w-36 bg-white rounded-xl shadow-lg border border-[#e0e4e8] overflow-hidden z-50"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => { setPinnedIds(togglePinned(org.id)); setMenuOrgId(null); }}
                className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-[#1d1d1f] hover:bg-gray-50"
              >
                <Star size={14} className={pinned ? 'text-[#f59e0b] fill-[#f59e0b]' : 'text-[#81858c]'} />
                {pinned ? '取消置顶' : '置顶'}
              </button>
              <button
                onClick={() => copyInviteCode(org.invite_code)}
                className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-[#1d1d1f] hover:bg-gray-50"
              >
                <Share2 size={14} className="text-[#4f8cff]" />
                分享邀请码
              </button>
              {org.my_role !== 'owner' && (
                <button
                  onClick={() => {
                    setConfirmState({ title: '退出组织', message: `确定退出组织「${org.name}」？`, action: () => { leaveOrgMutation.mutate(org.id); setConfirmState(null); } });
                    setMenuOrgId(null);
                  }}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-[#1d1d1f] hover:bg-gray-50"
                >
                  <LogOut size={14} className="text-[#f59e0b]" />
                  退出组织
                </button>
              )}
              {org.my_role === 'owner' && (
                <>
                  <div className="border-t border-[#e0e4e8]" />
                  <button
                    onClick={() => {
                      setConfirmState({ title: '删除组织', message: `确定删除组织「${org.name}」？此操作不可撤销。`, action: () => { deleteMutation.mutate(org.id); setConfirmState(null); } });
                      setMenuOrgId(null);
                    }}
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-[#ef4444] hover:bg-red-50"
                  >
                    <Trash2 size={14} />
                    删除组织
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/v3')} className="text-[#81858c] hover:text-[#1d1d1f]">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold text-[#1d1d1f]">团队模式</h1>
      </div>

      {/* 我创建的 */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-lg font-semibold text-[#1d1d1f]">我创建的</h2>
          <span className="text-xs text-[#b0b8c1]">({sortedOrgs.owned.length})</span>
          <div className="flex-1" />
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
        ) : sortedOrgs.owned.length === 0 ? (
          <div className="text-center py-6 bg-white rounded-xl border border-[#e0e4e8]">
            <p className="text-sm text-[#9ca3af]">还没有创建组织</p>
            <button onClick={() => setShowCreate(true)}
              className="text-xs text-[#4f8cff] hover:underline mt-1">创建一个</button>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedOrgs.owned.map((org: any) => <OrgCard key={org.id} org={org} />)}
          </div>
        )}
      </section>

      {/* 我加入的 */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-lg font-semibold text-[#1d1d1f]">我加入的</h2>
          <span className="text-xs text-[#b0b8c1]">({sortedOrgs.joined.length})</span>
        </div>
        {sortedOrgs.joined.length === 0 ? (
          <div className="text-center py-6 bg-white rounded-xl border border-[#e0e4e8]">
            <p className="text-sm text-[#9ca3af]">还没有加入组织</p>
            <p className="text-xs text-[#b0b8c1] mt-1">通过邀请码加入一个组织</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedOrgs.joined.map((org: any) => <OrgCard key={org.id} org={org} />)}
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

      {/* 确认弹窗 */}
      <ConfirmModal
        isOpen={!!confirmState}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        confirmText="确定"
        confirmStyle="danger"
        onConfirm={() => { confirmState?.action(); setConfirmState(null); }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}
