/**
 * Getting an imported research file ready to become the workspace.
 *
 * A file the person picks is not trusted the way their own saved workspace is.
 * Three things go wrong when it is treated that way, and all survive a reload:
 *
 *  - A row whose text is not text (a deck named `{"a":1}`) is stored as it came
 *    and then crashes whatever draws it. The sidebar draws every deck name, so
 *    the whole app failed to start, every time, and the screens that could
 *    restore a backup were on the far side of that crash.
 *  - Process state in the file is read back as the person's own. A warm-up
 *    marked "started, not finished" resumes on the next start, so the file alone
 *    began paid research on every company in it with no click. The same goes for
 *    followed companies (they send the app to Today, which searches for news on
 *    every start) and for a claim that the figures were already revalidated.
 *  - A file made of an enormous number of tiny rows is small enough to pass a
 *    size check and large enough to freeze the app on every start, when nothing
 *    throws and so no recovery screen ever shows.
 *
 * `prepareImportedSnapshot` refuses a file that is too large, keeps what is
 * readable, leaves out what is not (and says how much), and removes the process
 * state. It runs on IMPORT only: the person's own saved workspace still resumes
 * an interrupted warm-up on reload.
 */
import type { AnyZodObject } from 'zod';
import {
  cardSchema,
  citationSchema,
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
 * so no single deck gets near 100. 1,000 is the size of thirty-odd full decks:
 * past any real workspace, so a person restoring their own backup is never
 * turned away, and well below a file written to be as large as possible.
 */
export const MAX_IMPORTED_COMPANIES = 1000;

/**
 * The most text one import file may hold. A workspace of about twenty decks was
 * measured at 66.6 million characters when saving it first failed, so a person
 * restoring a heavy export must get in; 150 million is more than twice that. It
 * is a bound on the memory one file can ask for. The row limits below are what
 * stop a file of many tiny rows, which this alone would let through.
 */
export const MAX_IMPORT_CHARS = 150_000_000;

/**
 * The most rows an import may hold in each list. Past any real workspace, well
 * before a file made to be slow: the bundled sample deck is 10 companies, 26
 * cards, 48 figures and 21 claims, so a hundred of them is still 1,000
 * companies, 2,600 cards and 4,800 figures. A file over any one of these is
 * refused whole rather than trimmed: it is not an export of someone's research.
 */
const LIST_LIMITS: ReadonlyArray<readonly [field: string, max: number, noun: string]> = [
  ['markets', 500, 'decks'],
  ['decks', 500, 'decks'],
  ['companies', MAX_IMPORTED_COMPANIES, 'companies'],
  ['cards', 20_000, 'cards'],
  ['metrics', 50_000, 'figures'],
  ['viceClaims', 20_000, 'claims'],
  ['reports', 2_000, 'reports'],
  ['briefings', 2_000, 'briefings'],
  ['savedCards', 20_000, 'saved cards'],
  ['threads', 2_000, 'conversations'],
  ['researchEvidence', 20_000, 'research notes'],
  ['researchJobs', 500, 'research runs'],
  ['originalSourceAttempts', 20_000, 'saved source pages'],
];
/** Keyed collections: by company or by deck, so their size follows the lists above. */
const MAP_LIMITS: ReadonlyArray<readonly [field: string, max: number, noun: string]> = [
  ['dashboards', 5_000, 'company pages'],
  ['companyMarket', 5_000, 'company entries'],
  ['opportunity', 1_000, 'market analyses'],
  ['tabsRefreshedAt', 5_000, 'company entries'],
  ['sourceChecks', 5_000, 'source checks'],
  ['productBriefs', 5_000, 'product briefs'],
];

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
  /** Companies the file followed. Following is not carried over: a person follows what they want. */
  followsLeftOut: number;
}

/** A file that cannot be imported at all. The message is plain English meant for the person. */
export class ImportRefusedError extends Error {}

/** The lists every export has, even an empty one. */
const CORE_LISTS = ['markets', 'decks', 'companies', 'metrics', 'cards'] as const;

type Row = Record<string, unknown>;
type Tally = { skipped: number };
const isRow = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
/** The id a row is referred to by; numbers count because a number id becomes its string form below. */
const idOf = (row: Row): string | null => (typeof row.id === 'string' || typeof row.id === 'number') ? String(row.id) : null;
const text = (value: unknown): string => (typeof value === 'string' || typeof value === 'number') ? String(value) : '';
/**
 * An id that is also the name of something every object has ("constructor",
 * "toString", "__proto__"). The app keeps rows in records keyed by id, and reads
 * such an id back as the object's own method, so no row may carry one.
 */
const reservedKey = (key: unknown): boolean => typeof key === 'string' && key in Object.prototype;

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

/** Refuses a row whose own id (or `key`) is reserved; see reservedKey. */
const unreserved = (accept: (row: Row) => Row | null, key = 'id') => (row: Row): Row | null => {
  const accepted = accept(row);
  return accepted && !reservedKey(accepted[key]) ? accepted : null;
};

