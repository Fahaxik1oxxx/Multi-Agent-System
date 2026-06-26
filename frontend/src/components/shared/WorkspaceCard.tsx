import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users } from 'lucide-react';
import type { Workspace } from '@/types/workspace';

export function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  const navigate = useNavigate();

  const roleLabels: Record<string, string> = {
    owner: 'Owner',
    member: 'Member',
    viewer: 'Viewer',
  };

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => navigate(`/w/${workspace.id}`)}
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg">{workspace.name}</CardTitle>
          <Badge variant="secondary">{roleLabels[workspace.role || 'member']}</Badge>
        </div>
        <CardDescription className="line-clamp-2">
          {workspace.description || '暂无描述'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span>{workspace.created_at?.slice(0, 10)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
