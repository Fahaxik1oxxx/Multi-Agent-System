import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { X, Crown, Shield, Edit3, Trash2, Hash, Check, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmModal } from '@/components/shared/ConfirmModal';

interface TeamSettingsModalProps {
  orgId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function TeamSettingsModal({ orgId, isOpen, onClose }: TeamSettingsModalProps) {
  const qc = useQueryClient();
  const [renamingCh, setRenamingCh] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [newChName, setNewChName] = useState('');
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; action: () => void } | null>(null);

  const { data: orgDetail, isLoading } = useQuery({
    queryKey: ['org-detail', orgId],
    queryFn: async () => {
      const res = await apiClient.get(`/orgs/${orgId}`);
      return res.data;
    },
    enabled: isOpen && !!orgId,
  });

  const { data: channels = [] } = useQuery({
    queryKey: ['channels', orgId],
    queryFn: async () => {
      const res = await apiClient.get(`/orgs/${orgId}/channels`);
      return res.data;
    },
    enabled: isOpen && !!orgId,
  });

  const members = orgDetail?.members || [];
  const sortedMembers = [...members].sort((a: any, b: any) => {
    if (a.role === 'owner' && b.role !== 'owner') return -1;
    if (a.role !== 'owner' && b.role === 'owner') return 1;
    return (a.user_name || '').localeCompare(b.user_name || '');
  });
  const isOwner = orgDetail?.my_role === 'owner';

