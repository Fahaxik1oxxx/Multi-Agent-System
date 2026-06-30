import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Check } from 'lucide-react';

export function TeamChat() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [newChannel, setNewChannel] = useState('');

  const { data: channels = [] } = useQuery({
    queryKey: ['channels', orgId],
    queryFn: async () => {
      const res = await apiClient.get(`/orgs/${orgId}/channels`);
      const data = res.data;
      if (data.length > 0 && !activeChannel) setActiveChannel(data[0].id);
      return data;
    },
    enabled: !!orgId,
  });

  const { data: todos = [] } = useQuery({
    queryKey: ['todos', orgId],
    queryFn: async () => {
      const res = await apiClient.get(`/orgs/${orgId}/todos`);
      return res.data;
    },
    enabled: !!orgId,
  });

  // 拉取消息
  const fetchMessages = async () => {
    if (!activeChannel) return;
    try {
      const res = await apiClient.get(`/orgs/${orgId}/channels/${activeChannel}/messages`);
      setMessages(res.data);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    fetchMessages();
  }, [activeChannel]);

  // SSE 连接
  useEffect(() => {
    if (!orgId) return;
    const token = localStorage.getItem('auth_token');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const url = `/api/orgs/${orgId}/stream`;
      fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok || !response.body) return;
          const reader = response.body.getReader();
          readerRef.current = reader;
          const decoder = new TextDecoder();
          let buffer = '';
          const readLoop = async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\n\n');
                buffer = parts.pop() || '';
                for (const part of parts) {
                  const dataLine = part.split('\n').find((l) => l.startsWith('data: '));
                  if (!dataLine) continue;
                  try {
                    const event = JSON.parse(dataLine.slice(6));
                    if (event.type === 'message' && event.message) {
                      setMessages((prev) => [...prev, event.message]);
                    }
                  } catch { /* skip */ }
                }
              }
            } catch (err: any) {
              if (err?.name !== 'AbortError') throw err;
            } finally {
              try { reader.releaseLock(); } catch {}
            }
          };
          readLoop();
        })
        .catch(() => {});
    } catch { /* ignore */ }
    return () => {
      readerRef.current?.cancel();
      abortRef.current?.abort();
    };
  }, [orgId]);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      await apiClient.post(`/orgs/${orgId}/channels/${activeChannel}/messages`, { content });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['todos', orgId] });
      setInput('');
      setTimeout(fetchMessages, 300);
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || '发送失败'),
  });

  const channelMutation = useMutation({
    mutationFn: async (name: string) => {
      await apiClient.post(`/orgs/${orgId}/channels`, { name });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels', orgId] });
      setNewChannel('');
    },
  });

  const todoMutation = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: number }) => {
      await apiClient.put(`/orgs/${orgId}/todos/${id}`, { completed });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['todos', orgId] }),
  });

  const handleSend = () => {
    if (!input.trim() || !activeChannel) return;
    sendMutation.mutate(input.trim());
  };

  return (
    <div className="flex h-full">
      {/* 左侧栏 — 知识库占位 */}
      <div className="w-56 border-r border-[#e0e4e8] bg-white flex flex-col shrink-0">
        <div className="p-3 border-b border-[#e0e4e8]">
          <button onClick={() => navigate('/v3/team')} className="flex items-center gap-1 text-sm text-[#81858c] hover:text-[#1d1d1f]">
            <ArrowLeft size={14} /> 返回
          </button>
        </div>
        <div className="p-3">
          <h3 className="text-xs font-semibold text-[#9ca3af] uppercase mb-2">共享知识库</h3>
          <p className="text-xs text-[#9ca3af]">即将上线</p>
        </div>
      </div>

      {/* 中间 — 聊天 */}
      <div className="flex-1 flex flex-col bg-[#f8f9fc]">
        <div className="flex items-center gap-1 p-3 border-b border-[#e0e4e8] bg-white overflow-x-auto">
          {channels.map((ch: any) => (
            <button
              key={ch.id}
              className={`px-3 py-1 text-xs rounded-full transition-colors whitespace-nowrap ${
                activeChannel === ch.id
                  ? 'bg-[#4f8cff] text-white'
                  : 'bg-gray-100 text-[#81858c] hover:bg-gray-200'
              }`}
              onClick={() => setActiveChannel(ch.id)}
            >
              # {ch.name}
            </button>
          ))}
          <div className="flex items-center gap-1 ml-2">
            <input
              className="input input-xs w-20"
              style={{ borderRadius: '6px', borderColor: '#e0e4e8' }}
              placeholder="新频道"
              value={newChannel}
              onChange={(e) => setNewChannel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && channelMutation.mutate(newChannel)}
            />
            <button className="btn btn-xs btn-ghost" onClick={() => newChannel && channelMutation.mutate(newChannel)}>
              <Plus size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m: any, i: number) => (
            <div key={m.id || i} className={m.is_agent ? 'flex justify-center' : ''}>
              {m.is_agent ? (
                <div className="bg-[#4f8cff]/5 border border-[#4f8cff]/20 rounded-xl px-4 py-2 max-w-lg">
                  <div className="text-xs text-[#4f8cff] mb-1">🤖 Agent</div>
                  <div className="text-sm text-[#1d1d1f] whitespace-pre-wrap">{m.content}</div>
                </div>
              ) : (
                <div className="max-w-md">
                  <div className="text-xs text-[#9ca3af] mb-1">{m.user_name}</div>
                  <div className="bg-white rounded-xl px-3 py-2 shadow-sm border border-[#e0e4e8] text-sm">
                    {m.content}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-[#e0e4e8] bg-white">
          <div className="flex gap-2">
            <input
              type="text"
              className="input input-bordered flex-1"
              style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
              placeholder="输入消息，或 @agent 命令（总结/创建待办/搜索）"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            />
            <button
              className="btn"
              disabled={sendMutation.isPending || !input.trim()}
              onClick={handleSend}
              style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }}
            >
              发送
            </button>
          </div>
        </div>
      </div>

      {/* 右侧栏 — 待办 */}
      <div className="w-56 border-l border-[#e0e4e8] bg-white flex flex-col shrink-0">
        <div className="p-3 border-b border-[#e0e4e8]">
          <h3 className="text-sm font-semibold text-[#1d1d1f]">待办列表</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {todos.map((t: any) => (
            <div
              key={t.id}
              className={`flex items-center gap-2 p-2 rounded-lg text-xs cursor-pointer transition-colors ${
                t.completed ? 'bg-green-50 line-through text-[#9ca3af]' : 'hover:bg-gray-50'
              }`}
              onClick={() => todoMutation.mutate({ id: t.id, completed: t.completed ? 0 : 1 })}
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                t.completed ? 'bg-green-500 border-green-500 text-white' : 'border-[#d1d5db]'
              }`}>
                {t.completed ? <Check size={10} /> : null}
              </div>
              <span className="flex-1 truncate">{t.content}</span>
              {t.assignee_name && <span className="text-[10px] text-[#9ca3af]">@{t.assignee_name}</span>}
            </div>
          ))}
        </div>
        <div className="p-2 border-t border-[#e0e4e8]">
          <button
            className="btn btn-xs btn-ghost w-full text-[#81858c]"
            onClick={() => {
              const content = prompt('待办内容：');
              if (content) {
                apiClient.post(`/orgs/${orgId}/todos`, { content }).then(() => {
                  qc.invalidateQueries({ queryKey: ['todos', orgId] });
                });
              }
            }}
          >
            <Plus size={14} /> 新建待办
          </button>
        </div>
      </div>
    </div>
  );
}
