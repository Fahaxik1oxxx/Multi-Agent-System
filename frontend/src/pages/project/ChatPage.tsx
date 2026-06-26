import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, Bot, User, Loader2, Brain, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { projectsApi } from '@/api/projects';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';

interface Message {
  role: 'user' | 'assistant' | 'error';
  content: string;
  thinking?: Array<{ agent: string; output: string }>;
  task_type?: string;
}

export function ChatPage() {
  const { projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const { token } = useAuthStore();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [currentTask, setCurrentTask] = useState<string | null>(null);
  const [expandedThinking, setExpandedThinking] = useState<Record<number, boolean>>({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 加载项目信息
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const res = await projectsApi.get(projectId!);
      return res.data;
    },
    enabled: !!projectId,
  });

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 自动调整 textarea 高度
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, []);

  // 发送消息
  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: Message = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);
    setCurrentTask('思考中...');

    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    const history = messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: text,
          lane_mode: 'auto',
          history,
        }),
      });

      const data = await res.json();

      const assistantMsg: Message = {
        role: data.error ? 'error' : 'assistant',
        content: data.reply || data.error || '无响应',
        thinking: data.thinking || [],
        task_type: data.task_type || '未知',
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setCurrentTask(data.task_type || null);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'error', content: '❌ 网络请求失败，请稍后重试' },
      ]);
    } finally {
      setSending(false);
    }
  };

  // 键盘快捷键
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏 */}
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <Bot className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <h2 className="text-sm font-medium">{project?.name ?? '对话'}</h2>
          {currentTask && (
            <p className="text-xs text-muted-foreground">任务类型: {currentTask}</p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setMessages([]);
            setCurrentTask(null);
            setExpandedThinking({});
          }}
        >
          <Plus className="mr-1 h-4 w-4" /> 新对话
        </Button>
      </div>

      {/* 消息列表 */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="mx-auto max-w-3xl space-y-6 p-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Bot className="h-12 w-12 text-muted-foreground/30" />
              <h3 className="mt-4 text-lg font-medium">开始对话</h3>
              <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                向智能体团队发送消息，观察它们如何协作完成任务
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                'flex gap-3',
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              )}
            >
              {/* 头像 */}
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground order-2'
                    : msg.role === 'error'
                    ? 'bg-destructive text-destructive-foreground'
                    : 'bg-muted'
                )}
              >
                {msg.role === 'user' ? (
                  <User className="h-4 w-4" />
                ) : (
                  <Bot className="h-4 w-4" />
                )}
              </div>

              {/* 消息内容 */}
              <div
                className={cn(
                  'max-w-[80%] rounded-lg px-4 py-3',
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : msg.role === 'error'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-muted'
                )}
              >
                {/* 思考过程折叠面板 */}
                {msg.thinking && msg.thinking.length > 0 && (
                  <div className="mb-3 border-b border-border/50 pb-2">
                    <button
                      className="flex w-full items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setExpandedThinking((prev) => ({
                          ...prev,
                          [i]: !prev[i],
                        }))
                      }
                    >
                      <Brain className="h-3.5 w-3.5" />
                      思考过程 ({msg.thinking.length} 步)
                      {expandedThinking[i] ? (
                        <ChevronUp className="ml-auto h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="ml-auto h-3.5 w-3.5" />
                      )}
                    </button>
                    {expandedThinking[i] && (
                      <div className="mt-2 space-y-2">
                        {msg.thinking.map((step, j) => (
                          <div key={j} className="rounded bg-background/50 p-2">
                            <Badge variant="outline" className="mb-1 text-xs">
                              {step.agent}
                            </Badge>
                            <p className="text-xs whitespace-pre-wrap text-muted-foreground">
                              {step.output?.slice(0, 300)}
                              {step.output?.length > 300 && '...'}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 消息正文 */}
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {msg.content}
                </div>
              </div>
            </div>
          ))}

          {/* 发送中 loading */}
          {sending && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">智能体处理中...</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* 输入框 */}
      <div className="border-t p-4">
        <div className="mx-auto flex max-w-3xl gap-3">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="输入你的问题或任务... (Enter 发送, Shift+Enter 换行)"
            className="min-h-[44px] resize-none"
            rows={1}
            disabled={sending}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            size="icon"
            className="shrink-0"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
