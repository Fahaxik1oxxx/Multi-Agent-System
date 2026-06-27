import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { toast } from 'sonner';

const AGENTS = [
  { key: 'Planner', icon: '🧋', label: 'Planner', desc: '任务规划' },
  { key: 'Retriever', icon: '🐍', label: 'Retriever', desc: '知识检索' },
  { key: 'Coder', icon: '🫻', label: 'Coder', desc: '编写代码' },
  { key: 'Writer', icon: '✍️', label: 'Writer', desc: '撰写文档' },
  { key: 'Tester', icon: '✅', label: 'Tester', desc: 'QA审阅' },
  { key: 'Summarizer', icon: '🧊', label: 'Summarizer', desc: '生成报告' },
  { key: 'Bot', icon: '🤖', label: 'Bot', desc: '快捷问答' },
];

const DEFAULT_PROMPTS: Record<string, string> = {
  Planner: '你是高级项目经理。根据用户需求制定详细的执行计划。\n用编号列表列出执行步骤，每步含：目标、技术/工具、预期输出。',
  Retriever: '你是知识检索专家。从知识库中查找与任务相关的信息。',
  Coder: '你是 Python 程序员。编写并执行代码。',
  Writer: '你是专业文档撰写专家。使用 Markdown 格式输出。',
  Tester: '你是高级 QA 评审工程师。审查输出是否满足用户需求。',
  Summarizer: '你是技术文档专家。汇总执行过程，生成简洁报告。',
  Bot: '你是友好的 AI 助手。用简洁自然的中文直接回答。',
};

export function AgentDesigner() {
  const [selectedAgent, setSelectedAgent] = useState('Planner');
  const [editPrompt, setEditPrompt] = useState('');
  const queryClient = useQueryClient();

  const { data: config } = useQuery({
    queryKey: ['user-config'],
    queryFn: async () => {
      const res = await apiClient.get<{ roles?: Record<string, string> }>('/user/config');
      return res.data;
    },
  });

  // Reset edit prompt when switching agents (so currentPrompt falls back to saved/default)
  useEffect(() => {
    setEditPrompt('');
  }, [selectedAgent]);

  const currentPrompt =
    editPrompt ||
    config?.roles?.[selectedAgent] ||
    DEFAULT_PROMPTS[selectedAgent] ||
    '';

  const saveMutation = useMutation({
    mutationFn: async (roles: Record<string, string>) => {
      await apiClient.put('/user/config', { roles });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-config'] });
      toast.success('配置已保存');
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        '保存失败';
      toast.error(msg);
    },
  });

  const handleSave = () => {
    const roles = { ...(config?.roles || {}) };
    roles[selectedAgent] = editPrompt || currentPrompt;
    saveMutation.mutate(roles);
  };

  const handleReset = () => {
    setEditPrompt(DEFAULT_PROMPTS[selectedAgent] || '');
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-[#1d1d1f] mb-1">Agent 设计器</h1>
      <p className="text-[#81858c] text-sm mb-6">自定义每个 Agent 的 System Prompt</p>

      <div className="flex gap-6">
        {/* 左侧 Agent 列表 */}
        <div className="w-48 shrink-0">
          <div className="card bg-base-100 border border-[#e0e4e8] shadow-sm overflow-hidden">
            <div className="p-2">
              {AGENTS.map((agent) => (
                <button
                  key={agent.key}
                  onClick={() => setSelectedAgent(agent.key)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                    selectedAgent === agent.key
                      ? 'bg-[#4f8cff]/8 text-[#4f8cff]'
                      : 'text-[#81858c] hover:bg-[#f3f4f6] hover:text-[#1d1d1f]'
                  }`}
                >
                  <span className="text-lg leading-none">{agent.icon}</span>
                  <div>
                    <div className="text-sm font-medium">{agent.label}</div>
                    <div className="text-xs opacity-70">{agent.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 右侧编辑区 */}
        <div className="flex-1 min-w-0">
          <div className="card bg-base-100 border border-[#e0e4e8] shadow-sm">
            <div className="card-body">
              <div className="flex items-center justify-between mb-1">
                <h2 className="card-title text-[#1d1d1f] text-base">
                  {AGENTS.find((a) => a.key === selectedAgent)?.icon}{' '}
                  {selectedAgent} System Prompt
                </h2>
                <span className="badge badge-ghost text-xs">
                  {editPrompt ? '已修改' : config?.roles?.[selectedAgent] ? '自定义配置' : '默认配置'}
                </span>
              </div>

              <textarea
                className="textarea textarea-bordered w-full font-mono text-sm leading-relaxed resize-y"
                style={{
                  borderRadius: '10px',
                  borderColor: '#e0e4e8',
                  minHeight: '300px',
                }}
                value={editPrompt || currentPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                placeholder="输入 System Prompt..."
              />

              <div className="flex justify-end gap-2 mt-2">
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ borderRadius: '10px' }}
                  onClick={handleReset}
                >
                  恢复默认
                </button>
                <button
                  className="btn btn-sm"
                  disabled={saveMutation.isPending}
                  onClick={handleSave}
                  style={{
                    background: 'var(--brand-primary)',
                    color: '#fff',
                    borderRadius: '10px',
                    border: 'none',
                  }}
                >
                  {saveMutation.isPending ? (
                    <span className="loading loading-spinner loading-sm" />
                  ) : null}
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
