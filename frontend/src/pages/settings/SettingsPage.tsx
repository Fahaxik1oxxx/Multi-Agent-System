import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Loader2, Key, Trash2, Eye, EyeOff } from 'lucide-react';
import { userApi } from '@/api/user';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

export function SettingsPage() {
  const { user, setAuth } = useAuthStore();

  // Profile
  const [editName, setEditName] = useState('');
  const [editPassword, setEditPassword] = useState('');

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const res = await userApi.getProfile();
      setEditName(res.data.user_name);
      return res.data;
    },
  });

  const profileMutation = useMutation({
    mutationFn: async () => {
      const data: { name?: string; password?: string } = {};
      if (editName && editName !== user?.user_name) data.name = editName;
      if (editPassword) data.password = editPassword;
      if (Object.keys(data).length === 0) throw new Error('无变更');
      await userApi.updateProfile(data);
    },
    onSuccess: () => {
      toast.success('个人信息已更新');
      setEditPassword('');
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message || '更新失败';
      if (msg === '无变更') return;
      const apiErr = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(apiErr || msg);
    },
  });

  // API Key
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  const { data: keyStatus } = useQuery({
    queryKey: ['api-key-status'],
    queryFn: async () => {
      const res = await userApi.getApiKeyStatus();
      return res.data;
    },
  });

  const saveKeyMutation = useMutation({
    mutationFn: async (key: string) => {
      await userApi.saveApiKey(key);
    },
    onSuccess: () => {
      toast.success('API Key 已保存');
      setApiKey('');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '保存失败';
      toast.error(msg);
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: () => userApi.deleteApiKey(),
    onSuccess: () => toast.success('已恢复使用系统默认 API Key'),
    onError: () => toast.error('操作失败'),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">个人设置</h1>
        <p className="text-muted-foreground mt-1">管理你的账号信息和 API Key</p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
          <CardDescription>修改用户名或密码</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>用户 ID</Label>
            <Input value={profile?.user_id ?? ''} disabled className="font-mono text-sm" />
          </div>
          <div className="space-y-2">
            <Label>用户名</Label>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder={user?.user_name}
            />
          </div>
          <div className="space-y-2">
            <Label>新密码（留空不修改）</Label>
            <Input
              type="password"
              value={editPassword}
              onChange={(e) => setEditPassword(e.target.value)}
              placeholder="至少 6 位"
            />
          </div>
          <Button onClick={() => profileMutation.mutate()} disabled={profileMutation.isPending}>
            {profileMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存更改
          </Button>
        </CardContent>
      </Card>

      {/* API Key */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            API Key 管理
          </CardTitle>
          <CardDescription>
            配置你的 LLM API Key。留空则使用平台默认免费 Key。
            {!keyStatus?.has_custom_key && (
              <Badge variant="secondary" className="ml-2">当前使用系统默认</Badge>
            )}
            {keyStatus?.has_custom_key && (
              <Badge className="ml-2">正在使用自定义 Key</Badge>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>DeepSeek API Key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                onClick={() => saveKeyMutation.mutate(apiKey)}
                disabled={!apiKey.trim() || saveKeyMutation.isPending}
              >
                保存
              </Button>
            </div>
          </div>
          {keyStatus?.has_custom_key && (
            <Button variant="outline" onClick={() => deleteKeyMutation.mutate()}>
              <Trash2 className="mr-2 h-4 w-4" />
              删除自定义 Key，使用系统默认
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
