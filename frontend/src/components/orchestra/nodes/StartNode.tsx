import { Handle, Position, type NodeProps } from '@xyflow/react';

export function StartNode({ selected }: NodeProps) {
  return (
    <div
      style={{
        padding: '10px 28px',
        borderRadius: '14px',
        background: selected ? '#059669' : '#10b981',
        color: '#fff',
        fontWeight: 600,
        fontSize: '0.9rem',
        boxShadow: selected
          ? '0 0 0 3px rgba(16, 185, 129, 0.35)'
          : '0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      🚀 开始
      <Handle type="source" position={Position.Bottom} style={{ background: '#10b981', width: 10, height: 10, border: '2px solid #fff' }} />
    </div>
  );
}
