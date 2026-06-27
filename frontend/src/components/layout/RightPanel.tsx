import { useState, useCallback, useRef, type ReactNode } from 'react';

interface RightPanelProps { children: ReactNode; }

export function RightPanel({ children }: RightPanelProps) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(280);
  const dragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startWidth = width;
    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX - ev.clientX;
      setWidth(Math.min(480, Math.max(160, startWidth + delta)));
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [width]);

  return (
    <div className="flex h-full shrink-0">
      <div className="flex items-center justify-center w-[6px] h-full cursor-col-resize hover:bg-[#4f8cff]/20 transition-colors relative group shrink-0" onMouseDown={handleMouseDown}>
        <button onClick={() => setOpen(!open)} className="absolute w-6 h-6 rounded-full bg-white border border-[#e0e4e8] shadow-sm flex items-center justify-center text-[#9ca3af] hover:text-[#4f8cff] hover:border-[#4f8cff] transition-all z-10" style={{ top: '50%', transform: 'translateY(-50%)' }} title={open ? '收起面板' : '展开面板'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <div className="h-full overflow-hidden border-l border-[#eceef2] bg-white transition-all duration-200" style={{ width: open ? `${width}px` : '0px' }}>
        {open && <div className="w-full h-full overflow-y-auto" style={{ minWidth: '160px' }}>{children}</div>}
      </div>
    </div>
  );
}

interface RightPanelTabsProps {
  tabs: { key: string; label: string }[];
  activeTab: string;
  onTabChange: (key: string) => void;
}

export function RightPanelTabs({ tabs, activeTab, onTabChange }: RightPanelTabsProps) {
  return (
    <div className="flex border-b border-[#eceef2] bg-[#f9fafb]">
      {tabs.map((tab) => (
        <button key={tab.key} className={`flex-1 py-2.5 text-xs font-medium transition-colors ${activeTab === tab.key ? 'text-[#4f8cff] border-b-2 border-[#4f8cff] bg-white' : 'text-[#81858c] hover:text-[#1d1d1f]'}`} onClick={() => onTabChange(tab.key)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}