/**
 * A row from a collection the contracts do not describe (reports, briefings,
 * evidence): it needs a text id, every field in `required` must be text, and any
 * other text field it carries must be text. Partial rows pass on purpose: older
 * builds saved reports without a kind.
 */
const textRow = (keys: readonly string[], lists: readonly string[] = [], required: readonly string[] = []) => (row: Row): Row | null => {
  if (typeof row.id !== 'string') return null;
  if (required.some((key) => typeof row[key] !== 'string')) return null;
  if (keys.some((key) => row[key] !== undefined && typeof row[key] !== 'string')) return null;
  if (lists.some((key) => row[key] !== undefined && !Array.isArray(row[key]))) return null;
  return row;
};

const JOB_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'];

/** Keep the rows `accept` passes, count the rest, and tell `onDrop` which rows went. Null when the field is not a list at all. */
function sift(rows: unknown, accept: (row: Row) => Row | null, tally: Tally, onDrop?: (row: Row) => void): Row[] | null {
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

/** The sources that read as sources; one that does not is left out and counted. Absent or unreadable becomes none. */
function sources(value: unknown, tally: Tally): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) { tally.skipped += 1; return []; }
  return value.filter((citation) => {
    const readable = citationSchema.safeParse(citation).success;
    if (!readable) tally.skipped += 1;
    return readable;
  });
}

/** A keyed collection reduced to the entries `accept` keeps, under keys that are not reserved; the rest are counted. */
function keyed(value: unknown, accept: (entry: unknown, key: string) => unknown | undefined, tally: Tally): Row {
  const kept: Row = {};
  if (!isRow(value)) { tally.skipped += 1; return kept; }
  for (const [key, entry] of Object.entries(value)) {
    const accepted = reservedKey(key) ? undefined : accept(entry, key);
    if (accepted === undefined) tally.skipped += 1; else kept[key] = accepted;
  }
  return kept;
}

/**
 * One company's cached tab. A stored tab is a record with `lastRefreshedAt` as
 * text and `content` as an object. The pages for History, Live Intel and Mission
 * & Governance read that content directly, so for them it must be an object;
 * the other tabs read theirs through tolerant schemas, which also take the older
 * list form Team & Org was saved in, so they only rule out null and plain values.
 */
const DIRECT_TABS = ['history', 'live_intel', 'mission_governance'];
function dashboardTab(entry: unknown, tab: string, tally: Tally): unknown | undefined {
  if (!isRow(entry) || typeof entry.lastRefreshedAt !== 'string') return undefined;
  const content = entry.content;
  if (!(DIRECT_TABS.includes(tab) ? isRow(content) : isRow(content) || Array.isArray(content))) return undefined;
  return entry.citations === undefined ? entry : { ...entry, citations: sources(entry.citations, tally) };
}

/**
 * A Daily Briefing update as the briefing page draws it. One that does not read
 * is left out; the briefing keeps its other updates.
 */
function briefingUpdate(update: unknown, tally: Tally): Row | null {
  if (!isRow(update)) return null;
  const { companyName, oneLiner, detail, signal, companyId, publishedDate } = update;
  const readable = [companyName, oneLiner, detail].every((field) => typeof field === 'string') &&
    (signal === 'high' || signal === 'notable') &&
    (companyId === null || typeof companyId === 'string') && (publishedDate === null || typeof publishedDate === 'string');
  return readable ? { ...update, citations: sources(update.citations, tally) } : null;
}

/**
 * Validate an imported snapshot and strip its process state. Throws a plain
 * message when the file is too large to bring in; never throws for a bad row.
 */
