import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useStreamChat } from '@/hooks/useStreamChat';
import { sessionsApi } from '@/api/sessions';
import { projectsApi } from '@/api/projects';
import { workspacesApi } from '@/api/workspaces';
import { knowledgeApi } from '@/api/knowledge';
import { Markdown } from '@/components/shared/Markdown';
import { PageModal } from '@/components/shared/PageModal';
import { MonitorPage } from '@/pages/project/MonitorPage';
import { OrchestrationPage } from '@/pages/project/OrchestrationPage';
import { generateReportApi } from '@/api/client';
import type { Session } from '@/types/api';
import type { Project } from '@/types/workspace';
import { Search, MessageSquare, Plus, ChevronLeft, ChevronRight, ChevronDown, Check, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

// ── Constants ──
const AGENT_META: Record<string, { icon: string; color: string }> = {
  Planner: { icon: '🧋', color: '#4f8cff' },
  Retriever: { icon: '🐍', color: '#8b5cf6' },
  Coder: { icon: '🫻', color: '#10b981' },
  Writer: { icon: '✍️', color: '#f59e0b' },
  Tester: { icon: '✅', color: '#ef4444' },
  Summarizer: { icon: '🧊', color: '#4f8cff' },
  Bot: { icon: '🤖', color: '#10b981' },
  Executor: { icon: '⚙️', color: '#8b5cf6' },
};

const ICONS: Record<string, string> = {
  Planner: '🧋', Retriever: '🐍', Coder: '🫻', Writer: '✍️',
  Tester: '✅', Summarizer: '🧊', Bot: '🤖', Executor: '⚙️',
};
const COLORS: Record<string, string> = {
  Planner: '#4f8cff', Retriever: '#8b5cf6', Coder: '#10b981',
  Writer: '#f59e0b', Tester: '#ef4444', Summarizer: '#4f8cff',
  Bot: '#10b981', Executor: '#8b5cf6',
};

interface ThinkingEntry { name: string; content: string; }

interface Message {
  role: 'user' | 'assistant';
  content: string;
  thinking?: ThinkingEntry[];
  thinkingOrder?: string[];
  taskType?: string;
  loading?: boolean;
  error?: string;
}

type LaneMode = 'auto' | 'fast' | 'slow';

const PROJECT_SESSIONS_KEY = 'v3_proj_sessions';

/** 获取项目关联的会话 ID 列表 */
function getProjectSessions(projectId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(`${PROJECT_SESSIONS_KEY}_${projectId}`) || '[]');
  } catch { return []; }
}

/** 保存项目关联的会话 ID 列表 */
function saveProjectSessions(projectId: string, ids: string[]) {
  localStorage.setItem(`${PROJECT_SESSIONS_KEY}_${projectId}`, JSON.stringify([...new Set(ids)]));
}

/** 添加一个会话到项目映射 */
function addProjectSession(projectId: string, sessionId: string) {
  const ids = getProjectSessions(projectId);
  if (!ids.includes(sessionId)) {
    ids.push(sessionId);
    saveProjectSessions(projectId, ids);
  }
}

