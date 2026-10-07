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
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MarketIntelRepository } from '@mi/contracts';
import { MockRepository, type SeedSnapshot } from '@mi/mocks';
import sampleSnapshot from '@/sample/frontier-snapshot.json';
import { GeminiRepository, type ResearchStore } from '@mi/research';
import { readPreviewSource, supportsPreviewSource } from './local-source-reader';
import { previewGeminiFetch } from './local-gemini-fetch';
import { IpcRepository, isElectron } from './ipc-repository';
import { SentinelRepository } from './SentinelRepository';
import { openBrowserResearchStore } from './browserResearchStore';
import { useApiKey } from '@/lib/settings/apiKey';
import { useEngineChoice } from '@/lib/settings/engine';
import { recordCall, recordCallMetrics } from '@/lib/usage';

const RepositoryContext = createContext<MarketIntelRepository | null>(null);

export function selectRepository(apiKey: string, model: string, engine?: string, store?: ResearchStore): MarketIntelRepository {
  if (isElectron() && window.mi) {
    return new IpcRepository(window.mi);
  }
  if (engine === 'cloud') {
    return new SentinelRepository();
  }
  if (apiKey) {
    if (!store) throw new Error('Research storage must be opened before starting research.');
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
      fetchImpl: previewGeminiFetch,
      model: model || undefined,
      store,
      originalSourceReader: readPreviewSource,
      originalSourceSupports: supportsPreviewSource,
      targetCompanies,
      concurrency: 3,
      // Count every request locally so the user can see their free-tier headroom.
      onCall: ({ kind }) => recordCall(kind),
      onCallMetrics: (m) => recordCallMetrics(m),
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
  const [value, setValue] = useState<MarketIntelRepository | null>(repository ?? null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setValue(repository ?? null);
    setError(null);
    void (async () => {
      try {
        const store = !repository && !isElectron() && engine !== 'cloud' && apiKey
          ? await openBrowserResearchStore() : undefined;
        const selected = repository ?? selectRepository(apiKey, model, engine, store);
        if (selected instanceof GeminiRepository) await selected.ready();
        if (live) setValue(selected);
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : 'Research storage could not be opened.');
      }
    })();
    return () => {
      live = false;
    };
  }, [repository, apiKey, model, engine, retry]);
  if (error) return <div role="alert" className="m-8 space-y-3 text-content"><p>{error}</p><p>Your existing research has not been deleted.</p><button className="btn-ghost" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>;
  if (!value) return <p role="status" className="m-8 text-muted">Opening your research…</p>;
  return <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>;
}

export function useRepository(): MarketIntelRepository {
  const repo = useContext(RepositoryContext);
  if (!repo) throw new Error('useRepository must be used within a RepositoryProvider');
  return repo;
}
