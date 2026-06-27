import { useQuery } from '@tanstack/react-query';
import { knowledgeApi, type KnowledgeFile } from '@/api/knowledge';

interface FilesTabProps { projectId: string; }

export function FilesTab({ projectId }: FilesTabProps) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['knowledge-files', projectId],
    queryFn: async () => { const res = await knowledgeApi.listFiles(); return res.data; },
    enabled: !!projectId,
  });
  const handleDownload = (filename: string) => { window.open(`/api/knowledge/files/${encodeURIComponent(filename)}`, '_blank'); };
  const handleDelete = async (filename: string) => { try { await knowledgeApi.deleteFile(filename); refetch(); } catch {} };
  return (
    <div>
      <h3 className="text-sm font-semibold text-[#1d1d1f] mb-3">项目文件</h3>
      {isLoading ? <div className="text-center py-4"><span className="loading loading-spinner loading-sm text-[#4f8cff]" /></div>
      : !data || data.length === 0 ? <p className="text-xs text-[#b0b8c1] text-center py-8">暂无文件</p>
      : <div className="space-y-1">
          {data.map((f: KnowledgeFile) => (
            <div key={f.name} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-[#f9fafb] transition-colors">
              <div className="min-w-0 flex-1"><div className="text-xs text-[#1d1d1f] truncate">{f.name}</div><div className="text-[10px] text-[#9ca3af]">{f.size > 1024 ? (f.size / 1024).toFixed(1) + 'KB' : f.size + 'B'}</div></div>
              <div className="flex gap-1 shrink-0">
                <button className="text-[10px] px-2 py-0.5 rounded text-[#4f8cff] hover:bg-[#4f8cff]/5" onClick={() => handleDownload(f.name)}>下载</button>
                <button className="text-[10px] px-2 py-0.5 rounded text-[#ef4444] hover:bg-[#ef4444]/5" onClick={() => handleDelete(f.name)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      }
      <button className="btn btn-ghost btn-sm w-full mt-3 text-xs text-[#81858c]" style={{ borderRadius: '10px' }}
        onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.onchange = async () => { if (inp.files) { for (const f of Array.from(inp.files)) { try { await knowledgeApi.upload(f); } catch {} } refetch(); } }; inp.click(); }}>
        📤 上传文件
      </button>
    </div>
  );
}
