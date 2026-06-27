import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { RouteCondition } from '@/pages/project/OrchestrationPage';

export function RouterNode({ data, selected }: NodeProps) {
  const routes = (data.routes as RouteCondition[]) || [];

  return (
    <div
      style={{
        padding: '14px 18px',
        borderRadius: '12px',
        background: '#fff',
        border: selected
          ? '2.5px solid #f59e0b'
          : '1.5px solid #f59e0b80',
        boxShadow: selected
          ? '0 4px 16px rgba(245, 158, 11, 0.3)'
          : '0 2px 8px rgba(0,0,0,0.06)',
        minWidth: 180,
        textAlign: 'center',
        transition: 'box-shadow 0.2s, border-color 0.2s',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: '#f59e0b',
          width: 10,
          height: 10,
          border: '2px solid #fff',
        }}
      />
      <div
        style={{
          fontWeight: 600,
          fontSize: '0.85rem',
          color: '#f59e0b',
          marginBottom: 8,
        }}
      >
        ◇ 条件分支
      </div>
      {routes.length > 0 && (
        <div style={{ fontSize: '0.72rem', color: '#81858c', lineHeight: 1.6 }}>
          {routes
            .filter((r) => r.condition !== 'default')
            .map((r) => (
              <div key={r.id}>
                {r.condition} → {r.target}
              </div>
            ))}
          {routes
            .filter((r) => r.condition === 'default')
            .map((r) => (
              <div
                key={r.id}
                style={{ borderTop: '1px solid #e5e7eb', marginTop: 4, paddingTop: 4 }}
              >
                默认 → {r.target}
              </div>
            ))}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: '#f59e0b',
          width: 10,
          height: 10,
          border: '2px solid #fff',
        }}
      />
    </div>
  );
}
