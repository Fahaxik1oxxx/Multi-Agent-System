// Agent 元数据 —— 单一数据源，所有页面和组件从这里引用

export interface AgentMeta {
  key: string;
  icon: string;
  label: string;
  color: string;
  desc: string;
}

export const ALL_AGENTS: AgentMeta[] = [
  { key: 'Planner',    icon: '🧋', label: 'Planner',    color: '#4f8cff', desc: '任务规划' },
  { key: 'Retriever',  icon: '🐍', label: 'Retriever',  color: '#10b981', desc: '知识检索' },
  { key: 'Coder',      icon: '💻', label: 'Coder',      color: '#f59e0b', desc: '编写代码' },
  { key: 'Writer',     icon: '✍️', label: 'Writer',     color: '#8b5cf6', desc: '撰写文档' },
  { key: 'Executor',   icon: '⚙️', label: 'Executor',   color: '#ef4444', desc: '执行代码' },
  { key: 'Tester',     icon: '✅', label: 'Tester',     color: '#06b6d4', desc: 'QA审阅' },
  { key: 'Summarizer', icon: '🧊', label: 'Summarizer', color: '#ec4899', desc: '生成报告' },
  { key: 'Bot',        icon: '🤖', label: 'Bot',        color: '#81858c', desc: '快捷问答' },
];

// 导出给组件直接使用的映射
export const AGENT_META: Record<string, Omit<AgentMeta, 'key'>> = {};
export const AGENT_ICONS: Record<string, string> = {};
export const AGENT_COLORS: Record<string, string> = {};

for (const a of ALL_AGENTS) {
  AGENT_META[a.key] = { icon: a.icon, label: a.label, color: a.color, desc: a.desc };
  AGENT_ICONS[a.key] = a.icon;
  AGENT_COLORS[a.key] = a.color;
}
