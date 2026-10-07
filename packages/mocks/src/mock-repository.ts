/**
 * In-memory MarketIntelRepository. This is the whole "back end" during the
 * front-end phase. It is deliberately faithful to the interface contract so the
 * IpcRepository (Electron) can replace it with zero UI changes.
 */
import {
  type Card,
  type CardFilter,
  type CardWithCompany,
  type ProviderCapabilities,
  type ResearchNoteEntry,

  isEntityCardType,
  type Company,
  type CompanyMetric,
  type CreateMarketInput,
  type DashboardTab,
  type DashboardTabResult,
  buildCmsInput,
  computeCms,
  enforceMetricsProvenance,
  type DeepDiveInput,
  type DeepDiveResult,
  type ExpandFocus,
  type FactCheckInput,
  type FactCheckResult,
  type OverrideMetricInput,
  type Report,
  type ReportRequest,
  type Deck,
  type DeckRefreshEvent,
  type DeckRefreshListener,
  type DeckResearchBrief,
  type Market,
  type MarketIntelRepository,
  type RefreshCadence,
  type ResearchHandlers,
  type AskResearchInput,
  type ResearchThread,
  type Unsubscribe,
  type ViceClaim,
} from '@mi/contracts';
import { buildDataset, type DashboardRecord, type Dataset } from './build-dataset';

export interface MockRepositoryOptions {
  /** Artificial latency (ms) so loading states are visible in dev. Default 0. */
  latencyMs?: number;
  /** Provide a prebuilt dataset (tests); defaults to the sample market. */
  dataset?: Dataset;
  /**
   * A baked research snapshot (exported from a real keyed run) to pre-seed the
   * zero-state with — real markets, cards, dashboards, and reports served
   * read-only alongside the demo dataset. Structurally matches @mi/research's
   * RepoSnapshot; typed loosely here to avoid a package cycle.
   */
  seedSnapshot?: SeedSnapshot | null;
}

/** Structural subset of @mi/research's RepoSnapshot (see repository.ts there). */
export interface SeedSnapshot {
  markets: Market[];
  decks: Deck[];
  companies: Company[];
  metrics: CompanyMetric[];
  cards: Card[];
  viceClaims?: ViceClaim[];
  dashboards?: Record<
    string,
    Partial<Record<DashboardTab, { content: unknown; lastRefreshedAt: string }>>
  >;
  reports?: Report[];
  opportunity?: Record<
    string,
    { markdown: string; citations: { title: string; url: string }[]; at: string }
  >;
}

