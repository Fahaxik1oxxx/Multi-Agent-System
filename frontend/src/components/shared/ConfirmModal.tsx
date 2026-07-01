import { X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  confirmStyle?: 'danger' | 'warning' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ isOpen, title, message, confirmText = '确定', confirmStyle = 'danger', onConfirm, onCancel }: ConfirmModalProps) {
  if (!isOpen) return null;

  const btnColors = {
    danger: 'background: "#ef4444", color: "#fff"',
    warning: 'background: "#f59e0b", color: "#fff"',
    primary: 'background: "linear-gradient(135deg, #4f8cff, #6c5ce7)", color: "#fff"',
  };

  const bgMap = {
    danger: '#ef4444',
    warning: '#f59e0b',
    primary: '#4f8cff',
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[70]" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-80 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[#1d1d1f]">{title}</h3>
          <button onClick={onCancel} className="text-[#81858c] hover:text-[#1d1d1f]"><X size={16} /></button>
        </div>
        <p className="text-sm text-[#4b5563] leading-relaxed mb-5">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel}
            className="btn btn-sm btn-ghost" style={{ borderRadius: '8px', fontSize: '13px' }}>取消</button>
          <button onClick={onConfirm}
            className="btn btn-sm" style={{ background: bgMap[confirmStyle], color: '#fff', borderRadius: '8px', border: 'none', fontSize: '13px' }}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}
