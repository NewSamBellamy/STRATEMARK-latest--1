/**
 * Getting an imported research file ready to become the workspace.
 *
 * A file the person picks is not trusted the way their own saved workspace is.
 * Two things go wrong when it is treated that way, and both survive a reload:
 *
 *  - A row whose text is not text (a deck named `{"a":1}`) is stored as it came
 *    and then crashes whatever draws it. The sidebar draws every deck name, so
 *    the whole app failed to start, every time, and the screens that could
 *    restore a backup were on the far side of that crash.
 *  - Process state in the file is read back as the person's own. A warm-up
 *    marked "started, not finished" resumes on the next start, so the file alone
 *    began paid research on every company in it with no click.
 *
 * `prepareImportedSnapshot` keeps what is readable, leaves out what is not (and
 * says how much), and removes the process state. It runs on IMPORT only: the
 * person's own saved workspace still resumes an interrupted warm-up on reload.
 */
import type { AnyZodObject } from 'zod';
import {
  cardSchema,
  companyMetricSchema,
  companySchema,
  deckSchema,
  marketSchema,
  researchThreadSchema,
  viceClaimSchema,
} from '@mi/contracts';
import type { RepoSnapshot } from './repository';

/**
 * The most companies one import may bring in. A deck researches 2 to 30
 * companies (the target is a setting capped at 30) and a hunt adds a few more,
 * so no single deck gets near 100; the workspace the author measured held about
 * twenty decks, a few hundred companies. 1,000 is the size of thirty-odd full
 * decks: past any real workspace, so a person restoring their own backup is
 * never turned away, and well below a file written to be as large as possible.
 * Process state is removed from every import, so this is a sanity bound on the
 * time and memory one file can ask for, not the only guard on spend.
 */
export const MAX_IMPORTED_COMPANIES = 1000;

export interface ImportPlan {
  /** The workspace the import would write: readable rows only, no process state. */
  snapshot: RepoSnapshot;
  /** Decks the import brings in. */
  decks: number;
  companies: number;
  /** Rows the file held that could not be read, plus the rows that depended on them. They are left out. */
  skipped: number;
  /** Research the file recorded as running or waiting. It is not carried over and is never restarted. */
  unfinishedResearch: number;
}

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
/** The id a row is referred to by; numbers count because a number id becomes its string form below. */
const idOf = (row: Row): string | null => (typeof row.id === 'string' || typeof row.id === 'number') ? String(row.id) : null;
const text = (value: unknown): string => (typeof value === 'string' || typeof value === 'number') ? String(value) : '';

/**
 * Turn a number or boolean sitting where the contract wants text into that text
 * (a deck named 5 is a deck named "5"). Anything else is left alone and fails
 * the check: an object or null cannot be made into a name without inventing one.
 */
function coerceText(row: Row, schema: AnyZodObject): Row {
  const repaired: Row = { ...row };
  for (const [key, field] of Object.entries(schema.shape)) {
    if ((field as { _def: { typeName?: string } })._def.typeName !== 'ZodString') continue;
    const value = row[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      // A time written as a number of milliseconds is the same instant as its ISO text.
      const instant = /At$/.test(key) ? new Date(value) : null;
      repaired[key] = instant && !Number.isNaN(instant.getTime()) ? instant.toISOString() : String(value);
    } else if (typeof value === 'boolean') {
      repaired[key] = String(value);
    }
  }
  return repaired;
}

/** A row that already satisfies the contract is kept exactly as it is (extra fields and all); otherwise it is repaired if that is harmless, or refused. */
const byContract = (schema: AnyZodObject) => (row: Row): Row | null => {
  if (schema.safeParse(row).success) return row;
  const repaired = coerceText(row, schema);
  return schema.safeParse(repaired).success ? repaired : null;
};

/**
 * A row from a collection the contracts do not describe (reports, briefings,
 * evidence): it needs a text id, and any text field it carries must be text.
 * Partial rows pass on purpose: older builds saved reports without a kind.
 */
const textRow = (keys: readonly string[], lists: readonly string[] = []) => (row: Row): Row | null => {
  if (typeof row.id !== 'string') return null;
  if (keys.some((key) => row[key] !== undefined && typeof row[key] !== 'string')) return null;
  if (lists.some((key) => row[key] !== undefined && !Array.isArray(row[key]))) return null;
  return row;
};

const JOB_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'];

/** Keep the rows `accept` passes, count the rest, and tell `onDrop` which rows went. Null when the field is not a list at all. */
function sift(rows: unknown, accept: (row: Row) => Row | null, tally: { skipped: number }, onDrop?: (row: Row) => void): Row[] | null {
  if (!Array.isArray(rows)) return null;
  const kept: Row[] = [];
  for (const row of rows as unknown[]) {
    const accepted = isRow(row) ? accept(row) : null;
    if (accepted) {
      kept.push(accepted);
    } else {
      tally.skipped += 1;
      if (isRow(row)) onDrop?.(row);
    }
  }
  return kept;
}

