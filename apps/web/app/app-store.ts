"use client";

import { create } from "zustand";

export type MainView = "tasks" | "focus" | "trajectory";
export type PendingMutationState = "syncing" | "retry";

interface AppUiState {
  view: MainView;
  selectedListId: string | null;
  selectedItemId: string | null;
  pendingItems: Record<string, PendingMutationState>;
  setView(view: MainView): void;
  selectList(id: string | null): void;
  selectItem(id: string | null): void;
  setPendingItem(id: string, state: PendingMutationState): void;
  clearPendingItem(id: string): void;
}

export const useAppStore = create<AppUiState>((set) => ({
  view: "tasks",
  selectedListId: null,
  selectedItemId: null,
  pendingItems: {},
  setView: (view) => set({ view }),
  selectList: (selectedListId) => set({ selectedListId }),
  selectItem: (selectedItemId) => set({ selectedItemId }),
  setPendingItem: (id, state) => set((current) => ({ pendingItems: { ...current.pendingItems, [id]: state } })),
  clearPendingItem: (id) => set((current) => {
    const pendingItems = { ...current.pendingItems };
    delete pendingItems[id];
    return { pendingItems };
  }),
}));
