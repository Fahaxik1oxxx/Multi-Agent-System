import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, GitBranch, Save, ArrowLeft } from 'lucide-react';
import { PageModal } from '@/components/shared/PageModal';
import { OrchestrationPage } from '@/pages/project/OrchestrationPage';
import { toast } from 'sonner';
import { ALL_AGENTS } from '@/data/agents';
import { configsApi } from '@/api/projects';

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

  const handleSave = async () => {
    if (!name.trim()) { toast.error('请输入配置名称'); return; }
    if (enabled.length === 0) { toast.error('请至少选择一个 Agent'); return; }
    try {
      await configsApi.create({ name: name.trim(), agents: enabled, project_id: projectId });
      toast.success('配置已保存');
      navigate(`/v3/personal/${projectId}/agents`, { state: { tab: 'custom' } });
    } catch { toast.error('保存失败'); }
  };

  const goBack = () => navigate(`/v3/personal/${projectId}/agents`, { state: { tab: 'custom' } });

  return (
    <div className="flex flex-col h-full" style={{ background: '#fafbfc' }}>
      {/* Top toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-[#eceef2] shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={goBack}
            className="flex items-center gap-1 px-2 py-1 -ml-2 rounded-md text-[#4f8cff] hover:bg-[#4f8cff]/8 transition-colors text-xs">
            <ArrowLeft size={13} /> 返回
          </button>
        </div>
        <span className="text-sm font-semibold text-[#1d1d1f]">创建新配置</span>
        <div className="w-20" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
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
    </div>
  );
}
