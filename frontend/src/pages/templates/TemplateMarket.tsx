import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { workspacesApi } from '@/api/workspaces';
import { projectsApi } from '@/api/projects';
import { TEMPLATES, type Template } from '@/data/templates';
import { DEFAULT_PIPELINE } from '@/pages/project/OrchestrationPage';
import { toast } from 'sonner';

export function TemplateMarket() {
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [projectName, setProjectName] = useState('');
  const [creating, setCreating] = useState(false);

  // 获取或自动创建工作空间
  const createWsMutation = useMutation({
    mutationFn: () => workspacesApi.create({ name: '我的工作空间', description: '自动创建' }),
  });

  const openDialog = (template: Template) => {
    setSelectedTemplate(template);
    setProjectName(template.name);
    dialogRef.current?.showModal();
  };

  const handleCreate = async () => {
    if (!projectName.trim() || !selectedTemplate) return;
    setCreating(true);
    try {
      // 1. Get or create workspace
      const wsRes = await workspacesApi.list();
      let wsId = wsRes.data?.[0]?.id;
      if (!wsId) {
        const created = await workspacesApi.create({ name: '我的工作空间', description: '自动创建' });
        wsId = created.data.id;
      }

      // 2. Create project
      const projectRes = await projectsApi.create(wsId, {
        name: projectName.trim(),
        description: selectedTemplate.description,
      });
      const projectId = projectRes.data.id;

      // 3. Update agent config with template presets
      const newPipeline = {
        nodes: DEFAULT_PIPELINE.nodes.filter(n => {
          if (n.type === 'agent' && n.data.agent) {
            return selectedTemplate.agentConfig.includes(n.data.agent);
          }
          return true;
        }),
        edges: DEFAULT_PIPELINE.edges
      };
      await projectsApi.updateAgentConfig(projectId, newPipeline);

      toast.success('项目创建成功');
      dialogRef.current?.close();

      // 4. Navigate to chat
      navigate(`/v3/personal/${projectId}/chat`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        '创建失败';
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1d1d1f]">模板市场</h1>
        <p className="text-[#81858c] text-sm mt-1">浏览预置场景模板，一键创建项目</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TEMPLATES.map((template) => (
          <button
            key={template.id}
            className="card bg-base-100 border border-[#e0e4e8] shadow-sm hover:border-[#4f8cff] hover:shadow-md transition-all text-left cursor-pointer"
            style={{ borderRadius: '12px' }}
            onClick={() => openDialog(template)}
          >
            <div className="card-body p-5">
              <div className="text-3xl mb-2">{template.icon}</div>
              <h3 className="card-title text-[#1d1d1f] text-base">{template.name}</h3>
              <p className="text-sm text-[#81858c]">{template.description}</p>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {template.agentConfig.map((agent) => (
                  <span key={agent} className="badge bg-[#4f8cff]/8 text-[#4f8cff] border-0 text-xs">{agent}</span>
                ))}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* 创建项目弹窗 */}
      <dialog ref={dialogRef} className="modal">
        <div className="modal-box" style={{ borderRadius: '16px', padding: 0, overflow: 'hidden' }}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <h3 className="text-base font-semibold text-[#1d1d1f]">从模板创建项目</h3>
            <form method="dialog">
              <button className="w-7 h-7 rounded-full border-none bg-transparent text-[#9ca3af] cursor-pointer flex items-center justify-center text-sm hover:bg-[#f3f4f6] hover:text-[#4b5563]">✕</button>
            </form>
          </div>

          <div className="p-5 space-y-4">
            {selectedTemplate && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[#f3f4f6]">
                <span className="text-2xl">{selectedTemplate.icon}</span>
                <div>
                  <div className="text-sm font-medium text-[#1d1d1f]">{selectedTemplate.name}</div>
                  <div className="text-xs text-[#81858c]">{selectedTemplate.description}</div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium mb-1 text-[#81858c]">项目名称</label>
              <input className="input input-bordered w-full" style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                placeholder="输入项目名称" value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
            </div>
          </div>

          <div className="flex justify-end gap-2 px-5 pb-5">
            <form method="dialog">
              <button className="btn btn-ghost btn-sm" style={{ borderRadius: '10px' }}>取消</button>
            </form>
            <button className="btn btn-sm" disabled={creating || !projectName.trim()} onClick={handleCreate}
              style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '10px', border: 'none' }}>
              {creating ? <span className="loading loading-spinner loading-sm" /> : null}创建项目
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop"><button>close</button></form>
      </dialog>
    </div>
  );
}
