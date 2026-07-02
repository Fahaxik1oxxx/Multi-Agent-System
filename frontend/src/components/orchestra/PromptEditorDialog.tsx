import { useState } from 'react';
import { ALL_AGENTS } from '@/data/agents';
import { DEFAULT_PROMPTS } from '@/data/defaultPrompts';
import { Braces } from 'lucide-react';

interface PromptEditorDialogProps {
  agentName: string;
  promptValue: string;
  onSave: (value: string) => void;
  onClose: () => void;
}

export function PromptEditorDialog({ agentName, promptValue, onSave, onClose }: PromptEditorDialogProps) {
  const [text, setText] = useState(promptValue || '');
  const agentMeta = ALL_AGENTS.find(a => a.key === agentName);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.3)',
      }}
      onClick={onClose}
    >
      <dialog
        open
        style={{
          position: 'static',
          display: 'block',
          borderRadius: '16px',
          border: 'none',
          padding: 0,
          background: '#fff',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          minWidth: 480,
          maxWidth: 560,
          overflow: 'visible',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e5e7eb',
            fontWeight: 600,
            fontSize: '1rem',
            color: '#1d1d1f',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Braces size={16} className="text-[#4f8cff]" />
          <span>编辑 </span>
          <span style={{ color: agentMeta?.color || '#4f8cff' }}>{agentMeta?.icon}</span>
          <span>{agentName}</span>
          <span style={{ fontSize: '0.78rem', fontWeight: 400, color: '#81858c' }}>System Prompt</span>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px' }}>
          <textarea
            className="textarea textarea-bordered w-full font-mono text-[11px] leading-relaxed resize-y"
            style={{
              borderRadius: '10px',
              borderColor: '#e0e4e8',
              minHeight: '200px',
            }}
            value={text ?? ''}
            onChange={e => setText(e.target.value)}
            placeholder={DEFAULT_PROMPTS[agentName] || ''}
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              className="btn btn-ghost btn-xs"
              style={{ borderRadius: '8px' }}
              onClick={() => {
                setText('');
                onSave('');
              }}
            >
              恢复默认
            </button>
            <button
              className="btn btn-xs"
              style={{
                background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)',
                color: '#fff',
                borderRadius: '8px',
                border: 'none',
              }}
              onClick={() => {
                onSave(text);
              }}
            >
              💾 保存
            </button>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button
            className="btn btn-sm btn-ghost"
            style={{ borderRadius: '10px' }}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="btn btn-sm"
            style={{
              background: '#4f8cff',
              color: '#fff',
              borderRadius: '10px',
              border: 'none',
            }}
            onClick={() => {
              onSave(text);
              onClose();
            }}
          >
            确定
          </button>
        </div>
      </dialog>
    </div>
  );
}
