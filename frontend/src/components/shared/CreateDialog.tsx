import { useState, useEffect, useRef } from 'react';

interface CreateDialogProps {
  title: string;
  description: string;
  triggerLabel: string;
  nameLabel?: string;
  namePlaceholder?: string;
  descLabel?: string;
  descPlaceholder?: string;
  showDescription?: boolean;
  onSubmit: (name: string, description: string) => Promise<void>;
}

export function CreateDialog({
  title,
  description,
  triggerLabel,
  nameLabel = '名称',
  namePlaceholder = '输入名称',
  descLabel = '描述',
  descPlaceholder = '可选描述',
  showDescription = true,
  onSubmit,
}: CreateDialogProps) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await onSubmit(name.trim(), desc.trim());
      dialogRef.current?.close();
      setName('');
      setDesc('');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      setName('');
      setDesc('');
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, []);

  return (
    <>
      <button className="btn" style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }} onClick={() => dialogRef.current?.showModal()}>
        {triggerLabel}
      </button>
      <dialog ref={dialogRef} className="modal">
        <div className="modal-box" style={{ borderRadius: '16px', padding: 0, overflow: 'hidden' }}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <h3 className="text-base font-semibold text-[#1d1d1f]">{title}</h3>
            <form method="dialog">
              <button className="w-7 h-7 rounded-full border-none bg-transparent text-[#9ca3af] cursor-pointer flex items-center justify-center text-sm hover:bg-[#f3f4f6] hover:text-[#4b5563]">
                ✕
              </button>
            </form>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1 text-[#81858c]">{nameLabel}</label>
              <input
                className="input input-bordered w-full"
                style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                placeholder={namePlaceholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
            </div>
            {showDescription && (
              <div>
                <label className="block text-xs font-medium mb-1 text-[#81858c]">{descLabel}</label>
                <textarea
                  className="textarea textarea-bordered w-full"
                  style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                  placeholder={descPlaceholder}
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  rows={3}
                />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 px-5 pb-5">
            <form method="dialog">
              <button className="btn btn-ghost btn-sm" style={{ borderRadius: '10px' }}>取消</button>
            </form>
            <button
              className="btn btn-sm"
              disabled={loading || !name.trim()}
              onClick={handleSubmit}
              style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }}
            >
              {loading ? <span className="loading loading-spinner loading-sm" /> : null}
              创建
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </>
  );
}
