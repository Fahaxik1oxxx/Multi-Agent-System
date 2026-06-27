import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

export function GuestChat() {
  const [input, setInput] = useState('');
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/chat/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, lane_mode: 'auto', history: [] }),
      });
      const data = await res.json();
      setReply(data.reply || '');
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply || '' }]);
    } catch {
      toast.error('发送失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRestricted = (feature: string) => {
    toast.info(`「${feature}」需要注册后使用`, { description: '点击右上角注册即可解锁全部功能' });
  };

  // Simple markdown-like rendering for code blocks
  const renderContent = (content: string) => {
    const parts = content.split(/(```\w*\n[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (part.startsWith('```')) {
        const lines = part.split('\n');
        const code = lines.slice(1, -1).join('\n');
        return (
          <pre key={i} className="bg-gray-900 text-green-400 p-3 rounded-lg overflow-x-auto text-xs my-2">
            <code>{code}</code>
          </pre>
        );
      }
      return <div key={i} className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: part }} />;
    });
  };

  return (
    <div className="flex flex-col h-screen bg-[#f8f9fc]">
      {/* 顶部提示栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#4f8cff]/10 border-b border-[#4f8cff]/20">
        <span className="text-sm text-[#4f8cff]">
          🧪 游客模式 — 功能受限，会话不保存
        </span>
        <div className="flex gap-2">
          <Link to="/login" className="btn btn-sm" style={{ borderRadius: '8px' }}>登录</Link>
          <Link to="/register" className="btn btn-sm" style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '8px', border: 'none' }}>注册</Link>
        </div>
      </div>

      {/* 受限功能按钮栏 */}
      <div className="flex gap-2 px-4 py-2 overflow-x-auto border-b border-[#e0e4e8] bg-white">
        {['编排画布', '模板市场', 'Agent 设计器', '知识库上传', '团队模式'].map((f) => (
          <button
            key={f}
            onClick={() => handleRestricted(f)}
            className="btn btn-xs btn-outline"
            style={{ borderRadius: '6px' }}
          >
            🔒 {f}
          </button>
        ))}
      </div>

      {/* 聊天区域 */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && !loading && (
          <div className="text-center text-[#9ca3af] mt-20">
            <p className="text-4xl mb-4">🤖</p>
            <p className="text-lg font-medium">试试多智能体协作！</p>
            <p className="text-sm mt-1">输入任何问题，8 个 Agent 为你协作解答</p>
          </div>
        )}
        <div className="max-w-2xl mx-auto space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  m.role === 'user'
                    ? 'bg-[#4f8cff] text-white'
                    : 'bg-white border border-[#e0e4e8] text-[#1d1d1f]'
                }`}
              >
                {m.role === 'assistant' ? renderContent(m.content) : <p className="text-sm whitespace-pre-wrap">{m.content}</p>}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-[#4f8cff]">
              <span className="loading loading-spinner loading-sm" />
              <span className="text-sm">Agent 正在协作中...</span>
            </div>
          )}
        </div>
      </div>

      {/* 输入框 */}
      <div className="p-4 bg-white border-t border-[#e0e4e8]">
        <div className="flex gap-2 max-w-2xl mx-auto">
          <input
            type="text"
            className="input input-bordered flex-1"
            style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
            placeholder="输入你的问题..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          />
          <button
            className="btn"
            disabled={loading || !input.trim()}
            onClick={handleSend}
            style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
