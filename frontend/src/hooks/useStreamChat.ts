import { useState, useRef, useCallback } from 'react';
import apiClient from '@/api/client';

// SSE event types from backend
export interface StreamEvent {
  type: 'agent_start' | 'token' | 'agent_end' | 'done' | 'error' | 'cancelled';
  name?: string;
  content?: string;
  reply?: string;
  thinking?: Array<{ name: string; content: string }>;
  task_type?: string;
}

export interface StreamingState {
  sessionId: string | null;
  isStreaming: boolean;
  thinking: Map<string, string>; // agent name → accumulated content
  thinkingOrder: string[];       // agent name in order of appearance
  currentAgent: string | null;
  reply: string;
  error: string | null;
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
  });

  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const sessionRef = useRef<string | null>(null);

  const startStream = useCallback(async (message: string, laneMode: string = 'auto') => {
    // Reset state
    setStreaming({
      sessionId: null,
      isStreaming: true,
      thinking: new Map(),
      thinkingOrder: [],
      currentAgent: null,
      reply: '',
      error: null,
    });

    try {
      // 1. Start session
      const startResp = await apiClient.post('/chat/start', {
        message,
        lane_mode: laneMode,
        history: [],
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
            // 使用唯一key区分同一agent的多次循环: name_序号
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
            // 找到最新一次该agent的key
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
          return { ...prev, thinking };

        case 'done':
          return {
            ...prev,
            isStreaming: false,
            reply: event.reply || '',
            thinking,
            thinkingOrder,
            currentAgent: null,
          };

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

  const resetStream = useCallback(() => {
    setStreaming({
      sessionId: null,
      isStreaming: false,
      thinking: new Map(),
      thinkingOrder: [],
      currentAgent: null,
      reply: '',
      error: null,
    });
  }, []);

  return { streaming, startStream, abortStream, resetStream };
}
