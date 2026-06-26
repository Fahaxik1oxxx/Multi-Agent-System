export interface ApiError {
  error: string;
}

export interface ChatRequest {
  message: string;
  lane_mode: 'auto' | 'fast' | 'slow';
  history: Array<{ role: string; content: string }>;
  model_config?: Record<string, unknown>;
}

export interface ChatResponse {
  reply: string;
  thinking: Array<{ agent: string; output: string }>;
  task_type: string;
  generated_files: string[];
  error?: string;
}

export interface Session {
  id: string;
  title: string;
  count: number;
  updated: string;
}
