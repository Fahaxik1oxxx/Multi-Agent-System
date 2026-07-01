import { useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi, configsApi } from '@/api/projects';
import { Canvas } from '@/components/orchestra/Canvas';
import { NodePalette } from '@/components/orchestra/NodePalette';
import { toast } from 'sonner';
import { Save, RotateCcw } from 'lucide-react';

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
    { id: 'planner', type: 'agent', position: { x: 300, y: 100 }, data: { agent: 'Planner' } },
    { id: 'retriever', type: 'agent', position: { x: 300, y: 220 }, data: { agent: 'Retriever' } },
    { id: 'route_1', type: 'router', position: { x: 300, y: 340 }, data: { routes: [
      { id: 'r1', condition: '编程', target: 'coder' },
      { id: 'r2', condition: '分析', target: 'coder' },
      { id: 'r3', condition: '写作', target: 'writer' },
      { id: 'r4', condition: 'default', target: 'summarizer' },
    ]}},
    { id: 'coder', type: 'agent', position: { x: 120, y: 460 }, data: { agent: 'Coder' } },
    { id: 'writer', type: 'agent', position: { x: 480, y: 460 }, data: { agent: 'Writer' } },
    { id: 'executor', type: 'agent', position: { x: 120, y: 580 }, data: { agent: 'Executor' } },
    { id: 'tester', type: 'agent', position: { x: 120, y: 700 }, data: { agent: 'Tester' } },
    { id: 'summarizer', type: 'agent', position: { x: 300, y: 820 }, data: { agent: 'Summarizer' } },
    { id: 'bot', type: 'agent', position: { x: 600, y: 100 }, data: { agent: 'Bot' } },
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
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();

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

  return <OrchestrationEditor initialData={data} projectId={projectId!} workspaceId={workspaceId!} />;
}

function OrchestrationEditor({ initialData, projectId, workspaceId }: { initialData: any; projectId: string; workspaceId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const initialPipeline = (initialData?.pipeline?.nodes && initialData.pipeline.nodes.length > 0)
    ? (initialData.pipeline as PipelineConfig)
    : DEFAULT_PIPELINE;

  const [pipeline, setPipeline] = useState<PipelineConfig>(initialPipeline);
  const [pipelineKey, setPipelineKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const mountSkipRef = useRef(true);

  const handlePipelineChange = useCallback((p: PipelineConfig) => {
    setPipeline(p);
    // 跳过 mount 时的首次自动同步
    if (mountSkipRef.current) { mountSkipRef.current = false; return; }
    setDirty(true);
  }, []);

  const agentCount = pipeline.nodes.filter(n => n.type === 'agent').length;
  const routerCount = pipeline.nodes.filter(n => n.type === 'router').length;

  const saveMutation = useMutation({
    mutationFn: async (p: PipelineConfig) => {
      const agentStates: Record<string, string> = {};
      for (const node of p.nodes) {
        if (node.type === 'agent' && node.data?.agent) {
          agentStates[node.data.agent] = 'on';
        }
      }
      if (initialData?.agent_states) {
        for (const [k, v] of Object.entries(initialData.agent_states as Record<string, string>)) {
          if (v === 'off' && agentStates[k]) agentStates[k] = 'off';
        }
      }
      await projectsApi.updateAgentConfig(projectId, { pipeline: p, agent_states: agentStates });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-config', projectId] });
      setDirty(false);
      const agentNames = pipeline.nodes.filter(n => n.type === 'agent' && n.data?.agent).map(n => n.data!.agent!);
      configsApi.create({
        name: `编排配置 ${new Date().toLocaleTimeString('zh-CN')}`,
        agents: agentNames,
        project_id: projectId,
        pipeline: pipeline,
      }).catch(() => { /* non-critical */ });
      toast.success('流水线已保存');
      window.dispatchEvent(new CustomEvent('orchestra-saved'));
      setTimeout(() => navigate(`/v3/personal/${projectId}/agents`, { state: { tab: 'custom' } }), 600);
    },
    onError: () => toast.error('保存失败'),
  });

  return (
    <div className="flex flex-col h-full" style={{ background: '#fafbfc' }}>
      {/* Top toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-[#eceef2] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-[#1d1d1f]">编排流水线</span>
          <span className="text-[10px] text-[#81858c] bg-[#f3f4f6] px-2 py-0.5 rounded-full">
            {agentCount} Agent · {routerCount} 路由
          </span>
          {dirty && (
            <span className="text-[10px] text-[#f59e0b] bg-[#fffbeb] px-2 py-0.5 rounded-full border border-[#f59e0b]/20">
              未保存
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-ghost btn-xs gap-1"
            style={{ borderRadius: '8px' }}
            onClick={() => {
              setPipeline(DEFAULT_PIPELINE);
              setPipelineKey(k => k + 1);
              setDirty(true);
              toast.success('已恢复默认');
            }}
          >
            <RotateCcw size={12} /> 恢复默认
          </button>
          <button
            className="btn btn-xs gap-1"
            style={{
              background: dirty ? 'linear-gradient(135deg, #4f8cff, #6c5ce7)' : '#e5e7eb',
              color: dirty ? '#fff' : '#9ca3af',
              borderRadius: '8px',
              border: 'none',
            }}
            onClick={() => saveMutation.mutate(pipeline)}
            disabled={saveMutation.isPending || !dirty}
          >
            {saveMutation.isPending ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <Save size={12} />
            )}
            保存
          </button>
        </div>
      </div>

      {/* Body: palette + canvas */}
      <div className="flex flex-1 min-h-0">
        <div className="w-48 shrink-0 border-r border-[#eceef2] bg-white overflow-y-auto flex flex-col">
          <NodePalette />
        </div>
        <div className="flex-1">
          <Canvas key={pipelineKey} pipeline={pipeline} onChange={handlePipelineChange} />
        </div>
      </div>
    </div>
  );
}
