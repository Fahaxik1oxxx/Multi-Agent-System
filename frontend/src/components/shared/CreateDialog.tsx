import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';

interface CreateDialogProps {
  title: string;
  description: string;
  triggerLabel: string;
  nameLabel?: string;
  namePlaceholder?: string;
  descLabel?: string;
  descPlaceholder?: string;
  showDescription?: boolean;
  onSubmit: (name: string, description: string) => Promise<void>;
}

export function CreateDialog({
  title,
  description,
  triggerLabel,
  nameLabel = '名称',
  namePlaceholder = '输入名称',
  descLabel = '描述',
  descPlaceholder = '可选描述',
  showDescription = true,
  onSubmit,
}: CreateDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await onSubmit(name.trim(), desc.trim());
      setOpen(false);
      setName('');
      setDesc('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{nameLabel}</Label>
            <Input
              placeholder={namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
          </div>
          {showDescription && (
            <div className="space-y-2">
              <Label>{descLabel}</Label>
              <Textarea
                placeholder={descPlaceholder}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={3}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={loading || !name.trim()}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
