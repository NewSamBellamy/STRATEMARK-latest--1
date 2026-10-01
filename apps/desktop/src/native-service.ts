/** Native research owner. Saved reads never construct or call a provider. */
import { createHash, randomUUID } from 'node:crypto';
import {
  nativeResearchStartSchema,
  nativeCardEvidenceSchema,
  nativeSourceEvidenceSchema,
  isEntityCardType,
  type NativeCardEvidence,
  type NativeResearchRun,
  type NativeResearchTask,
  type NativeResearchStart,
  type ResearchProgress,
  type CardWithCompany,
  type Market,
  type Deck,
} from '@mi/contracts';
import {
  discoverDeckStubs,
  hydrateCompanyCard,
  createResearchUsageMeter,
  type CompanyCandidate,
  type LlmClient,
  type MarketPlan,
  type UsageMeter,
} from '@mi/research';
import type { openVault } from './vault';
import { retrievePublicSource } from './native-source-retrieval';

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const timestamp = () => new Date().toISOString();
const companyId = (candidate: CompanyCandidate) =>
  `cmp_${hash(JSON.stringify([candidate.name.toLowerCase(), candidate.domain?.toLowerCase() ?? null])).slice(0, 24)}`;
type Vault = ReturnType<typeof openVault>;
type RetainedSource = NonNullable<ReturnType<Vault['getSourceVersion']>>;
const sourceId = (cardId: string, url: string) => `src_${hash(JSON.stringify([cardId, url]))}`;
const passageId = (source: string) => `psg_${hash(source)}`;
function sourceMatches(
  source: RetainedSource['record'],
  expectedId: string,
  url: string,
  marketId: string,
) {
  return (
    source.id === expectedId &&
    source.revision === 1 &&
    source.origin === 'web' &&
    source.originalUrl === url &&
    source.visibilityScope.marketIds.includes(marketId)
  );
}
function retainedExcerpt(text: string): string | null {
  let excerpt = text.trim().slice(0, 20_000);
  // Do not split a surrogate pair at the retained excerpt boundary.
  if (/[\uD800-\uDBFF]$/.test(excerpt)) excerpt = excerpt.slice(0, -1);
  excerpt = excerpt.trim();
  return excerpt && Buffer.from(excerpt, 'utf8').toString('utf8') === excerpt ? excerpt : null;
}
function sourceLeads(cards: CardWithCompany[]): NativeCardEvidence['sources'] {
  const leads = new Map<string, NativeCardEvidence['sources'][number]>();
  for (const { card } of cards) {
    for (const citation of card.citations) {
      const parsed = nativeSourceEvidenceSchema.safeParse({
        url: citation.url,
        title: citation.title.slice(0, 5000),
        retrievalStatus: 'lead_only',
        fetchedAt: null,
        text: null,
        sourceId: null,
        sourceRevision: null,
        passageId: null,
        support: 'unreviewed',
      });
      if (parsed.success && !leads.has(parsed.data.url)) leads.set(parsed.data.url, parsed.data);
      if (leads.size === 20) return [...leads.values()];
    }
  }
  return [...leads.values()];
}

export class NativeResearchService {
  private readonly controllers = new Map<string, AbortController>();
  private readonly active = new Map<string, Promise<void>>();
  private readonly writes: ReturnType<Vault['writer']>['work'] | null;
  private readonly writer: ReturnType<Vault['writer']> | null;
  private readonly provenance: NonNullable<NativeResearchRun['researchProvenance']>;
  private readonly writable: boolean;
  private closing: Promise<void> | null = null;

