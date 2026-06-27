import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useStreamChat } from '@/hooks/useStreamChat';
import { Markdown } from '@/components/shared/Markdown';
import { sessionsApi } from '@/api/sessions';
import { knowledgeApi } from '@/api/knowledge';
import { generateReportApi } from '@/api/client';
import { toast } from 'sonner';

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
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; status: 'uploading' | 'done' | 'error' }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [reportContent, setReportContent] = useState<string | null>(null);
  const reportDialogRef = useRef<HTMLDialogElement>(null);

  // Listen for load-session event (from sidebar clicking a history item)
  useEffect(() => {
    const handler = (e: Event) => {
      const sid = (e as CustomEvent).detail;
      if (!sid) return;
      setSessionId(sid);
      sessionIdRef.current = sid;
      // Fetch session messages
      sessionsApi.get(sid).then((res) => {
        const msgs: Message[] = (res.data.messages || []).map((m: any) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          thinking: m.thinking,
          thinkingOrder: m.thinkingOrder,
          taskType: m.taskType,
        }));
        setMessages(msgs);
        setInputValue('');
        setEditingIdx(null);
        setEditValue('');
      }).catch(() => {
        // session not found
      });
    };
    window.addEventListener('load-session', handler);
    return () => window.removeEventListener('load-session', handler);
  }, []);

  // Auto-save messages after streaming completes or messages change
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (messages.length === 0) return;
    // Don't save while streaming
    if (streaming.isStreaming) return;
    // Debounce save
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const sid = sessionIdRef.current || String(Date.now());
      if (!sessionIdRef.current) {
        sessionIdRef.current = sid;
        setSessionId(sid);
      }
      const msgData = messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.thinking ? { thinking: m.thinking } : {}),
        ...(m.thinkingOrder ? { thinkingOrder: m.thinkingOrder } : {}),
        ...(m.taskType ? { taskType: m.taskType } : {}),
      }));
      const title = messages.find((m) => m.role === 'user')?.content?.slice(0, 50) || '新对话';
      sessionsApi.save({ id: sid, title, messages: msgData }).catch(() => {});
      // Notify sidebar to refresh
      window.dispatchEvent(new CustomEvent('session-saved'));
    }, 500);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [messages, streaming.isStreaming]);

  // Listen for "开启新对话" from sidebar
  useEffect(() => {
    const handler = () => {
      setMessages([]);
      setInputValue('');
      setEditingIdx(null);
      setEditValue('');
      setAttachedFiles([]);
      setSessionId(null);
      sessionIdRef.current = null;
    };
    window.addEventListener('new-chat', handler);
    return () => window.removeEventListener('new-chat', handler);
  }, []);

  // Smart scroll: 只在用户距底部 60px 内时自动滚动
  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, streaming.thinking, streaming.reply]);

  // Send message
  const handleSend = useCallback(async (message?: string) => {
    let text = (message ?? inputValue).trim();
    if (!text || streaming.isStreaming) return;

    // 附带已上传的文件名
    const doneFiles = attachedFiles.filter((f) => f.status === 'done').map((f) => f.name);
    if (doneFiles.length > 0) {
      text = `[附件: ${doneFiles.join(', ')}]\n${text}`;
    }
    setAttachedFiles([]);

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

  // Helper: extract base name from potentially suffixed key
  const baseName = (key: string) => {
    const idx = key.lastIndexOf('\x00');
    return idx === -1 ? key : key.slice(0, idx);
  };

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
            thinking: Array.from(streaming.thinking.entries()).map(([key, c]) => ({ name: baseName(key), content: c })),
            thinkingOrder: streaming.thinkingOrder.map(baseName),
            error: streaming.error || undefined,
            loading: false,
          };
        }
        return updated;
      });
    }
  }, [streaming.isStreaming, streaming.reply, streaming.error, streaming.thinking, streaming.thinkingOrder]);

  // Fix abort: 当流式停止但最后一条消息还卡在loading时，解除加载态
  useEffect(() => {
    if (!streaming.isStreaming && messages.length > 0) {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === 'assistant' && last.loading) {
          updated[updated.length - 1] = {
            ...last,
            content: last.content || streaming.reply || '（已中断）',
            loading: false,
          };
        }
        return updated;
      });
    }
  }, [streaming.isStreaming]);

  // Regenerate: 删除最后一条 assistant 消息，重新发送上一条用户消息
  const handleRegenerate = useCallback(() => {
    if (streaming.isStreaming) return;
    // 找到最后一条 assistant 消息的索引
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        lastAssistantIdx = i;
        break;
      }
    }
    if (lastAssistantIdx === -1) return;

    // 找到它前面的最后一条 user 消息
    const precedingUser = messages.slice(0, lastAssistantIdx).reverse().find(m => m.role === 'user');
    if (!precedingUser) return;

    // 手动构造消息列表，不依赖 handleSend 的闭包
    const kept = messages.slice(0, lastAssistantIdx);
    const userMsg: Message = { role: 'user', content: precedingUser.content };
    const assistMsg: Message = { role: 'assistant', content: '', loading: true };
    setMessages([...kept, userMsg, assistMsg]);
    setInputValue('');
    startStream(precedingUser.content, laneMode).catch(() => {});
  }, [messages, streaming.isStreaming, laneMode, startStream]);

  // Generate report from thinking data
  const handleGenerateReport = useCallback(async (thinking?: Array<{ name: string; content: string }>) => {
    if (!thinking || thinking.length === 0) {
      toast.error('无可用的思考记录');
      return;
    }
    try {
      const result = await generateReportApi(thinking);
      setReportContent(result.content || '报告生成失败');
      // 小延迟确保 dialog 已渲染
      setTimeout(() => reportDialogRef.current?.showModal(), 50);
    } catch {
      toast.error('报告生成失败');
    }
  }, []);

  const downloadReport = useCallback(() => {
    if (!reportContent) return;
    const blob = new Blob([reportContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    reportDialogRef.current?.close();
    toast.success('报告已下载');
  }, [reportContent]);

  // Edit & resend
  const startEdit = useCallback((idx: number, content: string) => {
    setEditingIdx(idx);
    setEditValue(content);
  }, []);

  // File upload handlers
  const uploadFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    for (const file of files) {
      const name = file.name;
      setAttachedFiles((prev) => [...prev, { name, status: 'uploading' }]);
      try {
        await knowledgeApi.upload(file);
        setAttachedFiles((prev) => prev.map((f) => f.name === name ? { ...f, status: 'done' } : f));
      } catch {
        setAttachedFiles((prev) => prev.map((f) => f.name === name ? { ...f, status: 'error' } : f));
        toast.error(`上传失败: ${name}`);
      }
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      uploadFiles(e.target.files);
      e.target.value = '';
    }
  }, [uploadFiles]);

  const removeFileTag = useCallback((name: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

  // Drag & drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) {
      uploadFiles(e.dataTransfer.files);
    }
  }, [uploadFiles]);

  const submitEdit = useCallback(() => {
    if (!editValue.trim() || editingIdx === null) return;
    // 截断到编辑的消息之前，然后手动添加编辑后的消息+assistant骨架
    const kept = messages.slice(0, editingIdx);
    const userMsg: Message = { role: 'user', content: editValue.trim() };
    const assistMsg: Message = { role: 'assistant', content: '', loading: true };
    setMessages([...kept, userMsg, assistMsg]);
    setEditingIdx(null);
    setEditValue('');
    setInputValue('');
    startStream(editValue.trim(), laneMode).catch(() => {});
  }, [editValue, editingIdx, messages, laneMode, startStream]);

  return (
    <>
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-chat)' }}>
      {/* Messages */}
      {/* Drag overlay */}
      {isDragging && <div className="drag-overlay show">释放文件以上传到知识库</div>}

      <div
        ref={chatRef}
        className="flex-1 overflow-y-auto"
        id="chat-messages"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
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
                  onClick={() => { setLaneMode(val); inputRef.current?.focus(); }}
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
            onGenerateReport={(thinking) => handleGenerateReport(thinking)}
            onRetry={() => handleSend(msg.content)}
            isLast={i === messages.length - 1}
          />
        ))}
      </div>

      {/* Disclaimer */}
      {messages.length > 0 && <div className="ai-disclaimer show">内容由 AI 生成，请仔细甄别</div>}

      {/* File tags */}
      {attachedFiles.length > 0 && (
        <div className="file-tags">
          {attachedFiles.map((f) => (
            <span key={f.name} className={`file-tag ${f.status === 'error' ? 'ft-error' : ''}`}>
              {f.status === 'uploading' ? '⏳' : f.status === 'done' ? '✅' : '❌'} {f.name}
              <span style={{ cursor: 'pointer', marginLeft: 4 }} onClick={() => removeFileTag(f.name)}>✕</span>
            </span>
          ))}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.txt,.png,.jpg,.jpeg"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

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
          {/* Attach button */}
          <button
            type="button"
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            title="上传文件(PDF/TXT/PNG/JPG)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          </button>

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

      {/* 报告预览弹窗 */}
      <dialog ref={reportDialogRef} className="modal">
        <div className="modal-box" style={{ borderRadius: '16px', padding: 0, overflow: 'hidden', maxWidth: '720px', width: '90vw' }}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <h3 className="text-base font-semibold text-[#1d1d1f]">报告预览</h3>
            <form method="dialog">
              <button className="w-7 h-7 rounded-full border-none bg-transparent text-[#9ca3af] cursor-pointer flex items-center justify-center text-sm hover:bg-[#f3f4f6] hover:text-[#4b5563]">✕</button>
            </form>
          </div>
          <div className="p-5 max-h-[60vh] overflow-y-auto">
            {reportContent ? (
              <div className="markdown-body" style={{ fontSize: '0.85rem' }}>
                {reportContent.split('\n').map((line, i) => (
                  <p key={i} style={{ margin: '0.2em 0' }}>{line || '\u00A0'}</p>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center py-8">
                <span className="loading loading-spinner loading-sm text-[#4f8cff]" />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 px-5 pb-5">
            <form method="dialog">
              <button className="btn btn-ghost btn-sm" style={{ borderRadius: '10px' }}>关闭</button>
            </form>
            <button
              className="btn btn-sm"
              disabled={!reportContent}
              onClick={downloadReport}
              style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }}
            >
              保存为 .md
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button onClick={() => { setReportContent(null); }}>close</button>
        </form>
      </dialog>
    </>
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
  onGenerateReport: (thinking: Array<{ name: string; content: string }>) => void;
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

  // Helper: extract base name
  const baseName2 = (key: string) => {
    const idx = key.lastIndexOf('\x00');
    return idx === -1 ? key : key.slice(0, idx);
  };

  // Assistant
  const thinking = isStreaming
    ? streamingOrder.map((key) => ({ name: baseName2(key), content: streamingThinking.get(key) || '' }))
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
          {msg.thinking && msg.thinking.length > 0 && (
            <button className="toolbar-btn" onClick={() => onGenerateReport(msg.thinking!)}>生成报告</button>
          )}
        </div>
      )}
      {msg.error && <button className="toolbar-btn mt-1" onClick={onRetry}>重试</button>}
    </div>
  );
}


