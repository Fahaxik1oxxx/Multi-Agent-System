import { Handle, Position, type NodeProps } from '@xyflow/react';

const ICONS: Record<string, string> = {
  Planner: '🧋',
  Retriever: '🐍',
  Coder: '🫻',
  Writer: '✍️',
  Tester: '✅',
  Summarizer: '🧊',
  Bot: '🤖',
  Executor: '⚙️',
};

const COLORS: Record<string, string> = {
  Planner: '#4f8cff',
  Retriever: '#8b5cf6',
  Coder: '#10b981',
  Writer: '#f59e0b',
  Tester: '#ef4444',
  Summarizer: '#4f8cff',
  Bot: '#10b981',
  Executor: '#8b5cf6',
};

export function AgentNode({ data, selected }: NodeProps) {
  const agent = (data.agent as string) || 'Unknown';
  const icon = ICONS[agent] || '🤖';
  const color = COLORS[agent] || '#4f8cff';

  return (
    <div
      style={{
        padding: '12px 20px',
        borderRadius: '12px',
        background: '#fff',
        border: selected
          ? `2.5px solid ${color}`
          : `1.5px solid ${color}40`,
        boxShadow: selected
          ? `0 4px 16px ${color}30`
          : '0 2px 8px rgba(0,0,0,0.06)',
        minWidth: 140,
        textAlign: 'center',
        transition: 'box-shadow 0.2s, border-color 0.2s',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: color,
          width: 10,
          height: 10,
          border: '2px solid #fff',
        }}
      />
      <span style={{ fontSize: '1.3rem', display: 'block', marginBottom: 2 }}>
        {icon}
      </span>
      <span
        style={{
          fontWeight: 600,
          fontSize: '0.85rem',
          color: '#1d1d1f',
          display: 'block',
        }}
      >
        {agent}
      </span>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: color,
          width: 10,
          height: 10,
          border: '2px solid #fff',
        }}
      />
    </div>
  );
}
