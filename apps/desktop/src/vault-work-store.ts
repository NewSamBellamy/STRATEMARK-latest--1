/** Native operational ledger. Generated projections are not retained evidence or verification. */
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  cardSchema,
  companySchema,
  companyMetricSchema,
  viceClaimSchema,
  marketSchema,
  deckSchema,
  vaultMarketSchema,
  recordVersionSchema,
  compareRecordTimestamps,
  nativeResearchStartSchema,
  nativeResearchTaskSchema,
  researchBriefSchema,
  isSignalCardType,
  type NativeResearchRun,
  type NativeResearchEvent,
  type Market,
  type Deck,
  type CardWithCompany,
  type ResearchProgress,
  type SavedCard,
} from '@mi/contracts';

export type NativeRun = NativeResearchRun;
export type NativeRunEvent = NativeResearchEvent;
/** Called only with schema-validated briefs; never borrow another card's citation context. */
export function researchBriefCitationsMatchCard(
  data: Pick<CardWithCompany, 'card' | 'researchBrief'>,
): boolean {
  const leads = new Set(data.card.citations.map((citation) => citation.url));
  return (
    !data.researchBrief ||
    data.researchBrief.sections.every((section) =>
      section.blocks.every((block) => block.citations.every((citation) => leads.has(citation.url))),
    )
  );
}
const id = recordVersionSchema.innerType().shape.id;
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().datetime();
export const workStoreLimits = {
  maxBodyBytes: 1_000_000,
  maxEventsPerRun: 5_000,
  maxEventBytesPerRun: 32 * 1024 * 1024,
  maxCardsPerRun: 250,
} as const;

const runSchema = nativeResearchStartSchema
  .extend({
    id,
    marketId: id,
    deckId: id,
    requestFingerprint: z.string().min(1).max(256),
    researchProvenance: z.enum(['synthetic_fixture', 'live_provider']).optional(),
    status: z.enum(['queued', 'running', 'paused', 'completed', 'failed', 'cancelled']),
    generation: integer,
    usage: z
      .object({
        requests: integer,
        inputTokens: integer,
        outputTokens: integer,
        complete: z.boolean(),
        sourceRequests: integer.optional(),
      })
      .strict(),
    createdAt: timestamp,
    updatedAt: timestamp,
    error: z.string().max(20_000).nullable(),
    tasks: z.array(nativeResearchTaskSchema).min(1).max(12).optional(),
  })
  .refine(
    (run) =>
      !run.tasks ||
      (run.tasks.length <= run.maxCompanies &&
        new Set(run.tasks.map((task) => task.companyId)).size === run.tasks.length),
    'Run tasks must be unique and within the company allowance.',
  )
  .refine(
    (run) => (run.usage.sourceRequests ?? 0) <= (run.limits.maxSourceRequests ?? 0),
    'Source requests exceed the approved allowance.',
  )
  .refine(
    (run) => compareRecordTimestamps(run.createdAt, run.updatedAt) <= 0,
    'Run update time must not precede creation.',
  );
const generatedCardSchema = z
  .object({
    card: cardSchema.extend({ id, deckId: id, companyId: id.nullable() }),
    company: companySchema.extend({ id }).nullable(),
    metrics: z.array(companyMetricSchema.extend({ id, companyId: id })).max(100),
    viceClaims: z.array(viceClaimSchema.extend({ id, cardId: id })).max(100),
    marketRoles: z
      .array(z.enum(['company', 'infrastructure', 'distribution']))
      .max(3)
      .optional(),
    evidenceState: z.literal('legacy_unreviewed').optional(),
    researchBrief: researchBriefSchema.optional(),
  })
  .strict()
  .superRefine((data, context) => {
    if (data.card.companyId !== (data.company?.id ?? null))
      context.addIssue({
        code: 'custom',
        message: 'Card company link does not match its projection.',
      });
    if (data.metrics.some((metric) => !data.company || metric.companyId !== data.company.id))
      context.addIssue({ code: 'custom', message: 'Metric company link does not match its card.' });
    if (data.viceClaims.some((claim) => claim.cardId !== data.card.id))
      context.addIssue({ code: 'custom', message: 'Vice claim link does not match its card.' });
    if (data.metrics.some((metric) => !['estimated', 'unknown'].includes(metric.confidence)))
      context.addIssue({
        code: 'custom',
        message:
          'Generated metrics must be estimated or unknown; native projections cannot assert verification.',
      });
    if (isSignalCardType(data.card.cardType) && data.metrics.length)
      context.addIssue({ code: 'custom', message: 'Finding cards must have empty metrics.' });
    if (!researchBriefCitationsMatchCard(data))
      context.addIssue({
        code: 'custom',
        path: ['researchBrief'],
        message: "Research brief citations must belong to this card's own citation leads.",
      });
  });
