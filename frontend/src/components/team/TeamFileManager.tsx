import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { toast } from 'sonner';
import {
  Upload, Trash2, Download, X, FileIcon,
  Check, Loader2, CheckSquare, Square,
} from 'lucide-react';
import { FilePreviewModal } from './FilePreviewModal';
import { ConfirmModal } from '@/components/shared/ConfirmModal';

const FILE_ICONS: Record<string, string> = {
  md: '📄', txt: '📄', pdf: '📕', docx: '📘',
  png: '📷', jpg: '📷', jpeg: '📷', gif: '📷', svg: '📷', webp: '📷',
  mp4: '🎬', webm: '🎬', mov: '🎬',
  py: '🐍', js: '📜', ts: '📜', json: '📋', csv: '📊',
  zip: '📦', exe: '⚙️',
};

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return FILE_ICONS[ext] || '📄';
}

const TYPE_ORDER: Record<string, number> = {
  md: 0, txt: 0, pdf: 0, docx: 0,
  png: 1, jpg: 1, jpeg: 1, gif: 1, svg: 1, webp: 1, bmp: 1,
  mp4: 2, webm: 2, mov: 2, avi: 2,
  py: 3, js: 3, ts: 3, json: 3, csv: 3, yaml: 3, yml: 3,
};

function sortFilesByType(files: TeamFile[]): TeamFile[] {
  return [...files].sort((a, b) => {
    const extA = a.file_name?.split('.').pop()?.toLowerCase() || '';
    const extB = b.file_name?.split('.').pop()?.toLowerCase() || '';
    const orderA = TYPE_ORDER[extA] ?? 99;
    const orderB = TYPE_ORDER[extB] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.file_name?.localeCompare(b.file_name || '') || 0;
  });
}

interface TeamFile {
  id: string;
  file_name: string;
  size: number;
  mime_type: string;
  uploaded_by_name: string;
  created_at: string;
}

