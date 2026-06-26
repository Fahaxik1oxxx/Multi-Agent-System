export interface Workspace {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  is_public: number;
  created_at: string;
  role?: string;
  members?: WorkspaceMember[];
  projects?: Project[];
  my_role?: string;
}

export interface WorkspaceMember {
  user_id: string;
  name: string;
  role: 'owner' | 'member' | 'viewer';
  joined_at: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  agent_config: string;
  created_by: string;
  created_at: string;
}
