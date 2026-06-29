import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { knowledgeApi } from '@/api/knowledge';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';
import { Upload, Trash2, FileIcon, RefreshCw, Database, HardDrive } from 'lucide-react';

export function KnowledgePage() {
  const { isGuest } = useAuthStore();
  const qc = useQueryClient();
  const [isDragging, setIsDragging] = useState(false);

  const { data: files = [], isLoading } = useQuery({
    queryKey: ['kb-files'],
    queryFn: async () => { const res = await knowledgeApi.listFiles(); return res.data; },
  });

  const { data: stats } = useQuery({
    queryKey: ['kb-stats'],
    queryFn: async () => { const res = await knowledgeApi.getStats(); return res.data; },
    enabled: !isGuest,
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => knowledgeApi.deleteFile(name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kb-files'] }); toast.success('文件已删除'); },
    onError: () => toast.error('删除失败'),
  });

  const rebuildMutation = useMutation({
    mutationFn: () => knowledgeApi.rebuild(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kb-stats'] }); toast.success('索引已重建'); },
    onError: () => toast.error('重建失败'),
  });

  const handleUpload = async (file: File) => {
    const toastId = toast.loading(`上传中: ${file.name}`);
    try {
      await knowledgeApi.upload(file);
      toast.success(`上传完成: ${file.name}`, { id: toastId });
      qc.invalidateQueries({ queryKey: ['kb-files'] });
      qc.invalidateQueries({ queryKey: ['kb-stats'] });
    } catch {
      toast.error(`上传失败: ${file.name}`, { id: toastId });
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1d1d1f]">知识库</h1>
        <p className="text-sm text-[#81858c] mt-1">管理上传的文件，Agent 可从中检索信息</p>
      </div>

      {/* 索引状态（个人模式） */}
      {!isGuest && stats && (
        <div className="bg-white rounded-xl border border-[#e0e4e8] p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[#1d1d1f] flex items-center gap-1.5">
              <Database size={16} className="text-[#4f8cff]" /> 索引状态
            </h2>
            <button
              className="btn btn-xs btn-ghost text-[#4f8cff]"
              disabled={rebuildMutation.isPending}
              onClick={() => rebuildMutation.mutate()}
            >
              <RefreshCw size={12} className={rebuildMutation.isPending ? 'animate-spin' : ''} />
              重建索引
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 bg-[#f9fafb] rounded-lg">
              <div className="text-lg font-bold text-[#1d1d1f]">{stats.total_files}</div>
              <div className="text-[10px] text-[#81858c]">文件总数</div>
            </div>
            <div className="text-center p-3 bg-[#f9fafb] rounded-lg">
              <div className="text-lg font-bold text-[#4f8cff]">{stats.indexed_files}</div>
              <div className="text-[10px] text-[#81858c]">已索引</div>
            </div>
            <div className="text-center p-3 bg-[#f9fafb] rounded-lg">
              <div className="text-lg font-bold text-[#10b981]">{stats.total_chunks}</div>
              <div className="text-[10px] text-[#81858c]">切片数</div>
            </div>
          </div>
          {stats.last_indexed && (
            <p className="text-[10px] text-[#b0b8c1] mt-2 text-center">
              最后索引: {new Date(stats.last_indexed).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {/* 上传区域 */}
      <div
        className={`border-2 border-dashed rounded-2xl p-8 text-center transition-colors cursor-pointer ${
          isDragging ? 'border-[#4f8cff] bg-[#4f8cff]/5' : 'border-[#e0e4e8] bg-white'
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files[0]; if (file) handleUpload(file); }}
        onClick={() => document.getElementById('kb-file-input')?.click()}
      >
        <Upload size={32} className="mx-auto text-[#9ca3af] mb-2" />
        <p className="text-sm text-[#81858c]">拖拽文件到此处上传</p>
        <p className="text-xs text-[#9ca3af]">支持 PDF · TXT · PNG · JPG（≤5MB）</p>
        <input id="kb-file-input" type="file" className="hidden" accept=".pdf,.txt,.png,.jpg,.jpeg"
          onChange={(e) => { const file = e.target.files?.[0]; if (file) handleUpload(file); }} />
      </div>

      {/* 文件列表 */}
      <div className="bg-white rounded-xl border border-[#e0e4e8]">
        <div className="flex items-center justify-between p-4 border-b border-[#e0e4e8]">
          <h2 className="font-semibold text-[#1d1d1f] flex items-center gap-1.5">
            <HardDrive size={16} className="text-[#9ca3af]" /> 文件列表（{files.length}）
          </h2>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-8"><span className="loading loading-spinner" /></div>
        ) : files.length === 0 ? (
          <p className="text-sm text-[#9ca3af] text-center py-8">暂无文件，上传一个吧</p>
        ) : (
          <div className="divide-y divide-[#f0f0f0]">
            {files.map((f: any) => (
              <div key={f.name} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                <FileIcon size={18} className="text-[#9ca3af] shrink-0" />
                <span className="text-sm text-[#1d1d1f] flex-1 truncate">{f.name}</span>
                <span className="text-xs text-[#9ca3af]">{f.size ? `${(f.size / 1024).toFixed(1)}KB` : ''}</span>
                <button className="btn btn-xs btn-ghost text-[#ef4444]" onClick={() => deleteMutation.mutate(f.name)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
