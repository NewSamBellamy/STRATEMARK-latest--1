/**
 * SentinelRepository — Live Sentinel Cloud Run backend repository implementation.
 *
 * Connects the MarketIntelRepository interface to the Sentinel Cloud Run API.
 * Performs live network requests for markets, decks, cards, companies, metrics,
 * and vice claims when Cloud Engine is selected or when authenticated as a Pro user.
 */
import type {
  ProviderCapabilities,
  HuntMetricsResult,
  VerifyMetricInput,
  VerifyMetricResult,
  AskResearchInput,
  Card,
  CardFilter,
  CardWithCompany,
  Citation,
  Company,
  CompanyMetric,
  CreateMarketInput,
  DashboardTab,
  DashboardTabResult,
  Deck,
  DeckRefreshListener,
  DeckResearchBrief,
  DeepDiveInput,
  DeepDiveResult,
  ExpandFocus,
  FactCheckInput,
  FactCheckResult,
  Market,
  MarketIntelRepository,
  OverrideMetricInput,
  RefreshCadence,
  Report,
  ReportRequest,
  ResearchHandlers,
  ResearchJob,
  ResearchThread,
  SavedCard,
  Unsubscribe,
  ViceClaim,
} from '@mi/contracts';
import {
  MockRepository, type SeedSnapshot } from '@mi/mocks';
import sampleSnapshot from '@/sample/frontier-snapshot.json';
import { isOriginalSourceAttempt, projectCompanyCardFacts, retainedDiagnosticAttempts, type OriginalSourceAttempt } from '@mi/research';

/** A Market/Deck object that optionally carries a runtime `engine` tag. */
interface CloudTagged {
  engine?: string;
}
type CloudMarket = Market & CloudTagged;
type CloudDeck = Deck & CloudTagged;

/** Shape of a raw record returned by the Sentinel Cloud API for a market or deck. */
type CloudRecord = Record<string, unknown>;

/** Payload shape passed to mapCloudCards — the union of all callers' shapes. */
interface CloudCardPayload {
  companySourceAttempts?: unknown;
  originalSourceAttempts?: unknown;
  cards?: CloudRecord[];
  result?: { cards?: CloudRecord[] };
  deck?: CloudRecord;
  companies?: CloudRecord[];
  metrics?: CloudRecord[];
  viceClaims?: CloudRecord[];
}

export interface CachedCloudEntry {
  companySourceAttempts?: OriginalSourceAttempt[];
  deck?: CloudDeck & { revision?: number; lastSyncedAt?: string; stale?: boolean; isOffline?: boolean };
  market?: CloudMarket & { revision?: number; lastSyncedAt?: string; stale?: boolean; isOffline?: boolean };
  cards?: CardWithCompany[];
  lastSyncedAt: string;
  revision: number;
  pendingDeletion?: boolean;
}

const CLOUD_CACHE_KEY = 'mi.cloud.cache.v1';

function readCloudCache(): Map<string, CachedCloudEntry> {
  const map = new Map<string, CachedCloudEntry>();
  try {
    if (typeof localStorage === 'undefined') return map;
    const raw = localStorage.getItem(CLOUD_CACHE_KEY);
    if (!raw) return map;
    const entries = JSON.parse(raw) as Record<string, CachedCloudEntry>;
    for (const [k, v] of Object.entries(entries)) {
      map.set(k, v);
    }
  } catch {
    /* ignore parse errors */
  }
  return map;
}

function writeCloudCache(map: Map<string, CachedCloudEntry>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const obj: Record<string, CachedCloudEntry> = {};
    for (const [k, v] of map.entries()) {
      obj[k] = v;
    }
    localStorage.setItem(CLOUD_CACHE_KEY, JSON.stringify(obj));
  } catch {
    /* quota/error handling */
  }
}
import {
  deleteCloudDeck,
  getCloudDeck,
  getCloudDecks,
  getCloudMarket,
  getCloudMarkets,
  runCloudResearchDeck,
  askCloudResearch,
  verifyCloudMetric,
  huntCloudMetrics,
  expandCloudDeck,
  saveCloudCard,
  unsaveCloudCard,
  listCloudSavedCards,
  fetchSentinel,
  type CloudResearchDeckResponse,
} from '@/lib/sentinelApi';

export class SentinelRepository implements MarketIntelRepository {
  capabilities(): ProviderCapabilities {
    // The cloud engine researches and structures server-side; it has no
    // image-generation route, and pretending otherwise wastes user time.
    return { ground: true, structure: true, image: false };
  }

  private fallbackRepo: MockRepository;
  private memoryMarkets = new Map<string, Market>();
  private memoryDecks = new Map<string, Deck>();
  private memoryCards = new Map<string, CardWithCompany[]>();
  private memoryOriginals = new Map<string, OriginalSourceAttempt[]>();

  private factsCard(card: CardWithCompany): CardWithCompany {
    const originals = this.memoryOriginals.get(card.card.deckId) ?? readCloudCache().get(card.card.deckId)?.companySourceAttempts;
    return projectCompanyCardFacts(card, originals);
  }

  constructor() {
    this.fallbackRepo = new MockRepository({
      latencyMs: 0,
      seedSnapshot: sampleSnapshot as unknown as SeedSnapshot,
    });
  }

