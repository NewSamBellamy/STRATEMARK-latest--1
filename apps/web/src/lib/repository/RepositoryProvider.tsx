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
import { loadSampleSnapshot } from '@/sample/loadSampleSnapshot';
import { GeminiRepository, type ResearchStore } from '@mi/research';
import { readAssetSource, readPreviewSource, supportsPreviewSource } from './local-source-reader';
import { previewGeminiFetch } from './local-gemini-fetch';
import { HOSTED_KEY } from '@/lib/hostedApi';
import { IpcRepository, isElectron } from './ipc-repository';
import { SentinelRepository } from './SentinelRepository';
import { openBrowserResearchStore } from './browserResearchStore';
import { RecoveryActions } from '@/components/states/StartupRecovery';
import { QUOTA_PRESETS, useApiKey } from '@/lib/settings/apiKey';
import { useEngineChoice } from '@/lib/settings/engine';
import { currentWebSearch } from '@/lib/settings/searchKey';
import { currentNewsSearch } from './news-lane';
import { isLowPower, markGroundingSpent, recordCall, recordCallMetrics } from '@/lib/usage';
import { useResearchControl } from '@/lib/living/researchControl';
import { wikidataJson } from '@/lib/media/wikidataFounded';

const RepositoryContext = createContext<MarketIntelRepository | null>(null);

export type RepositoryMode = 'demo' | 'browser-live' | 'ipc' | 'cloud';
const RepositoryModeContext = createContext<RepositoryMode>('demo');

/** Demo mode (no key, no desktop bridge, not the cloud engine): the only branch that needs the bundled sample deck. */
export function needsSampleDeck(apiKey: string, engine?: string): boolean {
  return !(isElectron() && window.mi) && engine !== 'cloud' && !apiKey;
}

/** localStorage switch for warming STORED decks' dashboard tabs (on start and on open). */
export const STORED_DECK_WARMUP_KEY = 'mi.warmStoredDecks';

/**
 * Stored-deck dashboard backfill is OFF unless explicitly switched on
 * (`localStorage['mi.warmStoredDecks'] = 'on'`): warming every company of every
 * stored deck is a one-time spend the owner approves first. New decks always warm.
 */
export function storedDeckWarmupEnabled(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  try {
    return storage?.getItem(STORED_DECK_WARMUP_KEY) === 'on';
  } catch {
    return false;
  }
}

export function selectRepository(apiKey: string, model: string, engine?: string, store?: ResearchStore,
  quotaPreset: 'free' | 'paid' = 'free', judgeModel = '', sample?: SeedSnapshot): MarketIntelRepository {
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
      // RAW-HTML lane for real company logos at stub time (creation prewarm).
      assetSourceReader: readAssetSource,
      // Extra hunt candidates alongside grounded search: free dated news, and
      // the user's own search key when connected.
      newsSearch: currentNewsSearch,
      webSearch: currentWebSearch,
      // Ownership registries (Wikidata, GLEIF) are CORS-open JSON APIs.
      ownershipFetch: globalThis.fetch.bind(globalThis),
      targetCompanies,
      concurrency: 3,
      // Count every request locally so the user can see their free-tier headroom.
      // Judge calls are verification-class; the local meter has no judge bucket,
      // and the grounded estimate is the honest (never-undercount) side.
      onCall: ({ kind }) => recordCall(kind === 'judge' ? 'ground' : kind),
      onCallMetrics: (m) => recordCallMetrics(m),
      // Google Search is out of quota: research continues from web pages, and the app says why.
      onGroundingSpent: () => markGroundingSpent(),
      // Every company's History, Team, Products and News tabs research in the
      // background after a deck is built (highest tier first), gated by the
      // spending cap and the background-research pause. Stored decks are
      // backfilled only when explicitly enabled (a one-time spend the owner
      // approves): see storedDeckWarmupEnabled.
      dashboardWarmup: {
        allowed: () => !isLowPower() && !useResearchControl.getState().paused,
        backfill: storedDeckWarmupEnabled(),
      },
      // Founded year from the company's own Wikidata item (no provider calls).
      wikidataJson,
      // YouTube's public oEmbed answer, to confirm a History video exists and can be embedded.
      videoJson: wikidataJson,
    });
  }
  if (!sample) throw new Error('Demo mode needs the sample deck loaded first (loadSampleSnapshot).');
  return new MockRepository({
    latencyMs: import.meta.env.MODE === 'test' ? 0 : 220,
    // Zero-state: a REAL researched deck (Frontier AI, live-baked with citations
    // and confidence tags intact) so first launch shows the finished product.
    seedSnapshot: sample,
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
  const userKey = useApiKey((s) => s.apiKey);
  const hosted = useApiKey((s) => s.hosted);
  // No personal key on a hosted build: research runs on the Worker's key.
  const apiKey = userKey || (hosted ? HOSTED_KEY : '');
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
        const sample = !repository && needsSampleDeck(apiKey, engine) ? await loadSampleSnapshot() : undefined;
        const selected = repository ?? selectRepository(apiKey, model, engine, store, quotaPreset, judgeModel, sample);
        if (selected instanceof GeminiRepository) await selected.ready();
        if (live) {
          // Dev builds only: a console handle for diagnosing a research run against the real client.
          if (import.meta.env.DEV) (globalThis as { __miRepo?: unknown }).__miRepo = selected;
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
  if (error) return <div role="alert" className="m-8 space-y-3 text-content"><p>{error}</p><p>Your existing research has not been deleted.</p><button className="btn-ghost" onClick={() => setRetry((n) => n + 1)}>Retry</button><RecoveryActions /></div>;
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

/**
 * False when the active engine reports it cannot run `method` (it would only
 * throw). Hide the control rather than offer a button that always fails.
 */
export function useSupports(method: keyof MarketIntelRepository): boolean {
  const repo = useContext(RepositoryContext);
  if (!repo || typeof repo[method] !== 'function') return false;
  return !(repo.capabilities?.().unsupported ?? []).includes(method);
}

/** 'demo' = keyless sample data; everything else is real research. UI must
 * label demo state so sample figures are never mistaken for live findings. */
export function useRepositoryMode(): RepositoryMode {
  return useContext(RepositoryModeContext);
}
