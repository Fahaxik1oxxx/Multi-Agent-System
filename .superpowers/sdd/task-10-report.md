# Task 10: Migrate ConfigBuilderPage handleSave from localStorage to API

**Status:** Complete

## Changes

**File:** `frontend/src/pages/chat/ConfigBuilderPage.tsx`

1. Added import: `import { configsApi } from '@/api/projects';`
2. Replaced `handleSave` from a synchronous localStorage-based function to an async API-based function.
   - **Before:** Read/wrote `v3_configs_${projectId}` key in localStorage, using `JSON.parse`/`JSON.stringify`.
   - **After:** Calls `configsApi.create({ name, agents, project_id: projectId })`, persists via the backend API.

## Verification

- `npx tsc --noEmit` — zero ConfigBuilder-related errors.
