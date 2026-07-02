import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { projectsApi, configsApi } from '@/api/projects';
import { Check, Sparkles, Puzzle, FileCode, Bot, Loader2, Plus, FolderKanban, GitBranch, Braces, Pencil, Trash2, X, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { ALL_AGENTS } from '@/data/agents';
import { DEFAULT_PROMPTS } from '@/data/defaultPrompts';

interface SavedConfig {
  id: string;
  name: string;
  agents: string[];
  pipeline?: Record<string, unknown>;
  prompts?: Record<string, string>;
  is_public?: number;
  project_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

const PRESETS = [
  { id: 'auto', icon: Sparkles, label: '默认智能体', desc: '8 Agent 全流水线协作', agents: ALL_AGENTS.map(a => a.key), color: '#4f8cff' },
  { id: 'code', icon: FileCode, label: '编程优化', desc: 'Planner + Coder + Executor + Tester', agents: ['Planner', 'Coder', 'Executor', 'Tester'], color: '#10b981' },
  { id: 'write', icon: Bot, label: '写作优化', desc: 'Planner + Retriever + Writer + Summarizer', agents: ['Planner', 'Retriever', 'Writer', 'Summarizer'], color: '#f59e0b' },
];

/* ─── Prompt 编辑器 ─── */
function storageKey(projectId?: string) {
  return projectId ? `custom_prompts_${projectId}` : 'custom_prompts';
}

function loadCustomPrompts(projectId?: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(storageKey(projectId)) || '{}'); } catch { return {}; }
}
function saveCustomPrompts(prompts: Record<string, string>, projectId?: string) {
  localStorage.setItem(storageKey(projectId), JSON.stringify(prompts));
}