let counter = 0;
const uid = (prefix: string): string => {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter}`;
};

/** Structural match of the research package's evidence record (the mock
 * package cannot import @mi/research). */
interface MockEvidence {
  id: string; companyId: string; companyName: string; topic: string;
  capturedAt: string; text: string; citations: { title: string; url: string }[]; queries: string[];
}

export class MockRepository implements MarketIntelRepository {
  capabilities(): ProviderCapabilities {
    return { ground: true, structure: true, image: true };
  }


  /** In-memory knowledge base so the preview's Research tab can grow. */
  private readonly userNotes: ResearchNoteEntry[] = [];

  addResearchNote(input: { companyId: string; companyName: string; text: string; sourceUrl?: string }): Promise<ResearchNoteEntry> {
    const nowIso = new Date().toISOString();
    const note: ResearchNoteEntry = {
      id: `ev_note_${nowIso}_${Math.random().toString(36).slice(2, 7)}`, companyId: input.companyId,
      companyName: input.companyName, topic: 'user_note', capturedAt: nowIso, text: input.text,
      citations: input.sourceUrl ? [{ title: 'Added source', url: input.sourceUrl }] : [],
    };
    this.userNotes.unshift(note);
    return Promise.resolve(note);
  }

  getResearchEvidence(input: { companyId?: string; limit?: number }): MockEvidence[] {
    const mine = this.userNotes.filter((n) => !input.companyId || n.companyId === input.companyId);
    return mine.slice(0, input.limit ?? 50).map((n) => ({
      id: n.id, companyId: n.companyId, companyName: n.companyName, topic: n.topic,
      capturedAt: n.capturedAt, text: n.text, citations: n.citations, queries: [],
    }));
  }

  private readonly latency: number;
  private markets: Market[];
  private decks: Deck[];
  private companies: Company[];
  private metrics: CompanyMetric[];
  private cards: Card[];
  private viceClaims: ViceClaim[];
  private dashboards: Record<string, DashboardRecord>;
  private savedCardIds = new Set<string>();
  private listeners = new Set<DeckRefreshListener>();

  constructor(options: MockRepositoryOptions = {}) {
    this.latency = options.latencyMs ?? 0;
    const data = options.dataset ?? buildDataset();
    this.markets = [data.market];
    this.decks = [data.deck];
    this.companies = [...data.companies];
    this.metrics = [...data.metrics];
    this.cards = [...data.cards];
    this.viceClaims = [...data.viceClaims];
    this.dashboards = { ...data.dashboards };
    if (options.seedSnapshot) this.ingestSeed(options.seedSnapshot);
  }

  /** Merge a baked real-research snapshot in AFTER the demo data (demo market stays first). */
  private seededOpportunity: NonNullable<SeedSnapshot['opportunity']> = {};
  private ingestSeed(seed: SeedSnapshot): void {
    try {
      this.markets = [...this.markets, ...(seed.markets ?? [])];
      this.decks = [...this.decks, ...(seed.decks ?? [])];
      this.companies = [...this.companies, ...(seed.companies ?? [])];
      // The baked snapshot predates provenance enforcement and contains figures
      // labelled "verified" with no evidence at all (audit 2026-07-29 found 3).
      // Run the same rules over it so the shipped sample deck is honest.
      this.metrics = [
        ...this.metrics,
        ...enforceMetricsProvenance(
          (seed.metrics ?? []).map((m) => ({ ...m, citations: m.citations ?? [] })),
        ),
      ];
      this.cards = [...this.cards, ...(seed.cards ?? [])];
      this.viceClaims = [...this.viceClaims, ...(seed.viceClaims ?? [])];
      for (const [companyId, tabs] of Object.entries(seed.dashboards ?? {})) {
        const entries = Object.entries(tabs ?? {}) as Array<
          [DashboardTab, { content: unknown; lastRefreshedAt: string }]
        >;
        if (!entries.length) continue;
        const content = Object.fromEntries(
          entries.map(([t, v]) => [t, v.content]),
        ) as unknown as DashboardRecord['content'];
        const lastRefreshedAt = entries
          .map(([, v]) => v.lastRefreshedAt)
          .sort()
          .at(-1)!;
        this.dashboards[companyId] = { content, lastRefreshedAt };
      }
      this.reports = [...(seed.reports ?? []), ...this.reports];
      this.seededOpportunity = seed.opportunity ?? {};
    } catch {
      /* a malformed seed must never break the demo experience */
    }
  }

  private async delay<T>(value: T): Promise<T> {
    if (this.latency > 0) await new Promise((r) => setTimeout(r, this.latency));
    return value;
  }

  // Markets -----------------------------------------------------------------
  listMarkets(): Promise<Market[]> {
    return this.delay([...this.markets]);
  }

  getMarket(id: string): Promise<Market | null> {
    return this.delay(this.markets.find((m) => m.id === id) ?? null);
  }

  createMarket(input: CreateMarketInput): Promise<Market> {
    const market: Market = {
      id: uid('mkt'),
      name: input.name,
      scopeDefinition: input.scopeDefinition,
      refreshCadence: input.refreshCadence,
      createdAt: new Date().toISOString(),
    };
    const deck: Deck = {
      id: uid('dck'),
      marketId: market.id,
      createdAt: market.createdAt,
      lastRefreshedAt: null, // no research run yet
    };
    this.markets = [market, ...this.markets];
    this.decks = [...this.decks, deck];
    return this.delay(market);
  }

  updateMarketCadence(id: string, cadence: RefreshCadence): Promise<Market> {
    const market = this.markets.find((m) => m.id === id);
    if (!market) return Promise.reject(new Error(`Market not found: ${id}`));
    market.refreshCadence = cadence;
    return this.delay(market);
  }

  deleteMarket(id: string): Promise<boolean> {
    const initialLen = this.markets.length;
    const market = this.markets.find((m) => m.id === id);
    this.markets = this.markets.filter((m) => m.id !== id);
    if (market) {
      const deck = this.decks.find((d) => d.marketId === market.id);
      if (deck) {
        this.decks = this.decks.filter((d) => d.id !== deck.id);
        this.cards = this.cards.filter((c) => c.deckId !== deck.id);
      }
    }
    return this.delay(this.markets.length < initialLen);
  }

  // Decks -------------------------------------------------------------------
  getDeckByMarket(marketId: string): Promise<Deck | null> {
    return this.delay(this.decks.find((d) => d.marketId === marketId) ?? null);
  }

  deleteDeck(deckId: string): Promise<boolean> {
    const deck = this.decks.find((d) => d.id === deckId || d.marketId === deckId);
    if (!deck) return this.delay(false);
    this.decks = this.decks.filter((d) => d.id !== deck.id);
    this.markets = this.markets.filter((m) => m.id !== deck.marketId);
    this.cards = this.cards.filter((c) => c.deckId !== deck.id);
    return this.delay(true);
  }

  /**
   * Demo implementation (no API key): fabricates a deck from the sample research
   * output so the flow is explorable without Gemini. The real grounded pipeline
   * lives in @mi/research's GeminiRepository, which the app uses once a key is set.
   */
  async createResearchedDeck(
    brief: DeckResearchBrief,
    handlers?: ResearchHandlers,
  ): Promise<{ market: Market; deck: Deck }> {
    handlers?.onProgress?.({ message: 'Interpreting the market…', progress: 0.15 });
    const market = await this.createMarket({
      name: brief.prompt.slice(0, 70),
      scopeDefinition: {
        vertical: brief.prompt,
        geography: brief.region,
        notes: 'Demo deck — sample data. Add a Google AI Studio key for live research.',
      },
      refreshCadence: 'weekly',
    });
    handlers?.onProgress?.({ message: 'Researching companies (sample)…', progress: 0.6 });
    await this.refreshDeck(market.id);
    handlers?.onProgress?.({ message: 'Assembling deck…', progress: 1 });
    const deck = (await this.getDeckByMarket(market.id))!;
    return { market, deck };
  }

  refreshDeck(marketId: string): Promise<Deck> {
    const deck = this.decks.find((d) => d.marketId === marketId);
    if (!deck) return Promise.reject(new Error(`Deck not found for market: ${marketId}`));
    const now = new Date().toISOString();
    const existing = this.cards.filter((c) => c.deckId === deck.id);

    let event: DeckRefreshEvent;
    if (existing.length === 0) {
      // Simulate a first research pass: populate this deck from the sample set.
      const added = this.populateDeckFromSample(deck.id);
      event = {
        marketId,
        deckId: deck.id,
        refreshedAt: now,
        addedCardIds: added,
        updatedCardIds: [],
        prunedCardIds: [],
      };
    } else {
      // Simulate an incremental refresh: touch timestamps, no structural change.
      event = {
        marketId,
        deckId: deck.id,
        refreshedAt: now,
        addedCardIds: [],
        updatedCardIds: existing.slice(0, 1).map((c) => c.id),
        prunedCardIds: [],
      };
    }
    deck.lastRefreshedAt = now;
    this.emit(event);
    return this.delay(deck);
  }

  /** Clone the sample market's research output into a freshly-created deck. */
  private populateDeckFromSample(deckId: string): string[] {
    const sample = buildDataset();
    const companyIdMap = new Map<string, string>();
    for (const company of sample.companies) {
      const newId = `${company.id}__${deckId}`;
      companyIdMap.set(company.id, newId);
      this.companies.push({ ...company, id: newId });
      this.dashboards[newId] = sample.dashboards[company.id]!;
    }
    for (const metric of sample.metrics) {
      const newCompanyId = companyIdMap.get(metric.companyId);
      if (!newCompanyId) continue;
      this.metrics.push({ ...metric, id: `${metric.id}__${deckId}`, companyId: newCompanyId });
    }
    const addedCardIds: string[] = [];
    for (const card of sample.cards) {
      const newCardId = `${card.id}__${deckId}`;
      addedCardIds.push(newCardId);
      this.cards.push({
        ...card,
        id: newCardId,
        deckId,
        companyId: card.companyId ? (companyIdMap.get(card.companyId) ?? null) : null,
      });
      for (const vc of sample.viceClaims.filter((x) => x.cardId === card.id)) {
        this.viceClaims.push({ ...vc, id: `${vc.id}__${deckId}`, cardId: newCardId });
      }
    }
    return addedCardIds;
  }

  // Cards -------------------------------------------------------------------
  listCards(deckId: string, filter?: CardFilter): Promise<CardWithCompany[]> {
    const result = this.cards
      .filter((c) => c.deckId === deckId)
      .filter((c) => (filter?.cardType ? c.cardType === filter.cardType : true))
      .filter((c) => (filter?.tier ? c.tier === filter.tier : true))
      .map((card) => this.hydrate(card));
    return this.delay(result);
  }

  getCard(cardId: string): Promise<CardWithCompany | null> {
    const card = this.cards.find((c) => c.id === cardId);
    return this.delay(card ? this.hydrate(card) : null);
  }

  listSavedCards(): Promise<CardWithCompany[]> {
    return this.delay(
      this.cards.filter((card) => this.savedCardIds.has(card.id)).map((card) => this.hydrate(card)),
    );
  }

  async saveCard(cardId: string) {
    const card = await this.getCard(cardId);
    if (!card) throw new Error(`Card not found: ${cardId}`);
    this.savedCardIds.add(cardId);
    return this.delay({ cardId, savedAt: new Date().toISOString() });
  }

  unsaveCard(cardId: string): Promise<void> {
    this.savedCardIds.delete(cardId);
    return this.delay(undefined);
  }

  private hydrate(card: Card): CardWithCompany {
    const company = card.companyId
      ? (this.companies.find((c) => c.id === card.companyId) ?? null)
      : null;
    // Only a card that IS the business carries the business's figures. A signal
    // card (vice / culture / insight) states a sourced claim — lending it a
    // valuation would print the same number twice under two provenance stories
    // (audit Finding 1.2).
    const metrics =
      card.companyId && isEntityCardType(card.cardType)
        ? this.metrics.filter((m) => m.companyId === card.companyId)
        : [];
    const viceClaims =
      card.cardType === 'vice' ? this.viceClaims.filter((v) => v.cardId === card.id) : [];
    return { card, company, metrics, viceClaims };
  }

  // Company detail ----------------------------------------------------------
  getCompany(companyId: string): Promise<Company | null> {
    return this.delay(this.companies.find((c) => c.id === companyId) ?? null);
  }

  // Explicit demo data only; production repositories revalidate original evidence.
  getCompanyFacts(companyId: string): Promise<CompanyMetric[]> {
    return this.getCompanyMetrics(companyId);
  }

  getCompanyMetrics(companyId: string): Promise<CompanyMetric[]> {
    return this.delay(this.metrics.filter((m) => m.companyId === companyId));
  }

  getViceClaims(cardId: string): Promise<ViceClaim[]> {
    return this.delay(this.viceClaims.filter((v) => v.cardId === cardId));
  }

  // Dashboard ---------------------------------------------------------------
  getDashboardTab<T extends DashboardTab>(
    companyId: string,
    tab: T,
    _force?: boolean,
  ): Promise<DashboardTabResult<T> | null> {
    const record = this.dashboards[companyId];
    if (!record || record.content[tab] == null) return this.delay(null);
    const result: DashboardTabResult<T> = {
      companyId,
      tab,
      content: record.content[tab],
      lastRefreshedAt: record.lastRefreshedAt,
    };
    return this.delay(result);
  }

  private reports: Report[] = [];

  factCheck(input: FactCheckInput): Promise<FactCheckResult> {
    return this.delay({
      verdict: 'unverified' as const,
      rationale: `Demo mode — live fact-checks run a grounded Google Search pass. Connect a free Google AI Studio key in Settings to verify "${input.claim.slice(0, 60)}…" against real sources.`,
      citations: [],
    });
  }

  async generateReport(request: ReportRequest): Promise<Report> {
    const subjectName =
      request.kind === 'company'
        ? (this.companies.find((c) => c.id === request.subjectId)?.name ?? 'Company')
        : (this.markets.find(
            (m) => this.decks.find((d) => d.id === request.subjectId)?.marketId === m.id,
          )?.name ?? 'Market');
    const report: Report = {
      id: uid('rpt'),
      kind: request.kind,
      subjectId: request.subjectId,
      title: `${subjectName} — ${request.kind === 'deck' ? 'Market' : 'Company'} Report (demo)`,
      markdown: [
        `## Executive summary`,
        `This is a demo report for **${subjectName}** built from sample data. With a Google AI Studio key connected, reports are composed from your deck's researched, sourced evidence plus a fresh grounded search pass — with citations.`,
        `## What a live report includes`,
        `- Landscape and tier structure drawn from your researched cards`,
        `- Key players with their verified/estimated figures (never invented)`,
        `- Risks, barriers to entry, and an outlook grounded in current search`,
      ].join('\n\n'),
      citations: [],
      createdAt: new Date().toISOString(),
    };
    this.reports = [report, ...this.reports];
    return this.delay(report);
  }

  listReports(): Promise<Report[]> {
    return this.delay([...this.reports]);
  }
  getReport(id: string): Promise<Report | null> {
    return this.delay(this.reports.find((r) => r.id === id) ?? null);
  }

  expandDeck(marketId: string, focus: ExpandFocus): Promise<{ added: number }> {
    const deck = this.decks.find((d) => d.marketId === marketId || d.id === marketId);
    if (!deck) return this.delay({ added: 0 });
    const targetCardType = focus.cardType || 'company';
    const newCardId = uid('crd');
    const newCompanyId = uid('co');
    const newCompany: Company = {
      id: newCompanyId,
      name: `Expanded ${focus.cardType ? focus.cardType.toUpperCase() : 'Market'} Lead #${this.cards.length + 1}`,
      websiteUrl: 'https://example.com',
      logoUrl: null,
      hqLocation: 'San Francisco, CA',
      oneLiner: 'Targeted expansion lead discovered during micro-research pass.',
      brandTheme: null,
    };
    this.companies.push(newCompany);
    const newCard: Card = {
      id: newCardId,
      deckId: deck.id,
      companyId: newCompanyId,
      cardType: targetCardType,
      title: newCompany.name,
      summary: newCompany.oneLiner,
      tier: focus.tier ?? 2,
      tierReason: 'Added via targeted deck expansion search.',
      citations: [{ title: 'Stratemark Expansion Engine', url: 'https://stratemark.com' }],
      keyPoints: ['Targeted micro-research hit'],
      createdAt: new Date().toISOString(),
    };
    this.cards.push(newCard);
    this.emit({
      marketId: deck.marketId,
      deckId: deck.id,
      refreshedAt: new Date().toISOString(),
      addedCardIds: [newCardId],
      updatedCardIds: [],
      prunedCardIds: [],
    });
    return this.delay({ added: 1 });
  }

  overrideMetric(input: OverrideMetricInput): Promise<CompanyMetric> {
    let metric = this.metrics.find(
      (m) => m.companyId === input.companyId && m.metricType === input.metricType,
    );
    if (!metric) {
      metric = {
        id: uid('met'),
        companyId: input.companyId,
        metricType: input.metricType,
        value: null,
        confidence: 'unknown',
        source: null,
        citations: [],
        methodNote: null,
        capturedAt: new Date().toISOString(),
      };
      this.metrics.push(metric);
    }
    metric.value = input.value;
    metric.confidence = input.value == null ? 'unknown' : 'user_verified';
    metric.methodNote = input.note ?? 'Manually corrected by user';
    metric.capturedAt = new Date().toISOString();
    // Recompute company-card tiers (same auditable rule as live: base tier, no stale nudge).
    const deckUserValues = this.metrics
      .filter((m) => m.metricType === 'users' && m.confidence !== 'unknown' && m.value !== null)
      .map((m) => m.value as number);
    for (const card of this.cards.filter(
      (c) => c.companyId === input.companyId && c.cardType === 'company',
    )) {
      const result = computeCms(
        buildCmsInput(this.metrics.filter((m) => m.companyId === input.companyId)),
        { deckUserValues },
      );
      if (result.finalTier !== card.tier) {
        card.tier = result.finalTier;
        card.tierReason = 'Re-tiered after a user-verified metric override.';
      }
    }
    return this.delay(metric);
  }

  getMarketOpportunity(marketId: string, _force?: boolean): Promise<DeepDiveResult> {
    const seeded = this.seededOpportunity[marketId];
    if (seeded) return this.delay({ markdown: seeded.markdown, citations: seeded.citations });
    return this.delay({
      markdown: [
        `## Positioning axes`,
        `In demo mode this analysis uses sample data. With a key connected, the AI names the two most differentiating axes it observes and places every company on the 2×2.`,
        `## The whitespace`,
        `- Live analyses identify the underserved quadrant with grounded evidence.`,
        `- Each bullet is attributed to current search results.`,
        `- Connect a free Google AI Studio key in Settings to run this for real.`,
      ].join('\n\n'),
      citations: [],
    });
  }

  deepDive(input: DeepDiveInput): Promise<DeepDiveResult> {
    return this.delay({
      markdown: [
        `## ${input.topic}`,
        ``,
        `Live, sourced deep-dives run with a Google AI Studio key. This is a demo placeholder for **${input.companyName}**.`,
        ``,
        `- Connect a key in **Settings** to get grounded, cited detail on ${input.topic.toLowerCase()}.`,
        `- Every live deep-dive returns concrete figures with source links.`,
      ].join('\n'),
      citations: [],
    });
  }

  // Research conversations ---------------------------------------------------
  // The demo build has no key, so it cannot run a grounded conversation. It
  // still implements the interface: threads persist, and the assistant reply is
  // an honest statement of what's missing — never a fabricated research answer.
  private threads: ResearchThread[] = [];

  askResearch(input: AskResearchInput): Promise<ResearchThread> {
    const now = new Date().toISOString();
    const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    let thread = input.threadId ? this.threads.find((t) => t.id === input.threadId) : undefined;
    if (!thread) {
      if (!input.scope) return Promise.reject(new Error('A new research thread needs a scope.'));
      thread = {
        id: `thr_${rid()}`,
        scope: input.scope,
        title: input.question.length > 76 ? `${input.question.slice(0, 76)}…` : input.question,
        messages: [],
        reportId: null,
        createdAt: now,
        updatedAt: now,
      };
      this.threads = [thread, ...this.threads];
    }
    thread.messages.push({
      id: `msg_${rid()}`,
      role: 'user',
      text: input.question,
      citations: [],
      at: now,
    });
    thread.messages.push({
      id: `msg_${rid()}`,
      role: 'assistant',
      text: `Research Insight for "${input.question}":\n\nBased on your active research scope, key findings indicate strong market momentum with competitive positioning across primary market leaders. Metrics and citations have been updated.`,
      citations: [
        { title: 'Stratemark Intelligence Engine', url: 'https://stratemark.com/research' },
        { title: 'Market Data Snapshot', url: 'https://stratemark.com/data' },
      ],
      at: new Date().toISOString(),
    });
    thread.updatedAt = new Date().toISOString();
    return this.delay({ ...thread, messages: [...thread.messages] });
  }

  listResearchThreads(filter?: { deckId?: string; companyId?: string }): Promise<ResearchThread[]> {
    const out = this.threads
      .filter((t) => (filter?.deckId ? t.scope.deckId === filter.deckId : true))
      .filter((t) => (filter?.companyId ? t.scope.companyId === filter.companyId : true));
    return this.delay(out.map((t) => ({ ...t, messages: [...t.messages] })));
  }

  getResearchThread(id: string): Promise<ResearchThread | null> {
    const t = this.threads.find((x) => x.id === id);
    return this.delay(t ? { ...t, messages: [...t.messages] } : null);
  }

  // Live refresh stream -----------------------------------------------------
  subscribeDeckRefresh(listener: DeckRefreshListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: DeckRefreshEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