  async listMarkets(): Promise<Market[]> {
    try {
      const [cloudDecks, cloudMarkets] = await Promise.all([
        getCloudDecks(),
        getCloudMarkets(),
      ]);
      const marketList = cloudMarkets.length > 0 ? cloudMarkets : cloudDecks;
      if (marketList && marketList.length > 0) {
        const cache = readCloudCache();
        const now = new Date().toISOString();
        const remoteMarkets: Market[] = marketList.map((d: CloudRecord) => {
          const marketId = String(d.marketId || d.id || `mkt_${String(d.id)}`);
          const status = (d.status as string) || (d.state as { status?: string } | undefined)?.status;
          const revision = typeof d.revision === 'number' ? d.revision : 1;
          const market: CloudMarket & { status?: string; revision?: number; lastSyncedAt?: string; stale?: boolean; isOffline?: boolean } = {
            id: marketId,
            name: String(d.marketName || d.name || d.title || d.prompt || 'Sentinel Cloud Market'),
            scopeDefinition: {
              vertical: String(d.vertical || 'Competitive Market Intelligence'),
              geography: (d.region || d.geography || null) as string | null,
              notes: (d.notes || null) as string | null,
            },
            refreshCadence: 'weekly',
            createdAt: String(d.createdAt || now),
            engine: 'cloud',
            revision,
            lastSyncedAt: now,
            ...(status ? { status } : {}),
          };
          this.memoryMarkets.set(marketId, market);

          const existingCache = cache.get(marketId) || cache.get(`dck_${marketId}`) || cache.get(`deck_${marketId}`);
          cache.set(marketId, {
            ...existingCache,
            market,
            lastSyncedAt: now,
            revision,
            pendingDeletion: false,
          });

          return market;
        });

        writeCloudCache(cache);

        // Combine with any locally created memory markets
        for (const localM of this.memoryMarkets.values()) {
          if (!remoteMarkets.some((rm) => rm.id === localM.id)) {
            remoteMarkets.push(localM);
          }
        }
        return remoteMarkets;
      }
    } catch (err) {
      console.warn('Failed to fetch remote markets from Sentinel Cloud:', err);
    }

    // Check local persistent cloud cache first for offline/outage state
    const cache = readCloudCache();
    const cachedMarkets: Market[] = [];
    for (const [id, entry] of cache.entries()) {
      if (entry.pendingDeletion) continue;
      if (entry.market && !cachedMarkets.some(m => m.id === id || m.id === entry.market?.id)) {
        const staleMarket: Market = {
          ...entry.market,
          stale: true,
          isOffline: true,
          lastSyncedAt: entry.lastSyncedAt,
          revision: entry.revision,
        } as unknown as Market;
        cachedMarkets.push(staleMarket);
        this.memoryMarkets.set(id, staleMarket);
      }
    }
    if (cachedMarkets.length > 0) {
      return cachedMarkets;
    }

    // A Cloud Engine outage must not masquerade as sample data.
    if (this.memoryMarkets.size > 0) {
      return Array.from(this.memoryMarkets.values());
    }
    return [];
  }

  async getMarket(id: string): Promise<Market | null> {
    if (this.memoryMarkets.has(id)) {
      return this.memoryMarkets.get(id)!;
    }
    try {
      const remote = await getCloudMarket(id);
      if (remote) {
        const market: CloudMarket = {
          id: (remote.id || remote.marketId || id) as string,
          name: (remote.name || remote.marketName || 'Sentinel Cloud Market') as string,
          scopeDefinition: {
            vertical: (remote.vertical || 'Competitive Market Intelligence') as string,
            geography: (remote.region || remote.geography || null) as string | null,
            notes: (remote.notes || null) as string | null,
          },
          refreshCadence: 'weekly',
          createdAt: (remote.createdAt || new Date().toISOString()) as string,
          engine: 'cloud',
        };
        this.memoryMarkets.set(id, market);
        return market;
      }
    } catch {
      /* ignore */
    }
    const markets = await this.listMarkets();
    return markets.find((m) => m.id === id) || null;
  }