const progressSchema = z
  .object({
    message: z.string().max(20_000),
    stage: z.enum(['scope', 'catalog', 'summary', 'metrics', 'signals', 'dashboard']).optional(),
    progress: z.number().min(0).max(1).optional(),
    kind: z.enum(['step', 'find', 'warn']).optional(),
    card: generatedCardSchema.optional(),
  })
  .strict();
const operationalMarketSchema = marketSchema.extend({ id });
const operationalDeckSchema = deckSchema.extend({ id, marketId: id });

export const workSchemaColumns = {
  work_markets: ['id', 'body'],
  work_decks: ['id', 'market_id', 'body'],
  work_runs: [
    'id',
    'market_id',
    'deck_id',
    'request_key',
    'fingerprint',
    'status',
    'generation',
    'body',
  ],
  work_events: ['run_id', 'sequence', 'generation', 'body', 'created_at'],
  work_cards: ['id', 'market_id', 'deck_id', 'run_id', 'generation', 'company_id', 'body'],
} as const;
export const workSchemaSql = `
CREATE TABLE work_markets (
  id TEXT PRIMARY KEY REFERENCES markets(id),
  body TEXT NOT NULL CHECK(json_valid(body) AND length(CAST(body AS BLOB))<=1000000)
) STRICT;
CREATE TABLE work_decks (
  id TEXT PRIMARY KEY, market_id TEXT NOT NULL UNIQUE REFERENCES work_markets(id),
  body TEXT NOT NULL CHECK(json_valid(body) AND length(CAST(body AS BLOB))<=1000000),
  UNIQUE(id,market_id)
) STRICT;
CREATE TABLE work_runs (
  id TEXT PRIMARY KEY, market_id TEXT NOT NULL, deck_id TEXT NOT NULL,
  request_key TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','paused','completed','failed','cancelled')),
  generation INTEGER NOT NULL CHECK(generation>=0 AND generation<=9007199254740991),
  body TEXT NOT NULL CHECK(json_valid(body) AND length(CAST(body AS BLOB))<=1000000),
  FOREIGN KEY(deck_id,market_id) REFERENCES work_decks(id,market_id), UNIQUE(id,deck_id,market_id)
) STRICT;
CREATE UNIQUE INDEX work_runs_live_market ON work_runs(market_id) WHERE status IN ('queued','running','paused');
CREATE TABLE work_events (
  run_id TEXT NOT NULL REFERENCES work_runs(id), sequence INTEGER NOT NULL CHECK(sequence>0 AND sequence<=5000),
  generation INTEGER NOT NULL CHECK(generation>=0 AND generation<=9007199254740991),
  body TEXT NOT NULL CHECK(json_valid(body) AND length(CAST(body AS BLOB))<=1000000), created_at TEXT NOT NULL,
  PRIMARY KEY(run_id,sequence)
) STRICT;
CREATE TRIGGER work_events_no_update BEFORE UPDATE ON work_events BEGIN SELECT RAISE(ABORT,'Run events are append-only'); END;
CREATE TRIGGER work_events_no_delete BEFORE DELETE ON work_events BEGIN SELECT RAISE(ABORT,'Run events are append-only'); END;
CREATE TABLE work_cards (
  id TEXT PRIMARY KEY, market_id TEXT NOT NULL, deck_id TEXT NOT NULL, run_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation>=0 AND generation<=9007199254740991), company_id TEXT,
  body TEXT NOT NULL CHECK(json_valid(body) AND length(CAST(body AS BLOB))<=1000000),
  FOREIGN KEY(run_id,deck_id,market_id) REFERENCES work_runs(id,deck_id,market_id)
) STRICT;
CREATE INDEX work_cards_deck ON work_cards(deck_id,id);
CREATE INDEX work_cards_run_company ON work_cards(run_id,company_id);
`;

