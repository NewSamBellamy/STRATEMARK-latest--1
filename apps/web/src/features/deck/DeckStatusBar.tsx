/**
 * DeckStatusBar — the deck's one status line.
 *
 * It replaces three stacked indicators (the "Deck ready" finish line, the
 * "Live research" strip and the "more cards will appear" box) that described
 * the same work in different words and different counts: a header could say
 * 20 companies while the banner said 16 were done and the cards still showed
 * Unknown. One line now says where the deck is, counted against real
 * denominators: companies planned during creation, card-face figures after it.
 * "Deck ready" is said only when every card face is sourced.
 *
 * The disclosure holds the detail for whoever is curious: each company's
 * state, the live activity, and coverage notes. Nothing here estimates — no
 * percentage, no ETA — and repeated actions collapse into one counted row.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Info, Pause, Play, RefreshCw, Sparkles } from 'lucide-react';
import { isEntityCardType, type CardWithCompany, type ResearchJob } from '@mi/contracts';
import { cn } from '@/lib/cn';
import { buildCardView } from '@/features/card/card-view';
import { gapsByKind, missingFaceSlots } from '@/lib/living/faceSweep';
import type { LivingDeckState } from '@/lib/living/useLivingDeck';
import { useResearchControl } from '@/lib/living/researchControl';
import { useRepository, useRepositoryMode } from '@/lib/repository/RepositoryProvider';
import { SettingsLink } from '@/components/SettingsLink';
import { useResearchSession } from './research-session';
import { groupSites, KIND_VERB, useSourceActivity } from './sourceActivity';
import { spendBetween, useFillRecord } from './fillLedger';

const CATEGORY_LABEL: Record<string, string> = {
  vice: 'risk and controversy signals',
  culture: 'culture signals',
  insight: 'market insights',
  barrier: 'barriers to entry',
  company: 'companies',
  infrastructure: 'infrastructure providers',
  distribution: 'distribution channels',
};

/** "Coverage shortfall for vice: found 0, minimum is 4. …" in plain English. */
export function plainCoverageNote(warning: string): string {
  const match = /^Coverage shortfall for (\w+): found (\d+), minimum is (\d+)\./i.exec(warning);
  if (!match) return warning;
  const [, role, found, minimum] = match;
  const label = CATEGORY_LABEL[role!.toLowerCase()] ?? role;
  return `Found ${found} sourced ${label} (aiming for ${minimum}). Only findings with a source are shown — nothing was made up to fill the gap.`;
}

export interface DeskProgress {
  id: string;
  name: string;
  /** Card-face places showing a sourced figure. */
  filled: number;
  /** Card-face places in all. */
  total: number;
}

/**
 * One row per company in the deck, counted the way the header counts them
 * (distinct companies behind company, infrastructure and distribution cards),
 * with the card face's own measure of what is still empty.
 */
export function deskProgress(cards: readonly CardWithCompany[]): DeskProgress[] {
  const seen = new Set<string>();
  const rows: DeskProgress[] = [];
  for (const card of cards) {
    if (!isEntityCardType(card.card.cardType) || !card.company || seen.has(card.company.id)) continue;
    seen.add(card.company.id);
    const total = buildCardView(card).faceMetrics.length;
    rows.push({ id: card.company.id, name: card.company.name, filled: total - missingFaceSlots(card).length, total });
  }
  return rows;
}

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return 'now';
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

interface LogRow { key: string; message: string; at: number | null; repeats: number; detail?: string }

/** Consecutive identical lines become one row with a count, not a firehose. */
function collapseRepeats(rows: LogRow[]): LogRow[] {
  const out: LogRow[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.message === row.message) last.repeats += 1;
    else out.push({ ...row });
  }
  return out;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Phase = 'creating' | 'stopped' | 'failed' | 'filling' | 'incomplete' | 'ready';

