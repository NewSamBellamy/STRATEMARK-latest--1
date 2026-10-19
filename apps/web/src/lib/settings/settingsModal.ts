import { create } from 'zustand';

export type SettingsTab = 'general' | 'engine' | 'data' | 'usage' | 'about';

interface SettingsModalState {
  isOpen: boolean;
  /** The tab to show on open; null keeps the modal's own default. */
  tab: SettingsTab | null;
  /** Accepts a tab id; anything else (e.g. a click event when used as a handler) is ignored. */
  open: (tab?: unknown) => void;
  close: () => void;
}

const TABS: readonly SettingsTab[] = ['general', 'engine', 'data', 'usage', 'about'];

export const useSettingsModal = create<SettingsModalState>((set) => ({
  isOpen: false,
  tab: null,
  open: (tab) => set({ isOpen: true, tab: TABS.includes(tab as SettingsTab) ? (tab as SettingsTab) : null }),
  close: () => set({ isOpen: false, tab: null }),
}));
