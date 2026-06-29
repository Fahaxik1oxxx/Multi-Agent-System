import { useCallback, useRef, useEffect, type DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { StartNode } from './nodes/StartNode';
import { AgentNode } from './nodes/AgentNode';
import { RouterNode } from './nodes/RouterNode';
import { RouterEditor } from './RouterEditor';
import { useState } from 'react';
import type { PipelineConfig, RouteCondition } from '@/pages/project/OrchestrationPage';

const nodeTypes = { start: StartNode, agent: AgentNode, router: RouterNode };

interface CanvasProps {
  pipeline: PipelineConfig;
  onChange: (pipeline: PipelineConfig) => void;
}

export function Canvas({ pipeline, onChange }: CanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(
    pipeline.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
    })) as Node[]
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    pipeline.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type || 'smoothstep',
      style: { stroke: '#9ca3af', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#9ca3af' },
    })) as Edge[]
  );
  const [routerEdit, setRouterEdit] = useState<{
    nodeId: string;
    routes: RouteCondition[];
  } | null>(null);
  const idCounter = useRef(50);

  const syncToParent = useCallback((): PipelineConfig => {
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: (n.type as 'start' | 'agent' | 'router') || 'agent',
        position: n.position,
        data: n.data as any,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
      })),
    };
  }, [nodes, edges]);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow-type');
      const agent = event.dataTransfer.getData('application/reactflow-agent');
      if (!type) return;

      // Using window viewport coordinates for drop position
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const position = {
        x: event.clientX - rect.left - 120,
        y: event.clientY - rect.top - 30,
      };
      const newId = `${type}_${idCounter.current++}`;
      const newNode: Node = {
        id: newId,
        type,
        position,
        data:
          type === 'agent'
            ? { agent }
            : { routes: [] },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes]
  );

  const onConnect = useCallback(
    (params: Connection) => {
      const newEdge: Edge = {
        ...params,
        id: `e_${idCounter.current++}`,
        type: 'smoothstep',
        style: { stroke: '#9ca3af', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#9ca3af' },
      };
      setEdges((eds) => addEdge(newEdge, eds));
    },
    [setEdges]
  );

  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === 'router') {
        const agentNodeIds = nodes
          .filter((n) => n.type === 'agent')
          .map((n) => n.id);
        setRouterEdit({
          nodeId: node.id,
          routes:
            ((node.data.routes as RouteCondition[]) || []).length > 0
              ? (node.data.routes as RouteCondition[])
              : [
                  {
                    id: 'default',
                    condition: 'default',
                    target: agentNodeIds[0] || '',
                  },
                ],
        });
      }
    },
    [nodes]
  );

  const handleRouterSave = (routes: RouteCondition[]) => {
    if (!routerEdit) return;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === routerEdit.nodeId ? { ...n, data: { ...n.data, routes } } : n
      )
    );
    setRouterEdit(null);
  };

  useEffect(() => {
    onChange(syncToParent());
  }, [nodes, edges, syncToParent, onChange]);

  return (
    <div
      style={{ width: '100%', height: '100%' }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      tabIndex={0}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDoubleClick={onNodeDoubleClick}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode={['Delete', 'Backspace']}
      >
        <Background color="#f0f2f5" gap={24} />
        <Controls className="!rounded-lg !border-[#e0e4e8] !shadow-sm" />
        <MiniMap
          className="!rounded-lg !border-[#e0e4e8]"
          nodeColor={(n) =>
            n.type === 'start'
              ? '#10b981'
              : n.type === 'router'
                ? '#f59e0b'
                : '#4f8cff'
          }
        />
      </ReactFlow>
      {routerEdit && (
        <RouterEditor
          routes={routerEdit.routes}
          agentNodes={nodes.filter((n) => n.type === 'agent').map((n) => n.id)}
          onSave={handleRouterSave}
          onClose={() => setRouterEdit(null)}
        />
      )}
    </div>
  );
}