export function V3ChatPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { isGuest } = useAuthStore();
  const { streaming, startStream, abortStream, resetStream } = useStreamChat();

  // ── 消息 ──
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [laneMode, setLaneMode] = useState<LaneMode>('auto');
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  // ── 项目列表与切换 ──
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [projDropdown, setProjDropdown] = useState(false);
  const projDropdownRef = useRef<HTMLDivElement>(null);
  const currentProject = allProjects.find(p => p.id === projectId);

  // 点击外部关闭项目下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (projDropdownRef.current && !projDropdownRef.current.contains(e.target as Node)) {
        setProjDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── 记录项目访问顺序 ──
  useEffect(() => {
    if (!projectId) return;
    try {
      const stored: string[] = JSON.parse(localStorage.getItem('v3_recent_projects') || '[]');
      const updated = [projectId, ...stored.filter(id => id !== projectId)].slice(0, 10);
      localStorage.setItem('v3_recent_projects', JSON.stringify(updated));
    } catch {}
  }, [projectId]);

  // ── 加载项目列表 ──
  useEffect(() => {
    if (isGuest || !projectId) return;
    const loadProjects = async () => {
      try {
        const wsRes = await workspacesApi.list();
        const wsId = wsRes.data?.[0]?.id;
        if (!wsId) return;
        const projRes = await projectsApi.list(wsId);
        setAllProjects(projRes.data || []);
      } catch {}
    };
    loadProjects();
  }, [isGuest, projectId]);

  // ── 项目不存在时重定向 ──
  useEffect(() => {
    if (!projectId || allProjects.length === 0) return;
    const exists = allProjects.some(p => p.id === projectId);
    if (!exists) {
      toast.error('项目已不存在');
      navigate('/v3/personal', { replace: true });
    }
  }, [projectId, allProjects, navigate]);

  // ── 文件 ──
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; status: 'uploading' | 'done' | 'error' }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 报告 ──
  const [reportContent, setReportContent] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);

  // ── 左侧栏 ──
  const [leftOpen, setLeftOpen] = useState(true);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Session[] | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  // ── 右侧栏 ──
  const [rightOpen, setRightOpen] = useState(false);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [orchestraOpen, setOrchestraOpen] = useState(false);
  const [currentThinking, setCurrentThinking] = useState<ThinkingEntry[]>([]);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [enabledAgents, setEnabledAgents] = useState<string[]>(Object.keys(AGENT_META));
  const [selectedThinkingAgent, setSelectedThinkingAgent] = useState<string | null>(null);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeStats, setKnowledgeStats] = useState<{ total_files: number; total_chunks: number } | null>(null);
  const [agentPoolOpen, setAgentPoolOpen] = useState(false);
  const agentPoolRef = useRef<HTMLDivElement>(null);
  const [agentTimings, setAgentTimings] = useState<Record<string, number>>({});
  const agentStartRef = useRef<Record<string, number>>({});

  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sessionIdRef = useRef<string | null>(null);

  // ── 从项目加载 Agent 配置 ──
  useEffect(() => {
    if (!projectId) return;
    projectsApi.getAgentConfig(projectId).then((res) => {
      const config = res.data;
      if (config?.enabled_agents?.length) setEnabledAgents(config.enabled_agents);
    }).catch(() => {});
  }, [projectId]);

  // ── 快速对话：自动恢复上一次会话（如果是从首页跳转过来） ──
  const [sessionLoaded, setSessionLoaded] = useState(false);
  useEffect(() => {
    // 优先从 sessionStorage 加载指定会话（首页点击历史记录）
    const loadSid = sessionStorage.getItem('v3_load_session');
    if (loadSid) {
      sessionStorage.removeItem('v3_load_session');
      sessionsApi.get(loadSid).then((res) => {
        const msgs: Message[] = (res.data.messages || []).map((m: any) => ({
          role: m.role, content: m.content, thinking: m.thinking, taskType: m.taskType,
        }));
        setMessages(msgs);
        setSessionLoaded(true);
      }).catch(() => setSessionLoaded(true));
      return;
    }

    // 没有指定会话时，尝试恢复快速对话的持久会话
    if (projectId) {
      const quickSid = localStorage.getItem(`quick_session_${projectId}`);
      if (quickSid) {
        sessionsApi.get(quickSid).then((res) => {
          const msgs: Message[] = (res.data.messages || []).map((m: any) => ({
            role: m.role, content: m.content, thinking: m.thinking, taskType: m.taskType,
          }));
          if (msgs.length > 0) setMessages(msgs);
          setSessionLoaded(true);
        }).catch(() => {
          localStorage.removeItem(`quick_session_${projectId}`);
          setSessionLoaded(true);
        });
      } else {
        setSessionLoaded(true);
      }
    } else {
      setSessionLoaded(true);
    }
  }, [projectId]);

  // ── 从首页携带消息时自动发送 ──
  const autoSendRef = useRef(false);
  useEffect(() => {
    if (!sessionLoaded || autoSendRef.current) return;
    autoSendRef.current = true;

    const pendingMsg = sessionStorage.getItem('v3_pending_message');
    if (pendingMsg) {
      sessionStorage.removeItem('v3_pending_message');
      // 延迟一帧等消息列表渲染完毕后再发
      setTimeout(() => {
        setInputValue(pendingMsg);
        // handleSend 依赖 inputValue，所以需要下一帧
        setTimeout(() => {
          handleSendRef.current?.(pendingMsg);
        }, 50);
      }, 50);
    }
  }, [sessionLoaded]);

  // ── 会话列表（按项目过滤） ──
  const fetchSessions = useCallback(async () => {
    if (isGuest || !projectId) return;
    try {
      const res = await sessionsApi.list();
      const all = res.data || [];
      const projectSessionIds = getProjectSessions(projectId);
      const filtered = all.filter((s: any) => projectSessionIds.includes(s.id));
      setSessions(filtered);
      setSideSessions(filtered);  // 同步更新侧栏列表
    } catch {}
  }, [isGuest, projectId]);
  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!q.trim()) { setSearchResults(null); return; }
    searchTimerRef.current = setTimeout(async () => {
      try { const res = await sessionsApi.search(q.trim()); setSearchResults(res.data || []); } catch { setSearchResults([]); }
    }, 300);
  }, []);

  const loadSession = useCallback(async (sid: string) => {
    try {
      const res = await sessionsApi.get(sid);
      const msgs: Message[] = (res.data.messages || []).map((m: any) => ({
        role: m.role, content: m.content, thinking: m.thinking, taskType: m.taskType,
      }));
      setMessages(msgs); setEditingIdx(null); setEditValue(''); setInputValue('');
      // 从最后一条 assistant 消息恢复 thinking
      const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant');
      const restoredThinking = lastAssistant?.thinking || [];
      setCurrentThinking(restoredThinking);
      if (restoredThinking.length > 0) {
        setExpandedAgents(new Set(restoredThinking.map(t => t.name)));
        setRightOpen(true);
      }
      setSelectedThinkingAgent(null);
      setAgentTimings({});
    } catch { toast.error('加载会话失败'); }
  }, []);

  const newChat = useCallback(() => {
    setMessages([]); setInputValue(''); setEditingIdx(null); setEditValue('');
    setAttachedFiles([]); sessionIdRef.current = null; setCurrentThinking([]);
    setSelectedThinkingAgent(null); setAgentTimings({}); agentStartRef.current = {};
    resetStream();
  }, [resetStream]);

  // ── 智能滚动 ──
  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (isNearBottom) el.scrollTop = el.scrollHeight;
  }, [messages, streaming.thinking, streaming.reply]);

  // ── 监听来自侧栏的事件 ──
  useEffect(() => {
    const onNewChat = () => { newChat(); fetchSessions(); };
    const onLoadSession = (e: Event) => { const sid = (e as CustomEvent).detail; if (sid) loadSession(sid); };
    window.addEventListener('new-chat', onNewChat);
    window.addEventListener('load-session', onLoadSession);
    return () => {
      window.removeEventListener('new-chat', onNewChat);
      window.removeEventListener('load-session', onLoadSession);
    };
  }, [newChat, loadSession, fetchSessions]);

  // ── 自动保存 ──
  useEffect(() => {
    if (messages.length === 0 || streaming.isStreaming) return;
    const timer = setTimeout(() => {
      const sid = sessionIdRef.current || String(Date.now());
      if (!sessionIdRef.current) sessionIdRef.current = sid;
      sessionsApi.save({
        id: sid,
        title: messages.find(m => m.role === 'user')?.content?.slice(0, 50) || '新对话',
        messages: messages.map(m => ({ role: m.role, content: m.content, ...(m.thinking ? { thinking: m.thinking } : {}) })),
      }).catch(() => {});
      // 记录项目→会话映射
      if (projectId && sid) addProjectSession(projectId, sid);
      window.dispatchEvent(new CustomEvent('session-saved'));
    }, 500);
    return () => clearTimeout(timer);
  }, [messages, streaming.isStreaming, projectId]);

  // ── 发送 ──
  const handleSendRef = useRef<((text?: string) => Promise<void>) | null>(null);
  const handleSend = useCallback(async (text?: string) => {
    const msg = (text ?? inputValue).trim();
    if (!msg || streaming.isStreaming) return;

    const doneFiles = attachedFiles.filter(f => f.status === 'done').map(f => f.name);
    const finalText = doneFiles.length > 0 ? `[附件: ${doneFiles.join(', ')}]\n${msg}` : msg;
    setAttachedFiles([]);

    const userMsg: Message = { role: 'user', content: finalText };
    setMessages(prev => [...prev, userMsg]);
    setInputValue('');

    const assistMsg: Message = { role: 'assistant', content: '', loading: true };
    setMessages(prev => [...prev, assistMsg]);

    setCurrentThinking([]);
    setAgentTimings({}); agentStartRef.current = {};

    try {
      await startStream(finalText, laneMode, projectId, (reply, thinking) => {
        // onComplete callback
      });
    } catch {
      // handled by streaming.error
    }
  }, [inputValue, streaming.isStreaming, laneMode, projectId, attachedFiles, startStream]);
  handleSendRef.current = handleSend;

  // 流式完成后保存会话 ID（快速对话持久化）
  useEffect(() => {
    if (!streaming.isStreaming && streaming.sessionId && projectId) {
      localStorage.setItem(`quick_session_${projectId}`, streaming.sessionId);
    }
  }, [streaming.isStreaming, streaming.sessionId, projectId]);

  // 实时更新右侧栏：流式过程中同步显示 Agent 输出 + 计时
  const prevOrderRef = useRef<string[]>([]);
  useEffect(() => {
    if (streaming.isStreaming && streaming.thinking.size > 0) {
      const order = streaming.thinkingOrder.map(baseName);
      const liveThinking = Array.from(streaming.thinking.entries())
        .map(([key, c]) => ({ name: baseName(key), content: c }));
      if (liveThinking.length > 0) {
        setRightOpen(true);
        setCurrentThinking(liveThinking);
        setExpandedAgents(prev => {
          const next = new Set(prev);
          liveThinking.forEach(t => next.add(t.name));
          return next;
        });
      }
      // 计时：新 Agent 开始时记录，切换时结算上一个
      const now = Date.now();
      const starts = { ...agentStartRef.current };
      const timings = { ...agentTimings };
      const prevOrder = prevOrderRef.current;
      for (let i = 0; i < order.length; i++) {
        const name = order[i];
        if (!starts[name]) {
          starts[name] = now;  // 首次出现 → 开始计时
        }
        // 如果前一个 Agent 和当前不同，结算前一个
        if (i > 0 && order[i - 1] !== name && !timings[order[i - 1]]) {
          timings[order[i - 1]] = now - (starts[order[i - 1]] || now);
        }
      }
      agentStartRef.current = starts;
      if (Object.keys(timings).length > 0) setAgentTimings(timings);
      prevOrderRef.current = order;
    }
  }, [streaming.thinking, streaming.isStreaming, streaming.thinkingOrder]);

  // 流式完成后更新消息 + 结算计时
  const baseName = (key: string) => {
    const idx = key.lastIndexOf('\x00');
    return idx === -1 ? key : key.slice(0, idx);
  };

  // 当选中 agent 时，自动展开其在右侧栏的详情
  const rightPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedThinkingAgent) {
      setExpandedAgents(prev => { const n = new Set(prev); n.add(selectedThinkingAgent); return n; });
      setTimeout(() => {
        const el = rightPanelRef.current?.querySelector(`[data-agent="${selectedThinkingAgent}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  }, [selectedThinkingAgent]);

  // 点击非时间轴节点区域 → 取消选中
  useEffect(() => {
    if (!selectedThinkingAgent) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.timeline-node') && !target.closest('[data-agent]') && !target.closest('.right-panel-bottom')) {
        setSelectedThinkingAgent(null);
      }
    };
    const id = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', handler); };
  }, [selectedThinkingAgent]);

  // Agent 池浮窗点击外部关闭
  useEffect(() => {
    if (!agentPoolOpen) return;
    const handler = (e: MouseEvent) => {
      if (agentPoolRef.current && !agentPoolRef.current.contains(e.target as Node)) {
        setAgentPoolOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [agentPoolOpen]);

  useEffect(() => {
    if (!streaming.isStreaming && (streaming.reply || streaming.error)) {
      // 结算所有 Agent 计时（遍历 thinking keys，不依赖 order）
      const now = Date.now();
      setAgentTimings(prev => {
        const next = { ...prev };
        const allNames = Array.from(streaming.thinking.keys()).map(baseName);
        const uniqueNames = [...new Set(allNames)];
        const starts = agentStartRef.current;
        for (const name of uniqueNames) {
          if (!(name in next) && starts[name]) {
            next[name] = now - starts[name];
          }
        }
        return next;
      });
      agentStartRef.current = {};
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
          const thinking = Array.from(streaming.thinking.entries()).map(([key, c]) => ({ name: baseName(key), content: c }));
          setCurrentThinking(thinking);
          setExpandedAgents(new Set(thinking.map(t => t.name)));
          if (thinking.length > 0) setRightOpen(true);
          updated[lastIdx] = {
            role: 'assistant',
            content: streaming.reply || '',
            thinking,
            thinkingOrder: streaming.thinkingOrder.map(baseName),
            error: streaming.error || undefined,
            loading: false,
          };
        }
        return updated;
      });
    }
  }, [streaming.isStreaming, streaming.reply, streaming.error, streaming.thinking, streaming.thinkingOrder]);

  // 中断修复
  useEffect(() => {
    if (!streaming.isStreaming && messages.length > 0) {
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === 'assistant' && last.loading) {
          updated[updated.length - 1] = {
            ...last,
            content: last.content || streaming.reply || '（已中断）',
            loading: false,
          };
        }
        return updated;
      });
    }
  }, [streaming.isStreaming]);

  const handleFocusThinking = useCallback((thinking: ThinkingEntry[], agentName: string) => {
    setCurrentThinking(thinking);
    setSelectedThinkingAgent(agentName);
    setExpandedAgents(prev => { const n = new Set(prev); n.add(agentName); return n; });
  }, []);

  // ── 重新生成 ──
  const handleRegenerate = useCallback(() => {
    if (streaming.isStreaming) return;
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') { lastAssistantIdx = i; break; }
    }
    if (lastAssistantIdx === -1) return;
    const precedingUser = messages.slice(0, lastAssistantIdx).reverse().find(m => m.role === 'user');
    if (!precedingUser) return;
    const kept = messages.slice(0, lastAssistantIdx);
    setMessages([...kept, precedingUser, { role: 'assistant', content: '', loading: true }]);
    setInputValue('');
    startStream(precedingUser.content, laneMode, projectId).catch(() => {});
  }, [messages, streaming.isStreaming, laneMode, startStream]);

  // ── 报告 ──
  const handleGenerateReport = useCallback(async (thinking?: ThinkingEntry[]) => {
    if (!thinking || thinking.length === 0) { toast.error('无可用的思考记录'); return; }
    if (generatingReport) return;
    setGeneratingReport(true);
    try {
      const result = await generateReportApi(thinking);
      setReportContent(result.content || '报告生成失败');
      setReportOpen(true);
    } catch { toast.error('报告生成失败'); }
    setGeneratingReport(false);
  }, [generatingReport]);

  const downloadReport = useCallback(() => {
    if (!reportContent) return;
    const blob = new Blob([reportContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `report_${Date.now()}.md`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url); setReportContent(null); toast.success('报告已下载');
  }, [reportContent]);

  const submitEdit = useCallback(() => {
    if (!editValue.trim() || editingIdx === null || streaming.isStreaming) return;
    const kept = messages.slice(0, editingIdx);
    const userMsg: Message = { role: 'user', content: editValue.trim() };
    setMessages([...kept, userMsg, { role: 'assistant', content: '', loading: true }]);
    setEditingIdx(null); setEditValue(''); setInputValue('');
    startStream(editValue.trim(), laneMode, projectId).catch(() => {});
  }, [editValue, editingIdx, messages, streaming.isStreaming, laneMode, startStream]);

  // ── 文件上传 ──
  const uploadFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    for (const file of files) {
      const name = file.name;
      setAttachedFiles(prev => [...prev, { name, status: 'uploading' }]);
      try {
        await knowledgeApi.upload(file);
        setAttachedFiles(prev => prev.map(f => f.name === name ? { ...f, status: 'done' } : f));
      } catch {
        setAttachedFiles(prev => prev.map(f => f.name === name ? { ...f, status: 'error' } : f));
        toast.error(`上传失败: ${name}`);
      }
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) { uploadFiles(e.target.files); e.target.value = ''; }
  }, [uploadFiles]);

  // ── 渲染 ──
  const [projectName, setProjectName] = useState('项目');
  const [sideSessions, setSideSessions] = useState<Session[]>([]);
  const [sideSearch, setSideSearch] = useState('');
  const [sideResults, setSideResults] = useState<Session[] | null>(null);
  const sideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sideFiles, setSideFiles] = useState<any[]>([]);
  const sideFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!projectId) return;
    projectsApi.get(projectId).then(r => { if (r.data?.name) setProjectName(r.data.name); }).catch(() => {});
    if (isGuest) return;
    const pid = projectId;
    const stored: string[] = JSON.parse(localStorage.getItem(`v3_proj_sessions_${pid}`) || '[]');
    sessionsApi.list().then(r => {
      const all = r.data || [];
      setSideSessions(all.filter((s: any) => stored.includes(s.id)));
    }).catch(() => {});
    knowledgeApi.listFiles().then(r => setSideFiles(r.data || [])).catch(() => {});
    knowledgeApi.getStats().then(r => setKnowledgeStats(r.data)).catch(() => {});
  }, [isGuest, projectId]);

  const handleSideSearch = (q: string) => {
    setSideSearch(q);
    if (sideTimerRef.current) clearTimeout(sideTimerRef.current);
    if (!q.trim()) { setSideResults(null); return; }
    sideTimerRef.current = setTimeout(async () => {
      try { const res = await sessionsApi.search(q.trim()); setSideResults(res.data || []); } catch { setSideResults([]); }
    }, 300);
  };

  const loadSideSession = (sid: string) => {
    window.dispatchEvent(new CustomEvent('load-session', { detail: sid }));
  };

  const refreshKnowledgeFiles = useCallback(() => {
    knowledgeApi.listFiles().then(r => setSideFiles(r.data || [])).catch(() => {});
    knowledgeApi.getStats().then(r => setKnowledgeStats(r.data)).catch(() => {});
  }, []);

  const displaySessions = sideResults ?? sideSessions;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ═══ 左侧栏（会话+文件） ═══ */}
      <div className={`${leftOpen ? 'w-60' : 'w-0'} shrink-0 overflow-hidden transition-all duration-200 flex flex-col border-r border-[#eceef2]`}
        style={{ background: 'var(--bg-sidebar)', minWidth: leftOpen ? '15rem' : '0' }}>
        {/* 项目标题区 + 收起按钮 */}
        <div className="px-3 pt-3 pb-2 shrink-0">
          <div className="flex items-center gap-2.5">
            <button onClick={() => navigate('/v3')}
              className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#4f8cff] to-[#6c5ce7] flex items-center justify-center text-white text-xs font-bold shadow-sm hover:shadow-md transition-shadow shrink-0"
              title="返回首页">
              <ArrowLeft size={14} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[#1d1d1f] truncate">{projectName}</div>
              <div className="text-[10px] text-[#9ca3af] flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                {messages.length > 0 ? `${messages.length} 条消息` : '新对话'}
              </div>
            </div>
            <button onClick={() => setLeftOpen(false)}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-[#b0b8c1] hover:text-[#4b5563] hover:bg-gray-100 transition-all shrink-0"
              title="收起侧栏">
              <ChevronLeft size={16} />
            </button>
          </div>
        </div>

        {/* 知识库入口 */}
        <div className="px-3 mb-1 shrink-0">
          <button onClick={() => setKnowledgeOpen(true)}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-xl bg-white border border-[#e0e4e8] hover:border-[#4f8cff] hover:shadow-sm transition-all">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#4f8cff]/10 to-[#6c5ce7]/10 flex items-center justify-center text-sm">📚</div>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-xs font-medium text-[#1d1d1f]">知识库</div>
              <div className="text-[10px] text-[#9ca3af]">
                {knowledgeStats ? `${knowledgeStats.total_files} 个文件 · ${knowledgeStats.total_chunks} 个片段` : '加载中...'}
              </div>
            </div>
            <span className="text-[10px] text-[#4f8cff]">管理</span>
          </button>
        </div>
        <div className="divider my-0 mx-3" />

        {/* 新建对话 */}
        <div className="px-3 my-2 shrink-0">
          <button onClick={() => window.dispatchEvent(new CustomEvent('new-chat'))}
            className="new-chat-btn w-full justify-center"><Plus size={14} /><span>新建对话</span></button>
        </div>

        {/* 搜索 */}
        <div className="relative px-3 mb-1 shrink-0">
          <Search size={12} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
          <input className="w-full h-8 rounded-lg border border-[#e0e4e8] bg-white pl-7 pr-2 text-xs outline-none focus:border-[#4f8cff]"
            placeholder="搜索会话..." value={sideSearch} onChange={e => handleSideSearch(e.target.value)} />
        </div>

        {/* 会话列表 */}
        <div className="flex-1 overflow-y-auto px-3 pb-2">
          {displaySessions.length === 0
            ? <p className="text-xs text-[#b0b8c1] text-center mt-6">{sideSearch ? '无匹配' : '暂无历史会话'}</p>
            : displaySessions.map(s => (
              <div key={s.id} className="group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-gray-100"
                onClick={() => loadSideSession(s.id)}>
                <MessageSquare size={12} className="shrink-0 text-[#9ca3af]" />
                <span className="truncate text-xs flex-1 text-[#1d1d1f]">{s.title || '空对话'}</span>
                <span className="text-[10px] text-[#b0b8c1] shrink-0">{s.count}条</span>
                <button onClick={(e) => {
                  e.stopPropagation();
                  const del = async () => {
                    try {
                      await sessionsApi.delete(s.id);
                      const stored: string[] = JSON.parse(localStorage.getItem(`v3_proj_sessions_${projectId}`) || '[]');
                      localStorage.setItem(`v3_proj_sessions_${projectId}`, JSON.stringify(stored.filter(id => id !== s.id)));
                      fetchSessions();
                      if (sessionIdRef.current === s.id) newChat();
                      toast.success('已删除');
                    } catch { toast.error('删除失败'); }
                  };
                  del();
                }}
                  className="text-[#b0b8c1] hover:text-[#ef4444] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  title="删除会话">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/></svg>
                </button>
              </div>
            ))}
        </div>
      </div>
      {!leftOpen && <button onClick={() => setLeftOpen(true)}
        className="flex flex-col items-center justify-center w-8 h-8 mt-2 cursor-pointer text-[#81858c] hover:text-[#4f8cff] hover:bg-[#f0f4ff] border-r border-[#eceef2] bg-white/90 shrink-0 transition-colors rounded-br-lg"
        title="展开侧栏">
        <ChevronRight size={16} />
      </button>}

      {/* ═══ 主聊天区 ═══ */}
      <div className="flex-1 flex flex-col min-w-0" style={{ background: 'var(--bg-chat)' }}>
        {isDragging && <div className="drag-overlay show">释放文件以上传到知识库</div>}

        {/* 无消息 → 居中欢迎+输入框 */}
        {messages.length === 0 && !streaming.isStreaming ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6">
            <div className="w-full max-w-2xl">
              <div className="text-center mb-6">
                <h2 className="text-2xl font-bold text-[#1d1d1f]">多智能体协作系统</h2>
              </div>
              {/* 居中态输入框 */}
              <div className="bg-white rounded-2xl border border-[#e0e4e8] shadow-sm focus-within:border-[#4f8cff] focus-within:shadow-md transition-all">
                <textarea ref={inputRef}
                  className="textarea textarea-ghost w-full resize-none text-base outline-none min-h-[56px] px-5 pt-3"
                  placeholder="给 Multi-Agent 发送任务（编程 / 写作 / 分析 / 问答 / 闲聊）"
                  rows={2}
                  value={inputValue}
                  onChange={e => { setInputValue(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); streaming.isStreaming ? abortStream() : handleSend(); } }}
                />
                <div className="flex items-center justify-between px-4 pb-3">
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full text-[#81858c] hover:bg-[#f0f4ff] hover:text-[#4f8cff] transition-colors" title="上传文件(PDF/TXT/PNG/JPG)">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                    </button>
                    <div className="w-px h-4 bg-[#e0e4e8]" />
                    {(['auto', 'fast', 'slow'] as const).map(m => (
                      <span key={m} className={`text-xs px-3 py-1.5 rounded-full cursor-pointer select-none transition-colors ${laneMode === m ? 'bg-[#4f8cff] text-white' : 'bg-[#f0f4ff] text-[#81858c] hover:bg-[#e0e8ff]'}`}
                        onClick={() => setLaneMode(m)}>
                        {m === 'auto' ? '自动' : m === 'fast' ? '快速' : '协作'}
                      </span>
                    ))}
                  </div>
                  <button onClick={() => streaming.isStreaming ? abortStream() : handleSend()}
                    disabled={!inputValue.trim() && !streaming.isStreaming}
                    className="btn btn-sm"
                    style={{
                      background: (inputValue.trim() || streaming.isStreaming) ? 'linear-gradient(135deg, #4f8cff, #6c5ce7)' : '#e0e4e8',
                      color: (inputValue.trim() || streaming.isStreaming) ? '#fff' : '#9ca3af',
                      borderRadius: '10px', border: 'none', minWidth: '64px',
                    }}>
                    {streaming.isStreaming ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
                    ) : '发送'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* 有消息 → 可滚动消息区 */}
            <div ref={chatRef} className="flex-1 overflow-y-auto px-6 py-4"
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={e => { e.preventDefault(); setIsDragging(false); }}
              onDrop={e => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files); }}>
              <div className="max-w-2xl mx-auto">
                {messages.map((msg, i) => (
                  <MsgBubble
                    key={i} msg={msg} idx={i}
                    isStreaming={streaming.isStreaming && i === messages.length - 1}
                    streamingThinking={streaming.thinking} streamingOrder={streaming.thinkingOrder}
                    streamingCurrentAgent={streaming.currentAgent}
                    editing={editingIdx === i} editValue={editValue}
                    onEditChange={setEditValue}
                    onStartEdit={() => { setEditingIdx(i); setEditValue(msg.content); }}
                    onSubmitEdit={submitEdit}
                    onCancelEdit={() => { setEditingIdx(null); setEditValue(''); }}
                    onCopy={t => navigator.clipboard.writeText(t)}
                    onRegenerate={handleRegenerate}
                    onGenerateReport={handleGenerateReport}
                    onSelectAgent={setSelectedThinkingAgent}
                    onFocusThinking={handleFocusThinking}
                    selectedAgent={selectedThinkingAgent}
                  />
                ))}
              </div>
            </div>

            {messages.length > 0 && <div className="ai-disclaimer show">内容由 AI 生成，请仔细甄别</div>}

            {attachedFiles.length > 0 && (
              <div className="file-tags" style={{ maxWidth: '672px' }}>
                {attachedFiles.map(f => (
                  <span key={f.name} className={`file-tag ${f.status === 'error' ? 'ft-error' : ''}`}>
                    {f.status === 'uploading' ? '⏳' : f.status === 'done' ? '✅' : '❌'} {f.name}
                    <span style={{ cursor: 'pointer', marginLeft: 4 }} onClick={() => setAttachedFiles(prev => prev.filter(x => x.name !== f.name))}>✕</span>
                  </span>
                ))}
              </div>
            )}

            <input ref={fileInputRef} type="file" multiple accept=".pdf,.txt,.png,.jpg,.jpeg" style={{ display: 'none' }} onChange={handleFileSelect} />
            <input ref={sideFileInputRef} type="file" className="hidden" accept=".pdf,.txt,.png,.jpg,.jpeg"
              onChange={e => { const f = e.target.files?.[0]; if (f) { knowledgeApi.upload(f).then(() => refreshKnowledgeFiles()).catch(() => {}); } }} />

            {/* 底部输入框 */}
            <div className="chat-input-area" style={{ maxWidth: '672px' }}>
              <div className="bg-white rounded-2xl border border-[#e0e4e8] shadow-sm focus-within:border-[#4f8cff] focus-within:shadow-md transition-all">
                <textarea ref={inputRef}
                  className="textarea textarea-ghost w-full resize-none text-base outline-none min-h-[56px] px-5 pt-3"
                  placeholder="给 Multi-Agent 发送任务（编程 / 写作 / 分析 / 问答 / 闲聊）"
                  rows={2}
                  value={inputValue}
                  onChange={e => { setInputValue(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); streaming.isStreaming ? abortStream() : handleSend(); } }}
                />
                <div className="flex items-center justify-between px-4 pb-3">
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full text-[#81858c] hover:bg-[#f0f4ff] hover:text-[#4f8cff] transition-colors" title="上传文件(PDF/TXT/PNG/JPG)">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                    </button>
                    <div className="w-px h-4 bg-[#e0e4e8]" />
                    {(['auto', 'fast', 'slow'] as const).map(m => (
                      <span key={m} className={`text-xs px-3 py-1.5 rounded-full cursor-pointer select-none transition-colors ${laneMode === m ? 'bg-[#4f8cff] text-white' : 'bg-[#f0f4ff] text-[#81858c] hover:bg-[#e0e8ff]'}`}
                        onClick={() => setLaneMode(m)}>
                        {m === 'auto' ? '自动' : m === 'fast' ? '快速' : '协作'}
                      </span>
                    ))}
                  </div>
                  <button onClick={() => streaming.isStreaming ? abortStream() : handleSend()}
                    disabled={!inputValue.trim() && !streaming.isStreaming}
                    className="btn btn-sm"
                    style={{
                      background: (inputValue.trim() || streaming.isStreaming) ? 'linear-gradient(135deg, #4f8cff, #6c5ce7)' : '#e0e4e8',
                      color: (inputValue.trim() || streaming.isStreaming) ? '#fff' : '#9ca3af',
                      borderRadius: '10px', border: 'none', minWidth: '64px',
                    }}>
                    {streaming.isStreaming ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
                    ) : '发送'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ═══ 右侧栏 ═══ */}
      {!rightOpen && <button onClick={() => setRightOpen(true)}
        className="flex flex-col items-center justify-center w-8 h-8 mt-2 cursor-pointer text-[#81858c] hover:text-[#4f8cff] hover:bg-[#f0f4ff] border-l border-[#eceef2] bg-white/90 shrink-0 transition-colors rounded-bl-lg"
        title="展开详情">
        <ChevronLeft size={16} />
      </button>}
      <div className={`${rightOpen ? 'w-96' : 'w-0'} shrink-0 overflow-hidden transition-all duration-200 flex flex-col border-l border-[#eceef2]`}
        style={{ background: '#fff', minWidth: rightOpen ? '24rem' : '0' }}>
        {/* 右侧栏标题（整行可点击收起） */}
        <div className="flex items-center justify-between px-3 pt-3 pb-1 shrink-0 cursor-pointer select-none hover:bg-gray-50 transition-colors"
          onClick={() => setRightOpen(false)}>
          <span className="text-xs font-semibold text-[#81858c] uppercase tracking-wider">&gt; Agent 输出</span>
          <ChevronRight size={14} className="text-[#b0b8c1]" />
        </div>
        <div ref={rightPanelRef} className="flex-1 overflow-y-auto px-3 pb-2 space-y-2">
          {currentThinking.length === 0 && <p className="text-xs text-[#9ca3af] text-center mt-8">发送消息后 Agent 输出将显示在这里</p>}
          {currentThinking.map((t, i) => {
            const meta = AGENT_META[t.name] || { icon: '🤖', color: '#81858c' };
            const duration = agentTimings[t.name];
            const charCount = t.content?.length || 0;
            const estTokens = Math.ceil(charCount / 3);
            const isSelected = selectedThinkingAgent === t.name;
            return (
              <div key={i} data-agent={t.name}
                className={`rounded-xl border overflow-hidden transition-all ${isSelected ? 'border-[#4f8cff] shadow-[0_0_0_1px_#4f8cff]' : 'border-[#eceef2]'}`}>
                <div className={`flex items-center justify-between px-3 py-2 cursor-pointer ${isSelected ? 'bg-[#f0f4ff]' : 'bg-[#f9fafb]'}`}
                  onClick={() => setExpandedAgents(prev => { const n = new Set(prev); n.has(t.name) ? n.delete(t.name) : n.add(t.name); return n; })}
                  style={{ borderLeft: `3px solid ${meta.color}` }}>
                  <div className="flex items-center gap-2"><span>{meta.icon}</span><span className="text-xs font-medium text-[#1d1d1f]">{t.name}</span></div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-[#b0b8c1]">⏱{duration ? (duration > 1000 ? (duration / 1000).toFixed(1) + 's' : duration + 'ms') : '···'} · 🪙{estTokens.toLocaleString()}</span>
                    <span className="text-[10px] text-[#9ca3af]">{expandedAgents.has(t.name) ? '▲' : '▼'}</span>
                  </div>
                </div>
                {expandedAgents.has(t.name) && (
                  <div className="px-3 py-2 max-h-48 overflow-y-auto bg-white">
                    <div className="text-xs text-[#4b5563] markdown-body">
                      {t.content ? <Markdown text={t.content} /> : '（无输出）'}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="shrink-0 border-t border-[#eceef2] bg-white right-panel-bottom">
          {/* ─── Agent 池开关（浮窗弹出） ─── */}
          <div className="px-2 pt-2.5 pb-0.5 relative" ref={agentPoolRef}>
            <button onClick={() => setAgentPoolOpen(!agentPoolOpen)}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-xl border border-[#e0e4e8] bg-white hover:border-[#4f8cff] transition-all">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#4f8cff]/10 to-[#6c5ce7]/10 flex items-center justify-center text-sm">🤖</div>
              <div className="flex-1 text-left">
                <div className="text-xs font-medium text-[#1d1d1f]">Agent 池</div>
                <div className="text-[10px] text-[#9ca3af]">{enabledAgents.length}/{Object.keys(AGENT_META).length} 已启用</div>
              </div>
              <ChevronDown size={14} className={`text-[#9ca3af] transition-transform ${agentPoolOpen ? 'rotate-180' : ''}`} />
            </button>
            {/* 浮窗：显示在按钮上方 */}
            {agentPoolOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-1.5 p-2 bg-white rounded-xl shadow-lg border border-[#eceef2] z-30 max-h-60 overflow-y-auto">
                <div className="grid grid-cols-4 gap-1">
                  {Object.entries(AGENT_META).map(([name, meta]) => {
                    const isOn = enabledAgents.includes(name);
                    return (
                      <button key={name} onClick={(e) => { e.stopPropagation(); setEnabledAgents(prev =>
                        prev.includes(name) ? prev.filter(k => k !== name) : [...prev, name]
                      );}}
                        className={`flex flex-col items-center py-1.5 rounded-lg text-[10px] transition-all ${
                          isOn
                            ? 'bg-white border border-[#e0e4e8] text-[#1d1d1f] shadow-sm'
                            : 'bg-gray-50 text-[#b0b8c1] border border-transparent'
                        }`}
                        title={name}>
                        <span className={`text-base leading-none mb-0.5 ${isOn ? '' : 'grayscale opacity-40'}`}>{meta.icon}</span>
                        <span className="leading-tight">{name}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="text-[9px] text-[#9ca3af] text-center pt-1.5 border-t border-[#f0f2f5] mt-1.5">
                  Agent 池映射 · 自定义 Agent 功能即将推出
                </div>
              </div>
            )}
          </div>

          {/* ─── 统计 ─── */}
          <div className="px-3 py-1.5 flex items-center justify-between text-[10px] text-[#9ca3af] border-t border-[#f0f2f5]">
            <span>💬 {messages.length} 条消息</span>
            <span>🧠 {enabledAgents.length}/{Object.keys(AGENT_META).length} Agent 已启用</span>
          </div>

          {/* ─── 操作按钮 ─── */}
          <div className="px-2 pb-2 pt-1 border-t border-[#f0f2f5]">
            <div className="grid grid-cols-2 gap-1">
              <button onClick={() => handleGenerateReport(currentThinking)}
                disabled={currentThinking.length === 0 || generatingReport}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] text-[#81858c] hover:text-[#4f8cff] hover:bg-[#f0f4ff] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                📄 报告
              </button>
              {projectId && (
                <button onClick={() => setOrchestraOpen(true)}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] text-[#81858c] hover:text-[#4f8cff] hover:bg-[#f0f4ff] transition-colors">
                  🗺️ 编排
                </button>
              )}
              {projectId && (
                <button onClick={() => setMonitorOpen(true)}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] text-[#81858c] hover:text-[#4f8cff] hover:bg-[#f0f4ff] transition-colors">
                  📡 监控
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 知识库管理弹窗 */}
      <PageModal open={knowledgeOpen} onClose={() => setKnowledgeOpen(false)} title="📚 知识库管理" width="600px">
        <div className="p-5 space-y-4">
          {/* 统计 */}
          {knowledgeStats && (
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-[#f9fafb]">
                <div className="text-[9px] text-[#81858c]">文件总数</div>
                <div className="text-lg font-semibold text-[#1d1d1f]">{knowledgeStats.total_files}</div>
              </div>
              <div className="p-3 rounded-xl bg-[#f9fafb]">
                <div className="text-[9px] text-[#81858c]">索引片段</div>
                <div className="text-lg font-semibold text-[#1d1d1f]">{knowledgeStats.total_chunks}</div>
              </div>
              <div className="p-3 rounded-xl bg-[#f9fafb]">
                <div className="text-[9px] text-[#81858c]">操作</div>
                <button onClick={() => knowledgeApi.rebuild().then(() => { toast.success('重建中'); refreshKnowledgeFiles(); }).catch(() => toast.error('重建失败'))}
                  className="text-xs text-[#4f8cff] hover:underline">重建索引</button>
              </div>
            </div>
          )}
          {/* 文件列表 + 上传 */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#1d1d1f]">文件列表</span>
            <button onClick={() => sideFileInputRef.current?.click()}
              className="btn btn-xs" style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '8px', border: 'none' }}>+ 上传</button>
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {sideFiles.length === 0 ? (
              <p className="text-xs text-[#b0b8c1] text-center py-4">暂无文件</p>
            ) : sideFiles.map((f: any) => (
              <div key={f.name} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#f9fafb] hover:bg-[#f3f4f6] transition-colors group">
                <span>📄</span>
                <span className="text-xs text-[#1d1d1f] flex-1 truncate">{f.name}</span>
                <span className="text-[10px] text-[#9ca3af]">{f.size ? `${(f.size / 1024).toFixed(0)}KB` : ''}</span>
                <button onClick={() => { knowledgeApi.deleteFile(f.name).then(() => { toast.success('已删除'); refreshKnowledgeFiles(); }).catch(() => toast.error('删除失败')); }}
                  className="text-[10px] text-[#ef4444] opacity-0 group-hover:opacity-100 transition-opacity">删除</button>
              </div>
            ))}
          </div>
        </div>
      </PageModal>

      {/* 编排弹窗 */}
      <PageModal open={orchestraOpen} onClose={() => setOrchestraOpen(false)} title="🗺️ 编排画布" width="90vw">
        {projectId && <OrchestrationPage />}
      </PageModal>

      {/* 监控弹窗 */}
      <PageModal open={monitorOpen} onClose={() => setMonitorOpen(false)} title="📡 执行监控" width="85vw">
        {projectId && <MonitorPage />}
      </PageModal>

      {/* 报告预览弹窗 */}
      <PageModal open={reportOpen} onClose={() => { setReportOpen(false); setReportContent(null); }} title="📄 报告预览" width="720px">
        <div className="p-5">
          {reportContent ? (
            <>
              <div className="max-h-[60vh] overflow-y-auto markdown-body text-sm leading-relaxed whitespace-pre-wrap">
                {reportContent.split('\n').map((line, i) => <p key={i} style={{ margin: '0.2em 0' }}>{line || '\u00A0'}</p>)}
              </div>
              <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-[#eceef2]">
                <button className="btn btn-ghost btn-sm" style={{ borderRadius: '10px' }} onClick={() => { setReportOpen(false); setReportContent(null); }}>关闭</button>
                <button className="btn btn-sm" onClick={downloadReport}
                  style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '10px', border: 'none' }}>保存为 .md</button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center py-12"><span className="loading loading-spinner loading-sm text-[#4f8cff]" /></div>
          )}
        </div>
      </PageModal>
    </div>
  );
}

// ── 消息气泡 ──
function MsgBubble({ msg, idx, isStreaming, streamingThinking, streamingOrder, streamingCurrentAgent,
  editing, editValue, onEditChange, onStartEdit, onSubmitEdit, onCancelEdit,
  onCopy, onRegenerate, onGenerateReport, onSelectAgent, onFocusThinking, selectedAgent }: {
  msg: Message; idx: number; isStreaming: boolean;
  streamingThinking: Map<string, string>; streamingOrder: string[];
  streamingCurrentAgent: string | null;
  editing: boolean; editValue: string;
  onEditChange: (v: string) => void; onStartEdit: () => void; onSubmitEdit: () => void; onCancelEdit: () => void;
  onCopy: (t: string) => void; onRegenerate: () => void;
  onGenerateReport: (thinking?: ThinkingEntry[]) => void;
  onSelectAgent?: (name: string) => void;
  onFocusThinking?: (thinking: ThinkingEntry[], name: string) => void;
  selectedAgent?: string | null;
}) {

  if (msg.role === 'user') {
    return (
      <div className="message-user">
        {editing ? (
          <div style={{ width: '100%', maxWidth: '66%', borderRadius: '20px', border: '1px solid #e0e4e8', padding: '12px 14px 10px', background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <textarea style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', fontFamily: 'inherit', fontSize: '0.9rem', lineHeight: 1.6, color: '#1d1d1f', background: 'transparent', minHeight: '44px', maxHeight: '120px' }}
              value={editValue} onChange={e => onEditChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmitEdit(); } if (e.key === 'Escape') onCancelEdit(); }} autoFocus />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', paddingTop: '6px', marginTop: '4px', borderTop: '1px solid #f0f2f5' }}>
              <button className="toolbar-btn" onClick={onCancelEdit}>取消</button>
              <button className="send-btn" style={{ position: 'static', width: '32px', height: '32px' }} onClick={onSubmitEdit} disabled={!editValue.trim()}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 11 7-7 7 7M12 4v16" /></svg>
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="bubble">{msg.content}</div>
            <div className="user-msg-toolbar">
              <button className="toolbar-btn" onClick={() => onCopy(msg.content)}>复制</button>
              <button className="toolbar-btn" onClick={onStartEdit}>修改</button>
            </div>
          </>
        )}
      </div>
    );
  }

  const thinking = isStreaming
    ? streamingOrder.map(key => ({ name: key, content: streamingThinking.get(key) || '' }))
    : (msg.thinking || []);
  const hasThinking = thinking.length > 0;

  return (
    <div className="message-assistant">
      {hasThinking && (
        <div className="thinking-timeline">
          {/* 垂直时间轴 */}
          <div className="timeline-line" />
          <div className="timeline-nodes">
            {thinking.map((t, j) => {
              const isActive = selectedAgent === t.name;
              const summary = t.content?.replace(/^#+\s*/gm, '').trim().split('\n').filter(Boolean)[0] || '完成';
              const shortSummary = summary.length > 55 ? summary.slice(0, 55) + '...' : summary;
              const color = COLORS[t.name] || '#81858c';
              const isCurrentStreaming = isStreaming && j === thinking.length - 1 && streamingCurrentAgent === t.name;
              return (
                <div key={j} className={`timeline-node ${isActive ? 'active' : ''}`}
                  onClick={() => { onSelectAgent?.(t.name); onFocusThinking?.(thinking, t.name); }}>
                  {/* 节点圆点 */}
                  <div className="timeline-dot" style={{ borderColor: color, background: isActive ? color : '#fff' }} />
                  {/* 内容 */}
                  <div className="timeline-content">
                    <span className="timeline-agent-icon">{ICONS[t.name] || '🔹'}</span>
                    <span className="timeline-agent-name">{t.name}</span>
                    <span className="timeline-agent-summary">
                      {isCurrentStreaming ? (
                        <span className="text-[#4f8cff]">思考中<span className="loading-dots" /></span>
                      ) : (
                        <span>— {shortSummary}</span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {msg.loading && !isStreaming ? (
        <div className="bubble loading-bubble">思考中<span className="loading-dots" /></div>
      ) : msg.error ? (
        <div className="message-error"><div className="bubble">⚠️ {msg.error}</div></div>
      ) : (
            <div className="bubble"><Markdown text={isStreaming ? (streamingThinking?.size > 0 ? '' : '思考中...') : msg.content} /></div>
      )}

      {!isStreaming && msg.content && !msg.error && (
        <div className="msg-toolbar">
          <button className="toolbar-btn" onClick={() => onCopy(msg.content)}>复制</button>
          <button className="toolbar-btn" onClick={onRegenerate}>重新生成</button>
          {msg.thinking && msg.thinking.length > 0 && (
            <button className="toolbar-btn" onClick={() => onGenerateReport(msg.thinking!)}>生成报告</button>
          )}
        </div>
      )}
    </div>
  );
}
