import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useStreamChat } from '@/hooks/useStreamChat';

// ── Agent constants ──
const ICONS: Record<string, string> = {
  Planner: '🧋', Retriever: '🐍', Coder: '🫻', Writer: '✍️',
  Tester: '✅', Summarizer: '🧊', Bot: '🤖', Executor: '⚙️',
};
const COLORS: Record<string, string> = {
  Planner: '#4f8cff', Retriever: '#8b5cf6', Coder: '#10b981',
  Writer: '#f59e0b', Tester: '#ef4444', Summarizer: '#4f8cff',
  Bot: '#10b981', Executor: '#8b5cf6',
};

interface Message {
  role: 'user' | 'assistant';
  content: string;
  thinking?: Array<{ name: string; content: string }>;
  thinkingOrder?: string[];
  taskType?: string;
  loading?: boolean;
  error?: string;
}

export function ChatPage() {
  const { projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const { streaming, startStream, abortStream } = useStreamChat();
  const [messages, setMessages] = useState<Message[]>([]);
  const [laneMode, setLaneMode] = useState<'auto' | 'fast' | 'slow'>('auto');
  const [inputValue, setInputValue] = useState('');
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, streaming.thinking, streaming.reply]);

  // Send message
  const handleSend = useCallback(async (message?: string) => {
    const text = (message ?? inputValue).trim();
    if (!text || streaming.isStreaming) return;

    const userMsg: Message = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInputValue('');

    const assistMsg: Message = { role: 'assistant', content: '', loading: true };
    setMessages([...newMessages, assistMsg]);

    try {
      await startStream(text, laneMode);
    } catch {
      // handled by streaming.error
    }
  }, [inputValue, messages, streaming.isStreaming, laneMode, startStream]);

  // When streaming completes, update last assistant message
  useEffect(() => {
    if (!streaming.isStreaming && (streaming.reply || streaming.error)) {
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
          updated[lastIdx] = {
            role: 'assistant',
            content: streaming.reply || '',
            thinking: Array.from(streaming.thinking.entries()).map(([name, c]) => ({ name, content: c })),
            thinkingOrder: streaming.thinkingOrder,
            error: streaming.error || undefined,
            loading: false,
          };
        }
        return updated;
      });
    }
  }, [streaming.isStreaming, streaming.reply, streaming.error, streaming.thinking, streaming.thinkingOrder]);

  // Regenerate
  const handleRegenerate = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    setMessages((prev) => prev.filter((m) => m.role !== 'assistant' || prev.indexOf(m) < prev.findLastIndex((x) => x.role === 'assistant')));
    handleSend(lastUser.content);
  }, [messages, handleSend]);

  // Edit & resend
  const startEdit = useCallback((idx: number, content: string) => {
    setEditingIdx(idx);
    setEditValue(content);
  }, []);

  const submitEdit = useCallback(() => {
    if (!editValue.trim()) return;
    setMessages((prev) => prev.slice(0, editingIdx!));
    setEditingIdx(null);
    setEditValue('');
    handleSend(editValue.trim());
  }, [editValue, editingIdx, handleSend]);

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-chat)' }}>
      {/* Messages */}
      <div ref={chatRef} className="flex-1 overflow-y-auto" id="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <h2 className="chat-welcome-title">多智能体协作系统</h2>
            <p className="chat-welcome-sub">
              使用 <strong>{laneMode === 'auto' ? '自动' : laneMode === 'fast' ? '快速' : '协作'}</strong> 模式进行对话
            </p>
            <div className="flex gap-3 w-full justify-center">
              {([
                ['auto', '⚡', '自动', 'AI 判断任务复杂度'],
                ['fast', '🔥', '快速', '直接回复，无需协作'],
                ['slow', '🦖', '协作', '多智能体流水线'],
              ] as const).map(([val, icon, name, desc]) => (
                <div
                  key={val}
                  className="flex-1 max-w-[150px] p-4 rounded-[14px] border-1.5 border-[#e0e4e8] bg-white cursor-pointer text-center select-none transition-all hover:border-[#4f8cff] hover:shadow-[0_2px_12px_rgba(79,140,255,0.1)]"
                  style={laneMode === val ? { borderColor: 'var(--brand-primary)', background: 'rgba(79,140,255,0.04)', boxShadow: '0 2px 12px rgba(79,140,255,0.12)' } : {}}
                  onClick={() => setLaneMode(val)}
                >
                  <div className="text-2xl mb-1.5">{icon}</div>
                  <div className="font-semibold text-[0.95rem] text-[#1d1d1f] mb-0.5">{name}</div>
                  <div className="text-xs text-[#81858c] leading-relaxed">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MsgBubble
            key={i}
            msg={msg}
            idx={i}
            isStreaming={i === messages.length - 1 && streaming.isStreaming}
            streamingThinking={streaming.thinking}
            streamingOrder={streaming.thinkingOrder}
            streamingCurrentAgent={streaming.currentAgent}
            editing={editingIdx === i}
            editValue={editValue}
            onEditChange={setEditValue}
            onStartEdit={() => startEdit(i, msg.content)}
            onSubmitEdit={submitEdit}
            onCancelEdit={() => { setEditingIdx(null); setEditValue(''); }}
            onCopy={(t) => navigator.clipboard.writeText(t)}
            onRegenerate={handleRegenerate}
            onRetry={() => handleSend(msg.content)}
            isLast={i === messages.length - 1}
          />
        ))}
      </div>

      {/* Disclaimer */}
      {messages.length > 0 && <div className="ai-disclaimer show">内容由 AI 生成，请仔细甄别</div>}

      {/* Input */}
      <div className="chat-input-area">
        <div className="input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-textarea"
            style={{ paddingRight: '90px' }}
            placeholder="给 Multi-Agent 发送任务（编程 / 写作 / 分析 / 问答 / 闲聊）"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                streaming.isStreaming ? abortStream() : handleSend();
              }
            }}
            rows={3}
            autoFocus
          />
          {/* Mode chips */}
          <div style={{ position: 'absolute', left: '14px', bottom: '14px', display: 'flex', gap: '3px', zIndex: 5 }}>
            {(['auto', 'fast', 'slow'] as const).map((m) => (
              <span
                key={m}
                className={`inline-flex items-center px-3 py-[3px] rounded-full text-xs font-medium cursor-pointer select-none leading-relaxed transition-all ${
                  laneMode === m
                    ? 'text-white bg-[#4f8cff]'
                    : 'text-[#9ca3af] hover:text-[#6b7280] hover:bg-[#f3f4f6]'
                }`}
                onClick={() => setLaneMode(m)}
              >
                {m === 'auto' ? '自动' : m === 'fast' ? '快速' : '协作'}
              </span>
            ))}
          </div>
          {/* Send / Stop */}
          <button
            className="send-btn"
            onClick={() => streaming.isStreaming ? abortStream() : handleSend()}
            title={streaming.isStreaming ? '中断 (Esc)' : '发送 (Enter)'}
            style={streaming.isStreaming ? { background: '#ef4444' } : {}}
          >
            {streaming.isStreaming ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 11 7-7 7 7M12 4v16" /></svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Message bubble sub-component ──
function MsgBubble({
  msg, idx, isStreaming, streamingThinking, streamingOrder, streamingCurrentAgent,
  editing, editValue, onEditChange, onStartEdit, onSubmitEdit, onCancelEdit,
  onCopy, onRegenerate, onRetry, isLast,
}: {
  msg: Message; idx: number; isStreaming: boolean;
  streamingThinking: Map<string, string>; streamingOrder: string[];
  streamingCurrentAgent: string | null;
  editing: boolean; editValue: string;
  onEditChange: (v: string) => void;
  onStartEdit: () => void; onSubmitEdit: () => void; onCancelEdit: () => void;
  onCopy: (t: string) => void;
  onRegenerate: () => void;
  onRetry: () => void;
  isLast: boolean;
}) {
  const [openPanels, setOpenPanels] = useState<Set<string>>(new Set());

  if (msg.role === 'user') {
    return (
      <div className="message-user">
        {editing ? (
          <div style={{ width: '100%', maxWidth: '66%', borderRadius: '20px', border: '1px solid #e0e4e8', padding: '12px 14px 10px', background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <textarea
              style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', fontFamily: 'inherit', fontSize: '0.9rem', lineHeight: 1.6, color: '#1d1d1f', background: 'transparent', minHeight: '44px', maxHeight: '120px' }}
              value={editValue}
              onChange={(e) => onEditChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmitEdit(); } if (e.key === 'Escape') onCancelEdit(); }}
              autoFocus
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', paddingTop: '6px', marginTop: '4px', borderTop: '1px solid #f0f2f5' }}>
              <button className="toolbar-btn" onClick={onCancelEdit}>取消</button>
              <button className="send-btn" style={{ position: 'static', width: '32px', height: '32px' }} onClick={onSubmitEdit} disabled={!editValue.trim()}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 11 7-7 7 7M12 4v16" /></svg>
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="bubble">{msg.content}</div>
            <div className="user-msg-toolbar">
              <button className="toolbar-btn" onClick={() => onCopy(msg.content)}>复制</button>
              <button className="toolbar-btn" onClick={onStartEdit}>修改</button>
            </div>
          </>
        )}
      </div>
    );
  }

  // Assistant
  const thinking = isStreaming
    ? streamingOrder.map((name) => ({ name, content: streamingThinking.get(name) || '' }))
    : msg.thinking || [];
  const hasThinking = thinking.length > 0;

  return (
    <div className="message-assistant">
      {hasThinking && (
        <div className="thinking-section">
          <button className="thinking-toggle" onClick={() => {
            const id = `think-${idx}`;
            setOpenPanels((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
          }}>
            <span className={`toggle-arrow ${openPanels.has(`think-${idx}`) ? 'open' : ''}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>
            </span>
            🧠 {thinking.map((t) => `${ICONS[t.name] || '🔹'} ${t.name}`).join(' → ')}
            {isStreaming && streamingCurrentAgent && <span className="text-[#4f8cff]"> ... </span>}
          </button>
          <div className="thinking-collapse" style={openPanels.has(`think-${idx}`) ? { maxHeight: 'none' } : {}}>
            {thinking.map((t, j) => (
              <div key={j} className="agent-card">
                <div className="agent-header" style={{ borderLeftColor: COLORS[t.name] || '#6b7280' }}>
                  <span className="agent-badge" style={{ background: `${COLORS[t.name] || '#6b7280'}18`, color: COLORS[t.name] || '#6b7280' }}>{ICONS[t.name] || '🔹'} {t.name}</span>
                </div>
                <div className="agent-body">
                  {isStreaming && j === thinking.length - 1 && streamingCurrentAgent === t.name
                    ? (t.content || '思考中...')
                    : <Markdown text={t.content} />}
                </div>
              </div>
            ))}
            {isStreaming && streamingCurrentAgent && !thinking.find((t) => t.name === streamingCurrentAgent) && (
              <div className="agent-card">
                <div className="agent-header" style={{ borderLeftColor: COLORS[streamingCurrentAgent] || '#6b7280' }}>
                  <span className="agent-badge" style={{ background: `${COLORS[streamingCurrentAgent] || '#6b7280'}18`, color: COLORS[streamingCurrentAgent] || '#6b7280' }}>{ICONS[streamingCurrentAgent] || '🔹'} {streamingCurrentAgent}</span>
                </div>
                <div className="agent-body">{streamingThinking.get(streamingCurrentAgent) || '思考中...'}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {msg.loading && !isStreaming ? (
        <div className="bubble loading-bubble">思考中<span className="loading-dots" /></div>
      ) : msg.error ? (
        <div className="message-error"><div className="bubble">⚠️ {msg.error}</div></div>
      ) : (
        <div className="bubble"><Markdown text={isStreaming ? (streamingThinking.size > 0 ? '' : '思考中...') : msg.content} /></div>
      )}

      {!isStreaming && msg.content && !msg.error && (
        <div className="msg-toolbar">
          <button className="toolbar-btn" onClick={() => onCopy(msg.content)}>复制</button>
          <button className="toolbar-btn" onClick={onRegenerate}>重新生成</button>
        </div>
      )}
      {msg.error && <button className="toolbar-btn mt-1" onClick={onRetry}>重试</button>}
    </div>
  );
}

// ── Lightweight Markdown renderer ──
function Markdown({ text }: { text: string }) {
  if (!text) return null;
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const withCode = escaped.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const id = `cb-${Math.random().toString(36).slice(2, 8)}`;
    return `<div class="code-block" id="${id}"><div class="code-lang">${lang || 'code'}</div><button class="code-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('code').textContent);this.textContent='已复制';setTimeout(()=>this.textContent='复制',2000)">复制</button><pre><code>${code.trim()}</code></pre></div>`;
  });
  return <div dangerouslySetInnerHTML={{ __html: withCode.replace(/\n/g, '<br>') }} />;
}