  constructor(
    readonly vault: Vault,
    private readonly connection: () => LlmClient | null,
    private readonly notify: (run: NativeResearchRun) => void = () => {},
    private readonly hydrationOptions: {
      fetchImpl?: typeof fetch;
      retrieveSource?: typeof retrievePublicSource;
      researchProvenance?: 'synthetic_fixture' | 'live_provider';
      writable?: boolean;
    } = {},
  ) {
    this.provenance = hydrationOptions.researchProvenance ?? 'live_provider';
    this.writable = hydrationOptions.writable ?? true;
    const runs = vault.work.listRuns();
    this.writer =
      this.writable && runs.every((run) => run.researchProvenance === this.provenance)
        ? vault.writer()
        : null;
    this.writes = this.writer?.work ?? null;
    if (!this.writes) return;
    for (const run of runs) {
      if (run.status === 'running' || run.status === 'queued') {
        this.writes.updateRun(
          {
            ...run,
            status: 'paused',
            generation: run.generation + 1,
            updatedAt: timestamp(),
            error:
              'Interrupted by restart. Review retained results before resuming; the last provider request may have been billed.',
          },
          run.generation,
        );
      }
    }
  }

  private assertWritable(): ReturnType<Vault['writer']>['work'] {
    if (!this.writable) throw new Error('Native research workspace is read-only.');
    if (this.vault.work.listRuns().some((run) => run.researchProvenance !== this.provenance))
      throw new Error('Stored workspace research provenance does not match this service.');
    if (!this.writes) throw new Error('Native research workspace is read-only.');
    return this.writes;
  }

  saveCard(cardId: string) {
    return this.assertWritable().bookmarkCard(cardId);
  }

  unsaveCard(cardId: string): void {
    this.assertWritable().unbookmarkCard(cardId);
  }

  getCardEvidence(cardId: string): NativeCardEvidence {
    const card = this.vault.work.getCard(cardId);
    if (!card) throw new Error('Saved card was not found.');
    const run = this.vault.work.listRuns().find((run) => run.deckId === card.card.deckId);
    const deck = run && this.vault.work.getDeckByMarket(run.marketId);
    if (!deck || deck.id !== card.card.deckId) throw new Error('Saved card market was not found.');
    const sources = sourceLeads([card]).map((lead) => {
      const expectedSource = sourceId(cardId, lead.url);
      const retained = this.vault.getSourceVersion(expectedSource, 1);
      if (!retained) return lead;
      const source = retained.record;
      if (!sourceMatches(source, expectedSource, lead.url, deck.marketId)) return lead;
      const base = { ...lead, fetchedAt: source.fetchedAt };
      if (source.retrievalStatus === 'failed' || source.retrievalStatus === 'blocked') {
        return {
          ...base,
          retrievalStatus: source.retrievalStatus,
          sourceId: source.id,
          sourceRevision: source.revision,
        };
      }
      const expectedPassage = passageId(source.id);
      const passage = this.vault.getPassage(expectedPassage);
      if (
        !passage ||
        passage.id !== expectedPassage ||
        passage.sourceId !== source.id ||
        passage.sourceRevision !== source.revision ||
        passage.origin !== source.origin ||
        !passage.visibilityScope.marketIds.includes(deck.marketId)
      )
        return { ...base, retrievalStatus: 'failed' as const };
      return {
        ...base,
        retrievalStatus: source.retrievalStatus,
        text: passage.text,
        sourceId: source.id,
        sourceRevision: source.revision,
        passageId: passage.id,
      };
    });
    return nativeCardEvidenceSchema.parse({ cardId, sources });
  }

