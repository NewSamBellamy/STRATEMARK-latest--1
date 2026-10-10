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
import { QUOTA_PRESETS, useApiKey } from '@/lib/settings/apiKey';
import { useEngineChoice } from '@/lib/settings/engine';
import { recordCall, recordCallMetrics } from '@/lib/usage';

const RepositoryContext = createContext<MarketIntelRepository | null>(null);

export type RepositoryMode = 'demo' | 'browser-live' | 'ipc' | 'cloud';
const RepositoryModeContext = createContext<RepositoryMode>('demo');

export function selectRepository(apiKey: string, model: string, engine?: string, store?: ResearchStore,
  quotaPreset: 'free' | 'paid' = 'free', judgeModel = ''): MarketIntelRepository {
  if (isElectron() && window.mi) {
    return new IpcRepository(window.mi);
  }
  if (engine === 'cloud') {
    return new SentinelRepository();
  }
  if (apiKey) {
    if (!store) throw new Error('Research storage must be opened before starting research.');
    // Outbound pacing (WS2): the free tier paces at its measured 10/15 RPM;
    // a paid key can run the same pipeline 6x faster.
    const quota = QUOTA_PRESETS[quotaPreset];
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
      // LLM as judge: verifications (metric verify, batch verify, red-team)
      // run on this model; blank keeps them on the research model.
      judgeModel: judgeModel || undefined,
      groundedRpm: quota.groundedRpm,
      structureRpm: quota.structureRpm,
      store,
      originalSourceReader: readPreviewSource,
      originalSourceSupports: supportsPreviewSource,
      targetCompanies,
      concurrency: 3,
      // Count every request locally so the user can see their free-tier headroom.
      // Judge calls are verification-class; the local meter has no judge bucket,
      // and the grounded estimate is the honest (never-undercount) side.
      onCall: ({ kind }) => recordCall(kind === 'judge' ? 'ground' : kind),
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
  const judgeModel = useApiKey((s) => s.judgeModel);
  const quotaPreset = useApiKey((s) => s.quotaPreset);
  const { engine } = useEngineChoice();
  const [value, setValue] = useState<MarketIntelRepository | null>(repository ?? null);
  const [mode, setMode] = useState<RepositoryMode>(repository ? 'browser-live' : 'demo');
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
        const selected = repository ?? selectRepository(apiKey, model, engine, store, quotaPreset, judgeModel);
        if (selected instanceof GeminiRepository) await selected.ready();
        if (live) {
          setValue(selected);
          setMode(repository
            ? 'browser-live'
            : isElectron() && window.mi ? 'ipc'
              : engine === 'cloud' ? 'cloud'
                : apiKey ? 'browser-live' : 'demo');
        }
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : 'Research storage could not be opened.');
      }
    })();
    return () => {
      live = false;
    };
  }, [repository, apiKey, model, engine, quotaPreset, judgeModel, retry]);
  if (error) return <div role="alert" className="m-8 space-y-3 text-content"><p>{error}</p><p>Your existing research has not been deleted.</p><button className="btn-ghost" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>;
  if (!value) return <p role="status" className="m-8 text-muted">Opening your research…</p>;
  return (
    <RepositoryModeContext.Provider value={mode}>
      <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>
    </RepositoryModeContext.Provider>
  );
}

export function useRepository(): MarketIntelRepository {
  const repo = useContext(RepositoryContext);
  if (!repo) throw new Error('useRepository must be used within a RepositoryProvider');
  return repo;
}

/** 'demo' = keyless sample data; everything else is real research. UI must
 * label demo state so sample figures are never mistaken for live findings. */
export function useRepositoryMode(): RepositoryMode {
  return useContext(RepositoryModeContext);
}
