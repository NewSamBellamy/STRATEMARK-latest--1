/**
 * RepositoryProvider — the single place the data backend is chosen:
 *
 *   window.mi present        → IpcRepository (Electron + SQLite, later)
 *   Gemini API key present   → GeminiRepository (LIVE grounded research)
 *   otherwise                → MockRepository (demo / sample data)
 *
 * The whole app talks only to the MarketIntelRepository interface, so flipping
 * between demo and live research is exactly this one decision — no UI changes.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MarketIntelRepository } from '@mi/contracts';
import { MockRepository, type SeedSnapshot } from '@mi/mocks';
import sampleSnapshot from '@/sample/frontier-snapshot.json';
import { GeminiRepository } from '@mi/research';
import { IpcRepository, isElectron } from './ipc-repository';
import { SentinelRepository } from '@/lib/repository/SentinelRepository';
import { createLocalStore } from './localStore';
import { hydrateFromVault } from './vault';
import { useApiKey } from '@/lib/settings/apiKey';
import { useEngineChoice } from '@/lib/settings/engine';
import { recordCall } from '@/lib/usage';

const RepositoryContext = createContext<MarketIntelRepository | null>(null);

export function selectRepository(
  apiKey: string,
  model: string,
  engine?: string,
): MarketIntelRepository {
  if (isElectron() && window.mi) {
    return new IpcRepository(window.mi);
  }
  if (engine === 'cloud') {
    return new SentinelRepository();
  }
  if (apiKey) {
    // Power-user knob (also used by scripted demos): localStorage 'mi.targetCompanies'.
    let targetCompanies = 10;
    try {
      const raw = Number(localStorage.getItem('mi.targetCompanies'));
      if (Number.isFinite(raw) && raw >= 2 && raw <= 30) targetCompanies = raw;
    } catch {
      /* opaque origin — keep default */
    }
    return new GeminiRepository({
      apiKey,
      model: model || undefined,
      store: createLocalStore(),
      targetCompanies,
      concurrency: 3,
      // Count every request locally so the user can see their free-tier headroom.
      onCall: ({ kind }) => recordCall(kind),
    });
  }
  return new MockRepository({
    latencyMs: import.meta.env.MODE === 'test' ? 0 : 220,
    // Zero-state: a REAL researched deck (Frontier AI, live-baked with citations
    // and confidence tags intact) so first launch shows the finished product.
    seedSnapshot: sampleSnapshot as unknown as SeedSnapshot,
  });
}

export function RepositoryProvider({
  children,
  repository,
}: {
  children: ReactNode;
  /** Injectable for tests. */
  repository?: MarketIntelRepository;
}) {
  const apiKey = useApiKey((s) => s.apiKey);
  const model = useApiKey((s) => s.model);
  const { engine } = useEngineChoice();
  // Vault hydration runs BEFORE the repository ever reads localStorage: if the
  // working copy was wiped (co-tenant clear, eviction) the IndexedDB replica
  // restores it first. Skipped instantly when injected (tests) or no IDB.
  const [hydrated, setHydrated] = useState(
    () => repository != null || typeof indexedDB === 'undefined',
  );
  useEffect(() => {
    if (hydrated) return;
    let live = true;
    void hydrateFromVault().finally(() => {
      if (live) setHydrated(true);
    });
    return () => {
      live = false;
    };
  }, [hydrated]);
  const value = useMemo(
    () => (hydrated ? (repository ?? selectRepository(apiKey, model, engine)) : null),
    [hydrated, repository, apiKey, model, engine],
  );
  if (!value) return null; // a few ms while the vault check runs
  return <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>;
}

export function useRepository(): MarketIntelRepository {
  const repo = useContext(RepositoryContext);
  if (!repo) throw new Error('useRepository must be used within a RepositoryProvider');
  return repo;
}