  const renameMutation = useMutation({
    mutationFn: async ({ chId, name }: { chId: string; name: string }) => {
      await apiClient.put(`/orgs/${orgId}/channels/${chId}`, { name });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['channels', orgId] }); setRenamingCh(null); toast.success('频道已重命名'); },
    onError: (err: any) => toast.error(err?.response?.data?.error || '重命名失败'),
  });

  const clearMutation = useMutation({
    mutationFn: async (chId: string) => {
      await apiClient.delete(`/orgs/${orgId}/channels/${chId}/messages`);
    },
    onSuccess: () => toast.success('聊天记录已清空'),
    onError: (err: any) => toast.error(err?.response?.data?.error || '清空失败'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (chId: string) => {
      await apiClient.delete(`/orgs/${orgId}/channels/${chId}`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['channels', orgId] }); toast.success('频道已删除'); },
    onError: (err: any) => toast.error(err?.response?.data?.error || '删除失败'),
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      await apiClient.post(`/orgs/${orgId}/channels`, { name });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['channels', orgId] }); setNewChName(''); toast.success('频道已创建'); },
    onError: (err: any) => toast.error(err?.response?.data?.error || '创建失败'),
  });

  if (!isOpen) return null;

  const orgName = orgDetail?.name || '';
  const owner = members.find((m: any) => m.role === 'owner');

  return (
    <>
      <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-xl w-[880px] h-[660px] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#eceef2] shrink-0">
            <h2 className="text-base font-semibold text-[#1d1d1f]">👥 团队管理</h2>
            <button onClick={onClose} className="text-[#81858c] hover:text-[#1d1d1f] cursor-pointer"><X size={18} /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {isLoading ? (
              <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-[#4f8cff]" /></div>
            ) : (
              <div className="space-y-5 max-w-2xl mx-auto">
                {/* 组织信息卡片 */}
                <div className="bg-white rounded-xl border border-[#e0e4e8] overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#eceef2] bg-gray-50/50">
                    <h3 className="text-sm font-semibold text-[#1d1d1f]">📋 组织信息</h3>
                  </div>
                  <div className="p-4 text-sm space-y-2">
                    <div className="flex items-center gap-3"><span className="text-[#81858c] w-20 shrink-0">组织名称</span><span className="font-medium">{orgName}</span></div>
                    <div className="flex items-center gap-3"><span className="text-[#81858c] w-20 shrink-0">管理员</span><span className="font-medium">{owner?.user_name || '—'}</span><Crown size={14} className="text-[#f59e0b]" /></div>
                    <div className="flex items-center gap-3"><span className="text-[#81858c] w-20 shrink-0">邀请码</span><span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{orgDetail?.invite_code || '—'}</span></div>
                  </div>
                </div>

                {/* 成员卡片 */}
                <div className="bg-white rounded-xl border border-[#e0e4e8] overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#eceef2] bg-gray-50/50">
                    <h3 className="text-sm font-semibold text-[#1d1d1f]">👥 成员列表（{members.length}）</h3>
                  </div>
                  <div className="p-3 space-y-1 max-h-48 overflow-y-auto">
                    {sortedMembers.map((m: any) => (
                      <div key={m.user_id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${m.role === 'owner' ? 'bg-[#f59e0b]' : 'bg-[#4f8cff]'}`}>
                          {m.user_name?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div className="flex-1 min-w-0"><div className="text-sm font-medium text-[#1d1d1f]">{m.user_name}</div></div>
                        {m.role === 'owner' ? <span className="text-xs text-[#f59e0b] font-medium flex items-center gap-1"><Crown size={12} /> 管理员</span> : <span className="text-xs text-[#81858c]">成员</span>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 频道管理卡片 — 仅管理员可见 */}
                {isOwner && (
                  <div className="bg-white rounded-xl border border-[#e0e4e8] overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[#eceef2] bg-gray-50/50">
                      <h3 className="text-sm font-semibold text-[#1d1d1f]"># 频道管理（{channels.length}）</h3>
                      <div className="flex items-center gap-1">
                        <input className="w-24 text-xs border border-[#e0e4e8] rounded-lg px-2 py-1 outline-none focus:border-[#4f8cff]" placeholder="新频道名" value={newChName}
                          onChange={(e) => setNewChName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && newChName.trim() && createMutation.mutate(newChName.trim())} />
                        <button onClick={() => newChName.trim() && createMutation.mutate(newChName.trim())}
                          className="w-6 h-6 rounded flex items-center justify-center text-[#4f8cff] hover:bg-[#4f8cff]/10 transition-colors"><Plus size={14} /></button>
                      </div>
                    </div>
                    <div className="p-3 space-y-1">
                      {channels.map((ch: any) => (
                        <div key={ch.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors group">
                          <Hash size={14} className="text-[#81858c] shrink-0" />
                          {renamingCh === ch.id ? (
                            <div className="flex items-center gap-1 flex-1">
                              <input className="flex-1 text-xs border border-[#4f8cff] rounded-lg px-2 py-1 outline-none" value={renameVal}
                                onChange={(e) => setRenameVal(e.target.value)}
                                onBlur={() => setRenamingCh(null)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && renameVal.trim()) renameMutation.mutate({ chId: ch.id, name: renameVal.trim() });
                                  if (e.key === 'Escape') setRenamingCh(null);
                                }} autoFocus />
                              <button onClick={() => renameVal.trim() && renameMutation.mutate({ chId: ch.id, name: renameVal.trim() })}
                                className="text-[#4f8cff]"><Check size={14} /></button>
                            </div>
                          ) : (
                            <>
                              <span className="flex-1 text-sm text-[#1d1d1f]"># {ch.name}</span>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => { setRenamingCh(ch.id); setRenameVal(ch.name); }}
                                  className="text-xs text-[#81858c] hover:text-[#4f8cff] px-1.5 py-0.5 rounded hover:bg-gray-100" title="重命名"><Edit3 size={12} /></button>
                                <button onClick={() => setConfirmState({ title: '清空聊天记录', message: `确定清空 #${ch.name} 的所有消息？此操作不可撤销。`, action: () => { clearMutation.mutate(ch.id); setConfirmState(null); } })}
                                  className="text-xs text-[#81858c] hover:text-[#f59e0b] px-1.5 py-0.5 rounded hover:bg-amber-50" title="清空记录">🗑</button>
                                <button onClick={() => setConfirmState({ title: '删除频道', message: `确定删除频道 #${ch.name}？频道内所有消息将被删除。`, action: () => { deleteMutation.mutate(ch.id); setConfirmState(null); } })}
                                  className="text-xs text-[#81858c] hover:text-[#ef4444] px-1.5 py-0.5 rounded hover:bg-red-50" title="删除频道"><Trash2 size={12} /></button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 确认弹窗 */}
      <ConfirmModal
        isOpen={!!confirmState}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        confirmText="确定"
        confirmStyle={confirmState?.title?.includes('删除') ? 'danger' : 'warning'}
        onConfirm={() => confirmState?.action()}
        onCancel={() => setConfirmState(null)}
      />
    </>
  );
}