function PromptEditor({ projectId }: { projectId?: string }) {
  const [agent, setAgent] = useState('Planner');
  const [text, setText] = useState('');

  useEffect(() => {
    const saved = loadCustomPrompts(projectId);
    setText(saved[agent] || '');
  }, [agent, projectId]);

  return (
    <div>
      <p className="text-xs text-[#81858c] mb-2">自定义 Agent System Prompt</p>
      {/* Agent 选择 */}
      <div className="flex flex-wrap gap-1 mb-2">
        {ALL_AGENTS.map(({ key, icon, label }) => (
          <button key={key} onClick={() => setAgent(key)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] transition-colors ${
              agent === key
                ? 'bg-[#4f8cff]/10 text-[#4f8cff] font-medium border border-[#4f8cff]/25'
                : 'text-[#81858c] hover:bg-[#f3f4f6] border border-transparent'
            }`}>
            <span>{icon}</span> {label}
          </button>
        ))}
      </div>
      {/* 编辑区 */}
      <textarea
        className="textarea textarea-bordered w-full font-mono text-[11px] leading-relaxed resize-y"
        style={{ borderRadius: '10px', borderColor: '#e0e4e8', minHeight: '160px' }}
        value={text ?? ''}
        onChange={e => setText(e.target.value)}
        placeholder={DEFAULT_PROMPTS[agent]}
      />
      <div className="flex justify-end gap-2 mt-2">
        <button className="btn btn-ghost btn-xs" style={{ borderRadius: '8px' }}
          onClick={() => {
            setText('');
            const p = loadCustomPrompts(projectId);
            if (agent in p) { delete p[agent]; saveCustomPrompts(p, projectId); }
            toast.success(`${agent} 已恢复默认`);
          }}>恢复默认</button>
        <button className="btn btn-xs"
          onClick={() => {
            const p = loadCustomPrompts(projectId);
            if (text) { p[agent] = text; } else { delete p[agent]; }
            saveCustomPrompts(p, projectId);
            toast.success(`「${agent}」Prompt 已保存`);
          }}
          style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '8px', border: 'none' }}>
          保存
        </button>
      </div>
    </div>
  );
}

export function V3AgentSelectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const initialTab = (location.state as { tab?: string })?.tab === 'custom' ? 'custom' : 'preset';
  const [mode, setMode] = useState<'preset' | 'custom'>(initialTab);
  const [selectedPreset, setSelectedPreset] = useState('auto');
  const [saving, setSaving] = useState(false);

  // 加载已有配置
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);

  const reloadConfigs = useCallback(async () => {
    try {
      const res = await configsApi.list();
      setSavedConfigs(res.data);
    } catch { setSavedConfigs([]); }
  }, []);

  useEffect(() => { reloadConfigs(); }, [reloadConfigs]);

  // 监听编排保存事件，自动刷新列表
  useEffect(() => {
    window.addEventListener('orchestra-saved', reloadConfigs);
    return () => window.removeEventListener('orchestra-saved', reloadConfigs);
  }, [reloadConfigs]);

  // Auto-migrate old localStorage configs to DB
  useEffect(() => {
    if (!projectId) return;
    const key = `v3_configs_${projectId}`;
    const oldData = localStorage.getItem(key);
    if (!oldData) return;
    try {
      const items: { name: string; agents: string[] }[] = JSON.parse(oldData);
      if (!Array.isArray(items) || items.length === 0) { localStorage.removeItem(key); return; }
      Promise.all(items.map(item =>
        configsApi.create({ name: item.name, agents: item.agents }).catch(() => null)
      )).then(() => {
        localStorage.removeItem(key);
        reloadConfigs();
      });
    } catch { localStorage.removeItem(key); }
  }, [projectId]);

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  const handleUseConfig = async (config: { id: string; name: string; agents: string[]; pipeline?: any; prompts?: Record<string, string> }) => {
    if (!projectId) return;
    try {
      if (config.prompts && Object.keys(config.prompts).length > 0) {
        const merged = { ...loadCustomPrompts(projectId), ...config.prompts };
        saveCustomPrompts(merged, projectId);
      }
      const localPrompts = loadCustomPrompts(projectId);
      const payload: any = { enabled_agents: config.agents };
      if (config.pipeline) payload.pipeline = config.pipeline;
      if (Object.keys(localPrompts).length > 0) payload.prompts = localPrompts;
      await projectsApi.updateAgentConfig(projectId, payload);
      navigate(`/v3/personal/${projectId}/chat`, { replace: true });
    } catch { toast.error('应用配置失败'); }
  };

  const handleRenameStart = (idx: number) => {
    setEditingIdx(idx);
    setEditName(savedConfigs[idx].name);
  };

  const handleRenameSave = async () => {
    if (editingIdx === null || !projectId) return;
    const cfg = savedConfigs[editingIdx];
    const newName = editName.trim() || cfg.name;
    try {
      await configsApi.update(cfg.id, { name: newName });
      const updated = [...savedConfigs];
      updated[editingIdx] = { ...updated[editingIdx], name: newName };
      setSavedConfigs(updated);
    } catch { toast.error('重命名失败'); }
    setEditingIdx(null);
  };

  const handleDelete = async (idx: number) => {
    const cfg = savedConfigs[idx];
    try {
      await configsApi.delete(cfg.id);
      setSavedConfigs(prev => prev.filter((_, i) => i !== idx));
      toast.success('已删除');
    } catch { toast.error('删除失败'); }
  };

  const handlePublish = async (idx: number) => {
    const cfg = savedConfigs[idx];
    try {
      if (cfg.is_public) {
        await configsApi.unpublish(cfg.id);
        toast.success('已取消发布');
      } else {
        await configsApi.publish(cfg.id);
        toast.success('已发布到模板市场');
      }
      reloadConfigs();
    } catch { toast.error('操作失败'); }
  };

  const handlePresetStart = async () => {
    if (!projectId) return;
    const agents = PRESETS.find(p => p.id === selectedPreset)?.agents || ALL_AGENTS.map(a => a.key);
    setSaving(true);
    try {
      const localPrompts = loadCustomPrompts(projectId);
      const payload: any = { enabled_agents: agents };
      if (Object.keys(localPrompts).length > 0) payload.prompts = localPrompts;
      await projectsApi.updateAgentConfig(projectId, payload);
      navigate(`/v3/personal/${projectId}/chat`, { replace: true });
    } catch {
      toast.error('保存配置失败');
    } finally {
      setSaving(false);
    }
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
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode !== 'preset' ? 'bg-[#4f8cff] text-white' : 'bg-[#f0f4ff] text-[#81858c] hover:bg-[#e0e8ff]'}`}
        >
          🔧 自定义配置
        </button>
      </div>

      {mode === 'preset' ? (
        /* ── 快速预设 ── */
        <>
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

          <button
            onClick={handlePresetStart}
            disabled={saving}
            className="btn w-full"
            style={{
              background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)',
              color: '#fff', borderRadius: '12px', border: 'none', height: '48px', fontSize: '15px',
            }}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : '开始对话'}
          </button>
        </>
      ) : (
        /* ── 自定义配置：编排 + Prompt 设计 + 已保存配置 ── */
        <div className="space-y-6">
          {/* 1. 编排入口 */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => navigate(`/v3/personal/${projectId}/orchestra`)}
              className="flex flex-col items-center justify-center gap-2 p-5 rounded-xl border border-[#e0e4e8] bg-white hover:border-[#4f8cff] hover:shadow-sm transition-all min-h-[120px]"
            >
              <div className="w-10 h-10 rounded-xl bg-[#f0f4ff] flex items-center justify-center">
                <GitBranch size={22} className="text-[#4f8cff]" />
              </div>
              <div className="text-sm font-medium text-[#1d1d1f]">编排流水线</div>
              <div className="text-[10px] text-[#81858c] text-center">拖拽连线设计 Agent 工作流</div>
            </button>
            <button
              onClick={() => navigate(`/v3/personal/${projectId}/config-builder`)}
              className="flex flex-col items-center justify-center gap-2 p-5 rounded-xl border-2 border-dashed border-[#e0e4e8] bg-white hover:border-[#4f8cff] hover:bg-[#f0f4ff]/20 transition-all min-h-[120px]"
            >
              <div className="w-10 h-10 rounded-xl bg-[#f9fafb] flex items-center justify-center">
                <Plus size={22} className="text-[#9ca3af]" />
              </div>
              <div className="text-sm font-medium text-[#1d1d1f]">创建新配置</div>
              <div className="text-[10px] text-[#81858c] text-center">保存 Agent 组合与管道</div>
            </button>
          </div>

          {/* 2. Prompt 设计器 */}
          <div className="p-4 rounded-xl border border-[#e0e4e8] bg-white">
            <div className="flex items-center gap-2 mb-1">
              <Braces size={16} className="text-[#4f8cff]" />
              <span className="text-sm font-semibold text-[#1d1d1f]">System Prompt</span>
              <span className="text-[10px] text-[#b0b8c1] ml-1">为每个 Agent 自定义提示词</span>
            </div>
            <PromptEditor projectId={projectId} />
          </div>

          {/* 3. 已保存配置 */}
          <div>
            <p className="text-xs text-[#81858c] mb-2">已保存的智能体配置</p>
            <div className="space-y-1.5">
              {savedConfigs.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-5 rounded-xl border border-[#e0e4e8] bg-white">
                  <p className="text-xs text-[#b0b8c1]">暂无保存的配置</p>
                  <p className="text-[10px] text-[#d0d4d8] mt-0.5">创建新配置或保存编排后出现</p>
                </div>
              ) : (
                savedConfigs.map((cfg, i) => {
                  if (editingIdx === i) {
                    return (
                      <div key={i} className="flex items-center gap-2 p-2 rounded-xl border border-[#4f8cff] bg-[#f0f4ff]">
                        <input
                          className="input input-sm flex-1 text-xs"
                          style={{ borderRadius: '8px', borderColor: '#e0e4e8', height: '34px' }}
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleRenameSave(); if (e.key === 'Escape') setEditingIdx(null); }}
                          autoFocus
                        />
                        <button onClick={handleRenameSave} className="p-1.5 rounded-md text-[#10b981] hover:bg-[#10b981]/10">
                          <CheckCheck size={14} />
                        </button>
                        <button onClick={() => setEditingIdx(null)} className="p-1.5 rounded-md text-[#b0b8c1] hover:bg-gray-100">
                          <X size={14} />
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div key={i}
                      className="flex items-center gap-3 w-full p-3 rounded-xl border border-[#e0e4e8] bg-white hover:border-[#4f8cff] hover:shadow-sm transition-all text-left group">
                      <button onClick={() => handleUseConfig(cfg)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                        <div className="w-8 h-8 rounded-lg bg-[#f0f4ff] flex items-center justify-center shrink-0">
                          <FolderKanban size={16} className="text-[#4f8cff]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[#1d1d1f] truncate">{cfg.name}</div>
                          <div className="text-[10px] text-[#81858c]">{cfg.agents.length} Agent</div>
                        </div>
                      </button>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button onClick={e => { e.stopPropagation(); handleRenameStart(i); }}
                          className="p-1 rounded-md text-[#81858c] hover:text-[#4f8cff] hover:bg-[#f0f4ff]">
                          <Pencil size={12} />
                        </button>
                        <button onClick={e => { e.stopPropagation(); handlePublish(i); }}
                          className={`p-1 rounded-md ${cfg.is_public ? 'text-[#10b981] hover:bg-[#10b981]/10' : 'text-[#81858c] hover:text-[#f59e0b] hover:bg-amber-50'}`}
                          title={cfg.is_public ? '已发布' : '发布到市场'}>
                          {cfg.is_public ? '🌐' : '📤'}
                        </button>
                        <button onClick={e => { e.stopPropagation(); handleDelete(i); }}
                          className="p-1 rounded-md text-[#81858c] hover:text-[#ef4444] hover:bg-red-50">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 底部：直接开始对话 */}
          <button
            onClick={async () => {
              if (!projectId) return;
              try {
                const localPrompts = loadCustomPrompts(projectId);
                const payload: any = { enabled_agents: ALL_AGENTS.map(a => a.key) };
                if (Object.keys(localPrompts).length > 0) payload.prompts = localPrompts;
                await projectsApi.updateAgentConfig(projectId, payload);
              } catch { /* 已有配置则忽略 */ }
              navigate(`/v3/personal/${projectId}/chat`, { replace: true });
            }}
            className="btn w-full"
            style={{
              background: '#fff',
              color: '#4f8cff',
              borderRadius: '12px',
              border: '1.5px solid #4f8cff',
              height: '44px',
              fontSize: '14px',
            }}
          >
            直接开始对话
          </button>
        </div>
      )}
    </div>
  );
}
