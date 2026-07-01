export interface Template {
  id: string;
  name: string;
  agents: string[];
  description?: string;
  icon?: string;
  suggestedMessage?: string;
  author_name?: string;
  pipeline?: any;
}

export const TEMPLATES: Template[] = [
  {
    id: 'tpl-code-helper',
    name: '代码助手',
    description: '编写、执行、审查 Python 代码',
    icon: '💻',
    agents: ['Planner', 'Retriever', 'Coder', 'Executor', 'Tester', 'Summarizer'],
    suggestedMessage: '请帮我编写一个 Python 函数，实现...',
  },
  {
    id: 'tpl-data-analysis',
    name: '数据分析',
    description: '上传 CSV，自动聚合分析、生成图表',
    icon: '📊',
    agents: ['Planner', 'Retriever', 'Coder', 'Executor', 'Summarizer'],
    suggestedMessage: '请分析我上传的数据文件，按指定维度分组统计并生成图表',
  },
  {
    id: 'tpl-writing',
    name: '论文写作',
    description: '结构化撰写学术论文或技术报告',
    icon: '📝',
    agents: ['Planner', 'Retriever', 'Writer', 'Tester', 'Summarizer'],
    suggestedMessage: '请帮我撰写一篇关于...的学术论文',
  },
  {
    id: 'tpl-quick-qa',
    name: '快速问答',
    description: '简洁直接的 AI 问答，无需复杂流程',
    icon: '⚡',
    agents: ['Bot'],
    suggestedMessage: '请解释...',
  },
  {
    id: 'tpl-code-review',
    name: '代码审查',
    description: '审查代码质量、安全性和最佳实践',
    icon: '🔍',
    agents: ['Planner', 'Coder', 'Tester', 'Summarizer'],
    suggestedMessage: '请审查以下代码的质量和安全性：',
  },
  {
    id: 'tpl-knowledge-qa',
    name: '知识问答',
    description: '结合知识库的深度问答',
    icon: '📚',
    agents: ['Planner', 'Retriever', 'Summarizer'],
    suggestedMessage: '根据知识库内容，请解释...',
  },
];
