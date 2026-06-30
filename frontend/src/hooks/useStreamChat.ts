import { useState, useRef, useCallback, useEffect } from 'react';
import apiClient from '@/api/client';

// SSE event types from backend
export interface StreamEvent {
  type: 'agent_start' | 'token' | 'agent_end' | 'done' | 'error' | 'cancelled';
  name?: string;
  content?: string;
  reply?: string;
  thinking?: Array<{ name: string; content: string }>;
  task_type?: string;
  elapsed_ms?: number;
  token_count?: number;
}

export interface StreamingState {
  sessionId: string | null;
  isStreaming: boolean;
  thinking: Map<string, string>;
  thinkingOrder: string[];
  currentAgent: string | null;
  reply: string;
  error: string | null;
  agentStats: Map<string, { elapsed_ms: number; token_count: number }>;
  taskType: string;
}

export function useStreamChat() {
  const [streaming, setStreaming] = useState<StreamingState>({
    sessionId: null,
    isStreaming: false,
    thinking: new Map(),
    thinkingOrder: [],
    currentAgent: null,
    reply: '',
    error: null,
    agentStats: new Map(),
    taskType: '',
  });

  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const sessionRef = useRef<string | null>(null);
  const onCompleteRef = useRef<((reply: string, thinking: Array<{name: string; content: string}>, taskType: string) => void) | undefined>(undefined);

  const startStream = useCallback(async (
    message: string,
    laneMode: string = 'auto',
    projectId?: string,
    onComplete?: (reply: string, thinking: Array<{name: string; content: string}>, taskType: string) => void,
    webSearchEnabled: boolean = false,
    agentStates: Record<string, string> = {},
  ) => {
    // Store callback for use in processEvent
    onCompleteRef.current = onComplete;

    // Reset state
    setStreaming({
      sessionId: null,
      isStreaming: true,
      thinking: new Map(),
      thinkingOrder: [],
      currentAgent: null,
      reply: '',
      error: null,
      agentStats: new Map(),
      taskType: '',
    });

    try {
      // 1. Start session
      const startResp = await apiClient.post('/chat/start', {
        message,
        lane_mode: laneMode,
        project_id: projectId,
        history: [],
        web_search_enabled: webSearchEnabled,
        agent_states: agentStates,
      });
      const { session_id } = startResp.data;
      sessionRef.current = session_id;

      setStreaming((prev) => ({ ...prev, sessionId: session_id }));

      // 2. Connect SSE
      const token = localStorage.getItem('auth_token');
      const streamResp = await fetch(`/api/chat/stream/${session_id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!streamResp.ok) throw new Error('流式连接失败');
      if (!streamResp.body) throw new Error('不支持流式响应');

      const reader = streamResp.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          let dataLine = '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              dataLine = line.slice(6);
              break;
            }
          }
          if (!dataLine) continue;

          try {
            const event: StreamEvent = JSON.parse(dataLine);
            processEvent(event);
          } catch {
            // skip malformed events
          }
        }
      }

      readerRef.current = null;
      sessionRef.current = null;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setStreaming((prev) => ({
        ...prev,
        isStreaming: false,
        error: (err as Error).message || '请求失败',
      }));
      readerRef.current = null;
      sessionRef.current = null;
    }
  }, []);

  const processEvent = useCallback((event: StreamEvent) => {
    setStreaming((prev) => {
      const thinking = new Map(prev.thinking);
      const thinkingOrder = [...prev.thinkingOrder];

      switch (event.type) {
        case 'agent_start':
          if (event.name) {
            const count = thinkingOrder.filter(n => {
              const base = n.lastIndexOf('\x00');
              return (base === -1 ? n : n.slice(0, base)) === event.name;
            }).length;
            const key = count > 0 ? `${event.name}\x00${count}` : event.name;
            thinking.set(key, '');
            thinkingOrder.push(key);
          }
          return { ...prev, thinking, thinkingOrder, currentAgent: event.name || null };

        case 'token':
          if (event.name && event.content) {
            const latestKey = [...thinkingOrder].reverse().find(n => {
              const base = n.lastIndexOf('\x00');
              return (base === -1 ? n : n.slice(0, base)) === event.name;
            });
            if (latestKey) {
              const existing = thinking.get(latestKey) || '';
              thinking.set(latestKey, existing + event.content);
            }
          }
          return { ...prev, thinking };

        case 'agent_end':
          if (event.name && event.content) {
            const latestKey = [...thinkingOrder].reverse().find(n => {
              const base = n.lastIndexOf('\x00');
              return (base === -1 ? n : n.slice(0, base)) === event.name;
            });
            if (latestKey) {
              thinking.set(latestKey, event.content);
            }
          }
          // 更新 agentStats
          if (event.name) {
            const stats = new Map(prev.agentStats);
            stats.set(event.name, {
              elapsed_ms: event.elapsed_ms || 0,
              token_count: event.token_count || 0,
            });
            return { ...prev, thinking, agentStats: stats };
          }
          return { ...prev, thinking };

        case 'done': {
          const taskType = event.task_type || '';
          // 构建 thinking 数组供 onComplete 使用
          const thinkArr: Array<{name: string; content: string}> = [];
          thinkingOrder.forEach(k => {
            const base = k.lastIndexOf('\x00');
            const name = base === -1 ? k : k.slice(0, base);
            thinkArr.push({ name, content: thinking.get(k) || '' });
          });
          // 延迟调用 onComplete，确保 state 已更新
          if (onCompleteRef.current) {
            setTimeout(() => {
              onCompleteRef.current?.(event.reply || '', thinkArr, taskType);
            }, 50);
          }
          return {
            ...prev,
            isStreaming: false,
            reply: event.reply || '',
            thinking,
            thinkingOrder,
            currentAgent: null,
            taskType,
          };
        }

        case 'error':
          return {
            ...prev,
            isStreaming: false,
            error: event.content || '未知错误',
          };

        case 'cancelled':
          return {
            ...prev,
            isStreaming: false,
            reply: prev.reply || '已中断',
          };

        default:
          return prev;
      }
    });
  }, []);

  const abortStream = useCallback(async () => {
    if (readerRef.current) {
      try {
        readerRef.current.cancel();
      } catch {
        // ignore
      }
      readerRef.current = null;
    }
    if (sessionRef.current) {
      try {
        await apiClient.post(`/chat/cancel/${sessionRef.current}`);
      } catch {
        // ignore
      }
      sessionRef.current = null;
    }
    setStreaming((prev) => ({ ...prev, isStreaming: false }));
  }, []);

  // 组件卸载时自动取消流
  useEffect(() => {
    return () => {
      if (readerRef.current) {
        try { readerRef.current.cancel(); } catch {}
        readerRef.current = null;
      }
      if (sessionRef.current) {
        const sid = sessionRef.current;
        sessionRef.current = null;
        // fire-and-forget cancel
        apiClient.post(`/chat/cancel/${sid}`).catch(() => {});
      }
    };
  }, []);

  const resetStream = useCallback(() => {
    onCompleteRef.current = undefined;
    setStreaming({
      sessionId: null,
      isStreaming: false,
      thinking: new Map(),
      thinkingOrder: [],
      currentAgent: null,
      reply: '',
      error: null,
      agentStats: new Map(),
      taskType: '',
    });
  }, []);

  return { streaming, startStream, abortStream, resetStream };
}
