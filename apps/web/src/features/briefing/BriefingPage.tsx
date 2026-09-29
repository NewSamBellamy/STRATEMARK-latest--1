/**
 * The Daily Briefing page — where a deck's overnight desk reports in.
 *
 * Three honest states:
 *   1. GATED — the deck is still forming; the briefing waits (with a real
 *      progress count) rather than digesting skeletons into prose.
 *   2. READY — one click sends the desk out over the last N hours and opens the
 *      cited editorial report.
 *   3. ARCHIVE — every generated briefing is kept. Sharing rides the
 *      existing link codec: the whole briefing + its evidence cards travel
 *      inside the URL, AI layer removed.
 */
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Newspaper, RefreshCw, Share2 } from 'lucide-react';
import { deckBakedState, type DeckBriefing } from '@mi/contracts';
import {
  useCards,
  useDeckBriefings,
  useDeckByMarket,
  useGenerateBriefing,
  useMarket,
} from '@/hooks/data';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { useApiKey } from '@/lib/settings/apiKey';
import { SettingsLink } from '@/components/SettingsLink';
import { buildBriefingShare } from '@/lib/share/codec';
import { ShareDialog } from '@/features/share/ShareDialog';
import { cn } from '@/lib/cn';
import { BriefingReport, toBriefingView } from './BriefingReport';

const WINDOWS: Array<{ hours: number; label: string }> = [
  { hours: 24, label: 'Last 24 hours' },
  { hours: 48, label: 'Last 48 hours' },
  { hours: 24 * 7, label: 'Last 7 days' },
];

