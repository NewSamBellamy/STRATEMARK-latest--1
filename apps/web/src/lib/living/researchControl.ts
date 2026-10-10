import { create } from 'zustand';

export const RESEARCH_CONTROL_KEY = 'mi.backgroundResearch.v1';
type ControlStorage = Pick<Storage, 'getItem' | 'setItem'>;
interface ResearchControl {
  paused: boolean;
  storageError: string | null;
  setPaused: (paused: boolean) => void;
  reload: () => void;
}

/** Workspace-wide scheduling preference; no keys or research data are stored here. */
export function createResearchControl(storage: ControlStorage) {
  const read = () => {
    try {
      const raw = storage.getItem(RESEARCH_CONTROL_KEY);
      if (raw == null) return { paused: false, storageError: null };
      const value = JSON.parse(raw);
      if (value?.version !== 1 || typeof value.paused !== 'boolean') throw new Error('Invalid preference');
      return { paused: value.paused as boolean, storageError: null };
    } catch {
      return { paused: true, storageError: 'Background research is paused because its saved setting could not be read.' };
    }
  };
  return create<ResearchControl>((set) => ({
    ...read(),
    reload: () => set(read()),
    setPaused: paused => {
      try {
        storage.setItem(RESEARCH_CONTROL_KEY, JSON.stringify({ version: 1, paused }));
        set({ paused, storageError: null });
      } catch {
        // Never acknowledge a durable pause or start spending after a failed resume save.
        set({ paused: true, storageError: 'Paused in this window, but the setting could not be saved. Other windows or a restart may not retain it.' });
      }
    },
  }));
}

export const useResearchControl = createResearchControl({
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
});
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === RESEARCH_CONTROL_KEY || event.key === null) useResearchControl.getState().reload();
  });
}
