interface SessionInfoTabProps {
  taskType: string;
  complexity: string;
  agentStats: Map<string, { elapsed_ms: number; token_count: number }>;
  thinkingOrder: string[];
  onExport: () => void;
  exporting?: boolean;
}

export function SessionInfoTab({ taskType, complexity, agentStats, thinkingOrder, onExport, exporting }: SessionInfoTabProps) {
  const totalTokens = Array.from(agentStats.values()).reduce((sum, s) => sum + s.token_count, 0);
  const totalElapsed = Array.from(agentStats.values()).reduce((sum, s) => sum + s.elapsed_ms, 0);
  const taskLabels: Record<string, string> = { '编程': '💻', '写作': '📝', '分析': '📊', '问答': '💬' };
  return (
    <div>
      <h3 className="text-sm font-semibold text-[#1d1d1f] mb-3">会话信息</h3>
      <div className="space-y-2 mb-4">
        <div className="flex justify-between text-xs"><span className="text-[#81858c]">任务类型</span><span className="text-[#1d1d1f] font-medium">{taskType ? (taskLabels[taskType] || '') + ' ' + taskType : '—'}</span></div>
        <div className="flex justify-between text-xs"><span className="text-[#81858c]">复杂度</span><span className="text-[#1d1d1f] font-medium">{complexity || '—'}</span></div>
        <div className="flex justify-between text-xs"><span className="text-[#81858c]">总耗时</span><span className="text-[#1d1d1f] font-medium">{totalElapsed > 1000 ? (totalElapsed / 1000).toFixed(1) + 's' : totalElapsed + 'ms'}</span></div>
        <div className="flex justify-between text-xs"><span className="text-[#81858c]">Token 消耗</span><span className="text-[#1d1d1f] font-medium">{totalTokens.toLocaleString()}</span></div>
      </div>
      {thinkingOrder.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-medium text-[#81858c] mb-2">执行顺序</h4>
          <div className="flex flex-wrap gap-1">
            {thinkingOrder.map((name, i) => (
              <span key={name + i} className="text-[10px] px-1.5 py-0.5 rounded bg-[#f0f2f5] text-[#81858c]">{name}{i < thinkingOrder.length - 1 ? ' →' : ''}</span>
            ))}
          </div>
        </div>
      )}
      {agentStats.size > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-medium text-[#81858c] mb-2">Agent 统计</h4>
          <div className="space-y-1">
            {Array.from(agentStats.entries()).map(([name, stats]) => (
              <div key={name} className="flex justify-between text-[10px]">
                <span className="text-[#81858c]">{name}</span>
                <span className="text-[#1d1d1f]">{stats.elapsed_ms > 1000 ? (stats.elapsed_ms / 1000).toFixed(1) + 's' : stats.elapsed_ms + 'ms'} · {stats.token_count} tokens</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <button className="btn btn-sm w-full" style={{ background: 'var(--brand-primary)', color: '#fff', borderRadius: '10px', border: 'none' }} onClick={onExport} disabled={exporting}>
        {exporting ? <span className="loading loading-spinner loading-xs" /> : '📄 导出报告'}
      </button>
    </div>
  );
}
