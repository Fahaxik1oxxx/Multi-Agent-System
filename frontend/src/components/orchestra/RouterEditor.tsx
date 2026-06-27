import { useState } from 'react';
import type { RouteCondition } from '@/pages/project/OrchestrationPage';

const SELECT_CONDITIONS = ['编程', '写作', '分析', '问答'];

interface RouterEditorProps {
  routes: RouteCondition[];
  agentNodes: string[];
  onSave: (routes: RouteCondition[]) => void;
  onClose: () => void;
}

export function RouterEditor({ routes, agentNodes, onSave, onClose }: RouterEditorProps) {
  const [editing, setEditing] = useState<RouteCondition[]>(
    routes.length > 0
      ? routes
      : [{ id: 'default', condition: 'default', target: agentNodes[0] || '' }]
  );

  const updateRoute = (id: string, field: 'condition' | 'target', value: string) => {
    setEditing((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  const addBranch = () => {
    const newId = `r_${Date.now()}`;
    setEditing((prev) => {
      // Insert before the default entry
      const defaultIdx = prev.findIndex((r) => r.condition === 'default');
      const newRoute: RouteCondition = {
        id: newId,
        condition: SELECT_CONDITIONS[0],
        target: agentNodes[0] || '',
      };
      if (defaultIdx >= 0) {
        const copy = [...prev];
        copy.splice(defaultIdx, 0, newRoute);
        return copy;
      }
      return [...prev, newRoute];
    });
  };

  const deleteBranch = (id: string) => {
    setEditing((prev) => prev.filter((r) => r.id !== id));
  };

  const handleSave = () => {
    // Validate: ensure at least one default route exists
    const hasDefault = editing.some((r) => r.condition === 'default');
    if (!hasDefault) return;
    onSave(editing);
  };

  const usedConditions = editing
    .filter((r) => r.condition !== 'default')
    .map((r) => r.condition);

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
          minWidth: 420,
          maxWidth: 500,
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
          }}
        >
          编辑条件分支
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px', maxHeight: '50vh', overflowY: 'auto' }}>
          {editing
            .filter((r) => r.condition !== 'default')
            .map((route) => (
              <div
                key={route.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <select
                  value={route.condition}
                  onChange={(e) => updateRoute(route.id, 'condition', e.target.value)}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    borderRadius: '8px',
                    border: '1px solid #d0d4d8',
                    fontSize: '0.82rem',
                    background: '#fff',
                    color: '#1d1d1f',
                    outline: 'none',
                  }}
                >
                  {SELECT_CONDITIONS.map((c) => (
                    <option
                      key={c}
                      value={c}
                      disabled={usedConditions.includes(c) && c !== route.condition}
                    >
                      {c}
                    </option>
                  ))}
                </select>

                <span style={{ color: '#81858c', fontSize: '0.82rem' }}>→</span>

                <select
                  value={route.target}
                  onChange={(e) => updateRoute(route.id, 'target', e.target.value)}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    borderRadius: '8px',
                    border: '1px solid #d0d4d8',
                    fontSize: '0.82rem',
                    background: '#fff',
                    color: '#1d1d1f',
                    outline: 'none',
                  }}
                >
                  {agentNodes.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => deleteBranch(route.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#9ca3af',
                    fontSize: '1rem',
                    padding: '4px 6px',
                    borderRadius: '6px',
                    lineHeight: 1,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = '#ef4444';
                    (e.currentTarget as HTMLButtonElement).style.background = '#fef2f2';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af';
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  }}
                >
                  ✕
                </button>
              </div>
            ))}

          {/* Default target */}
          {editing
            .filter((r) => r.condition === 'default')
            .map((route) => (
              <div
                key={route.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 10,
                  marginTop: editing.filter((r) => r.condition !== 'default').length > 0 ? 4 : 0,
                }}
              >
                <span
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    fontSize: '0.82rem',
                    color: '#81858c',
                    background: '#f9fafb',
                    borderRadius: '8px',
                    border: '1px solid #e5e7eb',
                  }}
                >
                  默认流向
                </span>
                <span style={{ color: '#81858c', fontSize: '0.82rem' }}>→</span>
                <select
                  value={route.target}
                  onChange={(e) => updateRoute(route.id, 'target', e.target.value)}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    borderRadius: '8px',
                    border: '1px solid #d0d4d8',
                    fontSize: '0.82rem',
                    background: '#fff',
                    color: '#1d1d1f',
                    outline: 'none',
                  }}
                >
                  {agentNodes.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
                <span style={{ width: 36 }} />
              </div>
            ))}

          {/* Add branch */}
          <button
            type="button"
            onClick={addBranch}
            disabled={usedConditions.length >= SELECT_CONDITIONS.length}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '10px',
              border: '1px dashed #d0d4d8',
              background: '#fafbfc',
              color: '#4f8cff',
              fontSize: '0.82rem',
              cursor:
                usedConditions.length >= SELECT_CONDITIONS.length
                  ? 'not-allowed'
                  : 'pointer',
              opacity:
                usedConditions.length >= SELECT_CONDITIONS.length ? 0.4 : 1,
            }}
          >
            + 添加分支
          </button>
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
            onClick={handleSave}
          >
            确定
          </button>
        </div>
      </dialog>
    </div>
  );
}
