import { useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import apiClient, { generateReportApi } from '@/api/client';
import { toast } from 'sonner';
import { AGENT_ICONS, AGENT_COLORS } from '@/data/agents';
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line,
  ResponsiveContainer, Legend,
} from 'recharts';

const ICONS = AGENT_ICONS;
const COLORS = AGENT_COLORS;
const PIE_COLORS = ['#4f8cff', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

const formatMs = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
const formatTokens = (n: number) => n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

interface Step {
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  elapsedMs: number;
  tokenCount: number;
}

const STATUS_CONFIG: Record<Step['status'], { icon: string; text: string; className: string }> = {
  pending:  { icon: '⏳', text: '等待中', className: 'text-[#9ca3af]' },
  running:  { icon: '🔄', text: '执行中', className: 'text-[#4f8cff]' },
  done:     { icon: '✅', text: '已完成', className: 'text-[#10b981]' },
  error:    { icon: '❌', text: '失败',   className: 'text-[#ef4444]' },
};

function PipelineTimeline({ steps }: { steps: Step[] }) {
  const maxElapsed = Math.max(...steps.map((s) => s.elapsedMs), 1);
  const totalElapsed = steps.reduce((sum, s) => sum + s.elapsedMs, 0);
  const totalTokens = steps.reduce((sum, s) => sum + s.tokenCount, 0);
  const doneCount = steps.filter((s) => s.status === 'done').length;

  return (
    <div>
      {/* ── Overview cards ── */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="bg-white rounded-2xl border border-[#e8ecf1] p-4">
          <div className="text-xs text-[#81858c] mb-1">总耗时</div>
          <div className="text-xl font-semibold text-[#1d1d1f]">{(totalElapsed / 1000).toFixed(1)}s</div>
        </div>
        <div className="bg-white rounded-2xl border border-[#e8ecf1] p-4">
          <div className="text-xs text-[#81858c] mb-1">Token 总量</div>
          <div className="text-xl font-semibold text-[#1d1d1f]">{totalTokens.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-2xl border border-[#e8ecf1] p-4">
          <div className="text-xs text-[#81858c] mb-1">Agent 数量</div>
          <div className="text-xl font-semibold text-[#1d1d1f]">{steps.length}</div>
        </div>
        <div className="bg-white rounded-2xl border border-[#e8ecf1] p-4">
          <div className="text-xs text-[#81858c] mb-1">完成进度</div>
          <div className="text-xl font-semibold text-[#1d1d1f]">{doneCount}/{steps.length}</div>
        </div>
      </div>

      {/* ── Timeline list ── */}
      <div className="bg-white rounded-2xl border border-[#e8ecf1] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#f0f2f5]">
          <span className="text-sm font-semibold text-[#1d1d1f]">Pipeline 时间轴</span>
        </div>
        {steps.map((step, i) => {
          const cfg = STATUS_CONFIG[step.status];
          const barWidth = (step.elapsedMs / maxElapsed) * 100;
          return (
            <div
              key={step.name}
              className={`flex items-center gap-3 px-4 py-3 ${i < steps.length - 1 ? 'border-b border-[#f5f6f8]' : ''}`}
            >
              {/* Status icon */}
              <span className={`text-lg ${cfg.className}`} title={cfg.text}>
                {cfg.icon}
              </span>

              {/* Agent icon + name */}
              <span className="text-base" style={{ minWidth: '1.5em' }}>
                {ICONS[step.name] || '🔹'}
              </span>
              <span className="text-sm font-medium text-[#1d1d1f]" style={{ minWidth: '80px' }}>
                {step.name}
              </span>

              {/* Elapsed */}
              <span className="text-xs text-[#81858c]" style={{ minWidth: '56px' }}>
                {(step.elapsedMs / 1000).toFixed(1)}s
              </span>

              {/* Tokens */}
              <span className="text-xs text-[#81858c]" style={{ minWidth: '64px' }}>
                {step.tokenCount > 0 ? `${step.tokenCount} tokens` : '—'}
              </span>

              {/* Progress bar */}
              <div className="flex-1 h-2 bg-[#f0f2f5] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${barWidth}%`,
                    background: step.status === 'running'
                      ? `linear-gradient(90deg, ${COLORS[step.name] || '#4f8cff'}, ${COLORS[step.name] || '#4f8cff'}88)`
                      : COLORS[step.name] || '#4f8cff',
                    opacity: step.status === 'pending' ? 0.3 : step.status === 'error' ? 0.5 : 1,
                  }}
                />
              </div>

              {/* Status label */}
              <span className={`text-xs font-medium ${cfg.className}`} style={{ minWidth: '44px', textAlign: 'right' }}>
                {cfg.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MonitorPage({ inlineSessionId }: { inlineSessionId?: string }) {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = inlineSessionId || searchParams.get('session_id');
  const [exporting, setExporting] = useState(false);
  const [reportContent, setReportContent] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['monitor-session', sessionId],
    queryFn: async () => {
      const res = await apiClient.get(`/monitor/session/${sessionId}`);
      const steps = res.data.steps || [];
      return steps.map((s: any) => ({
        name: s.name,
        status: s.status,
        elapsedMs: s.elapsed_ms,
        tokenCount: s.token_count,
      })) as Step[];
    },
    enabled: !!sessionId,
    refetchInterval: 5000, // Poll every 5s for live updates
  });

  const steps = data || [];

  // Build thinking data for report generation
  const mockThinking = steps.map((s) => ({
    name: s.name,
    content: `${s.name} 阶段${STATUS_CONFIG[s.status]?.text || '未知'}，耗时 ${(s.elapsedMs / 1000).toFixed(1)}s，消耗 ${s.tokenCount} tokens。`,
  }));

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const result = await generateReportApi(mockThinking);
      setReportContent(result.content || '报告生成失败');
      // Trigger download
      const blob = new Blob([result.content || ''], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report_${Date.now()}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('报告已导出');
    } catch {
      toast.error('报告导出失败');
    } finally {
      setExporting(false);
    }
  }, [mockThinking]);

  return (
    <div className="max-w-3xl mx-auto p-4">
      {/* ── 顶部导航栏 ── */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => navigate(`/v3/personal/${projectId}/chat`)}
          className="text-xs text-[#81858c] hover:text-[#4f8cff] transition-colors"
        >
          ← 返回对话
        </button>
        {steps.length > 0 && (
          <button
            disabled={exporting}
            onClick={handleExport}
            className="flex items-center gap-1 text-xs text-[#81858c] hover:text-[#4f8cff] transition-colors"
          >
            {exporting ? <span className="loading loading-spinner loading-xs" /> : '📄'} 导出报告
          </button>
        )}
      </div>

      {/* ── Pipeline Timeline ── */}
      {isLoading ? (
        <div className="flex justify-center py-10"><span className="loading loading-spinner text-[#4f8cff]" /></div>
      ) : isError ? (
        <div className="flex justify-center py-10 text-red-500">加载失败</div>
      ) : steps.length === 0 ? (
        <div className="flex justify-center py-10 text-gray-400">暂无步骤日志</div>
      ) : (
        <PipelineTimeline steps={steps} />
      )}

      {/* ── 仪表盘数据 ── */}
      {inlineSessionId && <EvalDashboard projectId={projectId} />}
    </div>
  );
}

// ── 仪表盘子组件 ──

function EvalDashboard({ projectId }: { projectId?: string }) {
  const [days, setDays] = useState(0);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['eval-stats', projectId, days],
    queryFn: async () => {
      const res = await apiClient.get(`/eval/stats/${projectId}?days=${days}`);
      return res.data as { total: number; avg_elapsed_ms: number; total_tokens: number; error_rate: number; task_types: Record<string, number>; daily: Array<{ day: string; cnt: number; avg_ms: number }> };
    },
    enabled: !!projectId,
    refetchInterval: 30000,
  });

  if (isLoading) return null;
  if (isError || !data || data.total === 0) return null;

  const pieData = Object.entries(data.task_types || {}).map(([name, value]) => ({ name, value }));

  return (
    <div className="mt-6 pt-5 border-t border-[#f0f2f5]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[#1d1d1f]">📊 执行仪表盘</h3>
        <select className="select select-bordered select-sm w-28" value={days} onChange={e => setDays(Number(e.target.value))}>
          <option value={0}>全部</option>
          <option value={7}>近7天</option>
          <option value={14}>近14天</option>
          <option value={30}>近30天</option>
        </select>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: '总执行次数', value: data.total.toLocaleString(), icon: '🚀' },
          { label: '平均耗时', value: formatMs(data.avg_elapsed_ms), icon: '⏱️' },
          { label: 'Token 总量', value: formatTokens(data.total_tokens), icon: '🧮' },
          { label: '错误率', value: `${data.error_rate.toFixed(1)}%`, icon: '⚠️' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-2xl border border-[#e8ecf1] p-4">
            <div className="flex items-center gap-2 mb-1"><span className="text-lg">{c.icon}</span><span className="text-xs text-[#81858c]">{c.label}</span></div>
            <div className="text-xl font-semibold text-[#1d1d1f]">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-[#e8ecf1] p-4">
          <h3 className="text-sm font-semibold text-[#1d1d1f] mb-3">任务类型分布</h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={2} dataKey="value">
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: '10px', border: '1px solid #e8ecf1', fontSize: '0.8rem' }} />
                <Legend wrapperStyle={{ fontSize: '0.7rem' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="flex items-center justify-center h-[220px] text-sm text-[#81858c]">暂无数据</div>}
        </div>

        <div className="bg-white rounded-2xl border border-[#e8ecf1] p-4">
          <h3 className="text-sm font-semibold text-[#1d1d1f] mb-3">每日执行趋势</h3>
          {(data.daily || []).length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#81858c' }} />
                <YAxis tick={{ fontSize: 11, fill: '#81858c' }} />
                <Tooltip contentStyle={{ borderRadius: '10px', border: '1px solid #e8ecf1', fontSize: '0.8rem' }} />
                <Line type="monotone" dataKey="cnt" name="执行次数" stroke="#4f8cff" strokeWidth={2} dot={{ r: 3, fill: '#4f8cff' }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="flex items-center justify-center h-[220px] text-sm text-[#81858c]">暂无数据</div>}
        </div>
      </div>
    </div>
  );
}
