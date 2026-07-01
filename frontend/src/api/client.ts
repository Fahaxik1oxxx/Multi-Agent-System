import axios from 'axios';

// 生产环境用完整后端 URL，开发环境走 Vite 代理
const API_BASE = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL}/api`
  : '/api';

const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 95000,  // 略大于后端 90s 超时
  headers: { 'Content-Type': 'application/json' },
});

// 请求拦截器：注入 JWT
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器：统一处理 401
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('mc_uname');
      // 不在这里 redirect，由 AuthGuard 处理
    }
    return Promise.reject(error);
  }
);

export default apiClient;

// Report API (uses plain POST /api/report, no auth required)
export const generateReportApi = async (thinking: Array<{ name: string; content: string }>) => {
  const res = await apiClient.post<{ content: string; path: string }>('/report', { thinking });
  return res.data;
};
