/**
 * Bake the shipped sample deck from a REAL keyed research run.
 *
 * The app's zero-state (no API key) serves a pre-baked snapshot so a first-time
 * visitor sees genuine researched output instead of an empty shell. That snapshot
 * has to be regenerated whenever the pipeline changes, or the demo silently
 * showcases old behaviour — which is exactly what happened: the previous bake
 * predates Wikidata logo resolution, Insight cards, and citation-bearing metrics,
 * so it shipped favicon rasters and "Publisher not recorded".
 *
 * This script exists so that regeneration is one reproducible command instead of
 * an ad-hoc snippet nobody can find later.
 *
 *   GEMINI_API_KEY=... npx tsx scripts/bake-sample-deck.ts
 *
 * Env:
 *   MI_PROMPT   market brief (default: the Frontier AI market)
 *   MI_REGION   geography or empty for global
 *   MI_TARGET   company count (default 10)
 *   MI_OUT      output path (default apps/web/src/sample/frontier-snapshot.json)
 *   MI_TABS     "all" (default) warms all 8 dashboard tabs per company; "none" skips
 *
 * Everything it writes is grounded output from the live pipeline. It invents
 * nothing: if a figure has no source, provenance enforcement demotes it, and this
 * script reports that rather than papering over it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DASHBOARD_TABS, type DashboardTab, type Deck, type Market } from '@mi/contracts';
import { GeminiRepository, type RepoSnapshot } from '../src/repository';

const apiKey = (process.env.GEMINI_API_KEY ?? '').replace(/[^\x20-\x7E]/g, '').trim();
if (!apiKey) {
  console.error('Set GEMINI_API_KEY');
  process.exit(1);
}

const prompt =
  process.env.MI_PROMPT ??
  'The frontier AI foundation model and compute infrastructure market — labs building frontier models, the compute providers they depend on, and the channels they reach enterprises through';
const region = process.env.MI_REGION || null;
const target = Number(process.env.MI_TARGET ?? 10);
const warmTabs = (process.env.MI_TABS ?? 'all') !== 'none';
const outPath = resolve(
  process.env.MI_OUT ?? resolve(import.meta.dirname, '../../../apps/web/src/sample/frontier-snapshot.json'),
);

/**
 * TOP-UP mode (MI_TOPUP=1): load the existing snapshot and research only what is
 * missing — the dashboard tabs a previous run failed to structure. A full re-bake
 * costs ~250 grounded calls and half an hour; repairing the gaps costs a few
 * dozen. Same reason the pipeline caps candidates: the scarce resource is
 * requests per minute, so don't spend them on work already done.
 */
const topUp = process.env.MI_TOPUP === '1';

/** In-memory store; we persist once at the end. */
let snapshot: RepoSnapshot | null = null;
if (topUp) {
  const existing = JSON.parse(readFileSync(outPath, 'utf8')) as RepoSnapshot;
  snapshot = existing;
  console.log(
    `top-up mode: loaded ${existing.cards.length} cards, ${existing.companies.length} companies, ` +
      `${Object.values(existing.dashboards).reduce((n, t) => n + Object.keys(t ?? {}).length, 0)} cached tabs`,
  );
}
// Write THROUGH to disk on every mutation. Interrupted bakes used to lose the
// whole run (the file wrote once, at the end); now any crash/kill leaves a
// valid snapshot that MI_TOPUP=1 resumes from.
const store = {
  read: () => snapshot,
  write: (s: RepoSnapshot) => {
    snapshot = s;
    try {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, `${JSON.stringify(s, null, 2)}\n`);
    } catch {
      /* disk hiccup — the end-of-run write still applies */
    }
  },
};

let calls = 0;
const repo = new GeminiRepository({
  apiKey,
  store,
  targetCompanies: target,
  concurrency: 2,
  onCall: () => {
    calls += 1;
  },
});

const t0 = Date.now();
const mins = () => `${((Date.now() - t0) / 60000).toFixed(1)}m`;

console.log(`\n=== Baking sample deck ===\nmarket: ${prompt.slice(0, 70)}…\ntarget: ${target} companies\n`);

let market: Market;
let deck: Deck;
if (topUp) {
  market = snapshot!.markets.at(-1)!;
  deck = snapshot!.decks.find((d) => d.marketId === market.id)!;
  console.log(`reusing deck for "${market.name}"`);
} else {
  const made = await repo.createResearchedDeck(
    { prompt, region },
    { onProgress: (p) => console.log(`  • [${mins()}] ${p.message}`) },
  );
  market = made.market;
  deck = made.deck;
}

