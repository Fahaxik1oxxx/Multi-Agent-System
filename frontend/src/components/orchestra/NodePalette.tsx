import type { DragEvent } from 'react';

const AGENTS = [
  { name: 'Planner', icon: '🧋' },
  { name: 'Retriever', icon: '🐍' },
  { name: 'Coder', icon: '🫻' },
  { name: 'Writer', icon: '✍️' },
  { name: 'Executor', icon: '⚙️' },
  { name: 'Tester', icon: '✅' },
  { name: 'Summarizer', icon: '🧊' },
  { name: 'Bot', icon: '🤖' },
];

export function NodePalette() {
  const onDragStart = (event: DragEvent, type: string, agent?: string) => {
    event.dataTransfer.setData('application/reactflow-type', type);
    if (agent) {
      event.dataTransfer.setData('application/reactflow-agent', agent);
    }
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div style={{ padding: '12px' }}>
      <div
        style={{
          fontSize: '0.7rem',
          fontWeight: 600,
          color: '#81858c',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 8,
        }}
      >
        节点面板
      </div>

      {/* Agent nodes */}
      {AGENTS.map((agent) => (
        <div
          key={agent.name}
          draggable
          onDragStart={(e) => onDragStart(e, 'agent', agent.name)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderRadius: '10px',
            border: '1px solid #e5e7eb',
            background: '#fff',
            cursor: 'grab',
            marginBottom: 6,
            fontSize: '0.82rem',
            fontWeight: 500,
            color: '#1d1d1f',
            transition: 'box-shadow 0.15s, border-color 0.15s',
            userSelect: 'none',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.boxShadow =
              '0 2px 8px rgba(0,0,0,0.08)';
            (e.currentTarget as HTMLDivElement).style.borderColor =
              '#4f8cff';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
            (e.currentTarget as HTMLDivElement).style.borderColor = '#e5e7eb';
          }}
        >
          <span style={{ fontSize: '1.1rem' }}>{agent.icon}</span>
          <span>{agent.name}</span>
        </div>
      ))}

      {/* Divider */}
      <div
        style={{
          borderTop: '1px solid #e5e7eb',
          margin: '10px 0',
        }}
      />

      {/* Router node */}
      <div
        draggable
        onDragStart={(e) => onDragStart(e, 'router')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderRadius: '10px',
          border: '1px solid #f59e0b40',
          background: '#fffbeb',
          cursor: 'grab',
          marginBottom: 6,
          fontSize: '0.82rem',
          fontWeight: 500,
          color: '#f59e0b',
          transition: 'box-shadow 0.15s, border-color 0.15s',
          userSelect: 'none',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.boxShadow =
            '0 2px 8px rgba(245,158,11,0.15)';
          (e.currentTarget as HTMLDivElement).style.borderColor = '#f59e0b';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
          (e.currentTarget as HTMLDivElement).style.borderColor =
            '#f59e0b40';
        }}
      >
        <span style={{ fontSize: '1.1rem' }}>◇</span>
        <span>条件分支</span>
      </div>
    </div>
  );
}
