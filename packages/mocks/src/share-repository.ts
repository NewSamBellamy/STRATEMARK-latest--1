/**
 * The repository behind a share link's viewer: the shared snapshot and nothing
 * else. It reads like the demo repository (so the real card, deck and
 * dashboard screens render from it) but is closed to everything that would
 * research, write or reach a network: unknown methods are simply absent (the
 * screens hide controls for absent optional methods), and the few required
 * write methods refuse in plain words.
 */
import type {
  DashboardTab,
  MarketIntelRepository,
  ProviderCapabilities,
  ShareSnapshot,
  SignalBrief,
} from '@mi/contracts';
import { signalBriefSchema } from '@mi/contracts';
import { MockRepository } from './mock-repository';

const READ_ONLY_MESSAGE = 'This is a read-only shared copy. Open Stratemark to research and change things.';

/** The only methods a shared copy answers. */
const READABLE = new Set<string>([
  'listMarkets',
  'getMarket',
  'getDeckByMarket',
  'listCards',
  'getCompany',
  'getCompanyMetrics',
  'getCompanyFacts',
  'getCard',
  'getViceClaims',
  'getDashboardTab',
  'listReports',
  'getReport',
]);

/** Required repository methods that change things: present, but they refuse. */
const REFUSED = new Set<string>([
  'createMarket',
  'updateMarketCadence',
  'deleteMarket',
  'setMarketArchived',
  'refreshDeck',
  'expandDeck',
  'overrideMetric',
  'generateReport',
  'getMarketOpportunity',
  'deepDive',
  'factCheck',
]);

const UNSUPPORTED = [...REFUSED, 'removeCard', 'saveThreadAsReport', 'askResearch', 'setMarketArchived'] as const;

/**
 * The briefs a share carries, cleaned the way an import is: points without a source are dropped, the shape is checked,
 * the brief must belong to a card in the share, and nothing else is kept. Never throws on hand-edited data.
 */
export function cleanSharedBriefs(snapshot: ShareSnapshot): Map<string, SignalBrief> {
  const out = new Map<string, SignalBrief>();
  const raw = snapshot.signalBriefs;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const cardIds = new Set(snapshot.cards.map((card) => card.id));
  for (const cardId of Object.keys(raw)) {
    if (!Object.hasOwn(raw, cardId) || !cardIds.has(cardId)) continue;
    const candidate = raw[cardId] as unknown as { points?: unknown } | null;
    if (!candidate || typeof candidate !== 'object') continue;
    const points = Array.isArray(candidate.points)
      ? candidate.points.filter((p): p is { sources: unknown[] } => !!p && typeof p === 'object'
        && Array.isArray((p as { sources?: unknown }).sources) && (p as { sources: unknown[] }).sources.length > 0)
      : candidate.points;
    const parsed = signalBriefSchema.safeParse({ ...candidate, points });
    if (parsed.success && parsed.data.cardId === cardId) out.set(cardId, parsed.data);
  }
  return out;
}

export function createShareRepository(snapshot: ShareSnapshot): MarketIntelRepository {
  const inner = new MockRepository({
    latencyMs: 0,
    seedOnly: true,
    seedSnapshot: {
      markets: snapshot.markets,
      decks: snapshot.decks,
      companies: snapshot.companies,
      metrics: snapshot.metrics,
      cards: snapshot.cards,
      viceClaims: snapshot.viceClaims,
      dashboards: snapshot.dashboards as Record<string, Partial<Record<DashboardTab, { content: unknown; lastRefreshedAt: string }>>>,
    },
  });
  const capabilities = (): ProviderCapabilities => ({ ground: false, structure: false, image: false, unsupported: UNSUPPORTED });
  const briefs = cleanSharedBriefs(snapshot);
  const peekSignalBrief = (cardId: string) => Promise.resolve(briefs.get(cardId) ?? null);
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'capabilities') return capabilities;
      if (prop === 'peekSignalBrief') return peekSignalBrief;
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
      if (READABLE.has(prop)) {
        const method = (target as unknown as Record<string, (...args: unknown[]) => unknown>)[prop]!;
        return method.bind(target);
      }
      if (REFUSED.has(prop)) return () => Promise.reject(new Error(READ_ONLY_MESSAGE));
      return undefined;
    },
  }) as MarketIntelRepository;
}
