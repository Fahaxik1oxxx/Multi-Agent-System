# Task 4 Report: 编排保存同步 agent_states

**Status:** Completed
**Commit:** `2f2d25c` on branch `Fahaxik1oxxx`

## Changes Made

### 1. `frontend/src/pages/project/OrchestrationPage.tsx` (lines 160-182)

Modified `saveMutation.mutationFn` to:

1. Scan all pipeline nodes for `type === 'agent'` entries
2. Default all pipeline agents to `'on'` state
3. Preserve any existing `'off'` states from `initialData.agent_states`
4. Pass `{ pipeline: p, agent_states: agentStates }` instead of just the pipeline config

### 2. `frontend/src/api/projects.ts` (lines 25-31)

Updated the `updateAgentConfig` API handler to forward `pipeline` alongside `agent_states` when both are present. Previously, the `'agent_states' in data` branch only sent `agent_states`, discarding any pipeline data.

## Verification

- TypeScript compilation: clean, no errors
- Behavior: When the user clicks "保存流水线" in OrchestrationPage, agent_states are now automatically built from the pipeline nodes and included in the save payload
- Agent states sync: agents in the pipeline default to `'on'`, existing `'off'` states are preserved, and agents not in the pipeline are implicitly absent from the state map
