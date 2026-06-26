export type WorkspaceRole = 'admin' | 'owner' | 'member' | 'viewer';
export type Action = 'view' | 'edit' | 'delete' | 'invite' | 'manage';

const ROLE_LEVEL: Record<WorkspaceRole, number> = {
  admin: 4,
  owner: 3,
  member: 2,
  viewer: 1,
};

const ACTION_LEVEL: Record<Action, number> = {
  view: 1,
  edit: 2,
  delete: 3,
  invite: 3,
  manage: 4,
};

export function hasPermission(role: WorkspaceRole | null, action: Action): boolean {
  if (!role) return false;
  return ROLE_LEVEL[role] >= ACTION_LEVEL[action];
}