export function DeckStatusBar({
  deckId,
  marketName,
  cards,
  living,
  deckStatus,
  resume,
}: {
  deckId: string | undefined;
  marketName: string;
  cards: readonly CardWithCompany[];
  living: LivingDeckState;
  deckStatus?: string;
  /** Present when an interrupted creation run can pick up where it stopped. */
  resume?: { run: () => void; pending: boolean } | null;
}) {
  const repo = useRepository();
  const mode = useRepositoryMode();
  const storageError = useResearchControl((state) => state.storageError);
  const session = useResearchSession((s) => s.session);
  const [open, setOpen] = useState(false);
  const [filling, setFilling] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const jobsEnabled = mode !== 'demo' && typeof repo.listResearchJobs === 'function' && !!deckId;
  const jobs = useQuery({
    queryKey: ['research-jobs', deckId],
    queryFn: async () => (await repo.listResearchJobs!()) as ResearchJob[],
    enabled: jobsEnabled,
    staleTime: 15_000,
    // Poll only while this deck's creation run is live.
    refetchInterval: (query) => {
      const latest = latestJob(query.state.data, deckId);
      return latest && (latest.status === 'running' || latest.status === 'queued') ? 5_000 : false;
    },
  });
  const job = jobsEnabled ? latestJob(jobs.data, deckId) : undefined;

  const desks = useMemo(() => deskProgress(cards), [cards]);
  const complete = desks.filter((d) => d.filled >= d.total).length;
  const missing = desks.reduce((sum, d) => sum + Math.max(0, d.total - d.filled), 0);

  const creating = job ? job.status === 'running' || job.status === 'queued' : deckStatus === 'running';
  const planned = job?.catalogNames.length ?? 0;
  const done = new Set(job?.completedEntityNames ?? []).size;
  const paused = living.status === 'paused';

  const phase: Phase = creating ? 'creating'
    : job?.status === 'failed' || deckStatus === 'failed' ? 'failed'
      : job?.status === 'cancelled' || deckStatus === 'partial' ? 'stopped'
        : desks.length > 0 && complete === desks.length ? 'ready'
          : living.canVerify && living.status === 'running' ? 'filling'
            : 'incomplete';

  const gaps = useMemo(() => gapsByKind(cards), [cards]);
  const fillRecord = useFillRecord(deckId, desks, phase === 'ready' || phase === 'incomplete' || phase === 'filling');
  const sourceFeed = useSourceActivity(open && (phase === 'creating' || phase === 'filling'));
  const sites = groupSites(sourceFeed.items);

  // The clock ticks only while something is moving.
  const moving = phase === 'creating' || phase === 'filling' || open;
  useEffect(() => {
    if (!moving) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [moving]);

  // A creation run is visible from another tab: "(7/16) Deck name".
  useEffect(() => {
    if (phase !== 'creating' || planned === 0) return;
    const before = document.title;
    document.title = `(${done}/${planned}) ${marketName} · Stratemark`;
    return () => { document.title = before; };
  }, [phase, done, planned, marketName]);

  if (desks.length === 0 && !creating && !job) return null;

  const startedAt = job ? Date.parse(job.createdAt) : NaN;
  const runTime = Number.isFinite(startedAt) ? elapsed((job && !creating ? Date.parse(job.updatedAt) : now) - startedAt) : null;

  // ── The one line ──
  let title: string;
  let meta: string[];
  if (phase === 'creating') {
    title = `Researching ${marketName}`;
    meta = [planned > 0 ? `${done} of ${planned} companies` : `${plural(done, 'company', 'companies')} so far`];
    if (runTime) meta.push(runTime);
  } else if (phase === 'failed' || phase === 'stopped') {
    title = phase === 'failed' ? 'Research failed' : 'Research stopped early';
    meta = [planned > 0 ? `${done} of ${planned} companies saved` : 'some companies still need another pass'];
  } else if (phase === 'ready') {
    title = 'Deck ready';
    meta = [plural(desks.length, 'company', 'companies'), 'every card face sourced'];
  } else {
    title = phase === 'filling' ? 'Filling cards' : `${complete} of ${desks.length} cards complete`;
    meta = phase === 'filling'
      ? [`${complete} of ${desks.length} complete`, `${plural(missing, 'figure', 'figures')} to find`]
      : [`${plural(missing, 'figure', 'figures')} not found yet`];
  }
  if (paused && (phase === 'filling' || phase === 'incomplete')) meta.push('paused');

  const tone = phase === 'ready' ? 'done' : phase === 'failed' ? 'bad' : phase === 'stopped' || phase === 'incomplete' ? 'warn' : 'live';

  // Segments: one per company, never a percentage.
  const segments: Array<{ key: string; label: string; state: 'done' | 'part' | 'todo' }> = phase === 'creating' && planned > 0
    ? job!.catalogNames.map((name) => ({
      key: name,
      label: name,
      state: (job!.completedEntityNames.includes(name) ? 'done' : 'todo') as 'done' | 'todo',
    }))
    : desks.map((d) => ({
      key: d.id,
      label: `${d.name}: ${d.filled} of ${d.total} figures`,
      state: d.filled >= d.total ? 'done' : d.filled > 0 ? 'part' : 'todo',
    }));

  const canFill = living.canVerify && missing > 0 && !creating;
  const fill = () => {
    setFilling(true);
    void living.fillCardFaces().finally(() => setFilling(false));
  };

  // ── The detail ──
  const coverage = (job?.warnings ?? []).filter((warning) =>
    /coverage shortfall|remained below|skipped \d+ results|no sourced barriers/i.test(warning));
  const activity: LogRow[] = phase === 'creating' && session?.running
    ? [...session.logLines].reverse().slice(0, 40).map((message, i) => ({ key: `s${i}`, message, at: null, repeats: 1 }))
    : living.events.slice(0, 30).map((e) => ({
      key: String(e.id),
      message: e.message,
      at: e.at,
      repeats: 1,
      detail: e.citations ? plural(e.citations, 'source', 'sources') : undefined,
    }));
  const rows = collapseRepeats(activity);
  const companyRows = phase === 'creating' && planned > 0
    ? job!.catalogNames.map((name) => ({ key: name, id: null as string | null, name, done: job!.completedEntityNames.includes(name), note: job!.completedEntityNames.includes(name) ? 'researched' : 'queued' }))
    : [...desks]
      .sort((a, b) => (b.total - b.filled) - (a.total - a.filled))
      .map((d) => ({ key: d.id, id: d.id as string | null, name: d.name, done: d.filled >= d.total, note: `${d.filled} of ${d.total} figures` }));

  return (
    <div data-testid="deck-status" className="mt-3 rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
          {tone === 'live' && !paused && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40 [animation-duration:2s]" />}
          <span className={cn('relative inline-flex h-2 w-2 rounded-full',
            tone === 'done' ? 'bg-positive' : tone === 'bad' ? 'bg-negative' : tone === 'warn' || paused ? 'bg-amber-400' : 'bg-primary')} />
        </span>
        <p role="status" className="min-w-0 text-[12px] leading-snug">
          {phase === 'ready' && <Check className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-positive" aria-hidden />}
          <span className="font-semibold text-content">{title}</span>
          {meta.map((part) => <span key={part} className="text-muted"> · {part}</span>)}
          {!living.canVerify && phase !== 'creating' && (
            <span className="text-faint"> · live updates off{mode !== 'demo' && <> — <SettingsLink className="underline underline-offset-2 hover:text-content">add your key</SettingsLink></>}</span>
          )}
        </p>
        {segments.length > 1 && (
          <div className="order-last flex h-1 w-full gap-px overflow-hidden rounded-full sm:order-none sm:ml-auto sm:w-40" aria-hidden>
            {segments.map((s) => (
              <span key={s.key} title={s.label} className={cn('h-full flex-1',
                s.state === 'done' ? (tone === 'done' ? 'bg-positive' : 'bg-primary') : s.state === 'part' ? 'bg-primary/40' : 'bg-surface-2')} />
            ))}
          </div>
        )}
        <span className={cn('flex shrink-0 items-center gap-1', segments.length <= 1 && 'ml-auto')}>
          {(phase === 'stopped' || phase === 'failed') && resume && (
            <button type="button" className="btn-ghost h-7 px-2 text-[12px]" disabled={resume.pending} onClick={resume.run}>
              <RefreshCw className={cn('h-3.5 w-3.5', resume.pending && 'animate-spin')} />
              {resume.pending ? 'Resuming…' : 'Resume'}
            </button>
          )}
          {canFill && (
            <button type="button" className="btn-ghost h-7 px-2 text-[12px]" disabled={filling} onClick={fill}
              title="Look for a sourced figure for every card-face place that still shows Unknown.">
              <Sparkles className={cn('h-3.5 w-3.5', filling && 'animate-pulse')} />
              {filling ? 'Searching…' : 'Find missing figures'}
            </button>
          )}
          {living.canVerify && living.deskCount > 0 && (
            <button type="button" className="rounded p-1.5 text-faint transition-colors hover:bg-surface-2 hover:text-content"
              title={paused ? 'Resume background research' : 'Pause background research'}
              aria-label={paused ? 'Resume background research' : 'Pause background research'}
              onClick={() => (paused ? living.resume() : living.pause())}>
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </button>
          )}
          <button type="button" className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-content"
            aria-expanded={open} aria-controls="deck-status-detail" onClick={() => setOpen((v) => !v)}>
            Details
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
          </button>
        </span>
      </div>
      {paused && <p className="px-3 pb-2 text-[11px] text-muted">Background research is paused across the app. Opening tabs and manual checks still work; work already sent may finish.</p>}
      {storageError && <p role="alert" className="px-3 pb-2 text-[11px] text-muted">{storageError}</p>}
      {open && (
        <div id="deck-status-detail" className="grid gap-4 border-t border-border px-3 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <section aria-label="Companies">
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Companies</h3>
            <ul className="max-h-64 space-y-px overflow-y-auto pr-1">
              {companyRows.map((row) => (
                <li key={row.key} className="flex items-center gap-2 py-0.5 text-[12px]">
                  {row.done
                    ? <Check className="h-3 w-3 shrink-0 text-positive" aria-label="Complete" />
                    : <span className="ml-0.5 mr-0.5 h-2 w-2 shrink-0 rounded-full border border-faint" aria-label="Not complete" />}
                  {row.id
                    ? <Link to={`/company/${row.id}/dashboard`} className="min-w-0 flex-1 truncate text-content hover:text-primary-ink">{row.name}</Link>
                    : <span className="min-w-0 flex-1 truncate text-content">{row.name}</span>}
                  <span className="shrink-0 tabular-nums text-faint">{row.note}</span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Activity">
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Activity</h3>
            {rows.length > 0 ? (
              <ol className="max-h-64 space-y-px overflow-y-auto pr-1">
                {rows.map((row) => (
                  <li key={row.key} className="flex items-start gap-2 py-0.5 text-[12px] leading-snug">
                    <span className="w-8 shrink-0 text-right tabular-nums text-faint">{row.at ? ago(row.at, now) : ''}</span>
                    <span className="min-w-0 flex-1 text-muted">
                      {row.message}
                      {row.repeats > 1 && <span className="text-faint"> ×{row.repeats}</span>}
                      {row.detail && <span className="text-faint"> · {row.detail}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[12px] text-faint">
                {living.canVerify ? 'No research activity yet this session.' : 'Live research is off, so nothing is running on this deck.'}
              </p>
            )}
          </section>
          {sourceFeed.supported && (phase === 'creating' || phase === 'filling') && (
            <section aria-label="Where research is looking" className="md:col-span-2">
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Where research is looking</h3>
              {sites.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {sites.map((site) => (
                    <li key={site.domain} className="rounded-full border border-border px-2.5 py-0.5 text-[12px] text-muted"
                      title={`${KIND_VERB[site.kind]}${site.company ? ` for ${site.company}` : ''}${site.count > 1 ? `, ${site.count} times` : ''}`}>
                      <span className="font-medium text-content">{site.domain}</span>
                      <span className="text-faint"> · {KIND_VERB[site.kind]}{site.count > 1 ? ` ×${site.count}` : ''}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-faint">Waiting for the next search. Sites appear here as research reaches them.</p>
              )}
              <p className="mt-1.5 text-[11px] text-faint">
                Left to do: {phase === 'creating'
                  ? (planned > 0 ? `${plural(Math.max(0, planned - done), 'company', 'companies')} of ${planned}` : 'the company list is still forming')
                  : `${plural(missing, 'figure', 'figures')} on ${plural(desks.length - complete, 'card', 'cards')}`}. No time estimate: research pace depends on the sources.
              </p>
            </section>
          )}
          {fillRecord && (
            <section aria-label="Fill record" className="md:col-span-2">
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Fill record</h3>
              <p className="text-[12px] text-muted">
                Figures on the cards: <span className="font-medium text-content">{fillRecord.latest.filled} of {fillRecord.latest.total}</span> now
                {(fillRecord.first.filled !== fillRecord.latest.filled || spendBetween(fillRecord) >= 0.005) && (
                  <>, {fillRecord.first.filled} of {fillRecord.first.total} when this deck was first seen finished
                    {spendBetween(fillRecord) >= 0.005 && <>. Estimated spend since then: about ${spendBetween(fillRecord).toFixed(2)} at list prices</>}</>
                )}
                .
              </p>
              <p className="mt-1 text-[11px] text-faint">Counted from the cards on this device. Spend is the usage meter's estimate, not a bill.</p>
            </section>
          )}
          {gaps.length > 0 && phase !== 'creating' && (
            <section aria-label="Figures still missing" className="md:col-span-2">
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Figures still missing</h3>
              <ul className="flex flex-wrap gap-1.5">
                {gaps.map((g) => (
                  <li key={g.label} className="rounded-full border border-border px-2.5 py-0.5 text-[12px] text-muted">
                    <span className="font-medium text-content">{g.label}</span> · {plural(g.companies, 'company', 'companies')}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-faint">A kind missing on many companies points at the research process; one or two is usually a figure nobody publishes.</p>
            </section>
          )}
          {coverage.length > 0 && (
            <section aria-label="Coverage notes" className="md:col-span-2">
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Coverage notes</h3>
              <div className="space-y-1">
                {coverage.map((warning, index) => (
                  <p key={index} className="flex items-start gap-1.5 text-[12px] text-muted">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" />
                    {plainCoverageNote(warning)}
                  </p>
                ))}
              </div>
            </section>
          )}
          {job?.error && (phase === 'failed' || phase === 'stopped') && (
            <p className="text-[12px] text-muted md:col-span-2">{job.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

function latestJob(jobs: ResearchJob[] | undefined, deckId: string | undefined): ResearchJob | undefined {
  if (!jobs || !deckId) return undefined;
  return jobs
    .filter((j) => j.deck?.id === deckId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}