export default function BriefingPage() {
  const { marketId } = useParams();
  const repo = useRepository();
  const hasKey = useApiKey((s) => s.hasKey);
  const market = useMarket(marketId);
  const deck = useDeckByMarket(marketId);
  const cards = useCards(deck.data?.id);
  const briefings = useDeckBriefings(marketId);
  const generate = useGenerateBriefing();
  const [shareOpen, setShareOpen] = useState(false);

  const [windowHours, setWindowHours] = useState(24);
  const [activeId, setActiveId] = useState<string | null>(null);

  const supported = typeof repo.generateDeckBriefing === 'function' && hasKey;
  const baked = useMemo(() => deckBakedState((cards.data ?? []).map((c) => c.card)), [cards.data]);
  const list = briefings.data ?? [];
  const active: DeckBriefing | null =
    (activeId ? list.find((b) => b.id === activeId) : null) ?? list[0] ?? null;

  const runGenerate = () => {
    if (!marketId) return;
    generate.mutate(
      { marketId, windowHours },
      {
        onSuccess: (b) => {
          setActiveId(b.id);
        },
      },
    );
  };

  const buildShare = async () => {
    if (!active) throw new Error('No briefing to share yet.');
    const mentioned = new Set(
      active.updates.map((u) => u.companyId).filter((x): x is string => x != null),
    );
    const evidence = (cards.data ?? [])
      .filter((c) => c.card.cardType === 'company')
      .filter((c) =>
        mentioned.size > 0 ? c.card.companyId != null && mentioned.has(c.card.companyId) : true,
      )
      .slice(0, 10);
    return buildBriefingShare(active, evidence);
  };

  const marketName = market.data?.name ?? 'this market';

  return (
    <div className="w-full max-w-[900px] px-2 sm:px-4">
      <div className="brf-no-print mb-5">
        <Link
          to={`/markets/${marketId}/deck`}
          className="inline-flex items-center gap-1 text-[12px] font-medium text-muted transition-colors hover:text-primary-ink"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to deck
        </Link>
      </div>

      {/* ── No engine / no key ── */}
      {!supported && (
        <div className="panel mx-auto max-w-xl p-8 text-center">
          <Newspaper className="mx-auto h-8 w-8 text-muted" />
          <h1 className="mt-3 font-display text-xl font-semibold text-content">Daily Briefing</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The briefing is a live-research feature: one grounded pass hunts the last 24 hours of
            real developments across every company in this deck and composes them into an editorial
            report. Connect your Gemini key in Settings to turn it on.
          </p>
          <SettingsLink className="btn-primary mt-5 inline-flex">Open Settings</SettingsLink>
        </div>
      )}

      {/* ── Gated: deck still forming ── */}
      {supported && !baked.baked && (
        <div className="panel mx-auto max-w-xl p-8 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-ink" />
          <h1 className="mt-3 font-display text-xl font-semibold text-content">
            The deck is still baking
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {baked.total === 0
              ? 'No company cards yet — run the research pass first.'
              : `${baked.formed} of ${baked.total} cards have finished forming. The briefing waits for all of them: digesting a half-researched deck would put skeletons into prose.`}
          </p>
          {baked.total > 0 && (
            <div className="mx-auto mt-4 h-1.5 w-56 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.round((baked.formed / baked.total) * 100)}%` }}
              />
            </div>
          )}
          <Link to={`/markets/${marketId}/deck`} className="btn-primary mt-5 inline-flex">
            Watch the deck form
          </Link>
        </div>
      )}

      {/* ── Ready, nothing generated yet ── */}
      {supported && baked.baked && !active && (
        <div className="panel mx-auto max-w-xl p-8 text-center">
          <Newspaper className="mx-auto h-8 w-8 text-primary-ink" />
          <h1 className="mt-3 font-display text-xl font-semibold text-content">Daily briefing</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Choose a time window. Stratemark checks all {baked.total} tracked companies in{' '}
            {marketName} and composes the cited developments that matter.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {WINDOWS.map((w) => (
              <button
                key={w.hours}
                type="button"
                onClick={() => setWindowHours(w.hours)}
                aria-pressed={windowHours === w.hours}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors',
                  windowHours === w.hours
                    ? 'border-primary bg-primary/10 text-primary-ink'
                    : 'border-border bg-surface text-muted hover:text-content',
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn-primary mt-5 inline-flex"
            disabled={generate.isPending}
            onClick={runGenerate}
          >
            {generate.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Newspaper className="h-4 w-4" />
            )}
            {generate.isPending ? 'Researching latest changes…' : 'Generate briefing'}
          </button>
          <p className="mt-3 text-[11px] text-faint">
            Uses your Gemini key. Only cited updates are saved in the briefing.
          </p>
          {generate.isError && (
            <p className="mt-3 text-[12px] text-negative">
              {generate.error instanceof Error
                ? generate.error.message
                : 'The hunt failed — try again.'}
            </p>
          )}
        </div>
      )}

      {/* ── A briefing exists ── */}
      {supported && baked.baked && active && (
        <>
          <BriefingReport
            view={toBriefingView(active)}
            actions={
              <>
                <button
                  type="button"
                  onClick={() => setShareOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content transition-colors hover:bg-surface-2"
                  title="Share this briefing and its evidence cards"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Share
                </button>
                <button
                  type="button"
                  onClick={runGenerate}
                  disabled={generate.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content transition-colors hover:bg-surface-2"
                  title={`Research the last ${windowHours}h again`}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', generate.isPending && 'animate-spin')} />
                  {generate.isPending ? 'Researching…' : 'New briefing'}
                </button>
              </>
            }
          />

          {/* Archive — every briefing is kept; the deck accumulates its mornings. */}
          {list.length > 1 && (
            <div className="brf-no-print mx-auto mt-8 max-w-3xl">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
                Past briefings
              </h3>
              <ul className="flex flex-wrap gap-2">
                {list.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveId(b.id);
                      }}
                      aria-pressed={active.id === b.id}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
                        active.id === b.id
                          ? 'border-primary bg-primary/10 text-primary-ink'
                          : 'border-border bg-surface text-muted hover:text-content',
                      )}
                    >
                      {new Date(b.generatedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}{' '}
                      · {b.updates.length} update{b.updates.length === 1 ? '' : 's'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* The share dialog packages the briefing and its evidence cards. */}
      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        title={active ? `${active.marketName} — Daily Briefing` : 'Daily Briefing'}
        subtitle={active ? new Date(active.generatedAt).toLocaleDateString() : null}
        build={async () => buildShare()}
      />
    </div>
  );
}
