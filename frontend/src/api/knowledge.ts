import apiClient from './client';

export const knowledgeApi = {
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post('/knowledge/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
  },
  list: () => apiClient.get('/knowledge/files'),
  delete: (filename: string) => apiClient.delete(`/knowledge/${filename}`),
};
