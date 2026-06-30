import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userApi } from '@/api/user';
import { useAuthStore } from '@/stores/authStore';
import { Eye, EyeOff, Save, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const AVATAR_COLORS = ['#4f8cff', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#6366f1'];

function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const TABS = [
  { id: 'account', label: '账号', icon: '🧑' },
  { id: 'model', label: '模型', icon: '🤖' },
  { id: 'agent-design', label: '智能体', icon: '🧠' },
  { id: 'roles', label: '角色映射', icon: '🔗' },
];

const ROLES = ['Planner', 'Retriever', 'Coder', 'Writer', 'Executor', 'Tester', 'Summarizer', 'Bot'];

const AGENTS_DESIGN = [
  { key: 'Planner', icon: '🧋', label: 'Planner', desc: '任务规划' },
  { key: 'Retriever', icon: '🐍', label: 'Retriever', desc: '知识检索' },
  { key: 'Coder', icon: '🫻', label: 'Coder', desc: '编写代码' },
  { key: 'Writer', icon: '✍️', label: 'Writer', desc: '撰写文档' },
  { key: 'Tester', icon: '✅', label: 'Tester', desc: 'QA审阅' },
  { key: 'Summarizer', icon: '🧊', label: 'Summarizer', desc: '生成报告' },
  { key: 'Bot', icon: '🤖', label: 'Bot', desc: '快捷问答' },
  { key: 'Executor', icon: '⚙️', label: 'Executor', desc: '执行代码' },
];

const DEFAULT_PROMPTS: Record<string, string> = {
  Planner: '你是高级项目经理。根据用户需求制定详细的执行计划。\n用编号列表列出执行步骤，每步含：目标、技术/工具、预期输出。\n最后一行必须是 \'task_type: coding\' 或 \'task_type: writing\' 或 \'task_type: analysis\'，表示任务类型。\n\n注意：执行环境仅支持 Python。如用户要求 C/Java/Rust 等语言，只规划到「编写代码片段」这一步，编译/运行由用户自行完成，task_type 标为 coding。\n如用户提问涉及最新资讯/实时信息/当前事件，首先使用 web_search 工具搜索获取最新数据。\n分析类任务（数据分析/CSV/Excel/统计/图表）→ task_type: analysis。',
  Bot: '你是友好的 AI 助手。用简洁、自然的中文直接回答用户。\n闲聊时友善亲切；问答时准确清晰，不啰嗦。\n如果用户问及最新资讯、实时新闻、当前事件或你不确定的信息，使用 web_search 工具搜索后回答。\n如果是简单的编程问题（如「Hello World」「怎么写冒泡排序」），直接给出代码片段和简要说明，不要说「我帮你规划」之类的话。\n如果是知识性问题，直接给出准确简明的解释。\n绝对不要暴露任何内部角色名（Planner/Coder 等）。你就是普通助手。',
  Retriever: '你是知识检索专家。你的**唯一职责**是从知识库中查找与任务相关的信息。\n使用 search_knowledge 工具查询知识库。\n\n铁律：\n- 你只能调用 search_knowledge，不得编写代码、不得写文件。\n- 如果搜索结果与当前任务完全不相关，必须明确回复「知识库中无相关内容，请使用自身知识完成任务」。\n- 如果找到相关信息，总结要点后交给下游角色处理。\n- 不要把检索结果原文全部贴出来——只贴最相关的 1-2 条摘要。',
  Coder: '你是 Python 程序员（仅 Python）。你的核心职责是：**编写并执行代码**。\n\n1. 用 ```python ... ``` 代码块编写可直接执行的 Python 代码。\n2. 代码必须包含 print() 输出关键结果，用 assert 做验证。\n3. 如需要保存文件（图表/报告），使用 write_file 工具。\n4. 不要在代码块里写「建议」「如果」「可以」——给出确定的可执行代码。\n\n能力边界：你只能写 Python。如用户要 C/Java/Go 等语言，只提供代码片段 + 注释说明，末尾标注「需用户手动编译运行」。',
  Writer: '你是专业文档撰写专家。根据 Planner 的计划和 Retriever 提供的资料撰写内容。\n使用 Markdown 格式输出，适当使用表格和列表。',
  Executor: '你是代码执行专家。负责运行 Python 代码并返回执行结果。',
  Tester: '你是高级 QA 评审工程师。审查下游输出是否满足用户的原始需求。\n\n核心原则：以「用户最初要什么」为标准，不以外观/格式为转移。\n对于代码：审查逻辑正确性、边界条件、实际可运行。\n对于报告/文章：审查内容是否真正回答了用户的问题。\n\n如果发现偏离用户原始需求，回复以 \'❌ 发现以下问题\' 开头。\n如果完全满足用户要求，回复以 \'✅ 评审全部通过\' 开头。',
  Summarizer: '你是技术文档专家。汇总整个执行过程，生成简洁报告。\n\n原则：输出长度与任务体量成正比。\n简单任务（HelloWorld/示例）→ 2-3 段即可，不要过度结构化。\n复杂任务（完整项目/数据分析）→ 可用节/表/代码块详细展开。\n报告包含：任务概述、关键产出、评审结论。使用 Markdown。',
};

export function SettingsModal({ initialTab }: { initialTab?: string }) {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(initialTab || 'account');

  // ── 账号 ──
  const [editName, setEditName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editBio, setEditBio] = useState('');

  // ── 模型 ──
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [customForm, setCustomForm] = useState({ key: '', model: '', base_url: '', api_key: '' });
  const [showForm, setShowForm] = useState(false);

  // ── 角色映射 ──
  const [roleModels, setRoleModels] = useState<Record<string, string>>({});

  // ── 查询 ──
  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const res = await userApi.getProfile();
      setEditName(res.data.user_name);
      setEditEmail(res.data.email || '');
      setEditBio(res.data.bio || '');
      return res.data;
    },
  });

  const { data: keyStatus } = useQuery({
    queryKey: ['api-key-status'],
    queryFn: async () => { const res = await userApi.getApiKeyStatus(); return res.data; },
  });

  const { data: config } = useQuery({
    queryKey: ['user-config'],
    queryFn: async () => { const res = await userApi.getConfig(); return res.data; },
  });

  useEffect(() => { if (config?.roles) setRoleModels({ ...config.roles }); }, [config?.roles]);

  const systemModels = Array.isArray(config?.system_models) ? config.system_models : [];
  const customModels = Array.isArray(config?.models) ? config.models : [];
  const modelKeys = systemModels.map((m: any) => m.key).filter(Boolean);
  const customKeys = customModels.map((m: any) => m.key).filter(Boolean);
  const allModels = [...new Set([...modelKeys, ...customKeys])];

  // ── mutations ──
  const profileMutation = useMutation({
    mutationFn: async () => {
      if (editEmail && !editEmail.includes('@')) {
        toast.error('邮箱格式不正确（需包含 @）');
        throw new Error('邮箱格式不正确');
      }
      const data: Record<string, string> = {};
      if (editName && editName !== user?.user_name) data.name = editName;
      if (editPassword) data.password = editPassword;
      if (editEmail !== (profile?.email || '')) data.email = editEmail;
      if (editBio !== (profile?.bio || '')) data.bio = editBio;
      if (Object.keys(data).length === 0) throw new Error('无变更');
      await userApi.updateProfile(data);
    },
    onSuccess: () => { toast.success('已更新'); setEditPassword(''); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '更新失败';
      if (msg !== '无变更') toast.error(msg);
    },
  });

  const saveKeyMutation = useMutation({
    mutationFn: async (key: string) => { await userApi.saveApiKey(key); },
    onSuccess: () => { toast.success('API Key 已保存'); setApiKey(''); },
    onError: (err: unknown) => toast.error((err as any)?.response?.data?.error || '保存失败'),
  });

  const deleteKeyMutation = useMutation({
    mutationFn: () => userApi.deleteApiKey(),
    onSuccess: () => toast.success('已恢复系统默认'),
  });

  return (
    <div className="flex h-full">
      {/* 左侧选项卡 */}
      <div className="w-36 shrink-0 border-r border-[#eceef2] p-2 space-y-0.5 overflow-y-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-left transition-colors ${
              tab === t.id ? 'bg-[#4f8cff]/8 text-[#4f8cff] font-medium' : 'text-[#81858c] hover:bg-gray-50'
            }`}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* 右侧内容 */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">

        {/* ═══ 账号 ═══ */}
        {tab === 'account' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[#1d1d1f]">账号</h3>

            <div className="flex gap-4">
              <div style={{
                width: 64, height: 64, borderRadius: '50%',
                background: avatarColor(profile?.avatar_seed || profile?.user_id || ''),
                color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 27, fontWeight: 700,
                userSelect: 'none', flexShrink: 0,
              }}>{(profile?.user_name || '?').charAt(0).toUpperCase()}</div>

              <div className="flex-1 space-y-2.5">
                <div>
                  <label className="text-[10px] text-[#81858c] block mb-0.5">用户名</label>
                  <input className="input input-bordered w-full text-xs"
                    style={{ borderRadius: '8px', borderColor: '#e0e4e8' }}
                    value={editName} onChange={e => setEditName(e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] text-[#81858c] block mb-0.5">邮箱</label>
                  <input className="input input-bordered w-full text-xs"
                    style={{ borderRadius: '8px', borderColor: '#e0e4e8' }}
                    value={editEmail} onChange={e => setEditEmail(e.target.value)}
                    placeholder="example@mail.com" />
                </div>
                <div>
                  <label className="text-[10px] text-[#81858c] block mb-0.5">个人简介</label>
                  <input className="input input-bordered w-full text-xs"
                    style={{ borderRadius: '8px', borderColor: '#e0e4e8' }}
                    value={editBio} onChange={e => setEditBio(e.target.value)}
                    placeholder="介绍一下自己..." />
                </div>
                <div>
                  <label className="text-[10px] text-[#81858c] block mb-0.5">新密码（留空不修改）</label>
                  <input type="password" className="input input-bordered w-full text-xs"
                    style={{ borderRadius: '8px', borderColor: '#e0e4e8' }}
                    value={editPassword} onChange={e => setEditPassword(e.target.value)}
                    placeholder="至少 6 位" />
                </div>
              </div>
            </div>

            <div className="flex gap-4 text-[10px] text-[#9ca3af]">
              <span>用户 ID: {profile?.user_id ?? ''}</span>
              <span>注册时间: {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('zh-CN') : ''}</span>
            </div>

            <button className="btn btn-xs" disabled={profileMutation.isPending} onClick={() => profileMutation.mutate()}
              style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '8px', border: 'none' }}>保存</button>
          </div>
        )}

        {/* ═══ 模型（系统模型 + API Key + 自定义模型）═══ */}
        {tab === 'model' && (
          <div className="space-y-5">
            {/* 系统默认模型 */}
            <div>
              <h3 className="text-sm font-semibold text-[#1d1d1f] mb-2">系统默认模型</h3>
              {systemModels.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-[#f9fafb] rounded-lg">
                    <div className="text-[9px] text-[#81858c]">模型</div>
                    <div className="text-xs font-medium text-[#1d1d1f]">{systemModels[0]?.model || '—'}</div>
                  </div>
                  <div className="p-2 bg-[#f9fafb] rounded-lg">
                    <div className="text-[9px] text-[#81858c]">接口</div>
                    <div className="text-xs font-medium text-[#1d1d1f] truncate">{systemModels[0]?.base_url || '—'}</div>
                  </div>
                </div>
              ) : <p className="text-xs text-[#b0b8c1]">加载中...</p>}
            </div>

            {/* API Key */}
            <div>
              <h3 className="text-sm font-semibold text-[#1d1d1f] mb-2">API Key</h3>
              <p className="text-[10px] text-[#81858c] mb-2">
                {keyStatus?.has_custom_key
                  ? <span className="badge badge-primary badge-xs">使用自定义 Key</span>
                  : <span className="badge badge-ghost badge-xs">系统默认</span>}
              </p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input type={showKey ? 'text' : 'password'} className="input input-bordered w-full pr-8 text-xs" style={{ borderRadius: '8px', borderColor: '#e0e4e8' }}
                    value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." />
                  <button onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#9ca3af]">
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                </div>
                <button className="btn btn-xs" disabled={!apiKey.trim() || saveKeyMutation.isPending} onClick={() => saveKeyMutation.mutate(apiKey)}
                  style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '8px', border: 'none' }}>保存</button>
              </div>
              {keyStatus?.has_custom_key && (
                <button className="btn btn-xs btn-ghost text-[#ef4444] mt-2" onClick={() => deleteKeyMutation.mutate()}>
                  <Trash2 size={12} /> 删除自定义 Key
                </button>
              )}
            </div>

            {/* 自定义模型 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-[#1d1d1f]">自定义模型</h3>
                <button className="btn btn-xs btn-ghost text-[#4f8cff]" onClick={() => setShowForm(!showForm)}>
                  <Plus size={12} /> {showForm ? '收起' : '添加'}
                </button>
              </div>
              {showForm && (
                <div className="space-y-2 p-3 bg-[#f9fafb] rounded-xl mb-3">
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input input-bordered input-xs text-xs" placeholder="标识" style={{ borderRadius: '6px', borderColor: '#e0e4e8' }}
                      value={customForm.key} onChange={e => setCustomForm(p => ({ ...p, key: e.target.value }))} />
                    <input className="input input-bordered input-xs text-xs" placeholder="模型名" style={{ borderRadius: '6px', borderColor: '#e0e4e8' }}
                      value={customForm.model} onChange={e => setCustomForm(p => ({ ...p, model: e.target.value }))} />
                    <input className="input input-bordered input-xs text-xs" placeholder="Base URL" style={{ borderRadius: '6px', borderColor: '#e0e4e8' }}
                      value={customForm.base_url} onChange={e => setCustomForm(p => ({ ...p, base_url: e.target.value }))} />
                    <input className="input input-bordered input-xs text-xs" placeholder="API Key" type="password" style={{ borderRadius: '6px', borderColor: '#e0e4e8' }}
                      value={customForm.api_key} onChange={e => setCustomForm(p => ({ ...p, api_key: e.target.value }))} />
                  </div>
                  <button className="btn btn-xs" disabled={!customForm.key || !customForm.model || !customForm.api_key}
                    onClick={() => {
                      userApi.addCustomModel(customForm).then(() => { toast.success('已添加'); setCustomForm({ key: '', model: '', base_url: '', api_key: '' }); setShowForm(false); })
                        .catch((err: any) => toast.error(err?.response?.data?.error || '添加失败'));
                    }}
                    style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '6px', border: 'none' }}>添加</button>
                </div>
              )}
              {customModels.length > 0 && (
                <div className="space-y-1">
                  {customModels.map((m: any) => (
                    <div key={m.key} className="flex items-center gap-2 text-xs p-2 bg-[#f9fafb] rounded-lg">
                      <span className="font-medium text-[#1d1d1f] w-16 truncate">{m.key}</span>
                      <span className="text-[#81858c] truncate flex-1">{m.model}</span>
                      <button className="text-[#ef4444]" onClick={() => userApi.deleteCustomModel(m.key).then(() => toast.success('已删除')).catch(() => toast.error('删除失败'))}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ 智能体设计 ═══ */}
        {tab === 'agent-design' && <AgentDesignTab />}

        {/* ═══ 角色映射 ═══ */}
        {tab === 'roles' && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[#1d1d1f]">角色模型映射</h3>
            <p className="text-[10px] text-[#81858c]">为每个 Agent 选择不同模型</p>
            <div className="space-y-1.5">
              {ROLES.map(role => (
                <div key={role} className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[#1d1d1f] w-16 shrink-0">{role}</span>
                  <select className="select select-bordered select-xs w-full text-xs" style={{ borderRadius: '6px', borderColor: '#e0e4e8' }}
                    value={roleModels[role] || (config?.roles?.[role] || '')}
                    onChange={e => setRoleModels(p => ({ ...p, [role]: e.target.value }))}>
                    <option value="">系统默认</option>
                    {allModels.map((mk: string) => <option key={mk} value={mk}>{mk}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

/* ─── 智能体设计内嵌标签 ─── */
const PROMPT_STORAGE_KEY = 'custom_prompts';

function loadCustomPrompts(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(PROMPT_STORAGE_KEY) || '{}'); } catch { return {}; }
}

function saveCustomPrompts(prompts: Record<string, string>) {
  localStorage.setItem(PROMPT_STORAGE_KEY, JSON.stringify(prompts));
}

function AgentDesignTab() {
  const [selectedAgent, setSelectedAgent] = useState('Planner');
  const [editPrompt, setEditPrompt] = useState('');

  // 切换 Agent 时从 localStorage 加载已保存的自定义 Prompt
  useEffect(() => {
    const saved = loadCustomPrompts();
    setEditPrompt(saved[selectedAgent] || '');
  }, [selectedAgent]);

  const hasCustom = editPrompt !== '';

  const handleSave = () => {
    const prompts = loadCustomPrompts();
    if (editPrompt) {
      prompts[selectedAgent] = editPrompt;
    } else {
      delete prompts[selectedAgent];
    }
    saveCustomPrompts(prompts);
    toast.success(`「${selectedAgent}」Prompt 已保存`);
  };

  const handleReset = () => {
    setEditPrompt('');
    const prompts = loadCustomPrompts();
    if (selectedAgent in prompts) {
      delete prompts[selectedAgent];
      saveCustomPrompts(prompts);
    }
    toast.success(`${selectedAgent} 已恢复默认`);
  };

  return (
    <div className="flex flex-col h-full">
      <h3 className="text-sm font-semibold text-[#1d1d1f] mb-3">自定义 System Prompt</h3>
      {/* Agent 选择行 */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {AGENTS_DESIGN.map(({ key, icon, label }) => (
          <button key={key} onClick={() => setSelectedAgent(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
              selectedAgent === key
                ? 'bg-[#4f8cff]/8 text-[#4f8cff] font-medium border border-[#4f8cff]/20'
                : 'text-[#81858c] hover:bg-[#f3f4f6] border border-transparent'
            }`}>
            <span className="text-sm">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>
      {/* 提示编辑区 */}
      <div className="flex-1 min-h-0">
        <div className="flex items-center justify-between mb-1">
          {hasCustom && (
            <span className="text-[10px] text-[#4f8cff]">已自定义 · 清空并保存可恢复默认</span>
          )}
        </div>
        <textarea
          className="textarea textarea-bordered w-full font-mono text-xs leading-relaxed resize-none"
          style={{ borderRadius: '10px', borderColor: '#e0e4e8', height: '280px' }}
          value={editPrompt ?? ''}
          onChange={(e) => setEditPrompt(e.target.value)}
          placeholder={DEFAULT_PROMPTS[selectedAgent]}
        />
        <div className="flex justify-end gap-2 mt-2">
          <button className="btn btn-ghost btn-xs" style={{ borderRadius: '8px' }} onClick={handleReset}>恢复默认</button>
          <button className="btn btn-xs" onClick={handleSave}
            style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '8px', border: 'none' }}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