/**
 * Validate an imported snapshot and strip its process state. Throws a plain
 * message when the file is too large to bring in; never throws for a bad row.
 */
export function prepareImportedSnapshot(raw: RepoSnapshot): ImportPlan {
  const incoming = raw as unknown as Row;
  const companyRows = Array.isArray(incoming.companies) ? incoming.companies.length : 0;
  if (companyRows > MAX_IMPORTED_COMPANIES) {
    throw new Error(`This file holds ${companyRows.toLocaleString('en-US')} companies, more than the ${MAX_IMPORTED_COMPANIES.toLocaleString('en-US')} an import can bring in. It is probably not a Stratemark export.`);
  }

  const tally = { skipped: 0 };
  const lostMarkets = new Set<string>();
  const lostDecks = new Set<string>();
  const lostCompanies = new Set<string>();
  const lostCards = new Set<string>();
  const remember = (set: Set<string>) => (row: Row) => { const id = idOf(row); if (id) set.add(id); };
  // A row that points at something left out would point at nothing, so it goes too.
  const unlessLost = (set: Set<string>, key: string, then: (row: Row) => Row | null) => (row: Row) =>
    set.has(text(row[key])) ? null : then(row);

  const clean: Row = { ...incoming };
  clean.markets = sift(incoming.markets, byContract(marketSchema), tally, remember(lostMarkets)) ?? [];
  clean.decks = sift(incoming.decks, unlessLost(lostMarkets, 'marketId', byContract(deckSchema)), tally, remember(lostDecks)) ?? [];
  clean.companies = sift(incoming.companies, byContract(companySchema), tally, remember(lostCompanies)) ?? [];
  clean.metrics = sift(incoming.metrics, unlessLost(lostCompanies, 'companyId', byContract(companyMetricSchema)), tally) ?? [];
  clean.cards = sift(incoming.cards, unlessLost(lostDecks, 'deckId', unlessLost(lostCompanies, 'companyId', byContract(cardSchema))), tally, remember(lostCards)) ?? [];
  clean.viceClaims = sift(incoming.viceClaims, unlessLost(lostCards, 'cardId', byContract(viceClaimSchema)), tally) ?? [];

  const optional = (field: string, accept: (row: Row) => Row | null, onDrop?: (row: Row) => void) => {
    if (incoming[field] === undefined) return;
    const kept = sift(incoming[field], accept, tally, onDrop);
    if (kept) { clean[field] = kept; } else { delete clean[field]; tally.skipped += 1; }
  };
  optional('savedCards', unlessLost(lostCards, 'cardId', (row) => typeof row.cardId === 'string' && (row.savedAt === undefined || typeof row.savedAt === 'string') ? row : null));
  optional('threads', byContract(researchThreadSchema));
  optional('reports', textRow(['title', 'markdown', 'subjectId', 'kind']));
  optional('briefings', textRow(['marketId', 'deckId', 'marketName', 'headline', 'generatedAt'], ['updates', 'insights']));
  optional('researchEvidence', textRow(['topic', 'capturedAt', 'text', 'companyId', 'companyName'], ['citations', 'queries']));
  // Collections nothing in this file describes further: all that matters is that they are lists of objects.
  for (const field of ['moves', 'follows', 'removedFromDeck'] as const) optional(field, (row) => row);
  for (const field of ['movesRefreshedAt', 'tabsRefreshedAt', 'sourceChecks', 'productBriefs'] as const) {
    if (incoming[field] !== undefined && !isRow(incoming[field])) { delete clean[field]; tally.skipped += 1; }
  }

  // Research the file says is running or waiting did not happen here: the
  // person's browser has no run to continue, and a "queued" job read back as
  // live is how a file starts work nobody asked for.
  let unfinishedResearch = 0;
  optional('researchJobs', (row) => {
    const job = textRow(['createdAt', 'updatedAt'], ['catalogNames', 'completedEntityNames', 'warnings'])(row);
    if (!job || typeof job.status !== 'string' || !JOB_STATUSES.includes(job.status)) return null;
    if (job.status === 'running' || job.status === 'queued') { unfinishedResearch += 1; return null; }
    return job;
  });
  // The researchJobs above counted every dropped unfinished job as skipped; it is not a damaged row.
  tally.skipped -= unfinishedResearch;
  clean.researchJobs ??= [];

  // Resume-on-start state: which warm-ups were started, what each tab attempt
  // did, and the measured run per deck. A file can say anything here; only a
  // run in this browser may.
  delete clean.deckWarmup;
  delete clean.dashboardWarmup;
  delete clean.deckRun;

  const snapshot = clean as unknown as RepoSnapshot;
  return { snapshot, decks: snapshot.markets.length, companies: snapshot.companies.length, skipped: tally.skipped, unfinishedResearch };
}