export const bookmarkSchemaColumns = { work_saved_cards: ['card_id', 'saved_at'] } as const;
export const bookmarkSchemaSql = `
CREATE TABLE work_saved_cards (
  card_id TEXT PRIMARY KEY NOT NULL REFERENCES work_cards(id),
  saved_at TEXT NOT NULL
) STRICT;
`;

const transitions: Record<NativeRun['status'], readonly NativeRun['status'][]> = {
  queued: ['running', 'paused', 'failed', 'cancelled'],
  running: ['paused', 'completed', 'failed', 'cancelled'],
  paused: ['queued', 'running', 'cancelled'],
  failed: ['queued', 'running', 'cancelled'],
  completed: [],
  cancelled: [],
};
type Row = Record<string, unknown>;
function body(value: unknown) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > workStoreLimits.maxBodyBytes)
    throw new Error('Operational record exceeds its storage limit.');
  return json;
}

/** Each mutation owns one transaction and rechecks the captured vault owner at commit. */
export function createWorkStore(
  db: DatabaseSync,
  vaultId: string,
  assertOpen: () => void,
  assertWrite: () => void,
) {
  function transaction<T>(write: () => T, changed = () => true): T {
    assertWrite();
    db.exec('BEGIN IMMEDIATE;');
    try {
      assertWrite();
      const result = write();
      assertWrite();
      if (changed()) db.exec('UPDATE vault_meta SET revision=revision+1 WHERE singleton=1;');
      db.exec('COMMIT;');
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK;');
      throw error;
    }
  }
  function decodeRun(row: Row | undefined): NativeRun | null {
    if (!row) return null;
    const run = runSchema.parse(JSON.parse(String(row.body)));
    if (
      run.id !== row.id ||
      run.marketId !== row.market_id ||
      run.deckId !== row.deck_id ||
      run.requestKey !== row.request_key ||
      run.requestFingerprint !== row.fingerprint ||
      run.status !== row.status ||
      run.generation !== row.generation
    )
      throw new Error('Stored run does not match its indexed identity or state.');
    return run;
  }
  function getRun(runId: string): NativeRun | null {
    assertOpen();
    return decodeRun(db.prepare('SELECT * FROM work_runs WHERE id=?').get(id.parse(runId)));
  }
  function running(runId: string, generation: number) {
    integer.parse(generation);
    const run = getRun(runId);
    if (run && !run.researchProvenance)
      throw new Error('Unclassified research provenance is read-only.');
    if (!run || run.generation !== generation || run.status !== 'running')
      throw new Error('Run output is fenced by its generation or status.');
    return run;
  }
  function decodeMarket(row: Row | undefined): Market | null {
    if (!row) return null;
    const market = operationalMarketSchema.parse(JSON.parse(String(row.body)));
    if (market.id !== row.id) throw new Error('Stored market projection identity mismatch.');
    return market;
  }
  function decodeDeck(row: Row | undefined): Deck | null {
    if (!row) return null;
    const deck = operationalDeckSchema.parse(JSON.parse(String(row.body)));
    if (deck.id !== row.id || deck.marketId !== row.market_id)
      throw new Error('Stored deck projection identity mismatch.');
    return deck;
  }
  function decodeCard(row: Row | undefined): CardWithCompany | null {
    if (!row) return null;
    const data = generatedCardSchema.parse(JSON.parse(String(row.body)));
    if (
      data.card.id !== row.id ||
      data.card.deckId !== row.deck_id ||
      data.card.companyId !== row.company_id
    )
      throw new Error('Stored card projection identity mismatch.');
    const run = getRun(String(row.run_id));
    if (
      !run ||
      run.marketId !== row.market_id ||
      run.deckId !== row.deck_id ||
      typeof row.generation !== 'number' ||
      row.generation > run.generation
    )
      throw new Error('Stored card does not belong to its run.');
    return data;
  }
  function insertEvent(run: NativeRun, progress: ResearchProgress): NativeRunEvent {
    const parsed = progressSchema.parse(progress);
    if (parsed.card && parsed.card.card.deckId !== run.deckId)
      throw new Error('Event card belongs to another deck.');
    const json = body(parsed);
    const totals = db
      .prepare(
        'SELECT count(*) AS count,COALESCE(sum(length(CAST(body AS BLOB))),0) AS bytes FROM work_events WHERE run_id=?',
      )
      .get(run.id)!;
    if (
      Number(totals.count) >= workStoreLimits.maxEventsPerRun ||
      Number(totals.bytes) + Buffer.byteLength(json) > workStoreLimits.maxEventBytesPerRun
    )
      throw new Error('Run event storage limit reached.');
    const event = {
      sequence: Number(totals.count) + 1,
      progress: parsed,
      createdAt: new Date().toISOString(),
    };
    db.prepare('INSERT INTO work_events VALUES(?,?,?,?,?)').run(
      run.id,
      event.sequence,
      run.generation,
      json,
      event.createdAt,
    );
    return event;
  }
  function writeCard(run: NativeRun, data: CardWithCompany) {
    if (data.card.deckId !== run.deckId) throw new Error('Card belongs to another deck.');
    const old = db.prepare('SELECT * FROM work_cards WHERE id=?').get(data.card.id);
    if (
      old &&
      (old.deck_id !== run.deckId ||
        old.market_id !== run.marketId ||
        old.company_id !== data.card.companyId)
    )
      throw new Error('Card ownership and company links are immutable.');
    if (old?.run_id === run.id && Number(old.generation) > run.generation)
      throw new Error('Card generation is fenced.');
    const json = body(data);
    // Identical persisted output is already accompanied by its event.
    if (old?.run_id === run.id && old.body === json) return;
    if (
      run.tasks &&
      !run.tasks.some((task) => task.companyId === data.card.companyId && task.status === 'running')
    )
      throw new Error('Card does not belong to an unfinished selected task.');
    const count = Number(
      db.prepare('SELECT count(*) AS count FROM work_cards WHERE run_id=?').get(run.id)?.count,
    );
    if (old?.run_id !== run.id && count >= workStoreLimits.maxCardsPerRun)
      throw new Error('Run card storage limit reached.');
    if (
      data.company &&
      !db
        .prepare('SELECT 1 FROM work_cards WHERE run_id=? AND company_id=?')
        .get(run.id, data.company.id)
    ) {
      const companies = Number(
        db
          .prepare('SELECT count(DISTINCT company_id) AS count FROM work_cards WHERE run_id=?')
          .get(run.id)?.count,
      );
      if (companies >= run.maxCompanies) throw new Error('Run company limit reached.');
    }
    db.prepare(
      'INSERT INTO work_cards VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id,generation=excluded.generation,body=excluded.body',
    ).run(
      data.card.id,
      run.marketId,
      run.deckId,
      run.id,
      run.generation,
      data.card.companyId,
      json,
    );
    insertEvent(run, { message: 'Generated card saved', kind: 'find', card: data });
  }
  function checkTasks(old: NativeRun, run: NativeRun) {
    if (!old.tasks) {
      if (
        run.tasks &&
        (old.status !== 'running' ||
          run.status !== 'running' ||
          run.generation !== old.generation ||
          run.tasks.some(
            (task) =>
              task.status !== 'queued' || task.attempts || task.cardIds.length || task.error,
          ) ||
          db.prepare('SELECT 1 FROM work_cards WHERE run_id=?').get(old.id))
      )
        throw new Error('Candidate queue must be selected before task work starts.');
      return;
    }
    if (!run.tasks || old.tasks.length !== run.tasks.length)
      throw new Error('Selected candidate queue is immutable.');
    for (const [index, previous] of old.tasks.entries()) {
      const next = run.tasks[index]!;
      if (
        previous.companyId !== next.companyId ||
        JSON.stringify(previous.candidate) !== JSON.stringify(next.candidate)
      )
        throw new Error('Selected candidate queue is immutable.');
      if (JSON.stringify(previous) === JSON.stringify(next)) continue;
      if (
        old.status !== 'running' ||
        run.status !== 'running' ||
        old.generation !== run.generation ||
        previous.status === 'completed'
      )
        throw new Error('Task outcome is fenced.');
      const starting = next.status === 'running' && next.attempts === previous.attempts + 1;
      const finishing =
        previous.status === 'running' &&
        ['completed', 'failed'].includes(next.status) &&
        next.attempts === previous.attempts;
      if ((!starting && !finishing) || (next.status !== 'completed' && next.cardIds.length))
        throw new Error('Invalid task outcome transition.');
      if (next.status === 'completed') {
        if (!next.cardIds.length || next.error)
          throw new Error('Completed task requires its saved cards.');
        for (const cardId of next.cardIds) {
          const card = db
            .prepare('SELECT run_id,company_id FROM work_cards WHERE id=?')
            .get(cardId);
          if (card?.run_id !== run.id || card.company_id !== next.companyId)
            throw new Error('Completed task card does not belong to its run and company.');
        }
      }
    }
  }
  const reads = {
    getRun,
    listRuns(): NativeRun[] {
      assertOpen();
      return db
        .prepare('SELECT * FROM work_runs ORDER BY id')
        .all()
        .map((row) => decodeRun(row)!);
    },
    listEvents(
      runId: string,
      after = 0,
      limit: number = workStoreLimits.maxEventsPerRun,
    ): NativeRunEvent[] {
      assertOpen();
      id.parse(runId);
      integer.parse(after);
      z.number().int().min(1).max(workStoreLimits.maxEventsPerRun).parse(limit);
      return db
        .prepare(
          'SELECT * FROM work_events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT ?',
        )
        .all(runId, after, limit)
        .map((row) => ({
          sequence: z
            .number()
            .int()
            .min(1)
            .max(workStoreLimits.maxEventsPerRun)
            .parse(row.sequence),
          progress: progressSchema.parse(JSON.parse(String(row.body))),
          createdAt: timestamp.parse(row.created_at),
        }));
    },
    listCards(deckId: string): CardWithCompany[] {
      assertOpen();
      return db
        .prepare('SELECT * FROM work_cards WHERE deck_id=? ORDER BY id')
        .all(id.parse(deckId))
        .map((row) => decodeCard(row)!);
    },
    getCard(cardId: string): CardWithCompany | null {
      assertOpen();
      return decodeCard(db.prepare('SELECT * FROM work_cards WHERE id=?').get(id.parse(cardId)));
    },
    listSavedCards(): CardWithCompany[] {
      assertOpen();
      return db
        .prepare(
          'SELECT c.*,s.saved_at FROM work_saved_cards s LEFT JOIN work_cards c ON c.id=s.card_id ORDER BY s.saved_at DESC,s.card_id',
        )
        .all()
        .map((row) => {
          timestamp.parse(row.saved_at);
          if (!row.id) throw new Error('Saved reference points to a missing card.');
          return decodeCard(row)!;
        });
    },
    listMarkets(): Market[] {
      assertOpen();
      return db
        .prepare('SELECT * FROM work_markets ORDER BY id')
        .all()
        .map((row) => decodeMarket(row)!);
    },
    getMarket(marketId: string): Market | null {
      assertOpen();
      return decodeMarket(
        db.prepare('SELECT * FROM work_markets WHERE id=?').get(id.parse(marketId)),
      );
    },
    getDeckByMarket(marketId: string): Deck | null {
      assertOpen();
      return decodeDeck(
        db.prepare('SELECT * FROM work_decks WHERE market_id=?').get(id.parse(marketId)),
      );
    },
  };
  return {
    ...reads,
    bookmarkCard(cardId: string): SavedCard {
      id.parse(cardId);
      let changed = false;
      return transaction(
        () => {
          if (!reads.getCard(cardId)) throw new Error('Saved card was not found.');
          const previous = db
            .prepare('SELECT saved_at FROM work_saved_cards WHERE card_id=?')
            .get(cardId);
          if (previous) return { cardId, savedAt: timestamp.parse(previous.saved_at) };
          const savedAt = new Date().toISOString();
          db.prepare('INSERT INTO work_saved_cards VALUES(?,?)').run(cardId, savedAt);
          changed = true;
          return { cardId, savedAt };
        },
        () => changed,
      );
    },
    unbookmarkCard(cardId: string): void {
      id.parse(cardId);
      let changed = false;
      transaction(
        () => {
          if (!reads.getCard(cardId)) throw new Error('Saved card was not found.');
          changed =
            Number(db.prepare('DELETE FROM work_saved_cards WHERE card_id=?').run(cardId).changes) >
            0;
        },
        () => changed,
      );
    },
    acceptRun(input: NativeRun, marketInput: Market, deckInput: Deck): NativeRun {
      const run = runSchema.parse(input);
      const market = operationalMarketSchema.parse(marketInput);
      const deck = operationalDeckSchema.parse(deckInput);
      let accepted = false;
      return transaction(
        () => {
          const previous = decodeRun(
            db.prepare('SELECT * FROM work_runs WHERE request_key=?').get(run.requestKey),
          );
          if (previous) {
            if (previous.researchProvenance !== run.researchProvenance)
              throw new Error('Request key research provenance conflict.');
            if (previous.requestFingerprint !== run.requestFingerprint)
              throw new Error('Request key fingerprint conflict.');
            return previous;
          }
          if (
            run.status !== 'queued' ||
            run.usage.requests ||
            run.usage.inputTokens ||
            run.usage.outputTokens ||
            run.usage.sourceRequests
          )
            throw new Error('New run must be queued with no consumed usage.');
          if (run.tasks) throw new Error('New run cannot supply selected task outcomes.');
          if (run.marketId !== market.id || run.deckId !== deck.id || deck.marketId !== market.id)
            throw new Error('Run must own its market and deck.');
          if (
            db
              .prepare(
                "SELECT 1 FROM work_runs WHERE market_id=? AND status IN ('queued','running','paused')",
              )
              .get(market.id)
          )
            throw new Error('Market already has a live run.');
          const oldRow = db.prepare('SELECT * FROM markets WHERE id=?').get(market.id);
          const old = oldRow ? vaultMarketSchema.parse(JSON.parse(String(oldRow.body))) : null;
          if (
            old &&
            (old.record.id !== market.id ||
              old.record.vaultId !== vaultId ||
              old.record.revision !== oldRow?.revision)
          )
            throw new Error('Stored market version does not match its vault.');
          const nativeMarket = vaultMarketSchema.parse({
            ...old,
            record: {
              contractVersion: '1',
              vaultId,
              id: market.id,
              revision: (old?.record.revision ?? 0) + 1,
              createdAt: old?.record.createdAt ?? market.createdAt,
              updatedAt: run.updatedAt,
            },
            name: market.name,
            scopeDraft: run.scope,
          });
          if (
            old &&
            compareRecordTimestamps(old.record.updatedAt, nativeMarket.record.updatedAt) > 0
          )
            throw new Error('Market update time must not move backwards.');
          for (const seed of run.scope.seeds)
            if (
              seed.companyId &&
              !db.prepare('SELECT 1 FROM companies WHERE id=?').get(seed.companyId)
            )
              throw new Error('Market scope seed references a missing company.');
          const nativeJson = body(nativeMarket);
          db.prepare(
            'INSERT INTO markets VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body',
          ).run(market.id, nativeMarket.record.revision, nativeJson);
          db.prepare("INSERT INTO record_history VALUES('markets',?,?,?)").run(
            market.id,
            nativeMarket.record.revision,
            nativeJson,
          );
          run.scope.seeds.forEach((seed, ordinal) => {
            if (seed.companyId)
              db.prepare("INSERT INTO market_scope_seeds VALUES('market',?,?,?,?)").run(
                market.id,
                nativeMarket.record.revision,
                ordinal,
                seed.companyId,
              );
          });
          const oldMarket = reads.getMarket(market.id);
          if (oldMarket && oldMarket.createdAt !== market.createdAt)
            throw new Error('Market creation time is immutable.');
          db.prepare(
            'INSERT INTO work_markets VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
          ).run(market.id, body(market));
          const oldDeck = reads.getDeckByMarket(market.id);
          if (oldDeck && (oldDeck.id !== deck.id || oldDeck.createdAt !== deck.createdAt))
            throw new Error('Market deck identity and creation time are immutable.');
          db.prepare(
            'INSERT INTO work_decks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
          ).run(deck.id, market.id, body(deck));
          db.prepare('INSERT INTO work_runs VALUES(?,?,?,?,?,?,?,?)').run(
            run.id,
            run.marketId,
            run.deckId,
            run.requestKey,
            run.requestFingerprint,
            run.status,
            run.generation,
            body(run),
          );
          accepted = true;
          return run;
        },
        () => accepted,
      );
    },
    updateRun(
      input: NativeRun,
      expectedGeneration: number,
      cards: CardWithCompany[] = [],
    ): NativeRun {
      const run = runSchema.parse(input);
      const outputs = z.array(generatedCardSchema).max(7).parse(cards);
      integer.parse(expectedGeneration);
      return transaction(() => {
        const old = getRun(run.id);
        if (!old || old.generation !== expectedGeneration)
          throw new Error('Run generation conflict.');
        if (!old.researchProvenance)
          throw new Error('Unclassified research provenance is read-only.');
        if (old.researchProvenance !== run.researchProvenance)
          throw new Error('Run research provenance is immutable.');
        if (outputs.length) {
          if (run.status !== 'running' || run.generation !== old.generation)
            throw new Error('Task output is fenced.');
          const current = running(run.id, expectedGeneration);
          for (const output of outputs) writeCard(current, output);
        }
        checkTasks(old, run);
        if (run.status === 'completed' && run.tasks?.some((task) => task.status !== 'completed'))
          throw new Error('Run cannot complete with unfinished selected tasks.');
        if (old.status === run.status) {
          if (!['queued', 'running'].includes(old.status) || run.generation !== expectedGeneration)
            throw new Error('Run status is fenced.');
        } else {
          if (!transitions[old.status].includes(run.status))
            throw new Error('Invalid run status transition.');
          const mustAdvance =
            ['paused', 'cancelled'].includes(run.status) ||
            ['paused', 'failed'].includes(old.status);
          if (
            run.generation !== expectedGeneration + 1 &&
            (mustAdvance || run.generation !== expectedGeneration)
          )
            throw new Error('Run control must advance generation exactly once.');
        }
        for (const field of [
          'marketId',
          'deckId',
          'requestKey',
          'requestFingerprint',
          'scope',
          'maxCompanies',
          'limits',
          'createdAt',
        ] as const)
          if (JSON.stringify(old[field]) !== JSON.stringify(run[field]))
            throw new Error('Run request fields are immutable.');
        if (compareRecordTimestamps(old.updatedAt, run.updatedAt) > 0)
          throw new Error('Run update time must not move backwards.');
        // The usage meter replaces token reservations with actuals within an attempt.
        // A new generation must carry its previous attempt's charged totals forward.
        if (
          run.usage.requests < old.usage.requests ||
          (run.usage.sourceRequests ?? 0) < (old.usage.sourceRequests ?? 0) ||
          (run.usage.sourceRequests ?? 0) > (run.limits.maxSourceRequests ?? 0) ||
          (run.generation !== old.generation &&
            (run.usage.inputTokens < old.usage.inputTokens ||
              run.usage.outputTokens < old.usage.outputTokens))
        )
          throw new Error('Consumed run usage must not decrease across attempts.');
        db.prepare(
          'UPDATE work_runs SET status=?,generation=?,body=? WHERE id=? AND generation=? AND status=?',
        ).run(run.status, run.generation, body(run), run.id, expectedGeneration, old.status);
        if (run.status === 'completed') {
          const deck = reads.getDeckByMarket(run.marketId)!;
          db.prepare('UPDATE work_decks SET body=? WHERE id=?').run(
            body({ ...deck, lastRefreshedAt: run.updatedAt }),
            deck.id,
          );
        }
        return run;
      });
    },
    appendEvent(runId: string, generation: number, progress: ResearchProgress): NativeRunEvent {
      return transaction(() => insertEvent(running(runId, generation), progress));
    },
    saveCard(runId: string, generation: number, input: CardWithCompany): CardWithCompany {
      // Parse a mutable copy of optional readonly marketRoles through the shared schemas.
      const data = generatedCardSchema.parse(input);
      return transaction(() => {
        const run = running(runId, generation);
        writeCard(run, data);
        return data;
      });
    },
  };
}
