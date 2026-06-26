export const ROLES = ['Planner', 'Retriever', 'Coder', 'Writer', 'Tester', 'Summarizer', 'Bot'] as const;
export type AgentRole = (typeof ROLES)[number];
