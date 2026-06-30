import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { projectsApi } from '@/api/projects';
import { Check, Sparkles, Puzzle, FileCode, Bot, Loader2, GitBranch, Palette, Plus, FolderKanban } from 'lucide-react';
import { toast } from 'sonner';
import { ALL_AGENTS } from '@/data/agents';

const PRESETS = [
  { id: 'auto', icon: Sparkles, label: '默认智能体', desc: '8 Agent 全流水线协作', agents: ALL_AGENTS.map(a => a.key), color: '#4f8cff' },
  { id: 'code', icon: FileCode, label: '编程优化', desc: 'Planner + Coder + Executor + Tester', agents: ['Planner', 'Coder', 'Executor', 'Tester'], color: '#10b981' },
  { id: 'write', icon: Bot, label: '写作优化', desc: 'Planner + Retriever + Writer + Summarizer', agents: ['Planner', 'Retriever', 'Writer', 'Summarizer'], color: '#f59e0b' },
];

export function V3AgentSelectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const initialMode = (location.state as { tab?: string })?.tab === 'advanced' ? 'advanced' : 'preset';
  const [mode, setMode] = useState<'preset' | 'custom' | 'advanced'>(initialMode);
  const [selectedPreset, setSelectedPreset] = useState('auto');
  const [customAgents, setCustomAgents] = useState<string[]>(ALL_AGENTS.map(a => a.key));
  const [saving, setSaving] = useState(false);

  // 加载已有配置
  const [savedConfigs, setSavedConfigs] = useState<{ name: string; agents: string[] }[]>([]);
  useEffect(() => {
    if (!projectId) return;
    try {
      const data = JSON.parse(localStorage.getItem(`v3_configs_${projectId}`) || '[]');
      setSavedConfigs(data);
    } catch { setSavedConfigs([]); }
  }, [projectId]);

  const handleUseConfig = async (config: { name: string; agents: string[] }) => {
    if (!projectId) return;
    try {
      await projectsApi.updateAgentConfig(projectId, config.agents);
      navigate(`/v3/personal/${projectId}/chat`, { replace: true });
    } catch { toast.error('应用配置失败'); }
  };

  const handleStart = async () => {
    if (!projectId) return;
    const enabledAgents = mode === 'preset'
      ? PRESETS.find(p => p.id === selectedPreset)?.agents || ALL_AGENTS.map(a => a.key)
      : mode === 'custom'
      ? customAgents
      : ALL_AGENTS.map(a => a.key); // advanced 模式用默认

    setSaving(true);
    try {
      await projectsApi.updateAgentConfig(projectId, enabledAgents);
      navigate(`/v3/personal/${projectId}/chat`, { replace: true });
    } catch {
      toast.error('保存配置失败');
    } finally {
      setSaving(false);
    }

    navigate(`/v3/personal/${projectId}/chat`, {
      state: { agentConfig: { enabled_agents: enabledAgents } },
    });
  };

  const toggleCustomAgent = (key: string) => {
    setCustomAgents((prev) =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-[#1d1d1f] mb-1">选择智能体</h1>
      <p className="text-sm text-[#81858c] mb-6">配置本次对话使用的智能体组合</p>

      {/* 模式切换 */}
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setMode('preset')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'preset' ? 'bg-[#4f8cff] text-white' : 'bg-[#f0f4ff] text-[#81858c] hover:bg-[#e0e8ff]'}`}
        >
          🎯 快速选择
        </button>
        <button
          onClick={() => setMode('custom')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'custom' ? 'bg-[#4f8cff] text-white' : 'bg-[#f0f4ff] text-[#81858c] hover:bg-[#e0e8ff]'}`}
        >
          🔧 自定义
        </button>
        <button
          onClick={() => setMode('advanced')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'advanced' ? 'bg-[#4f8cff] text-white' : 'bg-[#f0f4ff] text-[#81858c] hover:bg-[#e0e8ff]'}`}
        >
          ⚡ 高级配置
        </button>
      </div>

      {mode === 'preset' ? (
        /* 快速预设 */
        <div className="space-y-2 mb-6">
          {PRESETS.map(({ id, icon: Icon, label, desc, agents, color }) => (
            <button
              key={id}
              onClick={() => setSelectedPreset(id)}
              className={`flex items-center gap-3 w-full p-4 rounded-xl border transition-all text-left ${
                selectedPreset === id
                  ? 'border-[#4f8cff] bg-[#f0f4ff]'
                  : 'border-[#e0e4e8] bg-white hover:border-[#4f8cff]/30'
              }`}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}15` }}>
                <Icon size={20} style={{ color }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[#1d1d1f]">{label}</div>
                <div className="text-xs text-[#81858c] mt-0.5">{desc}</div>
                <div className="flex gap-1 mt-1">
                  {agents.map(a => {
                    const agent = ALL_AGENTS.find(x => x.key === a);
                    return agent ? <span key={a} className="text-xs">{agent.icon}</span> : null;
                  })}
                </div>
              </div>
              {selectedPreset === id && (
                <Check size={18} className="text-[#4f8cff] shrink-0" />
              )}
            </button>
          ))}

          {/* 模板市场入口 */}
          <button
            onClick={() => navigate('/v3/personal/templates')}
            className="flex items-center gap-3 w-full p-4 rounded-xl border border-dashed border-[#e0e4e8] bg-white hover:border-[#4f8cff]/30 transition-all text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-[#f9fafb] flex items-center justify-center shrink-0">
              <Puzzle size={20} className="text-[#9ca3af]" />
            </div>
            <div>
              <div className="text-sm font-medium text-[#1d1d1f]">从模板市场导入</div>
              <div className="text-xs text-[#81858c] mt-0.5">浏览社区分享的工作流模板</div>
            </div>
          </button>
        </div>
      ) : mode === 'custom' ? (
        /* 自定义选择 */
        <div className="mb-6">
          <p className="text-xs text-[#81858c] mb-3">勾选需要启用的智能体</p>
          <div className="space-y-1">
            {ALL_AGENTS.map(({ key, icon, label, desc, color }) => {
              const isOn = customAgents.includes(key);
              return (
                <div
                  key={key}
                  onClick={() => toggleCustomAgent(key)}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border cursor-pointer transition-all ${
                    isOn ? 'border-[#4f8cff] bg-[#f0f4ff]' : 'border-[#e0e4e8] bg-white hover:border-[#e0e4e8]'
                  }`}
                >
                  <span className="text-base">{icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[#1d1d1f]">{label}</div>
                    <div className="text-xs text-[#81858c]">{desc}</div>
                  </div>
                  <input
                    type="checkbox"
                    className="toggle toggle-sm"
                    style={{ '--tglbg': isOn ? color : '#d0d4d8' } as React.CSSProperties}
                    checked={isOn}
                    onChange={() => toggleCustomAgent(key)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* 高级配置 */
        <div className="mb-6">
          <p className="text-xs text-[#81858c] mb-3">管理你的智能体配置</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* 创建新配置 */}
            <button onClick={() => navigate(`/v3/personal/${projectId}/config-builder`)}
              className="flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed border-[#e0e4e8] bg-white hover:border-[#4f8cff] hover:bg-[#f0f4ff]/30 transition-all min-h-[140px]">
              <Plus size={28} className="text-[#9ca3af]" />
              <div className="text-sm font-medium text-[#1d1d1f]">创建新配置</div>
              <div className="text-[10px] text-[#81858c] text-center">设计智能体组合 + 编排流水线</div>
            </button>

            {/* 已有配置列表 */}
            <div className="space-y-2">
              {savedConfigs.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 rounded-xl border border-[#e0e4e8] bg-white min-h-[140px]">
                  <p className="text-xs text-[#b0b8c1]">暂无保存的配置</p>
                  <p className="text-[10px] text-[#d0d4d8] mt-1">创建新配置后将显示在这里</p>
                </div>
              ) : (
                savedConfigs.map((cfg, i) => (
                  <button key={i} onClick={() => handleUseConfig(cfg)}
                    className="flex items-center gap-3 w-full p-3 rounded-xl border border-[#e0e4e8] bg-white hover:border-[#4f8cff] hover:shadow-sm transition-all text-left">
                    <div className="w-8 h-8 rounded-lg bg-[#f0f4ff] flex items-center justify-center shrink-0">
                      <FolderKanban size={16} className="text-[#4f8cff]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[#1d1d1f] truncate">{cfg.name}</div>
                      <div className="text-[10px] text-[#81858c]">{cfg.agents.length} Agent</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 开始按钮 */}
      <button
        onClick={handleStart}
        disabled={(mode === 'custom' && customAgents.length === 0) || saving}
        className="btn w-full"
        style={{
          background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)',
          color: '#fff',
          borderRadius: '12px',
          border: 'none',
          height: '48px',
          fontSize: '15px',
        }}
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : '开始对话'}
      </button>
    </div>
  );
}
