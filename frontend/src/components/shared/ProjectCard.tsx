import { useNavigate, useParams } from 'react-router-dom';
import { MessageSquare, Trash2 } from 'lucide-react';
import type { Project } from '@/types/workspace';
import { hasPermission } from '@/lib/permissions';

interface ProjectCardProps {
  project: Project;
  myRole: string | null;
  onDelete: (id: string) => void;
}

export function ProjectCard({ project, myRole, onDelete }: ProjectCardProps) {
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const canDelete = hasPermission(myRole as Parameters<typeof hasPermission>[0], 'delete');

  return (
    <div
      className="card bg-base-100 border border-[#e0e4e8] shadow-sm cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => navigate(`/w/${workspaceId}/p/${project.id}/chat`)}
    >
      <div className="card-body p-4">
        <div className="flex items-start justify-between">
          <h3 className="card-title text-base text-[#1d1d1f]">{project.name}</h3>
          <div className="flex gap-1">
            <button
              className="btn btn-ghost btn-sm btn-square h-8 w-8"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/w/${workspaceId}/p/${project.id}/chat`);
              }}
            >
              <MessageSquare size={16} />
            </button>
            {canDelete && (
              <button
                className="btn btn-ghost btn-sm btn-square h-8 w-8 text-red-500"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(project.id);
                }}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>
        <p className="text-sm text-[#81858c] line-clamp-2">
          {project.description || '暂无描述'}
        </p>
        <p className="text-xs text-[#81858c] mt-1">
          创建于 {project.created_at?.slice(0, 10)}
        </p>
      </div>
    </div>
  );
}