export function prepareImportedSnapshot(raw: RepoSnapshot): ImportPlan {
  const incoming = raw as unknown as Row;
  // Not a workspace at all: refuse it rather than import it as an empty one.
  if (!isRow(incoming) || !CORE_LISTS.every((field) => Array.isArray(incoming[field]))) throw new ImportRefusedError('This file is not a Stratemark research export.');
  for (const [field, max, noun] of LIST_LIMITS) {
    const size = Array.isArray(incoming[field]) ? (incoming[field] as unknown[]).length : 0;
    if (size > max) throw new ImportRefusedError(`This file holds ${size.toLocaleString('en-US')} ${noun}, more than the ${max.toLocaleString('en-US')} an import can bring in. It is probably not a Stratemark export.`);
  }
  for (const [field, max, noun] of MAP_LIMITS) {
    const size = isRow(incoming[field]) ? Object.keys(incoming[field] as Row).length : 0;
    if (size > max) throw new ImportRefusedError(`This file holds ${size.toLocaleString('en-US')} ${noun}, more than the ${max.toLocaleString('en-US')} an import can bring in. It is probably not a Stratemark export.`);
  }

  const tally: Tally = { skipped: 0 };
  const lostMarkets = new Set<string>();
  const lostDecks = new Set<string>();
  const lostCompanies = new Set<string>();
  const lostCards = new Set<string>();
  const remember = (set: Set<string>) => (row: Row) => { const id = idOf(row); if (id) set.add(id); };
  // A row that points at something left out would point at nothing, so it goes too.
  const unlessLost = (set: Set<string>, key: string, then: (row: Row) => Row | null) => (row: Row) =>
    set.has(text(row[key])) || reservedKey(row[key]) ? null : then(row);

  const clean: Row = { ...incoming };
  clean.markets = sift(incoming.markets, unreserved(byContract(marketSchema)), tally, remember(lostMarkets)) ?? [];
  clean.decks = sift(incoming.decks, unlessLost(lostMarkets, 'marketId', unreserved(byContract(deckSchema))), tally, remember(lostDecks)) ?? [];
  clean.companies = sift(incoming.companies, unreserved(byContract(companySchema)), tally, remember(lostCompanies)) ?? [];
  clean.metrics = sift(incoming.metrics, unlessLost(lostCompanies, 'companyId', unreserved(byContract(companyMetricSchema))), tally) ?? [];
  clean.cards = sift(incoming.cards, unlessLost(lostDecks, 'deckId', unlessLost(lostCompanies, 'companyId', unreserved(byContract(cardSchema)))), tally, remember(lostCards)) ?? [];
  clean.viceClaims = sift(incoming.viceClaims, unlessLost(lostCards, 'cardId', unreserved(byContract(viceClaimSchema))), tally) ?? [];

  const optional = (field: string, accept: (row: Row) => Row | null, onDrop?: (row: Row) => void) => {
    if (incoming[field] === undefined) return;
    const kept = sift(incoming[field], accept, tally, onDrop);
    if (kept) { clean[field] = kept; } else { delete clean[field]; tally.skipped += 1; }
  };
  const isText = (value: unknown) => typeof value === 'string';
  optional('savedCards', unlessLost(lostCards, 'cardId', (row) => isText(row.cardId) && (row.savedAt === undefined || isText(row.savedAt)) ? row : null));
  optional('removedFromDeck', (row) => [row.deckId, row.companyKey, row.at].every(isText) ? row : null);
  optional('threads', unreserved(byContract(researchThreadSchema)));
  optional('reports', unreserved((row) => {
    const report = textRow(['title', 'markdown', 'subjectId', 'kind', 'createdAt'])(row);
    // The reports list counts `citations`, so a report always carries a list of them.
    return report && { ...report, citations: sources(report.citations, tally) };
  }));
  optional('briefings', unreserved((row) => {
    const briefing = textRow(['marketId', 'deckId', 'marketName', 'headline', 'generatedAt'], ['updates', 'insights'])(row);
    if (!briefing) return null;
    const updates = ((briefing.updates ?? []) as unknown[]).map((update) => briefingUpdate(update, tally));
    const insights = ((briefing.insights ?? []) as unknown[]).filter(isText);
    tally.skipped += updates.filter((update) => update === null).length + ((briefing.insights ?? []) as unknown[]).length - insights.length;
    return { ...briefing, updates: updates.filter((update) => update !== null), insights };
  }));
  optional('researchEvidence', unreserved((row) => {
    // `text` is read as text whenever the stored figures are re-judged, so a note without it is not kept.
    const note = textRow(['topic', 'capturedAt', 'companyId', 'companyName'], ['citations', 'queries'], ['text'])(row);
    const grounding = note?.grounding;
    return note && (grounding === undefined || (isRow(grounding) && (grounding.answerText === undefined || isText(grounding.answerText)))) ? note : null;
  }));

  // The cached tabs, analyses and company entries are keyed by id and drawn by
  // their own pages: what does not read as the page expects is left out.
  if (incoming.dashboards !== undefined) {
    clean.dashboards = keyed(incoming.dashboards, (tabs) => {
      if (!isRow(tabs)) return undefined;
      return keyed(tabs, (tab, key) => dashboardTab(tab, key, tally), tally);
    }, tally);
  }
  if (incoming.opportunity !== undefined) {
    clean.opportunity = keyed(incoming.opportunity, (analysis) => isRow(analysis) && isText(analysis.markdown) && isText(analysis.at)
      ? { ...analysis, citations: sources(analysis.citations, tally) } : undefined, tally);
  }
  for (const field of ['companyMarket', 'tabsRefreshedAt'] as const) {
    if (incoming[field] !== undefined) clean[field] = keyed(incoming[field], (value) => isText(value) ? value : undefined, tally);
  }
  for (const field of ['sourceChecks', 'productBriefs'] as const) {
    if (incoming[field] !== undefined) clean[field] = keyed(incoming[field], (value) => isRow(value) ? value : undefined, tally);
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
  // Followed companies send the first page to Today, whose daily check searches
  // for news and reads sources for each of them; when each was last looked for
  // is part of the same state. A person follows what they want, here.
  const followsLeftOut = Array.isArray(incoming.follows) ? incoming.follows.length : 0;
  delete clean.follows;
  delete clean.moves;
  delete clean.movesRefreshedAt;
  // "These figures were already revalidated against gate N" is a claim about
  // work done in some other browser. Without it, imported figures are judged
  // against the current gates (locally, free) before they are saved.
  delete clean.metricGateVersion;

  const snapshot = clean as unknown as RepoSnapshot;
  return { snapshot, decks: snapshot.markets.length, companies: snapshot.companies.length, skipped: tally.skipped, unfinishedResearch, followsLeftOut };
}
