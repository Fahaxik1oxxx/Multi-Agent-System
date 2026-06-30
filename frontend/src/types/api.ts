export interface ApiError {
  error: string;
}

export interface ChatRequest {
  message: string;
  lane_mode: 'auto' | 'fast' | 'slow';
  history: Array<{ role: string; content: string }>;
}

export interface ChatResponse {
  reply: string;
  thinking: Array<{ name: string; content: string }>;
  task_type: string;
  error?: string;
}

export interface Session {
  id: string;
  title: string;
  count: number;
  updated: string;
}
