# Task 13 Report: TemplateMarket Dynamic Loading

## Summary
Updated `TemplateMarket.tsx` to load templates from the backend API dynamically instead of using the static `TEMPLATES` constant.

## Changes Made

### File: `frontend/src/pages/templates/TemplateMarket.tsx`

1. **Imports updated:**
   - Added `useQuery` from `@tanstack/react-query`
   - Added `marketApi` to the import from `@/api/projects`
   - Changed `{ TEMPLATES, type Template }` import to `type { Template }` only (type-only import)

2. **Data fetching hook added:**
   ```typescript
   const { data: templates, isLoading } = useQuery({
     queryKey: ['market-templates'],
     queryFn: async () => {
       const res = await marketApi.list();
       return res.data;
     },
   });
   ```

3. **Copy handler added:**
   ```typescript
   const handleCopy = async (id: string) => {
     try {
       await marketApi.copy(id);
       toast.success('已复制到我的配置');
     } catch { toast.error('复制失败'); }
   };
   ```

4. **Loading spinner:** A centered loading spinner is displayed while `isLoading` is true.

5. **Data source swapped:** Replaced the static `TEMPLATES` array with `(templates || [])` from the API.

6. **Copy button:** Each template card now renders a "复制" (copy) button at the bottom (separated by a border), which calls `handleCopy(template.id)` with `e.stopPropagation()` to prevent triggering the card's main click handler.

## Verification
- `npx tsc --noEmit` — zero errors related to TemplateMarket.
- All existing UI styling and layout preserved (cards, dialog, navigation flow unchanged).
- The static `TEMPLATES` constant and the `@/data/templates` file remain unchanged for reference/fallback purposes.
