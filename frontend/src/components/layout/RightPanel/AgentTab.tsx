import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '@/api/projects';
import { toast } from 'sonner';

const AGENTS = [
  { key: 'Planner', icon: '🧋', label: 'Planner', desc: '任务规划', alwaysOn: true },
  { key: 'Retriever', icon: '🐍', label: 'Retriever', desc: '知识库检索', alwaysOn: false },
  { key: 'Coder', icon: '🫻', label: 'Coder', desc: '编写代码', alwaysOn: false },
  { key: 'Writer', icon: '✍️', label: 'Writer', desc: '撰写文档', alwaysOn: false },
  { key: 'Executor', icon: '⚙️', label: 'Executor', desc: '执行代码', alwaysOn: false },
  { key: 'Tester', icon: '✅', label: 'Tester', desc: 'QA 审阅', alwaysOn: false },
  { key: 'Summarizer', icon: '🧊', label: 'Summarizer', desc: '生成报告', alwaysOn: true },
  { key: 'Bot', icon: '🤖', label: 'Bot', desc: '快捷问答', alwaysOn: false },
];
const DEFAULT_ENABLED = ['Planner', 'Retriever', 'Coder', 'Writer', 'Executor', 'Tester', 'Summarizer', 'Bot'];

interface AgentTabProps { projectId: string; }

export function AgentTab({ projectId }: AgentTabProps) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['agent-config', projectId],
    queryFn: async () => { const res = await projectsApi.getAgentConfig(projectId); return res.data; },
    enabled: !!projectId,
  });
  const toggleMutation = useMutation({
    mutationFn: async (enabled: string[]) => { await projectsApi.updateAgentConfig(projectId, enabled); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['agent-config', projectId] }); toast.success('Agent 配置已更新'); },
    onError: () => toast.error('更新失败'),
  });
  const enabledAgents = data?.enabled_agents || DEFAULT_ENABLED;
  const handleToggle = (agentKey: string, on: boolean) => {
    const next = on ? [...enabledAgents, agentKey] : enabledAgents.filter((k: string) => k !== agentKey);
    toggleMutation.mutate(next);
  };
  if (isLoading) return <div className="text-center py-8"><span className="loading loading-spinner loading-sm text-[#4f8cff]" /></div>;
  return (
    <div>
      <h3 className="text-sm font-semibold text-[#1d1d1f] mb-3">Agent 开关</h3>
      <p className="text-xs text-[#81858c] mb-4">停用的 Agent 将在下次对话中被跳过</p>
      <div className="space-y-1">
        {AGENTS.map((agent) => {
          const isOn = enabledAgents.includes(agent.key);
          return (
            <div key={agent.key} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-[#f9fafb] transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base">{agent.icon}</span>
                <div className="min-w-0"><div className="text-xs font-medium text-[#1d1d1f]">{agent.label}</div><div className="text-[10px] text-[#9ca3af]">{agent.desc}</div></div>
              </div>
              {agent.alwaysOn ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#f0f2f5] text-[#81858c] shrink-0">始终启用</span>
              ) : (
                <input type="checkbox" className="toggle toggle-sm" style={{ '--tglbg': isOn ? '#4f8cff' : '#d0d4d8' } as React.CSSProperties} checked={isOn} onChange={(e) => handleToggle(agent.key, e.target.checked)} />
              )}
            </div>
          );
        })}
      </div>
      <button className="btn btn-ghost btn-sm w-full mt-4 text-xs text-[#81858c]" style={{ borderRadius: '10px' }} onClick={() => toggleMutation.mutate(DEFAULT_ENABLED)}>恢复默认配置</button>
    </div>
  );
}
