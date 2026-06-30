import apiClient from './client';

export interface KnowledgeFile { name: string; size: number; uploaded_at: string; indexed?: boolean; }

export interface KnowledgeStats {
  total_files: number;
  indexed_files: number;
  total_chunks: number;
  last_indexed: string;
}

export const knowledgeApi = {
  listFiles: () => apiClient.get<KnowledgeFile[]>('/knowledge/files'),
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post<{ success: boolean; status: string; filename: string; indexed: boolean; chunks: number; errors: Array<{ file: string; error: string }> }>('/knowledge/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
  },
  deleteFile: (filename: string) => apiClient.delete(`/knowledge/${encodeURIComponent(filename)}`),
  getStats: () => apiClient.get<KnowledgeStats>('/knowledge/stats'),
  rebuild: () => apiClient.post<{ success: boolean; added: number; errors: Array<{ file: string; error: string }> }>('/knowledge/rebuild'),
};
