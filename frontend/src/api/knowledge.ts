import apiClient from './client';

export interface KnowledgeFile { name: string; size: number; uploaded_at: string; }

export const knowledgeApi = {
  listFiles: () => apiClient.get<KnowledgeFile[]>('/knowledge/files'),
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post<{ name: string; status: string }>('/knowledge/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 30000 });
  },
  deleteFile: (filename: string) => apiClient.delete(`/knowledge/files/${encodeURIComponent(filename)}`),
};
