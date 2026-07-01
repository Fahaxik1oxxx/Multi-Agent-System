import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Check, FolderOpen, FileIcon, Loader2, Paperclip, Users, Crown, Shield } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { TeamFileManager } from '@/components/team/TeamFileManager';
import { FilePreviewModal } from '@/components/team/FilePreviewModal';
import { TeamSettingsModal } from '@/components/team/TeamSettingsModal';

export function TeamChat() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [newChannel, setNewChannel] = useState('');
  const [showFileManager, setShowFileManager] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [previewFile, setPreviewFile] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const msgContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [newMsgCount, setNewMsgCount] = useState(0);
  const [showTodoInput, setShowTodoInput] = useState(false);
  const [todoInputVal, setTodoInputVal] = useState('');
  const [todoAssignee, setTodoAssignee] = useState<string>('');

  const { data: channels = [] } = useQuery({
    queryKey: ['channels', orgId],
    queryFn: async () => {
      const res = await apiClient.get(`/orgs/${orgId}/channels`);
      const data = res.data;
      if (data.length > 0 && !activeChannel) setActiveChannel(data[0].id);
      return data;
    },
    enabled: !!orgId,
  });

  const { data: todos = [] } = useQuery({
    queryKey: ['todos', orgId],
    queryFn: async () => {
      const res = await apiClient.get(`/orgs/${orgId}/todos`);
      return res.data;
    },
    enabled: !!orgId,
  });

  const { data: orgDetail } = useQuery({
    queryKey: ['org-detail', orgId],
    queryFn: async () => {
      const res = await apiClient.get(`/orgs/${orgId}`);
      return res.data;
    },
    enabled: !!orgId,
  });

  const myRole = orgDetail?.my_role;
  const isOwner = myRole === 'owner';
  const members = orgDetail?.members || [];
  const sortedMembers = useMemo(() => [...members].sort((a: any, b: any) => {
    if (a.role === 'owner' && b.role !== 'owner') return -1;
    if (a.role !== 'owner' && b.role === 'owner') return 1;
    return (a.user_name || '').localeCompare(b.user_name || '');
  }), [members]);

  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [showAtMenu, setShowAtMenu] = useState(false);
  const [atSearch, setAtSearch] = useState('');
  const [atMenuLevel, setAtMenuLevel] = useState<'main' | 'agent'>('main');
  const [selectedAtIdx, setSelectedAtIdx] = useState(0);

  const AGENT_COMMANDS = [
    { label: '总结', desc: '总结频道讨论内容', insert: '总结一下' },
    { label: '创建待办', desc: '可 @成员 委派任务', insert: '创建待办：' },
    { label: '搜索', desc: '搜索知识库文档', insert: '搜索 ' },
    { label: '查看', desc: '查看团队文档内容', insert: '查看 ' },
  ];

  const { data: orgFiles = [] } = useQuery({
    queryKey: ['org-files', orgId],
    queryFn: async () => {
      const res = await apiClient.get(`/orgs/${orgId}/files`);
      return res.data || [];
    },
    enabled: !!orgId,
  });

  // 文件按类型排序
  const sortedFiles = useMemo(() => sortFilesByType(orgFiles), [orgFiles]);

  // 拉取消息
  const fetchMessages = async () => {
    if (!activeChannel) return;
    try {
      const res = await apiClient.get(`/orgs/${orgId}/channels/${activeChannel}/messages`);
      setMessages(res.data);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    fetchMessages();
  }, [activeChannel]);

  // SSE 连接
  useEffect(() => {
    if (!orgId) return;
    const token = localStorage.getItem('auth_token');
    let es: EventSource | null = null;
    try {
      // EventSource doesn't support Authorization header, use fetch as fallback
      const url = `/api/orgs/${orgId}/stream`;
      fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        .then((response) => {
          if (!response.ok || !response.body) return;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          const readLoop = async () => {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const parts = buffer.split('\n\n');
              buffer = parts.pop() || '';
              for (const part of parts) {
                const dataLine = part.split('\n').find((l) => l.startsWith('data: '));
                if (!dataLine) continue;
                try {
                  const event = JSON.parse(dataLine.slice(6));
                  if (event.type === 'message' && event.message) {
                    const msg = event.message;
                    setMessages((prev) => {
                      // 自己的消息：SSE 只替换乐观消息，不追加（防止竞态导致左右重复）
                      if (msg.user_id === currentUser?.user_id) {
                        const optIdx = prev.findIndex(m => m.id?.startsWith('opt-'));
                        if (optIdx >= 0) {
                          const next = [...prev];
                          next[optIdx] = msg;
                          return next;
                        }
                        // 没有乐观消息说明已处理过，忽略
                        return prev;
                      }
                      // 别人的消息：去重追加
                      return prev.some(m => m.id === msg.id) ? prev : [...prev, msg];
                    });
                    // 别人发的消息且不在底部时，累计未读提示
                    const el = msgContainerRef.current;
                    if (msg.user_id !== currentUser?.user_id && el) {
                      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
                      if (!nearBottom) {
                        setNewMsgCount((prev) => prev + 1);
                      }
                    }
                    // 如果不是当前频道，累计未读
                    if (msg.channel_id && msg.channel_id !== activeChannel) {
                      setUnreadCounts((prev) => ({
                        ...prev,
                        [msg.channel_id]: (prev[msg.channel_id] || 0) + 1,
                      }));
                    }
                  }
                } catch { /* skip */ }
              }
            }
          };
          readLoop();
        })
        .catch(() => {});
    } catch { /* ignore */ }
    return () => { es?.close(); };
  }, [orgId]);

  // 自动滚到底部 + 监听滚动位置
  const scrollToBottom = useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
    });
  }, []);

  useEffect(() => {
    const el = msgContainerRef.current;
    if (!el) return;
    const handler = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
      setShowScrollBtn(!nearBottom);
    };
    el.addEventListener('scroll', handler);
    return () => el.removeEventListener('scroll', handler);
  }, []);

  // 监听消息变化：自动滚底或累计未读提示
  useEffect(() => {
    const el = msgContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (nearBottom) {
      scrollToBottom(false);
      setNewMsgCount(0);
    }
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      await apiClient.post(`/orgs/${orgId}/channels/${activeChannel}/messages`, { content });
    },
    onMutate: (content: string) => {
      // 乐观更新：立即显示消息 + 清空输入框
      const optimisticMsg = {
        id: `opt-${Date.now()}`,
        channel_id: activeChannel,
        content: content,
        user_id: currentUser?.user_id || 'unknown',
        user_name: currentUser?.user_name || '我',
        is_agent: 0,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticMsg]);
      setInput('');
      // 自己发送的消息，强制滚到底部
      setNewMsgCount(0);
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      });
    },
    onSuccess: (data: any) => {
      // SSE 没来得及替换乐观消息时，用真实 ID 确认
      setMessages((prev) => prev.map(m =>
        m.id?.startsWith('opt-') ? { ...m, id: data.id } : m
      ));
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || '发送失败');
    },
  });

  const handleSend = () => {
    if (!input.trim() || !activeChannel || sendMutation.isPending) return;
    sendMutation.mutate(input.trim());
  };

  const channelMutation = useMutation({
    mutationFn: async (name: string) => {
      await apiClient.post(`/orgs/${orgId}/channels`, { name });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels', orgId] });
      setNewChannel('');
    },
  });

  const todoMutation = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: number }) => {
      await apiClient.put(`/orgs/${orgId}/todos/${id}`, { completed });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['todos', orgId] }),
  });


  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await apiClient.post(`/orgs/${orgId}/files/upload`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(`已上传: ${file.name}`);
      qc.invalidateQueries({ queryKey: ['org-files', orgId] });
      // 发一条系统消息（SSE 会推送，不需要手动 refetch）
      apiClient.post(`/orgs/${orgId}/channels/${activeChannel}/messages`, {
        content: `📎 上传了文件: ${file.name}`,
      }).catch(() => {});
    } catch (err: any) {
      toast.error(err?.response?.data?.error || '上传失败');
    }
    setUploading(false);
    if (e.target) e.target.value = '';
  };

  return (
    <div className="flex h-full">
      {/* 左侧栏 — 团队文档 */}
      <div className="w-56 border-r border-[#e0e4e8] bg-white flex flex-col shrink-0">
        {/* 返回 + 标题 */}
        <div className="px-3 pt-3 pb-2 border-b border-[#eceef2]">
          <button onClick={() => navigate('/v3/team')}
            className="inline-flex items-center gap-1.5 text-sm text-[#81858c] hover:text-[#1d1d1f] transition-colors mb-2 px-2 py-1 rounded-lg hover:bg-gray-100">
            <ArrowLeft size={16} /> 返回
          </button>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderOpen size={18} className="text-[#4f8cff]" />
              <h3 className="text-sm font-semibold text-[#1d1d1f]">团队文档</h3>
            </div>
            <button onClick={() => setShowFileManager(true)}
              className="text-sm text-[#4f8cff] font-medium px-2 py-1 rounded-lg hover:bg-[#4f8cff]/10 transition-colors">管理</button>
          </div>
        </div>
        {/* 文件列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {sortedFiles.length === 0 ? (
            <div className="text-center py-8 text-[#9ca3af]">
              <FileIcon size={24} className="mx-auto mb-2 opacity-30" />
              <p className="text-xs">暂无团队文档</p>
              <button onClick={() => setShowFileManager(true)}
                className="text-xs text-[#4f8cff] font-medium hover:underline mt-1">去上传</button>
            </div>
          ) : (
            sortedFiles.map((f: any) => (
              <div key={f.id}
                className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-50 cursor-pointer transition-all group"
                onDoubleClick={() => setPreviewFile(f)}
                title="双击预览"
              >
                <span className="text-base shrink-0">{getFileIcon(f.file_name)}</span>
                <span className="text-sm text-[#4b5563] truncate flex-1">{f.file_name}</span>
                <span className="text-[11px] text-[#b0b8c1] opacity-0 group-hover:opacity-100 transition-all px-2 py-0.5 rounded-full bg-gray-100 group-hover:bg-gray-200 shrink-0">预览</span>
              </div>
            ))
          )}
        </div>
        {/* 底部设置按钮 */}
        <div className="border-t border-[#eceef2] p-2">
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs text-[#81858c] hover:bg-gray-100 hover:text-[#4b5563] transition-colors"
          >
            <Shield size={14} />
            <span>群管理</span>
          </button>
        </div>
      </div>

      {/* 团队管理弹窗 */}
      <TeamSettingsModal
        orgId={orgId || ''}
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      {/* 文件管理弹窗 */}
      <TeamFileManager
        orgId={orgId || ''}
        isOpen={showFileManager}
        onClose={() => setShowFileManager(false)}
        onPreview={(file) => { setPreviewFile(file); }}
      />

      {/* 文件预览弹窗 */}
      <FilePreviewModal
        file={previewFile}
        files={sortedFiles}
        orgId={orgId || ''}
        isOpen={!!previewFile}
        onClose={() => setPreviewFile(null)}
      />

      {/* 中间 — 聊天 */}
      <div className="flex-1 flex flex-col bg-[#f5f6f8]">
        {/* 频道栏 */}
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-[#eceef2] bg-white/80 backdrop-blur-sm overflow-x-auto shrink-0">
          {channels.map((ch: any) => (
            <div key={ch.id} className="relative shrink-0 group">
              <button
                className={`relative px-3 py-1.5 text-xs font-medium rounded-xl transition-all whitespace-nowrap ${
                  activeChannel === ch.id
                    ? 'bg-[#4f8cff] text-white shadow-sm'
                    : 'text-[#81858c] hover:bg-gray-100 hover:text-[#4b5563]'
                }`}
                onClick={() => {
                  setActiveChannel(ch.id);
                  setUnreadCounts((prev) => ({ ...prev, [ch.id]: 0 }));
                }}
              >
                # {ch.name}
                {unreadCounts[ch.id] > 0 && activeChannel !== ch.id && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#ef4444] rounded-full border-2 border-white" />
                )}
              </button>
            </div>
          ))}
          <div className="flex items-center ml-2 pl-2.5 border-l border-[#d0d4d8]">
            <input
              className="w-20 text-xs border border-[#e0e4e8] rounded-lg px-2 py-1.5 outline-none text-[#4b5563] placeholder:text-[#b0b8c1] focus:border-[#4f8cff] transition-colors"
              placeholder="+ 新建频道"
              value={newChannel}
              onChange={(e) => setNewChannel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && newChannel && channelMutation.mutate(newChannel)}
            />
          </div>
        </div>

        {/* 消息区域 */}
        <div ref={msgContainerRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-4 relative">
          {/* 新消息提示横幅 */}
          {newMsgCount > 0 && (
            <div className="sticky top-3 z-10 flex justify-center">
              <button onClick={() => { scrollToBottom(); setNewMsgCount(0); }}
                className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-[#4f8cff] bg-white rounded-full shadow-md border border-[#e0e4e8] hover:shadow-lg transition-all"
              >
                ↑ {newMsgCount} 条新消息
              </button>
            </div>
          )}

          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-[#b0b8c1]">
              <div className="w-14 h-14 rounded-2xl bg-white shadow-sm border border-[#eceef2] flex items-center justify-center text-2xl mb-4">💬</div>
              <p className="text-sm font-medium text-[#81858c]">暂无消息</p>
              <p className="text-xs mt-1">发送第一条消息开始团队协作</p>
            </div>
          )}
          {messages.map((m: any, i: number) => {
            const isMe = !m.is_agent && m.user_id === currentUser?.user_id;
            const isAgent = m.is_agent === 1;
            return (
              <div key={m.id || i} className={`flex group ${isMe ? 'justify-end' : 'justify-start'}`}>
                {isAgent ? (
                  <div className="max-w-[80%]">
                    <div className="flex items-center gap-1.5 mb-1 ml-1">
                      <span className="text-xs font-semibold text-[#81858c]">🤖 机器人</span>
                      <span className="text-[9px] text-[#b0b8c1]">自动回复</span>
                    </div>
                    <div className="bg-white border border-[#eceef2] rounded-xl rounded-tl-sm px-4 py-2.5 shadow-sm text-sm leading-relaxed whitespace-pre-wrap">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div className={`${isMe ? 'max-w-[70%]' : 'max-w-[70%]'}`}>
                    <div className={`flex items-center gap-2 mb-1 ${isMe ? 'flex-row-reverse mr-1' : 'ml-1'}`}>
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 ${
                        isMe ? 'bg-[#4f8cff]' : 'bg-[#81858c]'
                      }`}>
                        {m.user_name?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                      <span className={`text-xs font-medium ${isMe ? 'text-[#4f8cff]' : 'text-[#81858c]'}`}>
                        {isMe ? '我' : m.user_name}
                      </span>
                    </div>
                    <div className={`rounded-xl px-4 py-2.5 text-sm leading-relaxed shadow-sm whitespace-pre-wrap ${
                      isMe
                        ? 'bg-[#4f8cff] text-white rounded-tr-sm'
                        : 'bg-white border border-[#eceef2] rounded-tl-sm'
                    }`}>
                      {m.content}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {/* 滚动锚点 */}
          <div ref={messagesEndRef} />
          {/* 滚动到底部按钮 */}
          {showScrollBtn && (
            <div className="sticky bottom-4 flex justify-center">
              <button onClick={() => scrollToBottom()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#4f8cff] bg-white rounded-full shadow-lg border border-[#e0e4e8] hover:shadow-xl hover:bg-gray-50 transition-all"
              >
                ↓ 最新消息
              </button>
            </div>
          )}
        </div>

        {/* 输入区域 */}
        <div className="px-6 py-3 bg-[#f5f6f8] border-t border-[#eceef2]">
          <div className="bg-white rounded-2xl border border-[#e0e4e8] shadow-sm hover:shadow-md transition-all focus-within:border-[#4f8cff] focus-within:shadow-md relative">
            {/* @ 提及悬浮列表 */}
            {showAtMenu && atMenuLevel === 'main' && (
              <div className="absolute bottom-full left-3 mb-1 w-52 bg-white rounded-xl shadow-xl border border-[#e0e4e8] z-50 max-h-48 overflow-y-auto">
                {/* 机器人入口 */}
                <button
                  className={`flex items-center gap-2 w-full px-3 py-2.5 text-xs transition-colors border-b border-[#f0f0f0] ${
                    selectedAtIdx === 0 ? 'bg-[#f0f4ff] text-[#4f8cff]' : 'text-[#1d1d1f] hover:bg-gray-50'
                  }`}
                  onClick={() => { setAtMenuLevel('agent'); setSelectedAtIdx(0); }}
                >
                  <span className="w-5 h-5 rounded-full bg-gradient-to-br from-[#4f8cff] to-[#6c5ce7] flex items-center justify-center text-white text-[9px]">A</span>
                  <span className="font-medium">🤖 机器人</span>
                  <span className="text-[#9ca3af] ml-auto text-[10px]">选择命令 →</span>
                </button>
                {/* 成员列表 */}
                <div className="text-[10px] text-[#b0b8c1] px-3 pt-1.5 pb-0.5 font-medium">@ 成员</div>
                {members
                  .filter((m: any) => !atSearch || m.user_name?.toLowerCase().includes(atSearch.toLowerCase()))
                  .map((m: any, idx: number) => (
                    <button
                      key={m.user_id}
                      className={`flex items-center gap-2 w-full px-3 py-2 text-xs transition-colors ${
                        selectedAtIdx === idx + 1 ? 'bg-[#f0f4ff] text-[#4f8cff]' : 'text-[#1d1d1f] hover:bg-gray-50'
                      }`}
                      onClick={() => {
                        const atIdx = input.lastIndexOf('@');
                        const newInput = input.slice(0, atIdx) + '@' + m.user_name + ' ';
                        setInput(newInput);
                        setShowAtMenu(false);
                        setAtMenuLevel('main');
                        setAtSearch('');
                        requestAnimationFrame(() => {
                          const ta = document.querySelector('textarea') as HTMLTextAreaElement | null;
                          if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = newInput.length; }
                        });
                      }}
                    >
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 ${
                        m.role === 'owner' ? 'bg-[#f59e0b]' : 'bg-[#4f8cff]'
                      }`}>
                        {m.user_name?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                      <span>@{m.user_name}</span>
                      {m.role === 'owner' && <Crown size={10} className="text-[#f59e0b]" />}
                    </button>
                  ))}
                {sortedMembers.filter((m: any) => !atSearch || m.user_name?.toLowerCase().includes(atSearch.toLowerCase())).length === 0 && (
                  <div className="px-3 py-2 text-xs text-[#9ca3af] text-center">无匹配成员</div>
                )}
              </div>
            )}

            {/* @ 机器人二级命令菜单 */}
            {showAtMenu && atMenuLevel === 'agent' && (
              <div className="absolute bottom-full left-3 mb-1 w-60 bg-white rounded-xl shadow-xl border border-[#e0e4e8] z-50">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-[#f0f0f0]">
                  <button onClick={() => { setAtMenuLevel('main'); setSelectedAtIdx(0); setAtSearch(''); }} className="text-[#81858c] hover:text-[#1d1d1f] text-xs">← 返回</button>
                  <span className="text-xs font-medium text-[#1d1d1f]">🤖 机器人命令</span>
                </div>
                <div className="max-h-40 overflow-y-auto">
                  {AGENT_COMMANDS.map((cmd, idx) => (
                    <button
                      key={cmd.label}
                      className={`flex flex-col items-start w-full px-3 py-2.5 text-xs transition-colors border-b border-[#f8f8f8] last:border-none ${
                        selectedAtIdx === idx ? 'bg-[#f0f4ff] text-[#4f8cff]' : 'hover:bg-gray-50'
                      }`}
                      onClick={() => {
                        const atIdx = input.lastIndexOf('@');
                        const newInput = input.slice(0, atIdx) + `@agent ${cmd.insert}`;
                        setInput(newInput);
                        setShowAtMenu(false);
                        setAtMenuLevel('main');
                        setAtSearch('');
                        requestAnimationFrame(() => {
                          const ta = document.querySelector('textarea') as HTMLTextAreaElement | null;
                          if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = newInput.length; }
                        });
                      }}
                    >
                      <span className="font-medium">{cmd.label}</span>
                      <span className="text-[10px] text-[#9ca3af] mt-0.5">{cmd.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <textarea
              className="textarea textarea-ghost w-full resize-none text-sm outline-none min-h-[44px] px-4 pt-3 pb-1 leading-relaxed"
              placeholder="输入消息，或 @agent 命令（总结/创建待办/搜索/查看）"
              rows={2}
              value={input}
              onChange={(e) => {
                const val = e.target.value;
                setInput(val);
                // 检测 @ 触发提及菜单
                const lastAtIndex = val.lastIndexOf('@');
                if (lastAtIndex >= 0 && (lastAtIndex === 0 || val[lastAtIndex - 1] === ' ' || val[lastAtIndex - 1] === '\n')) {
                  const afterAt = val.slice(lastAtIndex + 1);
                  // 只有在没有空格时才显示（@xxx 正在输入中）
                  if (!afterAt.includes(' ')) {
                    setShowAtMenu(true);
                    setAtMenuLevel('main');
                    setAtSearch(afterAt);
                  } else {
                    setShowAtMenu(false);
                  }
                } else {
                  setShowAtMenu(false);
                }
              }}
              onKeyDown={(e) => {
                if (showAtMenu) {
                  if (e.key === 'Escape') {
                    if (atMenuLevel === 'agent') { setAtMenuLevel('main'); setSelectedAtIdx(0); return; }
                    setShowAtMenu(false); return;
                  }
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const maxIdx = atMenuLevel === 'agent' ? AGENT_COMMANDS.length - 1 : sortedMembers.length;
                    setSelectedAtIdx((prev) => Math.min(prev + 1, maxIdx));
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelectedAtIdx((prev) => Math.max(prev - 1, 0));
                    return;
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    // 模拟点击选中项
                    if (atMenuLevel === 'agent') {
                      const cmd = AGENT_COMMANDS[selectedAtIdx];
                      if (cmd) {
                        const atIdx = input.lastIndexOf('@');
                        const newInput = input.slice(0, atIdx) + `@agent ${cmd.insert}`;
                        setInput(newInput);
                        setShowAtMenu(false);
                        setAtMenuLevel('main');
                        setAtSearch('');
                        requestAnimationFrame(() => {
                          const ta = document.querySelector('textarea') as HTMLTextAreaElement | null;
                          if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = newInput.length; }
                        });
                      }
                    } else {
                      if (selectedAtIdx === 0) {
                        // 选中的是机器人
                        setAtMenuLevel('agent');
                        setSelectedAtIdx(0);
                      } else {
                        // 选中的是成员
                        const m = sortedMembers[selectedAtIdx - 1];
                        if (m) {
                          const atIdx = input.lastIndexOf('@');
                          const newInput = input.slice(0, atIdx) + '@' + m.user_name + ' ';
                          setInput(newInput);
                          setShowAtMenu(false);
                          setAtMenuLevel('main');
                          setAtSearch('');
                          requestAnimationFrame(() => {
                            const ta = document.querySelector('textarea') as HTMLTextAreaElement | null;
                            if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = newInput.length; }
                          });
                        }
                      }
                    }
                    return;
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                  setShowAtMenu(false);
                }
              }}
            />
            <div className="flex items-center justify-between px-3 pb-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full text-[#81858c] hover:bg-gray-100 hover:text-[#4f8cff] transition-colors disabled:opacity-50"
                  title="上传文件到团队文档"
                >
                  {uploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={15} />}
                </button>
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
              </div>
              <button
                className="btn btn-sm"
                disabled={sendMutation.isPending || !input.trim()}
                onClick={handleSend}
                style={{
                  background: input.trim() ? 'linear-gradient(135deg, #4f8cff, #6c5ce7)' : '#e0e4e8',
                  color: input.trim() ? '#fff' : '#9ca3af',
                  borderRadius: '10px', border: 'none', minWidth: '64px', height: '32px', fontSize: '13px'
                }}
              >
                发送
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 右侧栏 — 待办 + 成员 */}
      <div className="w-56 border-l border-[#e0e4e8] bg-white flex flex-col shrink-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#eceef2]">
          <h3 className="text-xs font-semibold text-[#1d1d1f]">待办列表</h3>
            <button
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#81858c] hover:bg-[#4f8cff]/10 hover:text-[#4f8cff] transition-all"
                onClick={() => { setShowTodoInput(true); setTodoInputVal(''); }}
                title="新建待办"
              >
                <Plus size={18} />
              </button>
        </div>

        {/* 新建待办弹窗 */}
        {showTodoInput && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[70]" onClick={() => setShowTodoInput(false)}>
            <div className="bg-white rounded-2xl shadow-xl w-96 p-5" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-sm font-semibold text-[#1d1d1f] mb-3">📌 新建待办</h3>

              <label className="text-xs text-[#81858c] block mb-1">待办内容</label>
              <input
                className="input input-bordered w-full text-sm mb-3"
                style={{ borderRadius: '10px', borderColor: '#e0e4e8' }}
                placeholder="输入待办内容"
                value={todoInputVal}
                onChange={(e) => setTodoInputVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && todoInputVal.trim()) {
                    apiClient.post(`/orgs/${orgId}/todos`, { content: todoInputVal.trim(), assignee_id: todoAssignee || undefined }).then(() => {
                      qc.invalidateQueries({ queryKey: ['todos', orgId] });
                      setShowTodoInput(false); setTodoInputVal(''); setTodoAssignee('');
                    });
                  }
                  if (e.key === 'Escape') setShowTodoInput(false);
                }}
                autoFocus
              />

              <label className="text-xs text-[#81858c] block mb-1">指派给</label>
              <div className="flex flex-wrap gap-1.5 mb-4">
                <button
                  onClick={() => setTodoAssignee('')}
                  className={`text-xs px-2.5 py-1 rounded-full transition-colors ${!todoAssignee ? 'bg-[#4f8cff] text-white' : 'bg-gray-100 text-[#81858c] hover:bg-gray-200'}`}
                >不指定</button>
                {sortedMembers.map((m: any) => (
                  <button
                    key={m.user_id}
                    onClick={() => setTodoAssignee(m.user_id)}
                    className={`text-xs px-2.5 py-1 rounded-full transition-colors flex items-center gap-1 ${todoAssignee === m.user_id ? 'bg-[#4f8cff] text-white' : 'bg-gray-100 text-[#81858c] hover:bg-gray-200'}`}
                  >
                    {m.role === 'owner' && '👑 '}{m.user_name}
                  </button>
                ))}
              </div>

              <div className="flex justify-end gap-2">
                <button onClick={() => { setShowTodoInput(false); setTodoAssignee(''); }} className="btn btn-sm btn-ghost" style={{ borderRadius: '8px' }}>取消</button>
                <button
                  onClick={() => {
                    if (todoInputVal.trim()) {
                      apiClient.post(`/orgs/${orgId}/todos`, { content: todoInputVal.trim(), assignee_id: todoAssignee || undefined }).then(() => {
                        qc.invalidateQueries({ queryKey: ['todos', orgId] });
                        setShowTodoInput(false); setTodoInputVal(''); setTodoAssignee('');
                      });
                    }
                  }}
                  className="btn btn-sm" style={{ background: 'linear-gradient(135deg, #4f8cff, #6c5ce7)', color: '#fff', borderRadius: '8px', border: 'none' }}
                >添加</button>
              </div>
            </div>
          </div>
        )}

        <div className="flex-[3] overflow-y-auto p-2 space-y-1 min-h-0">
          {todos.length === 0 && (
            <div className="text-center py-4 text-[#b0b8c1]">
              <p className="text-xs">暂无待办</p>
            </div>
          )}
          {todos.map((t: any) => {
            const isMine = currentUser && !t.completed && t.created_by === currentUser.user_id;
            const isAtMe = currentUser && !t.completed && t.assignee_id === currentUser.user_id && t.created_by !== currentUser.user_id;
            const highlight = isMine || isAtMe;
            return (
              <div
                key={t.id}
                className={`flex items-center gap-2 p-2.5 rounded-xl text-xs cursor-pointer transition-all ${
                  isMine
                    ? 'border-l-2 border-[#10b981] bg-[#f0fdf4]/50'
                    : isAtMe
                    ? 'border-l-2 border-[#4f8cff] bg-[#f0f4ff]/50'
                    : t.completed ? 'bg-gray-50 line-through text-[#b0b8c1]' : 'hover:bg-gray-50 hover:shadow-sm'
                }`}
                onClick={() => todoMutation.mutate({ id: t.id, completed: t.completed ? 0 : 1 })}
              >
                <div className={`w-4.5 h-4.5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${
                  t.completed ? 'bg-[#d1d5db] border-[#d1d5db] text-white' : 'border-[#d1d5db] hover:border-[#4f8cff]'
                }`}>
                  {t.completed ? <Check size={10} strokeWidth={3} /> : null}
                </div>
                <span className="flex-1 truncate">{t.content}</span>
                {t.assignee_name && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  t.assignee_id === currentUser?.user_id
                    ? 'bg-[#4f8cff]/10 text-[#4f8cff] font-medium'
                    : 'text-[#9ca3af] bg-gray-50'
                }`}>@{t.assignee_name}</span>}
              </div>
            );
          })}
        </div>

        {/* 成员列表 */}
        <div className="border-t border-[#eceef2] h-[280px] flex flex-col">
          <div className="flex items-center gap-1.5 px-3 py-2">
            <Users size={14} className="text-[#81858c]" />
            <h3 className="text-xs font-semibold text-[#1d1d1f]">成员</h3>
            <span className="text-[10px] text-[#b0b8c1]">({sortedMembers.length})</span>
          </div>
          <div className="flex-1 px-2 pb-2 space-y-0.5 overflow-y-auto">
            {sortedMembers.map((m: any) => (
              <div key={m.user_id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 ${
                  m.role === 'owner' ? 'bg-[#f59e0b]' : 'bg-[#4f8cff]'
                }`}>
                  {m.user_name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <span className="text-xs text-[#4b5563] truncate flex-1">{m.user_name}</span>
                {m.role === 'owner' ? (
                  <Crown size={11} className="text-[#f59e0b] shrink-0" title="管理员" />
                ) : (
                  <span className="text-[9px] text-[#b0b8c1] shrink-0">成员</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const FILE_ICONS: Record<string, string> = {
  md: '📄', txt: '📄', pdf: '📕', docx: '📘',
  png: '📷', jpg: '📷', jpeg: '📷', gif: '📷', svg: '📷', webp: '📷',
  mp4: '🎬', webm: '🎬', mov: '🎬',
  py: '🐍', js: '📜', ts: '📜', json: '📋',
};

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return FILE_ICONS[ext] || '📄';
}

// 文件类型分组排序：文档 > 图片 > 视频 > 代码 > 其他
const TYPE_ORDER: Record<string, number> = {
  md: 0, txt: 0, pdf: 0, docx: 0,  // 文档
  png: 1, jpg: 1, jpeg: 1, gif: 1, svg: 1, webp: 1, bmp: 1,  // 图片
  mp4: 2, webm: 2, mov: 2, avi: 2,  // 视频
  py: 3, js: 3, ts: 3, json: 3, csv: 3, yaml: 3, yml: 3,  // 代码/数据
};

function sortFilesByType(files: any[]): any[] {
  return [...files].sort((a, b) => {
    const extA = a.file_name?.split('.').pop()?.toLowerCase() || '';
    const extB = b.file_name?.split('.').pop()?.toLowerCase() || '';
    const orderA = TYPE_ORDER[extA] ?? 99;
    const orderB = TYPE_ORDER[extB] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.file_name?.localeCompare(b.file_name || '') || 0;
  });
}