  start(input: NativeResearchStart): NativeResearchRun {
    if (this.closing) throw new Error('Research service is closing.');
    const writes = this.assertWritable();
    const request = nativeResearchStartSchema.parse(input);
    if (request.scope.seeds.length > request.maxCompanies)
      throw new Error('Increase the company allowance or use fewer must-include companies.');
    if (request.scope.seeds.some((seed) => seed.companyId && !seed.name && !seed.domain)) {
      throw new Error('Include a company name or domain for each seed in this research preview.');
    }
    const fingerprint = hash(
      JSON.stringify({
        scope: request.scope,
        maxCompanies: request.maxCompanies,
        limits: request.limits,
      }),
    );
    const existing = this.vault.work
      .listRuns()
      .find((run) => run.requestKey === request.requestKey);
    if (existing) {
      if (existing.requestFingerprint !== fingerprint)
        throw new Error('Research request key already belongs to a different scope.');
      return existing;
    }
    const client = this.connection();
    if (!client)
      throw new Error(
        'Connect your Gemini key in Settings before starting research. Your scope has been kept.',
      );
    const at = timestamp();
    const market: Market = {
      id: id('mkt'),
      name: request.scope.goal.slice(0, 240),
      scopeDefinition: {
        vertical: request.scope.goal,
        geography: request.scope.region,
        notes: null,
      },
      refreshCadence: 'weekly',
      createdAt: at,
    };
    const deck: Deck = { id: id('dck'), marketId: market.id, createdAt: at, lastRefreshedAt: null };
    const run: NativeResearchRun = {
      id: id('run'),
      marketId: market.id,
      deckId: deck.id,
      requestKey: request.requestKey,
      requestFingerprint: fingerprint,
      researchProvenance: this.provenance,
      status: 'queued',
      generation: 0,
      scope: request.scope,
      maxCompanies: request.maxCompanies,
      limits: request.limits,
      usage: {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        complete: false,
        ...(request.limits.maxSourceRequests ? { sourceRequests: 0 } : {}),
      },
      createdAt: at,
      updatedAt: at,
      error: null,
    };
    writes.acceptRun(run, market, deck);
    this.dispatch(run, client);
    return this.vault.work.getRun(run.id)!;
  }

  control(runId: string, command: 'pause' | 'resume' | 'cancel'): NativeResearchRun {
    const writes = this.assertWritable();
    const run = this.vault.work.getRun(runId);
    if (!run) throw new Error('Research run was not found.');
    if (command === 'resume') {
      if (this.closing) throw new Error('Research service is closing.');
      if (run.status === 'completed' || run.status === 'cancelled' || this.active.has(runId))
        return run;
      const needsModel = !run.tasks || run.tasks.some((task) => task.status !== 'completed');
      const client = needsModel ? this.connection() : null;
      if (needsModel && !client) throw new Error('Reconnect your Gemini key before resuming.');
      // Reservations from interrupted attempts remain charged to the original limits.
      if (
        needsModel &&
        (run.usage.requests >= run.limits.maxRequests ||
          run.usage.inputTokens >= run.limits.maxInputTokens ||
          run.usage.outputTokens >= run.limits.maxOutputTokens)
      ) {
        throw new Error(
          'This run has used its approved allowance. Retained research remains readable.',
        );
      }
      const next = {
        ...run,
        status: 'queued' as const,
        generation: run.generation + 1,
        updatedAt: timestamp(),
        error: null,
      };
      writes.updateRun(next, run.generation);
      this.dispatch(next, client);
    } else if (
      command === 'pause' &&
      ['paused', 'failed', 'completed', 'cancelled'].includes(run.status)
    ) {
      return run;
    } else if (!['completed', 'cancelled'].includes(run.status)) {
      this.controllers.get(runId)?.abort();
      writes.updateRun(
        {
          ...run,
          status: command === 'pause' ? 'paused' : 'cancelled',
          generation: run.generation + 1,
          updatedAt: timestamp(),
          error: null,
        },
        run.generation,
      );
    }
    const current = this.vault.work.getRun(runId)!;
    this.notify(current);
    return current;
  }

  private dispatch(run: NativeResearchRun, client: LlmClient | null) {
    this.assertWritable();
    if (this.active.has(run.id)) return;
    const controller = new AbortController();
    this.controllers.set(run.id, controller);
    const work = this.execute(run, client, controller.signal).finally(() => {
      this.controllers.delete(run.id);
      this.active.delete(run.id);
    });
    this.active.set(run.id, work);
    // execute records failures; no unhandled background rejection.
    void work.catch(() => {});
  }

