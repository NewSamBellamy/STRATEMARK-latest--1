import { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { publisherOf, type MarketIntelRepository, type SignalBrief, type SignalBriefPoint } from '@mi/contracts';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { useReadOnly } from '@/lib/readOnly';
import { sourceHref } from '@/lib/sourceHref';

export type SignalBriefState =
  | { status: 'idle' }
  | { status: 'building' }
  | { status: 'ready'; brief: SignalBrief }
  | { status: 'failed'; message: string };

/** Builds in flight, per repository and card, so two openings of one card share one build (and one spend). */
const builds = new WeakMap<object, Map<string, Promise<SignalBrief>>>();

/** A build that failed is not started again by merely reopening the card for this long; an explicit "Try again" always may. */
export const BUILD_BACKOFF_MS = 5 * 60 * 1000;
const failures = new WeakMap<object, Map<string, { at: number; message: string }>>();

function recentFailure(repo: MarketIntelRepository, cardId: string): string | null {
  const found = failures.get(repo)?.get(cardId);
  return found && Date.now() - found.at < BUILD_BACKOFF_MS ? found.message : null;
}

function noteFailure(repo: MarketIntelRepository, cardId: string, message: string): void {
  let byCard = failures.get(repo);
  if (!byCard) failures.set(repo, byCard = new Map());
  byCard.set(cardId, { at: Date.now(), message });
}

function sharedBuild(repo: MarketIntelRepository, cardId: string, force: boolean): Promise<SignalBrief> {
  let byCard = builds.get(repo);
  if (!byCard) builds.set(repo, byCard = new Map());
  const running = byCard.get(cardId);
  if (running) return running;
  const run = repo.researchSignalBrief!({ cardId, ...(force ? { force: true } : {}) });
  byCard.set(cardId, run);
  const clear = () => { if (byCard.get(cardId) === run) byCard.delete(cardId); };
  run.then(clear, clear);
  return run;
}

/** A point is shown only with a source behind it. */
export function sourcedPoints(brief: SignalBrief): SignalBriefPoint[] {
  return (brief.points ?? []).filter((point) => point.text?.trim() && Array.isArray(point.sources) && point.sources.length > 0);
}

/**
 * The brief behind a signal card. Reads a stored one for free; builds one once when none is stored, unless the view is a
 * shared copy (which never builds or spends). Rebuilding is only ever called from an explicit, confirmed click.
 */
export function useSignalBrief(cardId: string, enabled: boolean) {
  const repo = useRepository();
  const readOnly = useReadOnly();
  const [state, setState] = useState<SignalBriefState>({ status: 'idle' });
  const canBuild = !readOnly && typeof repo.researchSignalBrief === 'function';

  const build = useCallback((force: boolean, auto = false) => {
    if (!canBuild) return;
    // Opening a card again must not pay again for a build that just failed.
    const recent = auto ? recentFailure(repo, cardId) : null;
    if (recent !== null) { setState({ status: 'failed', message: recent }); return; }
    setState({ status: 'building' });
    sharedBuild(repo, cardId, force).then(
      (brief) => setState({ status: 'ready', brief }),
      (error: unknown) => {
        const message = error instanceof Error && error.message ? error.message : 'The report could not be written.';
        noteFailure(repo, cardId, message);
        setState({ status: 'failed', message });
      },
    );
  }, [repo, cardId, canBuild]);

  useEffect(() => {
    if (!enabled || typeof repo.peekSignalBrief !== 'function') {
      if (enabled && canBuild) build(false, true);
      return;
    }
    let live = true;
    repo.peekSignalBrief(cardId).then(
      (stored) => {
        if (!live) return;
        if (stored) setState({ status: 'ready', brief: stored });
        else if (canBuild) build(false, true);
      },
      () => { if (live && canBuild) build(false, true); },
    );
    return () => { live = false; };
  }, [enabled, repo, cardId, canBuild, build]);

  return { state, canBuild, retry: () => build(false), rebuild: () => build(true) };
}

type Controls = ReturnType<typeof useSignalBrief>;

/** The brief's lead and points, each with its own sources. Renders nothing until there is something sourced to show. */
export function SignalBriefBody({ controls }: { controls: Controls }) {
  const { state } = controls;
  const [confirming, setConfirming] = useState(false);
  if (state.status === 'idle') return null;
  if (state.status === 'building') {
    return <p className="card-inspector__trust-note min-h-[2.5rem]" role="status">Writing the full report on this finding…</p>;
  }
  if (state.status === 'failed') {
    return <div className="card-inspector__trust-note min-h-[2.5rem]" role="alert">
      <span>{state.message}</span>{' '}
      <button type="button" className="font-semibold text-content hover:underline" onClick={controls.retry}>Try again</button>
    </div>;
  }
  const points = sourcedPoints(state.brief);
  const lead = state.brief.lead?.trim();
  if (points.length === 0) {
    return <p className="card-inspector__trust-note">Nothing more is documented about this finding yet.</p>;
  }
  return <div className="signal-brief" aria-label="Full report on this finding">
    {lead && <p className="text-[13px] font-medium leading-relaxed text-content">{lead}</p>}
    <ul className="card-inspector__findings mt-2">
      {points.map((point, index) => <li key={`${index}-${point.text}`}>
        <p>{point.text}</p>
        <span className="card-inspector__source-list">
          {point.sources.map((source) => <a key={source.url} href={sourceHref(source.url, source.title)}
            target="_blank" rel="noopener noreferrer">
            <ExternalLink size={10} aria-hidden="true" />{publisherOf(source.url, source.title)}
          </a>)}
        </span>
      </li>)}
    </ul>
    {controls.canBuild && <div className="brf-no-print mt-2 text-[11px] text-muted">
      {confirming ? <span className="flex items-center gap-2">
        <span>Rebuilding uses research credits.</span>
        <button type="button" className="font-semibold text-content hover:underline"
          onClick={() => { setConfirming(false); controls.rebuild(); }}>Rebuild now</button>
        <button type="button" className="hover:underline" onClick={() => setConfirming(false)}>Cancel</button>
      </span> : <button type="button" className="hover:underline" onClick={() => setConfirming(true)}>Rebuild</button>}
    </div>}
  </div>;
}
