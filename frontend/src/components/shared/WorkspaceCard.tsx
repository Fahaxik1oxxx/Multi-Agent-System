import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import type { Workspace } from '@/types/workspace';

const roleLabels: Record<string, string> = {
  owner: 'Owner',
  member: 'Member',
  viewer: 'Viewer',
};

const roleColors: Record<string, string> = {
  owner: 'badge-primary',
  member: 'badge-ghost',
  viewer: 'badge-ghost',
};

export function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  const navigate = useNavigate();

  return (
    <div
      className="card bg-base-100 border border-[#e0e4e8] shadow-sm cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => navigate(`/w/${workspace.id}`)}
    >
      <div className="card-body p-4">
        <div className="flex items-start justify-between">
          <h3 className="card-title text-lg text-[#1d1d1f]">{workspace.name}</h3>
          <span className={`badge ${roleColors[workspace.role || 'member']} text-xs`}>
            {roleLabels[workspace.role || 'member']}
          </span>
        </div>
        <p className="text-sm text-[#81858c] line-clamp-2">
          {workspace.description || '暂无描述'}
        </p>
        <div className="flex items-center gap-1 text-xs text-[#81858c] mt-1">
          <Users size={14} />
          <span>{workspace.created_at?.slice(0, 10)}</span>
        </div>
      </div>
    </div>
  );
}