  private async execute(initial: NativeResearchRun, raw: LlmClient | null, signal: AbortSignal) {
    const writes = this.assertWritable();
    let run = {
      ...initial,
      status: 'running' as NativeResearchRun['status'],
      updatedAt: timestamp(),
    };
    const guard = () => {
      const current = this.vault.work.getRun(run.id);
      if (
        signal.aborted ||
        !current ||
        current.generation !== run.generation ||
        current.researchProvenance !== this.provenance ||
        current.status !== 'running'
      ) {
        throw new Error('Research attempt is no longer active.');
      }
      return current;
    };
    const saveUsage = (usage: NativeResearchRun['usage']) => {
      const current = guard();
      run = writes.updateRun(
        { ...current, usage: { ...current.usage, ...usage }, updatedAt: timestamp() },
        run.generation,
      );
    };
    const saveTask = (
      entityId: string,
      outcome: Partial<NativeResearchTask>,
      cards: CardWithCompany[] = [],
    ) => {
      guard();
      run = writes.updateRun(
        {
          ...run,
          tasks: run.tasks!.map((task) =>
            task.companyId === entityId ? { ...task, ...outcome } : task,
          ),
          updatedAt: timestamp(),
        },
        run.generation,
        cards,
      );
    };
    const emit = (progress: ResearchProgress) => {
      guard();
      writes.appendEvent(run.id, run.generation, progress);
      this.notify(run);
    };
    let publicationFailed = false;
    const captureSources = async (cards: CardWithCompany[]) => {
      const ceiling = run.limits.maxSourceRequests ?? 0;
      if (!ceiling) return;
      const warn = () => {
        guard();
        publicationFailed = true;
        emit({
          kind: 'warn',
          message: 'Source capture was unavailable. Saved cards remain unreviewed.',
        });
      };
      const repairPassage = (retained: RetainedSource) => {
        const source = retained.record;
        if (
          retained.content === null ||
          !['retrieved', 'partial'].includes(source.retrievalStatus) ||
          this.vault.getPassage(passageId(source.id))
        )
          return;
        const text = retainedExcerpt(String(retained.content));
        if (!text) return;
        const at = timestamp();
        guard();
        this.writer!.savePassage({
          contractVersion: '1',
          vaultId: source.vaultId,
          id: passageId(source.id),
          revision: 1,
          createdAt: at,
          updatedAt: at,
          sourceId: source.id,
          sourceRevision: source.revision,
          text,
          contentHash: hash(text),
          origin: source.origin,
          visibilityScope: source.visibilityScope,
        });
      };
      const beforeRequest = () => {
        const current = guard();
        const used = current.usage.sourceRequests ?? 0;
        if (used >= ceiling) throw new Error('Source request allowance exhausted.');
        run = writes.updateRun(
          {
            ...current,
            usage: { ...current.usage, sourceRequests: used + 1 },
            updatedAt: timestamp(),
          },
          current.generation,
        );
      };
      for (const lead of sourceLeads(cards).slice(0, 2)) {
        guard();
        const targets = cards
          .filter(({ card }) => card.citations.some((citation) => citation.url === lead.url))
          .map(({ card }) => ({
            card,
            retained: this.vault.getSourceVersion(sourceId(card.id, lead.url), 1),
          }));
        let cached: RetainedSource | undefined;
        for (const { card, retained } of targets) {
          if (
            !retained ||
            !sourceMatches(retained.record, sourceId(card.id, lead.url), lead.url, run.marketId)
          )
            continue;
          cached ??= retained;
          try {
            repairPassage(retained);
          } catch {
            warn();
          }
        }
        const missing = targets.filter((target) => !target.retained);
        if (!missing.length) continue;
        let result: Awaited<ReturnType<typeof retrievePublicSource>>;
        let fetchedAt: string;
        if (cached) {
          result = {
            originalUrl: lead.url,
            canonicalUrl: cached.record.canonicalUrl!,
            text: cached.content === null ? null : String(cached.content),
            retrievalStatus: cached.record.retrievalStatus,
            reason: null,
          };
          fetchedAt = cached.record.fetchedAt;
        } else {
          if ((guard().usage.sourceRequests ?? 0) >= ceiling) continue;
          try {
            result = await (this.hydrationOptions.retrieveSource ?? retrievePublicSource)(
              lead.url,
              {
                signal,
                beforeRequest,
              },
            );
          } catch (error) {
            guard();
            result = {
              originalUrl: lead.url,
              canonicalUrl: lead.url,
              text: null,
              retrievalStatus: 'failed',
              reason: error instanceof Error ? error.message : 'Source retrieval failed.',
            };
          }
          fetchedAt = timestamp();
        }
        guard();
        const fullText = result.text?.trim() ?? '';
        const text = retainedExcerpt(fullText);
        const retained = ['retrieved', 'partial'].includes(result.retrievalStatus) && text !== null;
        const status = retained
          ? fullText.length > text!.length || result.retrievalStatus === 'partial'
            ? 'partial'
            : 'retrieved'
          : result.retrievalStatus === 'blocked'
            ? 'blocked'
            : 'failed';
        const content = retained ? text : null;
        const at = timestamp();
        const version = {
          contractVersion: '1',
          vaultId: this.vault.status().vaultId,
          revision: 1,
          createdAt: at,
          updatedAt: at,
        };
        const visibilityScope = { marketIds: [run.marketId], companyIds: [] };
        for (const { card } of missing) {
          try {
            const source = sourceId(card.id, lead.url);
            guard();
            this.writer!.saveSourceVersion(
              {
                ...version,
                id: source,
                originalUrl: lead.url,
                canonicalUrl: result.canonicalUrl,
                fetchedAt,
                publishedAt: null,
                eventAt: null,
                retrievalStatus: status,
                contentHash: content === null ? null : hash(content),
                origin: 'web',
                visibilityScope,
              },
              content,
              0,
            );
            repairPassage(this.vault.getSourceVersion(source, 1)!);
          } catch {
            guard();
            const retained = this.vault.getSourceVersion(sourceId(card.id, lead.url), 1);
            if (
              !retained ||
              !sourceMatches(retained.record, sourceId(card.id, lead.url), lead.url, run.marketId)
            ) {
              warn();
              continue;
            }
            // One local repair handles a transient passage write; never repeat HTTP here.
            try {
              repairPassage(retained);
            } catch {
              warn();
            }
          }
        }
      }
    };
    try {
      writes.updateRun(run, run.generation);
      const charged = { ...run.usage };
      const meter = createResearchUsageMeter({
        maxRequests: run.limits.maxRequests - charged.requests,
        maxInputTokens: run.limits.maxInputTokens - charged.inputTokens,
        maxOutputTokens: run.limits.maxOutputTokens - charged.outputTokens,
      });
      const persistMeter = () => {
        const usage = meter.snapshot();
        saveUsage({
          requests: charged.requests + usage.requests,
          inputTokens: charged.inputTokens + usage.inputTokens,
          outputTokens: charged.outputTokens + usage.outputTokens,
          complete:
            usage.requests === 0
              ? charged.complete
              : (charged.requests === 0 || charged.complete) && usage.complete,
        });
      };
      const usageMeter: UsageMeter = {
        beginAttempt(request) {
          guard();
          const grant = meter.beginAttempt(request);
          persistMeter();
          return grant;
        },
        settleAttempt(attempt, usage) {
          meter.settleAttempt(attempt, usage);
          persistMeter();
        },
        snapshot: () => meter.snapshot(),
      };
      const client: LlmClient = {
        ground: (prompt, options) => {
          guard();
          if (!raw) throw new Error('Company research requires a provider connection.');
          return raw.ground(prompt, { ...options, signal, usageMeter });
        },
        structure: (prompt, schema, options) => {
          guard();
          if (!raw) throw new Error('Company research requires a provider connection.');
          return raw.structure(prompt, schema, { ...options, signal, usageMeter });
        },
      };
      const plan: MarketPlan = {
        marketName: this.vault.work.getMarket(run.marketId)!.name,
        vertical: run.scope.goal,
        geography: run.scope.region,
        notes: null,
        searchThemes: [run.scope.goal, ...run.scope.inclusions].slice(0, 4),
      };
      if (!run.tasks) {
        if (this.vault.work.listCards(run.deckId).length)
          throw new Error(
            'The original candidate queue was not retained. Saved research remains readable; start a new run.',
          );
        emit({
          stage: 'catalog',
          kind: 'step',
          message: 'Finding companies within your approved scope…',
        });
        const seedText = run.scope.seeds.map((seed) =>
          [seed.name, seed.domain].filter(Boolean).join(' — '),
        );
        const prompt = [
          run.scope.goal,
          `Must include if identity can be confirmed: ${seedText.join('; ') || 'none'}`,
          `Exclude: ${run.scope.exclusions.join('; ') || 'none'}`,
        ].join('\n');
        const stubs = await discoverDeckStubs({ prompt, region: run.scope.region }, client, {
          confirmedPlan: { ...plan, notes: prompt },
          targetCompanies: run.maxCompanies,
          catalogMax: run.maxCompanies,
          catalogPasses: 0,
          signal,
          coverage: {
            companies: { min: 0, target: run.maxCompanies, max: run.maxCompanies },
            infrastructure: { min: 0, target: 0, max: 0 },
            distribution: { min: 0, target: 0, max: 0 },
            vice: { min: 0, target: 0, max: 0 },
            culture: { min: 0, target: 0, max: 0 },
          },
          onEvent: (event) => {
            if (event.type === 'warning') emit({ kind: 'warn', message: event.message });
          },
        });
        guard();
        const excluded = new Set(run.scope.exclusions.map((name) => name.toLowerCase()));
        const candidates = stubs.candidates.filter(
          (candidate) =>
            !excluded.has(candidate.name.toLowerCase()) &&
            !excluded.has(candidate.domain?.toLowerCase() ?? ''),
        );
        for (const seed of run.scope.seeds) {
          const matches = candidates.filter((candidate) =>
            seed.domain
              ? candidate.domain?.toLowerCase() === seed.domain.toLowerCase()
              : candidate.name.toLowerCase() === seed.name?.toLowerCase(),
          );
          emit({
            kind: matches.length === 1 ? 'find' : 'warn',
            message: `Seed ${seed.name ?? seed.domain}: ${matches.length === 1 ? 'discovered; identity still requires source review' : matches.length ? 'ambiguous; retained for review' : 'not discovered in this bounded pass'}.`,
          });
        }
        if (!candidates.length)
          throw new Error(
            'No companies were discovered in this scope. Edit the scope and try a new run.',
          );
        const selected = [
          ...new Map(candidates.map((candidate) => [companyId(candidate), candidate])).values(),
        ].slice(0, run.maxCompanies);
        run = writes.updateRun(
          {
            ...run,
            tasks: selected.map((candidate) => ({
              companyId: companyId(candidate),
              candidate,
              status: 'queued',
              attempts: 0,
              cardIds: [],
              error: null,
            })),
            updatedAt: timestamp(),
          },
          run.generation,
        );
      }
      // Company output commits before capture. Resume that independent work without rehydration.
      const savedCards = this.vault.work.listCards(run.deckId);
      for (const task of run.tasks!.filter((task) => task.status === 'completed')) {
        await captureSources(savedCards.filter((entry) => task.cardIds.includes(entry.card.id)));
      }
      const tasks = run.tasks!.filter((task) => task.status !== 'completed');
      let index = 0;
      let failedCompanies = 0;
      const worker = async () => {
        while (index < tasks.length) {
          guard();
          const task = tasks[index++]!;
          const candidate = task.candidate;
          saveTask(task.companyId, {
            status: 'running',
            attempts: task.attempts + 1,
            cardIds: [],
            error: null,
          });
          let savedCards: CardWithCompany[] = [];
          try {
            emit({ stage: 'summary', kind: 'step', message: `Researching ${candidate.name}…` });
            const result = await hydrateCompanyCard({
              candidate,
              client,
              plan,
              deckId: run.deckId,
              signal,
              fetchImpl: this.hydrationOptions.fetchImpl,
            });
            guard();
            const cards = result.cards
              .filter((entry) => entry.company && isEntityCardType(entry.card.cardType))
              .map((entry) => {
                const entityId = task.companyId;
                const citations = [
                  ...new Map(
                    [...entry.card.citations, ...(result.citations ?? [])].map((citation) => [
                      JSON.stringify([citation.title, citation.url]),
                      { title: citation.title, url: citation.url, credibility: 'unknown' as const },
                    ]),
                  ).values(),
                ];
                const data: CardWithCompany = {
                  ...entry,
                  card: {
                    ...entry.card,
                    id: `crd_${hash(`${run.deckId}:${entityId}:${entry.card.cardType}`).slice(0, 24)}`,
                    deckId: run.deckId,
                    companyId: entry.company ? entityId : null,
                    tier: null,
                    tierReason: null,
                    citations,
                  },
                  company: entry.company ? { ...entry.company, id: entityId } : null,
                  // Capturing a source never verifies a model-extracted figure.
                  metrics: entry.company
                    ? entry.metrics.map((metric) => ({
                        ...metric,
                        companyId: entityId,
                        confidence:
                          metric.value === null ? ('unknown' as const) : ('estimated' as const),
                        methodNote:
                          'Model-extracted figure; exact retained passage support has not been verified.',
                      }))
                    : [],
                };
                return data;
              });
            if (!cards.length)
              throw new Error('No entity cards could be retained for this candidate.');
            saveTask(
              task.companyId,
              { status: 'completed', cardIds: cards.map((entry) => entry.card.id), error: null },
              cards,
            );
            savedCards = cards;
            emit({
              stage: 'summary',
              kind: 'find',
              message: `Saved ${candidate.name}; source review pending.`,
            });
          } catch (error) {
            guard();
            failedCompanies += 1;
            saveTask(task.companyId, {
              status: 'failed',
              cardIds: [],
              error: error instanceof Error ? error.message : 'Provider failed.',
            });
            emit({
              kind: 'warn',
              message: `Could not complete ${candidate.name}. ${error instanceof Error ? error.message : 'Provider failed.'}`,
            });
          }
          // Source failure cannot undo the already durable company output/task.
          await captureSources(savedCards);
        }
      };
      // Keep the run active until both workers settle, including an abort or budget failure.
      const workers = await Promise.allSettled([worker(), worker()]);
      const rejected = workers.find((worker) => worker.status === 'rejected');
      if (rejected?.status === 'rejected') throw rejected.reason;
      guard();
      emit({
        stage: 'dashboard',
        kind: 'step',
        message:
          'Bounded pass finished. Saved company research is ready to inspect; evidence review and other card categories remain incomplete.',
      });
      const retained = this.vault.work.listCards(run.deckId).length;
      writes.updateRun(
        {
          ...run,
          status: failedCompanies || publicationFailed || !retained ? 'failed' : 'completed',
          updatedAt: timestamp(),
          error: failedCompanies
            ? `${failedCompanies} company tasks failed. Partial research is retained.`
            : publicationFailed
              ? 'Local source publication failed. Saved cards and retained text are kept; resume to repair.'
              : !retained
                ? 'No company cards could be retained.'
                : null,
        },
        run.generation,
      );
    } catch (error) {
      const current = this.vault.work.getRun(run.id);
      if (
        current?.generation === run.generation &&
        ['running', 'queued'].includes(current.status)
      ) {
        writes.updateRun(
          {
            ...current,
            status: 'failed',
            updatedAt: timestamp(),
            error: error instanceof Error ? error.message : 'Research failed.',
          },
          run.generation,
        );
      }
    } finally {
      const current = this.vault.work.getRun(run.id);
      if (current) this.notify(current);
    }
  }

  async waitForIdle() {
    await Promise.all(this.active.values());
  }
  close(): Promise<void> {
    if (!this.closing)
      this.closing = (async () => {
        try {
          for (const run of this.vault.work.listRuns()) {
            if (this.active.has(run.id)) this.control(run.id, 'pause');
          }
          await this.waitForIdle();
        } finally {
          for (const controller of this.controllers.values()) controller.abort();
          try {
            await Promise.allSettled(this.active.values());
          } finally {
            this.vault.close();
          }
        }
      })();
    return this.closing;
  }
}
