/**
 * Research execution engine preference store.
 *
 * Lets users choose between:
 * - 'cloud': Sentinel Cloud Agent (Cloud Run multi-pass research pipeline + 24/7 CourtListener monitor)
 * - 'local': Local Engine (in-browser / IPC grounded search via local Gemini API key)
 */
import { create } from 'zustand';
import { isCommunityDesktop } from './runtime';
import { isSentinelConfigured } from '../sentinelApi';

export type EngineChoice = 'cloud' | 'local';

const STORAGE_KEY = 'mi.researchEngine';

/**
 * Pure default-selection rule: Sentinel Cloud is only ever chosen when it is
 * actually configured; otherwise (or on community desktop) use the Local Engine.
 */
export function resolveEngine(stored: unknown, sentinelConfigured: boolean): EngineChoice {
  if (stored === 'cloud' && sentinelConfigured) return 'cloud';
  return 'local';
}

function readLocalEngine(): EngineChoice {
  if (isCommunityDesktop()) return 'local';
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return resolveEngine(stored, isSentinelConfigured());
}

function writeLocalEngine(choice: EngineChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* ignore */
  }
}

interface EngineState {
  engine: EngineChoice;
  setEngine: (engine: EngineChoice) => void;
}

export const useEngineChoice = create<EngineState>((set) => ({
  engine: readLocalEngine(),
  setEngine: (engine) => {
    if (isCommunityDesktop()) engine = 'local';
    engine = resolveEngine(engine, isSentinelConfigured());
    writeLocalEngine(engine);
    set({ engine });
  },
}));
