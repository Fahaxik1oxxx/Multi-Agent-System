import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageSquare, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => navigate(`/w/${workspaceId}/p/${project.id}/chat`)}
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <CardTitle className="text-base">{project.name}</CardTitle>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/w/${workspaceId}/p/${project.id}/chat`);
              }}
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(project.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <CardDescription className="line-clamp-2">
          {project.description || '暂无描述'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          创建于 {project.created_at?.slice(0, 10)}
        </p>
      </CardContent>
    </Card>
  );
}
