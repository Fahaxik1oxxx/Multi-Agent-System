# Task 11 Report: OrchestrationPage save onSuccess -- localStorage to API

## File Changed
- `frontend/src/pages/project/OrchestrationPage.tsx`

## Changes Made

### 1. Added `configsApi` import (line 4)
```typescript
import { projectsApi, configsApi } from '@/api/projects';
```

### 2. Replaced localStorage write with API call in `saveMutation.onSuccess`
Removed the try/catch block that serialized pipeline configs to `localStorage` under key `v3_configs_${projectId}`. Replaced with:
```typescript
const agentNames = pipeline.nodes.filter(n => n.type === 'agent' && n.data?.agent).map(n => n.data!.agent!);
configsApi.create({
  name: `编排配置 ${new Date().toLocaleTimeString('zh-CN')}`,
  agents: agentNames,
  project_id: projectId,
  pipeline: pipeline,
}).catch(() => { /* non-critical */ });
```

### 3. Full onSuccess callback after change
```typescript
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ['agent-config', projectId] });
  setDirty(false);
  const agentNames = pipeline.nodes.filter(n => n.type === 'agent' && n.data?.agent).map(n => n.data!.agent!);
  configsApi.create({
    name: `编排配置 ${new Date().toLocaleTimeString('zh-CN')}`,
    agents: agentNames,
    project_id: projectId,
    pipeline: pipeline,
  }).catch(() => { /* non-critical */ });
  toast.success('流水线已保存');
  window.dispatchEvent(new CustomEvent('orchestra-saved'));
  setTimeout(() => navigate(`/v3/personal/${projectId}/agents`, { state: { tab: 'custom' } }), 600);
},
```

## Verification
- `npx tsc --noEmit` passed with no errors for `OrchestrationPage`
- `configsApi` is exported from `@/api/projects` (line 36 of `frontend/src/api/projects.ts`)
