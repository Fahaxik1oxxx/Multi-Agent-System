import { create } from 'zustand';

interface WorkspaceStore {
  currentWorkspaceId: string | null;
  currentProjectId: string | null;
  setWorkspace: (id: string | null) => void;
  setProject: (id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  currentWorkspaceId: null,
  currentProjectId: null,
  setWorkspace: (id) => set({ currentWorkspaceId: id, currentProjectId: null }),
  setProject: (id) => set({ currentProjectId: id }),
}));
