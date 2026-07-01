import type { DragEvent } from 'react';
import { ALL_AGENTS } from '@/data/agents';

const AGENTS = ALL_AGENTS.map(a => ({ name: a.key, icon: a.icon, color: a.color }));

export function NodePalette() {
  const onDragStart = (event: DragEvent, type: string, agent?: string) => {
    event.dataTransfer.setData('application/reactflow-type', type);
    if (agent) {
      event.dataTransfer.setData('application/reactflow-agent', agent);
    }
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="p-3">
      {/* Agent 节点 */}
      <div className="text-[10px] font-semibold text-[#9ca3af] uppercase tracking-wide mb-2 flex items-center gap-1.5">
        <span className="w-1 h-3 rounded-full bg-[#4f8cff]" /> Agent 节点
      </div>
      {AGENTS.map((agent) => (
        <div
          key={agent.name}
          draggable
          onDragStart={(e) => onDragStart(e, 'agent', agent.name)}
          className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-[#e5e7eb] bg-white cursor-grab mb-1.5 text-[0.78rem] font-medium text-[#1d1d1f] transition-shadow hover:shadow-sm hover:border-[#4f8cff] select-none"
        >
          <span className="text-sm w-5 text-center">{agent.icon}</span>
          <span>{agent.name}</span>
        </div>
      ))}

      {/* 控制节点 */}
      <div className="text-[10px] font-semibold text-[#9ca3af] uppercase tracking-wide mb-2 mt-4 flex items-center gap-1.5">
        <span className="w-1 h-3 rounded-full bg-[#f59e0b]" /> 控制节点
      </div>
      <div
        draggable
        onDragStart={(e) => onDragStart(e, 'router')}
        className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-[#f59e0b]/30 bg-[#fffbeb] cursor-grab mb-1.5 text-[0.78rem] font-medium text-[#b45309] transition-shadow hover:shadow-sm hover:border-[#f59e0b] select-none"
      >
        <span className="text-sm w-5 text-center">◇</span>
        <span>条件分支</span>
      </div>

      {/* 快捷键提示 */}
      <div className="mt-4 pt-3 border-t border-[#eceef2]">
        <p className="text-[9px] text-[#b0b8c1] leading-relaxed">
          💡 拖拽节点到画布<br />
          🔗 拖拽节点端口连线<br />
          🗑️ Delete/Backspace 删除<br />
          👆 双击路由器编辑条件
        </p>
      </div>
    </div>
  );
}
