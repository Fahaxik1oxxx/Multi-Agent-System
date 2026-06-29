import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '@/api/projects';
import { Canvas } from '@/components/orchestra/Canvas';
import { NodePalette } from '@/components/orchestra/NodePalette';
import { toast } from 'sonner';

// ── Data model types ──

export interface RouteCondition {
  id: string;
  condition: string;
  target: string;
}

export interface PipelineNode {
  id: string;
  type: 'start' | 'agent' | 'router';
  position: { x: number; y: number };
  data: { agent?: string; routes?: RouteCondition[] };
}

export interface PipelineEdge {
  id: string;
  source: string;
  target: string;
  type?: 'loop';
}

export interface PipelineConfig {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

// ── Default pipeline ──

export const DEFAULT_PIPELINE: PipelineConfig = {
  nodes: [
    { id: 'start', type: 'start', position: { x: 300, y: 0 }, data: {} },
    {
      id: 'planner',
      type: 'agent',
      position: { x: 300, y: 100 },
      data: { agent: 'Planner' },
    },
    {
      id: 'retriever',
      type: 'agent',
      position: { x: 300, y: 220 },
      data: { agent: 'Retriever' },
    },
    {
      id: 'route_1',
      type: 'router',
      position: { x: 300, y: 340 },
      data: {
        routes: [
          { id: 'r1', condition: '编程', target: 'coder' },
          { id: 'r2', condition: '分析', target: 'coder' },
          { id: 'r3', condition: '写作', target: 'writer' },
          { id: 'r4', condition: 'default', target: 'summarizer' },
        ],
      },
    },
    {
      id: 'coder',
      type: 'agent',
      position: { x: 120, y: 460 },
      data: { agent: 'Coder' },
    },
    {
      id: 'writer',
      type: 'agent',
      position: { x: 480, y: 460 },
      data: { agent: 'Writer' },
    },
    {
      id: 'executor',
      type: 'agent',
      position: { x: 120, y: 580 },
      data: { agent: 'Executor' },
    },
    {
      id: 'tester',
      type: 'agent',
      position: { x: 120, y: 700 },
      data: { agent: 'Tester' },
    },
    {
      id: 'summarizer',
      type: 'agent',
      position: { x: 300, y: 820 },
      data: { agent: 'Summarizer' },
    },
    {
      id: 'bot',
      type: 'agent',
      position: { x: 600, y: 100 },
      data: { agent: 'Bot' },
    },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'planner' },
    { id: 'e2', source: 'planner', target: 'retriever' },
    { id: 'e3', source: 'retriever', target: 'route_1' },
    { id: 'e4', source: 'coder', target: 'executor' },
    { id: 'e5', source: 'executor', target: 'tester' },
    { id: 'e6', source: 'tester', target: 'summarizer' },
    { id: 'e7', source: 'writer', target: 'tester' },
  ],
};

// ── Page component ──

export function OrchestrationPage() {
  const { workspaceId, projectId } = useParams<{
    workspaceId: string;
    projectId: string;
  }>();
  
  const { data, isLoading } = useQuery({
    queryKey: ['agent-config', projectId],
    queryFn: async () => {
      const res = await projectsApi.getAgentConfig(projectId!);
      return res.data;
    },
    enabled: !!projectId,
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="loading loading-spinner loading-lg text-[#4f8cff]" />
      </div>
    );
  }

  return (
    <OrchestrationEditor 
      initialData={data} 
      projectId={projectId!} 
      workspaceId={workspaceId!} 
    />
  );
}

function OrchestrationEditor({ initialData, projectId, workspaceId }: { initialData: any, projectId: string, workspaceId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  // Initialize pipeline cleanly on mount
  const initialPipeline = (initialData?.pipeline?.nodes && initialData.pipeline.nodes.length > 0)
    ? (initialData.pipeline as PipelineConfig)
    : DEFAULT_PIPELINE;
    
  const [pipeline, setPipeline] = useState<PipelineConfig>(initialPipeline);
  const [pipelineKey, setPipelineKey] = useState(0);

  const saveMutation = useMutation({
    mutationFn: async (p: PipelineConfig) => {
      await projectsApi.updateAgentConfig(projectId, p);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-config', projectId] });
      toast.success('流水线已保存');
      window.dispatchEvent(new CustomEvent('orchestra-saved'));
    },
    onError: () => toast.error('保存失败'),
  });

  return (
    <div className="flex h-full" style={{ background: '#fafbfc' }}>
      {/* Left panel: Node palette */}
      <div className="w-48 shrink-0 border-r border-[#eceef2] bg-white overflow-y-auto">
        <NodePalette />
        <div className="p-3 border-t border-[#eceef2] space-y-2">
          <button
            className="btn btn-sm w-full"
            style={{
              background: 'var(--brand-primary)',
              color: '#fff',
              borderRadius: '10px',
              border: 'none',
            }}
            onClick={() => saveMutation.mutate(pipeline)}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <span className="loading loading-spinner loading-xs" />
            ) : null}{' '}
            保存流水线
          </button>
          <button
            className="btn btn-ghost btn-sm w-full text-xs"
            style={{ borderRadius: '10px' }}
            onClick={() => {
              setPipeline(DEFAULT_PIPELINE);
              setPipelineKey(k => k + 1);
              toast.success('已恢复默认');
            }}
          >
            恢复默认
          </button>
        </div>
      </div>

      {/* Main canvas area */}
      <div className="flex-1">
        {/* Tab navigation */}
        <div className="flex items-center gap-1 px-4 py-2 bg-white border-b border-[#eceef2] text-sm">
          <button
            className="text-[#81858c] hover:text-[#1d1d1f] transition-colors"
            onClick={() => navigate(`/v3/personal/${projectId}/chat`)}
          >
            💬 对话
          </button>
          <span className="text-[#d0d4d8]">|</span>
          <span className="text-[#4f8cff] font-medium">🗺️ 编排</span>
        </div>
        <Canvas key={pipelineKey} pipeline={pipeline} onChange={setPipeline} />
      </div>
    </div>
  );
}
