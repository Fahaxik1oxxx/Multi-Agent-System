import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, GitBranch, Save, Maximize2 } from 'lucide-react';
import { PageModal } from '@/components/shared/PageModal';
import { OrchestrationPage } from '@/pages/project/OrchestrationPage';
import { toast } from 'sonner';

const ALL_AGENTS = [
  { key: 'Planner', icon: '🧋', label: 'Planner', desc: '任务规划', color: '#4f8cff' },
  { key: 'Retriever', icon: '🐍', label: 'Retriever', desc: '知识库检索', color: '#8b5cf6' },
  { key: 'Coder', icon: '🫻', label: 'Coder', desc: '编写代码', color: '#10b981' },
  { key: 'Writer', icon: '✍️', label: 'Writer', desc: '撰写文档', color: '#f59e0b' },
  { key: 'Executor', icon: '⚙️', label: 'Executor', desc: '执行代码', color: '#8b5cf6' },
  { key: 'Tester', icon: '✅', label: 'Tester', desc: 'QA 审阅', color: '#ef4444' },
  { key: 'Summarizer', icon: '🧊', label: 'Summarizer', desc: '生成报告', color: '#4f8cff' },
  { key: 'Bot', icon: '🤖', label: 'Bot', desc: '快捷问答', color: '#10b981' },
];

export function ConfigBuilderPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState<string[]>(ALL_AGENTS.map(a => a.key));
  const [orchestraOpen, setOrchestraOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOrchestraOpen(false);
    window.addEventListener('orchestra-saved', handler);
    return () => window.removeEventListener('orchestra-saved', handler);
  }, []);

  const handleSave = () => {
    if (!name.trim()) { toast.error('请输入配置名称'); return; }
    if (enabled.length === 0) { toast.error('请至少选择一个 Agent'); return; }
    try {
      const key = `v3_configs_${projectId}`;
      const existing = JSON.parse(localStorage.getItem(key) || '[]');
      existing.push({ name: name.trim(), agents: enabled });
      localStorage.setItem(key, JSON.stringify(existing));
      toast.success('配置已保存');
      navigate(`/v3/personal/${projectId}/agents`, { state: { tab: 'advanced' } });
    } catch { toast.error('保存失败'); }
  };

  return (
    <div>
      <h1 className="text-xl font-bold text-[#1d1d1f] mb-1">创建新配置</h1>
      <p className="text-sm text-[#81858c] mb-6">选择 Agent 并编排流程</p>

      <div className="mb-4">
        <label className="block text-xs font-medium text-[#81858c] mb-1">配置名称</label>
        <input className="input input-bordered w-full text-sm" style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
          placeholder="例如：代码审查配置" value={name} onChange={e => setName(e.target.value)} />
      </div>

      <div className="mb-4">
        <p className="text-xs text-[#81858c] mb-2">选择智能体</p>
        <div className="space-y-1">
          {ALL_AGENTS.map(({ key, icon, label, desc, color }) => {
            const isOn = enabled.includes(key);
            return (
              <div key={key} onClick={() => setEnabled(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border cursor-pointer transition-all ${
                  isOn ? 'border-[#4f8cff] bg-[#f0f4ff]' : 'border-[#e0e4e8] bg-white'
                }`}>
                <span className="text-base">{icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[#1d1d1f]">{label}</div>
                  <div className="text-xs text-[#81858c]">{desc}</div>
                </div>
                <input type="checkbox" className="toggle toggle-sm" style={{ '--tglbg': isOn ? color : '#d0d4d8' } as React.CSSProperties}
                  checked={isOn} onChange={() => {}} onClick={e => e.stopPropagation()} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mb-6">
        <p className="text-xs text-[#81858c] mb-2">流水线编排（可选）</p>
        <button onClick={() => setOrchestraOpen(true)}
          className="flex items-center gap-3 w-full p-3 rounded-xl border border-[#e0e4e8] bg-white hover:border-[#4f8cff] transition-all text-left">
          <div className="w-8 h-8 rounded-lg bg-[#f0f4ff] flex items-center justify-center"><GitBranch size={16} className="text-[#4f8cff]" /></div>
          <div>
            <div className="text-sm font-medium text-[#1d1d1f]">打开编排画布 <span className="text-[#4f8cff]">浮窗</span></div>
            <div className="text-[10px] text-[#81858c]">拖拽连线设计 Agent 执行顺序</div>
          </div>
        </button>
      </div>

      {/* 编排浮窗 */}
      <PageModal open={orchestraOpen} onClose={() => setOrchestraOpen(false)} title="🗺️ 编排画布" width="90vw">
        {projectId && <OrchestrationPage />}
      </PageModal>

      <button onClick={handleSave} className="btn w-full"
        style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '12px', border: 'none', height: '48px' }}>
        <Save size={16} /> 保存配置
      </button>
    </div>
  );
}