interface TeamFileManagerProps {
  orgId: string;
  onPreview: (file: TeamFile) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function TeamFileManager({ orgId, onPreview, isOpen, onClose }: TeamFileManagerProps) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [previewFile, setPreviewFile] = useState<TeamFile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: rawFiles = [], isLoading } = useQuery({
    queryKey: ['org-files', orgId],
    queryFn: async () => {
      const res = await apiClient.get(`/orgs/${orgId}/files`);
      return res.data as TeamFile[];
    },
    enabled: isOpen && !!orgId,
  });

  // 按类型排序
  const files = useMemo(() => sortFilesByType(rawFiles), [rawFiles]);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await apiClient.post(`/orgs/${orgId}/files/upload`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data;
    },
    onSuccess: (data) => {
      toast.success(`已上传: ${data.file_name}`);
      qc.invalidateQueries({ queryKey: ['org-files', orgId] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || '上传失败'),
  });

  const renameMutation = useMutation({
    mutationFn: async ({ fileId, name }: { fileId: string; name: string }) => {
      await apiClient.put(`/orgs/${orgId}/files/${fileId}/rename`, { file_name: name });
    },
    onSuccess: () => {
      toast.success('已重命名');
      qc.invalidateQueries({ queryKey: ['org-files', orgId] });
      setRenamingId(null);
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || '重命名失败'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (fileId: string) => {
      await apiClient.delete(`/orgs/${orgId}/files/${fileId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-files', orgId] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || '删除失败'),
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async (fileIds: string[]) => {
      await apiClient.post(`/orgs/${orgId}/files/batch-delete`, { file_ids: fileIds });
    },
    onSuccess: (data: any) => {
      toast.success(`已删除 ${data.deleted} 个文件`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['org-files', orgId] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || '批量删除失败'),
  });

  const handleExport = useCallback(async () => {
    if (selected.size === 0) { toast.error('请先选择文件'); return; }
    try {
      const res = await apiClient.post(`/orgs/${orgId}/files/batch-export`,
        { file_ids: Array.from(selected) },
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = `org_files_${orgId.slice(0, 8)}.zip`;
      a.click(); URL.revokeObjectURL(url);
      toast.success('导出成功');
    } catch {
      toast.error('导出失败');
    }
  }, [selected, orgId]);

  const toggleSelect = (fid: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(fid)) next.delete(fid); else next.add(fid);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === files.length) { setSelected(new Set()); }
    else { setSelected(new Set(files.map(f => f.id))); }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const handleDelete = (fileId: string, fileName: string) => {
    setDeleteTarget({ id: fileId, name: fileName });
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadMutation.mutate(file);
    if (e.target) e.target.value = '';
  };

  // 点击 esc
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !previewFile) onClose();
      if (e.key === 'Escape' && previewFile) setPreviewFile(null);
    };
    if (isOpen) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose, previewFile]);

  // 退出多选模式时清空选择
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  if (!isOpen) return null;

  return (
    <>
      {/* 管理弹窗 */}
      <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-xl w-[880px] h-[660px] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 头部 */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#eceef2] shrink-0">
            <h2 className="text-base font-semibold text-[#1d1d1f]">📁 团队文档管理</h2>
            <div className="flex items-center gap-3">
              {selectMode ? (
                <>
                  <span className="text-xs text-[#81858c]">已选 {selected.size} 项</span>
                  <button onClick={() => batchDeleteMutation.mutate(Array.from(selected))}
                    className="text-xs text-[#ef4444] hover:underline">删除选中</button>
                  <button onClick={handleExport}
                    className="text-xs text-[#4f8cff] hover:underline flex items-center gap-1">
                    <Download size={12} /> 导出
                  </button>
                  <button onClick={exitSelectMode}
                    className="text-xs text-[#81858c] hover:underline">退出多选</button>
                </>
              ) : (
                <button onClick={() => setSelectMode(true)}
                  className="text-xs text-[#4f8cff] hover:underline flex items-center gap-1">
                  <CheckSquare size={12} /> 多选
                </button>
              )}
              <button onClick={() => fileInputRef.current?.click()}
                className="btn btn-sm" style={{ background: 'linear-gradient(135deg,#4f8cff,#6c5ce7)', color: '#fff', borderRadius: '8px', border: 'none', fontSize: '12px', height: '30px' }}>
                <Upload size={12} /> 上传
              </button>
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
              <button onClick={onClose} className="text-[#81858c] hover:text-[#1d1d1f] cursor-pointer"><X size={18} /></button>
            </div>
          </div>

          {/* 文件列表 */}
          <div className="flex-1 overflow-y-auto p-4">
            {isLoading ? (
              <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-[#4f8cff]" /></div>
            ) : files.length === 0 ? (
              <div className="text-center py-12 text-[#9ca3af]">
                <FileIcon size={40} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm">暂无团队文档</p>
                <p className="text-xs mt-1">点击右上角「上传」添加文件</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[#81858c] border-b border-[#eceef2]">
                    {selectMode && (
                      <th className="text-left font-normal pb-2 w-8">
                        <button onClick={selectAll} className="cursor-pointer text-[#4f8cff]">
                          {selected.size === files.length ? <CheckSquare size={14} /> : <Square size={14} />}
                        </button>
                      </th>
                    )}
                    <th className="text-left font-normal pb-2">文件名</th>
                    <th className="text-left font-normal pb-2 w-16">大小</th>
                    <th className="text-left font-normal pb-2 w-20">上传者</th>
                    <th className="text-left font-normal pb-2 w-24">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.id} className="border-b border-[#f5f6f8] hover:bg-[#f8f9fc] group">
                      {selectMode && (
                        <td className="py-2.5">
                          <button onClick={() => toggleSelect(f.id)} className="cursor-pointer text-[#4f8cff]">
                            {selected.has(f.id) ? <CheckSquare size={14} /> : <Square size={14} />}
                          </button>
                        </td>
                      )}
                      <td className="py-2.5">
                        {renamingId === f.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              className="input input-bordered input-xs flex-1 text-xs"
                              style={{ borderRadius: '6px', borderColor: '#e0e4e8', height: '28px' }}
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && renameValue.trim()) {
                                  renameMutation.mutate({ fileId: f.id, name: renameValue.trim() });
                                }
                                if (e.key === 'Escape') setRenamingId(null);
                              }}
                              autoFocus
                            />
                            <button onClick={() => { if (renameValue.trim()) renameMutation.mutate({ fileId: f.id, name: renameValue.trim() }); }}
                              className="text-[#4f8cff]"><Check size={14} /></button>
                            <button onClick={() => setRenamingId(null)} className="text-[#81858c]"><X size={14} /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 cursor-pointer"
                            onDoubleClick={() => { setPreviewFile(f); }}>
                            <span>{getFileIcon(f.file_name)}</span>
                            <span className="text-[#1d1d1f] font-medium text-xs">{f.file_name}</span>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 text-[#81858c] text-[11px]">{formatSize(f.size)}</td>
                      <td className="py-2.5 text-[#81858c] text-[11px]">{f.uploaded_by_name}</td>
                      <td className="py-2.5">
                        <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => { setRenamingId(f.id); setRenameValue(f.file_name); }}
                            className="text-[#4f8cff] hover:underline text-[11px]">✏️ 重命名</button>
                          <button onClick={() => handleDelete(f.id, f.file_name)}
                            className="text-[#ef4444] hover:underline text-[11px]">🗑 删除</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 底部 */}
          <div className="flex items-center justify-between px-5 py-2.5 border-t border-[#eceef2] shrink-0 bg-[#f8f9fc] rounded-b-2xl">
            <span className="text-xs text-[#81858c]">共 {files.length} 个文件</span>
            <span className="text-xs text-[#81858c]">双击文件名预览 · 多选后批量操作</span>
          </div>
        </div>
      </div>

      {/* 预览弹窗（在管理弹窗上层） */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          files={files}
          orgId={orgId}
          isOpen={!!previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {/* 删除确认弹窗 */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        title="删除文件"
        message={deleteTarget ? `确定删除「${deleteTarget.name}」？` : ''}
        confirmText="删除"
        confirmStyle="danger"
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
