import { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '@/api/client';
import { X, Download, Loader2, FileIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { Markdown } from '@/components/shared/Markdown';

interface TeamFile {
  id: string;
  file_name: string;
  size: number;
  mime_type: string;
}

interface FilePreviewModalProps {
  file: TeamFile | null;
  files: TeamFile[];
  orgId: string;
  isOpen: boolean;
  onClose: () => void;
}

type PreviewType = 'markdown' | 'docx' | 'text' | 'image' | 'pdf' | 'video' | 'unsupported';

const TEXT_EXTS = new Set(['txt', 'py', 'js', 'ts', 'json', 'yaml', 'yml', 'toml', 'css', 'html', 'xml', 'sql', 'csv', 'sh', 'bat', 'env', 'cfg', 'ini']);
const IMG_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico']);
const VID_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv']);

function getPreviewType(name: string): PreviewType {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'md') return 'markdown';
  if (ext === 'docx') return 'docx';
  if (TEXT_EXTS.has(ext)) return 'text';
  if (IMG_EXTS.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (VID_EXTS.has(ext)) return 'video';
  return 'unsupported';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const icons: Record<string, string> = {
    md: '📄', txt: '📄', pdf: '📕', docx: '📘',
    png: '📷', jpg: '📷', jpeg: '📷', gif: '📷', svg: '📷', webp: '📷',
    mp4: '🎬', webm: '🎬', mov: '🎬',
  };
  return icons[ext] || '📄';
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function FilePreviewModal({ file, files, orgId, isOpen, onClose }: FilePreviewModalProps) {
  // 内部跟踪当前文件，支持前后切换而不依赖父组件更新 file prop
  const [currentFile, setCurrentFile] = useState<TeamFile | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // 当外部 file 变化时同步到内部（仅打开时）
  useEffect(() => {
    if (isOpen && file) {
      setCurrentFile(file);
    }
    if (!isOpen) {
      setCurrentFile(null);
      setContent(null);
      setDocxHtml(null);
      setError(null);
      if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
      setObjectUrl(null);
    }
  }, [file?.id, isOpen]);

  const loadContent = useCallback((f: TeamFile) => {
    const type = getPreviewType(f.file_name);
    setLoading(true);
    setError(null);
    setContent(null);
    setDocxHtml(null);
    if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
    setObjectUrl(null);

    if (type === 'markdown' || type === 'text') {
      apiClient.get(`/orgs/${orgId}/files/${f.id}/download`)
        .then((res) => {
          if (typeof res.data === 'object' && res.data.content !== undefined) {
            const d = res.data as { content: string };
            setContent(d.content);
            if (type === 'text') {
              setDocxHtml(`<pre style="white-space:pre-wrap;font-family:monospace;font-size:13px;background:#f8f9fc;padding:16px;border-radius:10px;border:1px solid #eceef2">${escapeHtml(d.content)}</pre>`);
            }
          }
        })
        .catch((err) => setError(err?.response?.data?.error || '加载失败'))
        .finally(() => setLoading(false));
    } else if (type === 'docx') {
      apiClient.get(`/orgs/${orgId}/files/${f.id}/download`, { responseType: 'blob' })
        .then(async (res) => {
          try {
            const mammoth = await import('mammoth');
            const buffer = await (res.data as Blob).arrayBuffer();
            const result = await mammoth.default.convertToHtml({ arrayBuffer: buffer });
            setDocxHtml(`<div class="prose prose-sm max-w-none">${result.value}</div>`);
          } catch {
            const blob = new Blob([res.data as Blob], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            objectUrlRef.current = url;
            setObjectUrl(url);
            setError('文档渲染失败，可点击「下载」在本地打开');
          }
        })
        .catch((err) => setError(err?.response?.data?.error || '加载失败'))
        .finally(() => setLoading(false));
    } else if (type === 'image') {
      apiClient.get(`/orgs/${orgId}/files/${f.id}/download`, { responseType: 'blob' })
        .then((res) => {
          const blob = new Blob([res.data as Blob], { type: f.mime_type || 'image/png' });
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          setObjectUrl(url);
        })
        .catch((err) => setError(err?.response?.data?.error || '加载失败'))
        .finally(() => setLoading(false));
    } else if (type === 'pdf') {
      apiClient.get(`/orgs/${orgId}/files/${f.id}/download`, { responseType: 'blob' })
        .then((res) => {
          const blob = new Blob([res.data as Blob], { type: f.mime_type || 'application/pdf' });
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          setObjectUrl(url);
        })
        .catch((err) => setError(err?.response?.data?.error || 'PDF 加载失败'))
        .finally(() => setLoading(false));
    } else if (type === 'video') {
      apiClient.get(`/orgs/${orgId}/files/${f.id}/download`, { responseType: 'blob' })
        .then((res) => {
          const blob = new Blob([res.data as Blob], { type: f.mime_type || 'video/mp4' });
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          setObjectUrl(url);
        })
        .catch((err) => setError(err?.response?.data?.error || '加载失败'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
      setError('该格式不支持预览，请下载后在本地打开');
    }
  }, [orgId]);

  // 当前文件变化时加载内容
  useEffect(() => {
    if (currentFile) loadContent(currentFile);
  }, [currentFile?.id, loadContent]);

  // 清理 URL
  useEffect(() => {
    return () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); };
  }, []);

  const currentIndex = currentFile ? files.findIndex(f => f.id === currentFile.id) : -1;
  const prevFile = currentIndex > 0 ? files[currentIndex - 1] : null;
  const nextFile = currentIndex >= 0 && currentIndex < files.length - 1 ? files[currentIndex + 1] : null;

  const goTo = useCallback((f: TeamFile) => {
    setCurrentFile(f);
  }, []);

  const handleDownload = useCallback(async () => {
    if (!currentFile) return;
    try {
      const res = await apiClient.get(`/orgs/${orgId}/files/${currentFile.id}/download`, { responseType: 'blob' });
      const blob = new Blob([res.data as Blob], { type: currentFile.mime_type || undefined });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = currentFile.file_name;
      a.click(); URL.revokeObjectURL(url);
    } catch {
      window.open(`/api/orgs/${orgId}/files/${currentFile.id}/download`, '_blank');
    }
  }, [currentFile, orgId]);

  // 键盘导航
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && prevFile) goTo(prevFile);
      if (e.key === 'ArrowRight' && nextFile) goTo(nextFile);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose, prevFile, nextFile, goTo]);

  if (!isOpen || !currentFile) return null;

  const type = getPreviewType(currentFile.file_name);

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-[880px] h-[660px] flex flex-col relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#eceef2] bg-[#f8f9fc] rounded-t-2xl shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm shrink-0">{getFileIcon(currentFile.file_name)}</span>
            <span className="text-sm font-medium text-[#1d1d1f] truncate">{currentFile.file_name}</span>
            <span className="text-xs text-[#81858c] shrink-0">{formatSize(currentFile.size)}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#eceef2] text-[#81858c]">{type.toUpperCase()}</span>
            {files.length > 1 && (
              <span className="text-[10px] text-[#b0b8c1] ml-1 shrink-0">
                {currentIndex + 1}/{files.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={handleDownload}
              className="btn btn-xs btn-ghost flex items-center gap-1" style={{ borderRadius: '6px' }}>
              <Download size={12} /> 下载
            </button>
            <button onClick={onClose} className="text-[#81858c] hover:text-[#1d1d1f]"><X size={18} /></button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto relative">
          {/* 左右切换按钮 */}
          {prevFile && (
            <button onClick={() => goTo(prevFile)}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-20 flex items-center justify-center
                opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity group"
              title={`上一个: ${prevFile.file_name}`}>
              <ChevronLeft size={20} className="text-[#81858c] group-hover:text-[#4b5563] drop-shadow-sm" />
            </button>
          )}
          {nextFile && (
            <button onClick={() => goTo(nextFile)}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-20 flex items-center justify-center
                opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity group"
              title={`下一个: ${nextFile.file_name}`}>
              <ChevronRight size={20} className="text-[#81858c] group-hover:text-[#4b5563] drop-shadow-sm" />
            </button>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-[#81858c]">
              <Loader2 size={28} className="animate-spin mb-3 text-[#4f8cff]" />
              <span className="text-sm">加载中...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 text-[#81858c]">
              <FileIcon size={40} className="mb-3 opacity-40" />
              <p className="text-sm text-[#ef4444]">{error}</p>
              <button onClick={handleDownload} className="btn btn-xs mt-4" style={{ borderRadius: '6px' }}>
                <Download size={12} /> 下载文件
              </button>
            </div>
          ) : (
            <>
              {type === 'markdown' && content !== null && (
                <div className="p-6"><Markdown text={content} /></div>
              )}
              {type === 'docx' && docxHtml && (
                <div className="p-6" dangerouslySetInnerHTML={{ __html: docxHtml }} />
              )}
              {type === 'text' && docxHtml && (
                <div className="p-6" dangerouslySetInnerHTML={{ __html: docxHtml }} />
              )}
              {type === 'image' && objectUrl && (
                <div className="flex items-center justify-center p-4 h-full">
                  <img src={objectUrl} alt={currentFile.file_name} className="max-w-full max-h-full object-contain rounded-lg" />
                </div>
              )}
              {type === 'pdf' && objectUrl && (
                <iframe src={objectUrl} className="w-full h-full border-none" title={currentFile.file_name} />
              )}
              {type === 'video' && objectUrl && (
                <div className="flex items-center justify-center p-4 h-full bg-black/5">
                  <video controls className="max-w-full max-h-full rounded-lg" src={objectUrl}>
                    您的浏览器不支持视频播放
                  </video>
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部 */}
        <div className="px-5 py-2 border-t border-[#eceef2] bg-[#f8f9fc] rounded-b-2xl shrink-0 text-center flex items-center justify-center gap-4">
          <span className="text-[11px] text-[#81858c]">
            支持预览: Markdown · Word · 文本 · 图片 · PDF · 视频
          </span>
          {files.length > 1 && (
            <span className="text-[11px] text-[#b0b8c1]">← → 键盘切换</span>
          )}
        </div>
      </div>
    </div>
  );
}