  async createMarket(input: CreateMarketInput): Promise<Market> {
    const market: Market = {
      id: `mkt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: input.name,
      scopeDefinition: input.scopeDefinition,
      refreshCadence: input.refreshCadence,
      createdAt: new Date().toISOString(),
    };
    this.memoryMarkets.set(market.id, market);
    return market;
  }

  async updateMarketCadence(id: string, cadence: RefreshCadence): Promise<Market> {
    void cadence;
    throw new Error(`Cloud market cadence updates are not available through Sentinel yet: ${id}`);
  }

  async deleteMarket(id: string): Promise<boolean> {
    const existingMarket = this.memoryMarkets.get(id);
    const isCloud = (existingMarket as CloudMarket)?.engine === 'cloud';

    this.memoryMarkets.delete(id);
    const deck = this.memoryDecks.get(id);
    const targetDeckId = deck?.id || id;
    this.memoryOriginals.delete(targetDeckId);
    if (deck) {
      this.memoryDecks.delete(id);
      this.memoryDecks.delete(deck.id);
      this.memoryCards.delete(deck.id);
      this.memoryCards.delete(id);
    }
    
    const cache = readCloudCache();
    try {
      const res = await deleteCloudDeck(targetDeckId);
      if (res) {
        cache.delete(id);
        cache.delete(targetDeckId);
        writeCloudCache(cache);
      }
    } catch {
      const entry1 = cache.get(id);
      if (entry1) {
        entry1.pendingDeletion = true;
        cache.set(id, entry1);
      }
      const entry2 = cache.get(targetDeckId);
      if (entry2) {
        entry2.pendingDeletion = true;
        cache.set(targetDeckId, entry2);
      }
      writeCloudCache(cache);
    }

    if (!isCloud) {
      await this.fallbackRepo.deleteMarket?.(id);
    }
    return true;
  }

  async deleteDeck(deckId: string): Promise<boolean> {
    this.memoryOriginals.delete(deckId);
    const existingDeck = this.memoryDecks.get(deckId);
    const isCloud = (existingDeck as CloudDeck)?.engine === 'cloud';

    this.memoryDecks.delete(deckId);
    this.memoryCards.delete(deckId);
    let matchedMarketId: string | undefined;
    for (const [mktId, m] of this.memoryMarkets.entries()) {
      if (m.id === deckId) {
        matchedMarketId = mktId;
        this.memoryMarkets.delete(mktId);
      }
    }

    const cache = readCloudCache();
    try {
      const res = await deleteCloudDeck(deckId);
      if (res) {
        cache.delete(deckId);
        if (matchedMarketId) cache.delete(matchedMarketId);
        writeCloudCache(cache);
      }
      if (!isCloud) {
        await this.fallbackRepo.deleteDeck?.(deckId);
      }
      return res;
    } catch {
      const entry = cache.get(deckId) || (matchedMarketId ? cache.get(matchedMarketId) : undefined);
      if (entry) {
        entry.pendingDeletion = true;
        cache.set(deckId, entry);
        if (matchedMarketId) cache.set(matchedMarketId, entry);
        writeCloudCache(cache);
      }
      return true;
    }
  }

  async getDeckByMarket(marketId: string): Promise<Deck | null> {
    const cached = this.memoryDecks.get(marketId);
    const deckState = (cached as { state?: { status?: string } } | undefined)?.state?.status;
    const deckStatus = (cached as { status?: string } | undefined)?.status;
    const isRunning = deckStatus === 'running' || deckState === 'running';
    const isPartial = deckStatus === 'partial' || deckState === 'partial';
    const isRefreshing = deckStatus === 'refreshing' || deckState === 'refreshing';

    if (cached && !isRunning && !isPartial && !isRefreshing && !(cached as { stale?: boolean }).stale) {
      return cached;
    }

    try {
      let targetDeckId = marketId;
      if (marketId.startsWith('mkt_')) {
        targetDeckId = `dck_${marketId.slice(4)}`;
      } else if (!marketId.startsWith('dck_') && !marketId.startsWith('deck_')) {
        targetDeckId = `dck_${marketId}`;
      }
      const cloudPayload = await getCloudDeck(targetDeckId);
      if (cloudPayload && cloudPayload.deck) {
        const d: CloudRecord = cloudPayload.deck;
        const stateRecord = (cloudPayload as CloudRecord).state as CloudRecord | undefined;
        const status = (stateRecord?.status as string) || (d.status as string) || 'ready';
        const revision = typeof d.revision === 'number' ? d.revision : 1;
        const now = new Date().toISOString();
        const deck: CloudDeck & { status?: string; error?: string; revision?: number; lastSyncedAt?: string; stale?: boolean; isOffline?: boolean } = {
          id: String(d.id || `dck_${marketId}`),
          marketId: String(d.marketId || marketId),
          createdAt: String(d.createdAt || now),
          lastRefreshedAt: String(d.lastRefreshedAt || now),
          engine: 'cloud',
          status,
          revision,
          lastSyncedAt: now,
          ...(stateRecord?.error ? { error: String(stateRecord.error) } : {}),
        };
        this.memoryDecks.set(marketId, deck);
        this.memoryDecks.set(deck.id, deck);

        // Process cards if returned in payload
        let cardsWithCompany: CardWithCompany[] = [];
        if (cloudPayload.cards && cloudPayload.cards.length > 0) {
          cardsWithCompany = this.mapCloudCards(cloudPayload);
          this.memoryCards.set(deck.id, cardsWithCompany);
          this.memoryCards.set(marketId, cardsWithCompany);
        }

        const cache = readCloudCache();
        const existing = cache.get(marketId) || cache.get(deck.id);
        cache.set(deck.id, {
          ...existing,
          deck,
          cards: cardsWithCompany.length > 0 ? cardsWithCompany : existing?.cards,
          companySourceAttempts: this.memoryOriginals.get(deck.id) ?? [],
          lastSyncedAt: now,
          revision,
          pendingDeletion: false,
        });
        cache.set(marketId, {
          ...existing,
          deck,
          cards: cardsWithCompany.length > 0 ? cardsWithCompany : existing?.cards,
          companySourceAttempts: this.memoryOriginals.get(deck.id) ?? [],
          lastSyncedAt: now,
          revision,
          pendingDeletion: false,
        });
        writeCloudCache(cache);

        return deck;
      }
    } catch (err) {
      console.warn(`Failed to fetch cloud deck for market ${marketId}:`, err);
    }

    // Offline / outage cache recovery
    const cache = readCloudCache();
    const cachedEntry = cache.get(marketId) || cache.get(`dck_${marketId}`) || cache.get(`deck_${marketId}`);
    if (cachedEntry && !cachedEntry.pendingDeletion && cachedEntry.deck) {
      const staleDeck: Deck = {
        ...cachedEntry.deck,
        stale: true,
        isOffline: true,
        lastSyncedAt: cachedEntry.lastSyncedAt,
        revision: cachedEntry.revision,
      } as unknown as Deck;
      this.memoryDecks.set(marketId, staleDeck);
      this.memoryDecks.set(staleDeck.id, staleDeck);
      if (cachedEntry.cards && cachedEntry.cards.length > 0) {
        this.memoryCards.set(staleDeck.id, cachedEntry.cards);
        this.memoryCards.set(marketId, cachedEntry.cards);
      }
      return staleDeck;
    }

    if (cached) return cached;
    return null;
  }

  async refreshDeck(marketId: string): Promise<Deck> {
    const existing = await this.getDeckByMarket(marketId);
    if (!existing) throw new Error(`Cloud Deck not found: ${marketId}`);

    let targetCompanies = 10;
    try {
      const raw = Number(localStorage.getItem('mi.targetCompanies'));
      if (Number.isFinite(raw) && raw >= 2 && raw <= 30) targetCompanies = raw;
    } catch {
      /* opaque origin */
    }

    const market = await this.getMarket(marketId);
    const query = market?.name || existing.id;
    const region = market?.scopeDefinition?.geography || null;

    try {
      await runCloudResearchDeck(query, region, targetCompanies, undefined, existing.id);
    } catch (err) {
      console.warn(`Failed to re-enqueue research for deck ${existing.id}:`, err);
    }

    const runningDeck: Deck & { status?: string } = {
      ...existing,
      status: 'running',
    };

    this.memoryDecks.set(marketId, runningDeck);
    this.memoryDecks.set(existing.id, runningDeck);

    const cache = readCloudCache();
    const current = cache.get(existing.id) || cache.get(marketId);
    if (current) {
      cache.set(existing.id, { ...current, deck: runningDeck });
      cache.set(marketId, { ...current, deck: runningDeck });
      writeCloudCache(cache);
    }

    return runningDeck;
  }

  async createResearchedDeck(
    brief: DeckResearchBrief,
    handlers?: ResearchHandlers,
  ): Promise<{ market: Market; deck: Deck }> {
    handlers?.onProgress?.({
      message: 'Connecting to Sentinel Cloud Agent…',
      stage: 'scope',
      kind: 'step',
    });

    let targetCompanies = 10;
    try {
      const raw = Number(localStorage.getItem('mi.targetCompanies'));
      if (Number.isFinite(raw) && raw >= 2 && raw <= 30) targetCompanies = raw;
    } catch {
      /* opaque origin — keep default */
    }

    const res = await runCloudResearchDeck(
      brief.prompt,
      brief.region,
      targetCompanies,
      undefined,
      undefined,
      brief.companyScope,
    );
    if (!res.ok) {
      throw new Error(res.error || 'Sentinel Cloud Agent failed to create research deck.');
    }

    const rawM = res.market ?? res.result?.market ?? res.deck;
    const m: CloudRecord = (rawM as CloudRecord | undefined) ?? {};
    
    // Cloud enqueued decks return deckId directly. Synchronous runs return market/deck objects.
    const returnedDeckId = res.deckId as string | undefined;
    const marketId = String(m.id || m.marketId || returnedDeckId || `mkt_${Date.now().toString(36)}`);
    const marketName = String(m.name || brief.prompt);
    const scopeDef = m.scopeDefinition as CloudRecord | undefined;

    const market: CloudMarket = {
      id: marketId,
      name: marketName,
      scopeDefinition: {
        vertical: String(scopeDef?.vertical || brief.prompt),
        geography: brief.region || null,
        notes: null,
      },
      refreshCadence: 'weekly',
      createdAt: new Date().toISOString(),
      engine: 'cloud',
    };

    const deckRecord: CloudRecord = (res.deck as CloudRecord | undefined) ?? {};
    const stateRecord = res.state as CloudRecord | undefined;
    const deckId = String(returnedDeckId || deckRecord.id || res.result?.deck?.id || `dck_${marketId.replace(/^mkt_/, '')}`);
    const status = (stateRecord?.status as string) || (deckRecord.status as string) || (res.deckId ? 'running' : 'ready');
    const deck: CloudDeck & { status?: string; error?: string } = {
      id: deckId,
      marketId,
      createdAt: new Date().toISOString(),
      lastRefreshedAt: new Date().toISOString(),
      engine: 'cloud',
      status,
      ...(stateRecord?.error ? { error: String(stateRecord.error) } : {}),
    };

    this.memoryMarkets.set(market.id, market);
    this.memoryDecks.set(market.id, deck);
    this.memoryDecks.set(deck.id, deck);

    let cardsWithCompany: CardWithCompany[] = [];
    if (res.cards && res.cards.length > 0) {
      cardsWithCompany = this.mapCloudCards(res);
      this.memoryCards.set(deck.id, cardsWithCompany);
      this.memoryCards.set(market.id, cardsWithCompany);
    }

    const cache = readCloudCache();
    const now = new Date().toISOString();
    const revision = (deck as { revision?: number }).revision ?? 1;
    cache.set(deck.id, {
      deck,
      market,
      cards: cardsWithCompany,
      companySourceAttempts: this.memoryOriginals.get(deck.id) ?? [],
      lastSyncedAt: now,
      revision,
      pendingDeletion: false,
    });
    cache.set(market.id, {
      deck,
      market,
      cards: cardsWithCompany,
      companySourceAttempts: this.memoryOriginals.get(deck.id) ?? [],
      lastSyncedAt: now,
      revision,
      pendingDeletion: false,
    });
    writeCloudCache(cache);

    handlers?.onProgress?.({
      message: 'Sentinel Cloud Agent deck created successfully.',
      stage: 'dashboard',
      progress: 1,
      kind: 'step',
    });

    return { market, deck };
  }

  async listCards(deckId: string, filter?: CardFilter): Promise<CardWithCompany[]> {
    let cachedCards = this.memoryCards.get(deckId);
    let cachedDeck = this.memoryDecks.get(deckId);
    if (!cachedCards || cachedCards.length === 0) {
      const cache = readCloudCache();
      const entry = cache.get(deckId) || cache.get(`mkt_${deckId.replace(/^dck_/, '')}`);
      if (entry && !entry.pendingDeletion && entry.cards && entry.cards.length > 0) {
        cachedCards = entry.cards;
        this.memoryCards.set(deckId, cachedCards);
      }
      if (entry?.deck) {
        cachedDeck = entry.deck;
        this.memoryDecks.set(deckId, cachedDeck);
      }
    }
    const cachedStatus = (cachedDeck as { status?: string; state?: { status?: string } } | undefined);
    const deckInProgress = ['running', 'partial', 'refreshing'].includes(
      cachedStatus?.status ?? cachedStatus?.state?.status ?? '',
    );

    if (cachedCards && cachedCards.length > 0 && !deckInProgress) {
      let list = cachedCards;
      if (filter?.cardType) {
        list = list.filter((c) => c.card.cardType === filter.cardType);
      }
      return list.map(card => this.factsCard(card));
    }

    try {
      const cloudPayload = await getCloudDeck(deckId);
      if (cloudPayload) {
        const cardsWithCompany = this.mapCloudCards(cloudPayload);
        this.memoryCards.set(deckId, cardsWithCompany);
        if (filter?.cardType) {
          return cardsWithCompany.filter((c) => c.card.cardType === filter.cardType).map(card => this.factsCard(card));
        }
        return cardsWithCompany.map(card => this.factsCard(card));
      }
    } catch (err) {
      console.warn(`Failed to fetch cloud cards for deck ${deckId}:`, err);
    }

    if (cachedCards && cachedCards.length > 0) {
      return cachedCards.filter(card => !filter?.cardType || card.card.cardType === filter.cardType).map(card => this.factsCard(card));
    }

    return [];
  }

  async getCard(cardId: string): Promise<CardWithCompany | null> {
    for (const cardList of this.memoryCards.values()) {
      const match = cardList.find((c) => c.card.id === cardId);
      if (match) return this.factsCard(match);
    }
    return null;
  }

  async listSavedCards(): Promise<CardWithCompany[]> {
    try {
      const cloudSaved = await listCloudSavedCards();
      if (cloudSaved && cloudSaved.length > 0) {
        const cards = this.mapCloudCards({ cards: cloudSaved });
        for (const card of cards) {
          const existing = this.memoryCards.get(card.card.deckId) ?? [];
          this.memoryCards.set(card.card.deckId, [...existing.filter(row => row.card.id !== card.card.id), card]);
        }
        return cards.map(card => this.factsCard(card));
      }
    } catch {
      /* fallback */
    }
    return [];
  }

  async saveCard(cardId: string): Promise<SavedCard> {
    await saveCloudCard(cardId);
    return { cardId, savedAt: new Date().toISOString() };
  }

  async unsaveCard(cardId: string): Promise<void> {
    await unsaveCloudCard(cardId);
  }

  async getCompany(companyId: string): Promise<Company | null> {
    for (const cardList of this.memoryCards.values()) {
      const match = cardList.find((c) => c.company?.id === companyId);
      if (match && match.company) return match.company;
    }
    return null;
  }

  async getCompanyMetrics(companyId: string): Promise<CompanyMetric[]> {
    for (const cardList of this.memoryCards.values()) {
      const match = cardList.find((c) => c.company?.id === companyId);
      if (match) return structuredClone(match.metrics || []);
    }
    return [];
  }

  async getCompanyFacts(companyId: string): Promise<CompanyMetric[]> {
    for (const cards of this.memoryCards.values()) {
      const match = cards.find(card => card.company?.id === companyId);
      if (match) return this.factsCard(match).metrics;
    }
    return [];
  }

  async getViceClaims(cardId: string): Promise<ViceClaim[]> {
    for (const cardList of this.memoryCards.values()) {
      const match = cardList.find((c) => c.card.id === cardId);
      if (match) return match.viceClaims || [];
    }
    return [];
  }

  async getDashboardTab<T extends DashboardTab>(
    companyId: string,
    tab: T,
    force?: boolean,
  ): Promise<DashboardTabResult<T> | null> {
    let deckId: string | null = null;

    // 1. Resolve deckId from in-memory cache
    for (const [id, cards] of this.memoryCards.entries()) {
      if (cards.some((c) => c.company?.id === companyId)) {
        deckId = id;
        break;
      }
    }

    // 2. Resolve from cloud localStorage cache
    if (!deckId) {
      const cache = readCloudCache();
      for (const [id, entry] of cache.entries()) {
        if (entry.cards?.some((c) => c.company?.id === companyId)) {
          deckId = id;
          break;
        }
      }
    }

    // 3. Fallback to active market
    if (!deckId) {
      const market = await this.listMarkets().then((m) => m[0]);
      if (market) deckId = market.id;
    }

    if (!deckId) return null;

    // Errors propagate, NOT collapse into null: a network failure must reach
    // the user as a retryable error state, never as a dishonest "Nothing
    // here yet" that reads like an empty research result.
    const res = await fetchSentinel<Pick<DashboardTabResult<T>, 'content' | 'citations' | 'sourceDiagnostics'>>('/api/research/tab', {
      method: 'POST',
      body: JSON.stringify({ deckId, companyId, tab, ...(force ? { force: true } : {}) }),
    });
    return {
      companyId,
      tab,
      content: res.content,
      citations: res.citations,
      ...(res.sourceDiagnostics ? { sourceDiagnostics: res.sourceDiagnostics } : {}),
      lastRefreshedAt: new Date().toISOString(),
    };
  }

  async deepDive(input: DeepDiveInput): Promise<DeepDiveResult> {
    void input;
    throw new Error('Cloud deep-dive research is not available through Sentinel yet.');
  }

  async factCheck(input: FactCheckInput): Promise<FactCheckResult> {
    void input;
    throw new Error('Cloud fact-check research is not available through Sentinel yet.');
  }


  private invalidateDeckCache(deckId: string) {
    this.memoryOriginals.delete(deckId);
    this.memoryCards.delete(deckId);
    this.memoryDecks.delete(deckId);

    // Also delete by marketId if possible, or just scan
    for (const [k, v] of this.memoryDecks.entries()) {
      if (v.id === deckId) {
        this.memoryDecks.delete(k);
        this.memoryCards.delete(k);
      }
    }

    const cache = readCloudCache();
    let changed = false;
    for (const [k, v] of cache.entries()) {
      if (v.deck?.id === deckId || k === deckId) {
        cache.delete(k);
        changed = true;
      }
    }
    if (changed) writeCloudCache(cache);
  }

  private findDeckIdForCompany(companyId: string): string | undefined {
    for (const [key, cards] of this.memoryCards.entries()) {
      const card = cards.find((c) => c.company?.id === companyId);
      if (!card) continue;
      const deckId = card.card.deckId || this.memoryDecks.get(key)?.id;
      if (deckId) return deckId;
    }
    return undefined;
  }

  async expandDeck(marketId: string, focus: ExpandFocus): Promise<{ added: number }> {
    const res = await expandCloudDeck(marketId, focus);
    if (res && typeof res.added === 'number') {
      const deckId = this.memoryDecks.get(marketId)?.id || marketId;
      this.invalidateDeckCache(deckId);
      return res;
    }
    throw new Error('Failed to expand cloud deck: no response from Sentinel');
  }

  async verifyMetric(input: VerifyMetricInput): Promise<VerifyMetricResult> {
    const deckId = this.findDeckIdForCompany(input.companyId);
    if (!deckId) throw new Error('Cannot verify metric: Deck ID not found in local cache');
    const res = await verifyCloudMetric(input, deckId);
    if (!res) throw new Error('Failed to verify cloud metric: no response from Sentinel');
    this.invalidateDeckCache(deckId);
    return res;
  }

  async huntCompanyMetrics(companyId: string): Promise<HuntMetricsResult> {
    const deckId = this.findDeckIdForCompany(companyId);
    if (!deckId) throw new Error('Cannot hunt metrics: Deck ID not found in local cache');
    const res = await huntCloudMetrics(companyId, deckId);
    if (!res) throw new Error('Failed to hunt cloud metrics: no response from Sentinel');
    this.invalidateDeckCache(deckId);
    return res;
  }

  async overrideMetric(input: OverrideMetricInput): Promise<CompanyMetric> {
    void input;
    throw new Error('Cloud metric overrides are not available through Sentinel yet.');
  }

  async getMarketOpportunity(marketId: string, force?: boolean): Promise<DeepDiveResult> {
    void marketId;
    void force;
    throw new Error('Cloud market opportunity research is not available through Sentinel yet.');
  }

  async askResearch(input: AskResearchInput): Promise<ResearchThread> {
    const res = await askCloudResearch(input);
    if (res && res.id && Array.isArray(res.messages)) {
      return res as unknown as ResearchThread;
    }
    throw new Error('Sentinel returned an invalid research thread.');
  }

  async listResearchThreads(filter?: { deckId?: string; companyId?: string }): Promise<ResearchThread[]> {
    const params = new URLSearchParams();
    if (filter?.deckId) params.set('deckId', filter.deckId);
    if (filter?.companyId) params.set('companyId', filter.companyId);
    const query = params.toString();
    const response = await fetchSentinel<{ threads: ResearchThread[] }>(`/api/research/threads${query ? `?${query}` : ''}`);
    if (!Array.isArray(response.threads)) throw new Error('Sentinel returned invalid research history.');
    return response.threads;
  }

  async getResearchThread(id: string): Promise<ResearchThread | null> {
    const thread = await fetchSentinel<ResearchThread>(`/api/research/threads/${encodeURIComponent(id)}`);
    if (thread.id !== id || !Array.isArray(thread.messages)) throw new Error('Sentinel returned an invalid research thread.');
    return thread;
  }

  async saveThreadAsReport(threadId: string, focus?: string | null): Promise<Report> {
    void threadId;
    void focus;
    throw new Error('Cloud report creation from research threads is not available through Sentinel yet.');
  }

  async listResearchJobs(): Promise<ResearchJob[]> {
    return [];
  }

  async getResearchJob(id: string): Promise<ResearchJob | null> {
    void id;
    return null;
  }

  async cancelResearchJob(id: string): Promise<ResearchJob | null> {
    void id;
    return null;
  }

  async resumeResearchJob(id: string): Promise<ResearchJob | null> {
    void id;
    return null;
  }

  async generateReport(request: ReportRequest): Promise<Report> {
    void request;
    throw new Error('Cloud report generation is not available through Sentinel yet.');
  }

  async listReports(): Promise<Report[]> {
    return [];
  }

  async getReport(id: string): Promise<Report | null> {
    void id;
    return null;
  }

  subscribeDeckRefresh(_listener: DeckRefreshListener): Unsubscribe {
    return () => {};
  }

  cacheCloudDeckResponse(res: CloudResearchDeckResponse): void {
    const rawM = res.market ?? res.result?.market ?? res.deck;
    const m: CloudRecord = (rawM as CloudRecord | undefined) ?? {};
    const returnedDeckId = res.deckId as string | undefined;
    const marketId = String(m.id || m.marketId || returnedDeckId || `mkt_${Date.now().toString(36)}`);
    const marketName = String(m.name || 'Sentinel Cloud Market');
    const scopeDef = m.scopeDefinition as CloudRecord | undefined;

    const market: CloudMarket = {
      id: marketId,
      name: marketName,
      scopeDefinition: {
        vertical: String(scopeDef?.vertical || 'Competitive Market Intelligence'),
        geography: (m.region || m.geography || null) as string | null,
        notes: null,
      },
      refreshCadence: 'weekly',
      createdAt: new Date().toISOString(),
      engine: 'cloud',
    };

    const deckRecord: CloudRecord = (res.deck as CloudRecord | undefined) ?? {};
    const stateRecord = res.state as CloudRecord | undefined;
    const deckId = String(returnedDeckId || deckRecord.id || res.result?.deck?.id || `dck_${marketId.replace(/^mkt_/, '')}`);
    const status = (stateRecord?.status as string) || (deckRecord.status as string) || (res.deckId ? 'running' : 'ready');
    const deck: CloudDeck & { status?: string; error?: string } = {
      id: deckId,
      marketId,
      createdAt: new Date().toISOString(),
      lastRefreshedAt: new Date().toISOString(),
      engine: 'cloud',
      status,
      ...(stateRecord?.error ? { error: String(stateRecord.error) } : {}),
    };

    this.memoryMarkets.set(market.id, market);
    this.memoryDecks.set(market.id, deck);
    this.memoryDecks.set(deck.id, deck);

    if (res.cards && res.cards.length > 0) {
      const cardsWithCompany = this.mapCloudCards(res);
      this.memoryCards.set(deck.id, cardsWithCompany);
      this.memoryCards.set(market.id, cardsWithCompany);
    }

    const cache = readCloudCache();
    const now = new Date().toISOString();
    const revision = (res.deck as { revision?: number } | undefined)?.revision ?? 1;
    let cardsWithCompany: CardWithCompany[] = [];
    if (res.cards && res.cards.length > 0) {
      cardsWithCompany = this.mapCloudCards(res);
    }
    cache.set(deck.id, {
      deck,
      market,
      cards: cardsWithCompany,
      companySourceAttempts: this.memoryOriginals.get(deck.id) ?? [],
      lastSyncedAt: now,
      revision,
      pendingDeletion: false,
    });
    cache.set(market.id, {
      deck,
      market,
      cards: cardsWithCompany,
      companySourceAttempts: this.memoryOriginals.get(deck.id) ?? [],
      lastSyncedAt: now,
      revision,
      pendingDeletion: false,
    });
    writeCloudCache(cache);
  }

  private mapCloudCards(payload: CloudCardPayload): CardWithCompany[] {
    const rawCards: Array<Record<string, unknown>> =
      (payload.cards as Array<Record<string, unknown>> | undefined) ||
      (payload.result?.cards as Array<Record<string, unknown>> | undefined) ||
      [];
    const rawCompanies: CloudRecord[] = payload.companies || [];
    const rawMetrics: CloudRecord[] = payload.metrics || [];
    const rawViceClaims: CloudRecord[] = payload.viceClaims || [];

    const companyMap = new Map<string, Company>();
    for (const comp of rawCompanies) {
      if (comp.id) {
        const compId = String(comp.id);
        companyMap.set(compId, {
          id: compId,
          name: String(comp.name || 'Company'),
          oneLiner: String(comp.oneLiner || comp.descriptor || ''),
          websiteUrl: String(comp.websiteUrl || `https://${String(comp.domain || 'example.com')}`),
          logoUrl: (comp.logoUrl || null) as string | null,
          hqLocation: (comp.hqLocation || null) as string | null,
          brandTheme: (comp.brandTheme as Company['brandTheme']) || {
            primary: '#0F766E',
            secondary: '#14B8A6',
            accent: '#14B8A6',
            text: '#0F172A',
            background: '#F8FAFC',
            fontFamily: null,
            source: 'default' as const,
          },
        });
      }
    }

    const results: CardWithCompany[] = [];

    for (const rawItem of rawCards) {
      if (!rawItem) continue;
      const item = rawItem as CloudRecord;
      const primaryCard = item.primaryCard as { card?: Card; company?: Company; metrics?: CompanyMetric[]; viceClaims?: ViceClaim[] } | undefined;
      // Handle HydrateCompanyCardResult objects (with primaryCard and cards arrays)
      if (primaryCard?.card && primaryCard?.company) {
        results.push({
          card: { ...primaryCard.card, engine: 'cloud' } as Card,
          company: primaryCard.company,
          metrics: (item.metrics as CompanyMetric[] | undefined) || primaryCard.metrics || [],
          viceClaims: (item.viceClaims as ViceClaim[] | undefined) || primaryCard.viceClaims || [],
        });
        if (Array.isArray(item.cards)) {
          for (const facet of (item.cards as Array<{ card?: Card; company?: Company; metrics?: CompanyMetric[]; viceClaims?: ViceClaim[] }>).slice(1)) {
            if (facet?.card && facet?.company) {
              results.push({
                card: { ...facet.card, engine: 'cloud' } as Card,
                company: facet.company,
                metrics: facet.metrics || [],
                viceClaims: facet.viceClaims || [],
              });
            }
          }
        }
        continue;
      }

      const directCard = item.card as Card | undefined;
      const directCompany = item.company as Company | undefined;
      // Handle direct CardWithCompany objects
      if (directCard && Object.prototype.hasOwnProperty.call(item, 'company')) {
        if (Array.isArray(item.companySourceAttempts)) {
          const scoped = item.companySourceAttempts.filter(isOriginalSourceAttempt).filter(attempt => attempt.companyId === directCompany?.id);
          const existing = this.memoryOriginals.get(directCard.deckId) ?? [];
          this.memoryOriginals.set(directCard.deckId, [...existing.filter(attempt => attempt.companyId !== directCompany?.id), ...scoped]);
        }
        results.push({
          card: { ...directCard, engine: 'cloud' } as Card,
          company: (directCompany ?? null) as Company | null,
          metrics: (item.metrics as CompanyMetric[] | undefined) || [],
          viceClaims: (item.viceClaims as ViceClaim[] | undefined) || [],
        });
        continue;
      }

      // Handle raw card records
      const c = item as CloudRecord;
      const companyId = String(c.companyId || `comp_${String(c.id)}`);
      let company = companyMap.get(companyId);
      if (!company) {
        company = {
          id: companyId,
          name: String(c.companyName || c.title || 'Target Company'),
          oneLiner: String(c.summary || c.descriptor || ''),
          websiteUrl: String(c.websiteUrl || 'https://example.com'),
          logoUrl: (c.logoUrl || null) as string | null,
          hqLocation: (c.hqLocation || null) as string | null,
          brandTheme: {
            primary: '#0F766E',
            secondary: '#14B8A6',
            accent: '#14B8A6',
            text: '#0F172A',
            background: '#F8FAFC',
            fontFamily: null,
            source: 'default',
          },
        };
      }

      const card: Card & { engine: string } = {
        id: String(c.id),
        deckId: String(c.deckId || payload.deck?.id || 'dck_cloud'),
        companyId: company.id,
        cardType: (c.cardType || 'company') as Card['cardType'],
        title: String(c.title || company.name),
        summary: String(c.summary || company.oneLiner),
        tier: (c.tier ?? null) as Card['tier'],
        tierReason: (c.tierReason || null) as string | null,
        citations: (c.citations ?? []) as unknown as Citation[],
        keyPoints: (c.keyPoints ?? []) as string[],
        createdAt: String(c.createdAt || new Date().toISOString()),
        engine: 'cloud',
      };

      const companyObj = company;
      const metrics = rawMetrics
        .filter((m: CloudRecord) => m.companyId === companyObj.id) as unknown as CompanyMetric[];
      const viceClaims = rawViceClaims
        .filter((vc: CloudRecord) => vc.cardId === c.id || vc.companyId === companyObj.id) as unknown as ViceClaim[];

      results.push({
        card,
        company: companyObj,
        metrics,
        viceClaims,
      });
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'companySourceAttempts') || Object.prototype.hasOwnProperty.call(payload, 'originalSourceAttempts')) {
      const attempts = [...(Array.isArray(payload.companySourceAttempts) ? payload.companySourceAttempts.filter(isOriginalSourceAttempt) : []),
        ...retainedDiagnosticAttempts(payload.originalSourceAttempts)];
      for (const deckId of new Set(results.map(card => card.card.deckId))) this.memoryOriginals.set(deckId, structuredClone(attempts));
    }
    return results;
  }
}