const cards = await repo.listCards(deck.id);
console.log(`\ndeck: ${cards.length} cards in ${mins()} (${calls} API calls)`);

// ---- Warm every dashboard tab so the keyless demo is fully explorable -------
if (warmTabs) {
  const companies = [...new Set(cards.map((c) => c.company?.id).filter((x): x is string => !!x))];
  console.log(`\nwarming ${DASHBOARD_TABS.length} tabs x ${companies.length} companies…`);
  for (const companyId of companies) {
    const name = cards.find((c) => c.company?.id === companyId)?.company?.name ?? companyId;
    const cached = snapshot?.dashboards?.[companyId] ?? {};
    const wanted = (DASHBOARD_TABS as readonly DashboardTab[]).filter((t) => !cached[t]);
    if (wanted.length === 0) {
      console.log(`  – [${mins()}] ${name} (all tabs already cached)`);
      continue;
    }
    for (const tab of wanted) {
      try {
        await repo.getDashboardTab(companyId, tab, true);
      } catch (err) {
        // A failed tab is a visible gap in the demo, not a reason to lose the run.
        console.log(`  ! ${name} / ${tab}: ${err instanceof Error ? err.message.slice(0, 90) : err}`);
      }
    }
    console.log(`  ✓ [${mins()}] ${name}`);
  }
}

// ---- One report + the whitespace analysis, so those screens aren't empty ----
if ((snapshot?.reports ?? []).length === 0) {
  try {
    await repo.generateReport({ kind: 'deck', subjectId: deck.id });
    console.log(`\nreport generated [${mins()}]`);
  } catch (err) {
    console.log(`! report failed: ${err instanceof Error ? err.message.slice(0, 120) : err}`);
  }
} else {
  console.log('\nreport already present — skipped');
}
if (!snapshot?.opportunity?.[market.id]) {
  try {
    await repo.getMarketOpportunity(market.id);
    console.log(`opportunity analysis generated [${mins()}]`);
  } catch (err) {
    console.log(`! opportunity failed: ${err instanceof Error ? err.message.slice(0, 120) : err}`);
  }
} else {
  console.log('opportunity analysis already present — skipped');
}

// ---- Honest audit of what we're about to ship ------------------------------
const snap = snapshot!;
const violations: string[] = [];
let verified = 0;
let verifiedCited = 0;
let estimated = 0;
let unknown = 0;
for (const m of snap.metrics) {
  const who = snap.companies.find((c) => c.id === m.companyId)?.name ?? m.companyId;
  if (m.confidence === 'verified') {
    verified += 1;
    if ((m.citations ?? []).length > 0) verifiedCited += 1;
    else violations.push(`VERIFIED without citation: ${who} ${m.metricType}=${m.value}`);
  } else if (m.confidence === 'estimated') {
    estimated += 1;
    if (!m.methodNote) violations.push(`ESTIMATED without method note: ${who} ${m.metricType}`);
  } else if (m.confidence === 'unknown') {
    unknown += 1;
    if (m.value != null) violations.push(`UNKNOWN with a value (FABRICATION): ${who} ${m.metricType}`);
  }
}

const logoKind = (url: string | null): string =>
  !url ? 'lettermark' : /upload\.wikimedia|commons\.wikimedia/.test(url) ? (/\.svg/i.test(url) ? 'wikidata-svg' : 'wikidata-raster') : /gstatic/.test(url) ? 'favicon' : 'other';
const logos: Record<string, number> = {};
for (const c of snap.companies) {
  const k = logoKind(c.logoUrl);
  logos[k] = (logos[k] ?? 0) + 1;
}

const byType: Record<string, number> = {};
for (const c of snap.cards) byType[c.cardType] = (byType[c.cardType] ?? 0) + 1;

console.log(`\n=== Snapshot audit ===`);
console.log(`cards by type      : ${JSON.stringify(byType)}`);
console.log(`logo sources       : ${JSON.stringify(logos)}`);
console.log(`metrics            : verified=${verified} estimated=${estimated} unknown=${unknown}`);
console.log(`verified w/ citation: ${verifiedCited}/${verified}`);
console.log(`dashboard tabs      : ${Object.values(snap.dashboards).reduce((n, t) => n + Object.keys(t ?? {}).length, 0)}`);
console.log(`reports             : ${snap.reports.length}`);
console.log(`total API calls     : ${calls} in ${mins()}`);
console.log(`VIOLATIONS          : ${violations.length}`);
for (const v of violations.slice(0, 15)) console.log('  ✗', v);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(snap, null, 2)}\n`);
console.log(`\nwrote ${outPath}`);
