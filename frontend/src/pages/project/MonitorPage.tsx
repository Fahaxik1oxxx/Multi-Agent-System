import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { generateReportApi } from '@/api/client';
import { toast } from 'sonner';

// ── Agent constants (same as ChatPage) ──
const ICONS: Record<string, string> = {
  Planner: '🧋', Retriever: '🐍', Coder: '🫻', Writer: '✍️',
  Tester: '✅', Summarizer: '🧊', Bot: '🤖', Executor: '⚙️',
};
const COLORS: Record<string, string> = {
  Planner: '#4f8cff', Retriever: '#8b5cf6', Coder: '#10b981',
  Writer: '#f59e0b', Tester: '#ef4444', Summarizer: '#4f8cff',
  Bot: '#10b981', Executor: '#8b5cf6',
};

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

const MOCK_STEPS: Step[] = [
  { name: 'Planner',    status: 'done',    elapsedMs: 2100, tokenCount: 850 },
  { name: 'Retriever',  status: 'done',    elapsedMs: 1200, tokenCount: 420 },
  { name: 'Coder',      status: 'done',    elapsedMs: 3500, tokenCount: 1800 },
  { name: 'Executor',   status: 'done',    elapsedMs: 400,  tokenCount: 0 },
  { name: 'Tester',     status: 'done',    elapsedMs: 1800, tokenCount: 650 },
  { name: 'Summarizer', status: 'running', elapsedMs: 500,  tokenCount: 200 },
];

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

export function MonitorPage() {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [reportContent, setReportContent] = useState<string | null>(null);
  const reportDialogRef = useState<HTMLDialogElement | null>(null);

  // Build mock thinking data for report generation
  const mockThinking = MOCK_STEPS.map((s) => ({
    name: s.name,
    content: `${s.name} 阶段${STATUS_CONFIG[s.status].text}，耗时 ${(s.elapsedMs / 1000).toFixed(1)}s，消耗 ${s.tokenCount} tokens。`,
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
      {/* ── Tab navigation ── */}
      <div className="flex items-center gap-1 mb-4 text-sm">
        <button
          className="text-[#81858c] hover:text-[#1d1d1f] transition-colors"
          onClick={() => navigate(`/v3/personal/${projectId}/chat`)}
        >
          💬 对话
        </button>
        <span className="text-[#d0d4d8] select-none">|</span>
        <span className="text-[#4f8cff] font-medium">📡 监控</span>
        <span className="text-[#d0d4d8] select-none">|</span>
        <button
          className="text-[#81858c] hover:text-[#1d1d1f] transition-colors"
          onClick={() => navigate(`/v3/personal/${projectId}/chat`)}
        >
          📊 仪表盘
        </button>
      </div>

      {/* ── Pipeline Timeline ── */}
      <PipelineTimeline steps={MOCK_STEPS} />

      {/* ── Action buttons ── */}
      <div className="flex items-center gap-3 mt-5">
        <button
          className="btn btn-sm"
          style={{ background: '#f0f2f5', color: '#1d1d1f', borderRadius: '10px', border: 'none' }}
          onClick={() => navigate(`/v3/personal/${projectId}/chat`)}
        >
          💬 查看对话
        </button>
        <button
          className="btn btn-sm"
          disabled={exporting}
          onClick={handleExport}
          style={{ background: 'var(--brand-primary, #4f8cff)', color: '#fff', borderRadius: '10px', border: 'none' }}
        >
          {exporting ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            '📄 导出报告'
          )}
        </button>
      </div>
    </div>
  );
}
