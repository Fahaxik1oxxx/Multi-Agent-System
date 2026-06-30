import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/api/client';
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line,
  ResponsiveContainer, Legend,
} from 'recharts';

// ── Types ──

interface EvalStats {
  total: number;
  avg_elapsed_ms: number;
  total_tokens: number;
  error_rate: number;
  task_types: Record<string, number>;
  daily: Array<{ day: string; cnt: number; avg_ms: number }>;
}

const PIE_COLORS = ['#4f8cff', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

// ── Helpers ──

const fallbackStats: EvalStats = {
  total: 0,
  avg_elapsed_ms: 0,
  total_tokens: 0,
  error_rate: 0,
  task_types: {},
  daily: [],
};

const formatMs = (ms: number): string => {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
};

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

// ── Sub-components ──

function OverviewCards({ stats }: { stats: EvalStats }) {
  const cards = [
    { label: '总执行次数', value: stats.total.toLocaleString(), icon: '🚀' },
    { label: '平均耗时',   value: formatMs(stats.avg_elapsed_ms),  icon: '⏱️' },
    { label: 'Token 总量', value: formatTokens(stats.total_tokens), icon: '🧮' },
    { label: '错误率',     value: `${(stats.error_rate * 100).toFixed(1)}%`, icon: '⚠️' },
  ];

  return (
    <div className="grid grid-cols-4 gap-3 mb-5">
      {cards.map((c) => (
        <div key={c.label} className="bg-white rounded-2xl border border-[#e8ecf1] p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{c.icon}</span>
            <span className="text-xs text-[#81858c]">{c.label}</span>
          </div>
          <div className="text-xl font-semibold text-[#1d1d1f]">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function Charts({ stats }: { stats: EvalStats }) {
  const pieData = Object.entries(stats.task_types).map(([name, value]) => ({ name, value }));
  const hasPieData = pieData.length > 0;
  const hasDailyData = stats.daily.length > 0;

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* ── Pie: task type distribution ── */}
      <div className="bg-white rounded-2xl border border-[#e8ecf1] p-4">
        <h3 className="text-sm font-semibold text-[#1d1d1f] mb-3">任务类型分布</h3>
        {hasPieData ? (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={95}
                paddingAngle={2}
                dataKey="value"
              >
                {pieData.map((_, idx) => (
                  <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ borderRadius: '10px', border: '1px solid #e8ecf1', fontSize: '0.8rem' }}
              />
              <Legend
                wrapperStyle={{ fontSize: '0.75rem' }}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[260px] text-sm text-[#81858c]">
            暂无数据
          </div>
        )}
      </div>

      {/* ── Line: daily trend ── */}
      <div className="bg-white rounded-2xl border border-[#e8ecf1] p-4">
        <h3 className="text-sm font-semibold text-[#1d1d1f] mb-3">每日执行趋势（近14天）</h3>
        {hasDailyData ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={stats.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#81858c' }} />
              <YAxis tick={{ fontSize: 11, fill: '#81858c' }} />
              <Tooltip
                contentStyle={{ borderRadius: '10px', border: '1px solid #e8ecf1', fontSize: '0.8rem' }}
              />
              <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
              <Line
                type="monotone"
                dataKey="cnt"
                name="执行次数"
                stroke="#4f8cff"
                strokeWidth={2}
                dot={{ r: 3, fill: '#4f8cff' }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[260px] text-sm text-[#81858c]">
            暂无数据
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ──

export function EvaluationPage() {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const navigate = useNavigate();
  const [days, setDays] = useState<number>(0);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['eval-stats', projectId, days],
    queryFn: async () => {
      const res = await apiClient.get<EvalStats>(`/eval/stats/${projectId}?days=${days}`);
      return res.data;
    },
    enabled: !!projectId,
    refetchInterval: 30000,
  });

  const stats = data ?? fallbackStats;

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="flex justify-end mb-4">
        <select
          className="select select-bordered select-sm w-32"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={0}>全部时间</option>
          <option value={7}>近7天</option>
          <option value={14}>近14天</option>
          <option value={30}>近30天</option>
        </select>
      </div>

      {/* ── Content ── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <span className="loading loading-spinner loading-lg text-[#4f8cff]" />
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <p className="text-sm text-[#81858c]">数据加载失败，请稍后重试</p>
          </div>
        </div>
      ) : stats.total === 0 ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="text-4xl mb-3">📊</div>
            <p className="text-sm text-[#81858c]">暂无数据</p>
          </div>
        </div>
      ) : (
        <>
          <OverviewCards stats={stats} />
          <Charts stats={stats} />
        </>
      )}
    </div>
  );
}
