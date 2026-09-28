import { create } from 'zustand';
import { storage, StorageKeys } from '@/lib/storage';

interface UIState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (value: boolean) => void;
  setMobileNavOpen: (value: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: storage.get<boolean>(StorageKeys.SIDEBAR_COLLAPSED) ?? false,
  mobileNavOpen: false,

  toggleSidebar: () =>
    set((s) => {
      const next = !s.sidebarCollapsed;
      storage.set(StorageKeys.SIDEBAR_COLLAPSED, next);
      return { sidebarCollapsed: next };
    }),

  setSidebarCollapsed: (value) => {
    storage.set(StorageKeys.SIDEBAR_COLLAPSED, value);
    set({ sidebarCollapsed: value });
  },

  setMobileNavOpen: (value) => set({ mobileNavOpen: value }),
}));
