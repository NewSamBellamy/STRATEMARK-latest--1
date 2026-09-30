/**
 * New deck — conversational creation flow.
 *
 * Research session state lives in a Zustand store (research-session.ts) so it
 * survives navigation. The user can click "Decks", browse, and come back to
 * "New Deck" — the running session is still here.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowUp, ChevronDown, Cloud, Globe2, Cpu } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import { runCloudResearchDeck } from '@/lib/sentinelApi';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { useApiKey } from '@/lib/settings/apiKey';
import { useEngineChoice, type EngineChoice } from '@/lib/settings/engine';
import { cn } from '@/lib/cn';
import logoMark from '@/assets/logo-mark.svg';
import { MicButton } from '@/components/ui/MicButton';
import { NotificationToast } from '@/components/ui/NotificationToast';
import { SettingsLink } from '@/components/SettingsLink';
import { isCommunityDesktop } from '@/lib/settings/runtime';
import { useResearchSession } from './research-session';
import { ResearchStage, type LogLine } from './ResearchStage';
import { qk } from '@/lib/query/keys';

const SUGGESTIONS = [
  'Christian apparel companies',
  'AI code-review startups',
  'Non-alcoholic spirits brands',
  'Precision fermentation companies',
  'Direct-to-consumer pet food',
  'Vertical farming startups',
];

const REGIONS = [
  'Global',
  'North America',
  'United States',
  'Europe',
  'United Kingdom',
  'Asia Pacific',
  'Latin America',
  'Middle East & Africa',
  'California, USA',
  'New York, USA',
  'Southeast Asia',
  'India',
  'China',
  'Australia & NZ',
  'DACH (Germany, Austria, Switzerland)',
  'Nordics',
];

const STAGE_LABELS: Record<string, string> = {
  scope: 'Understanding the market…',
  catalog: 'Cataloging the market…',
  summary: 'Researching company cards…',
  metrics: 'Sourcing metrics…',
  signals: 'Researching market signals…',
  dashboard: 'Preparing company dashboards…',
};

// ── Region picker ────────────────────────────────────────────────────────────

function RegionPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const hasValue = value.trim().length > 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors',
          hasValue
            ? 'border-primary/30 bg-primary/5 text-primary-ink'
            : 'border-border text-muted hover:border-content/20 hover:text-content',
        )}
      >
        <Globe2 className="h-3 w-3" />
        {hasValue ? value : 'Region'}
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-56 max-h-64 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-card">
          {REGIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                onChange(r === 'Global' ? '' : r);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors',
                value === r || (r === 'Global' && !hasValue)
                  ? 'bg-surface-2 font-medium text-content'
                  : 'text-muted hover:bg-surface-2 hover:text-content',
              )}
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EnginePicker({
  value,
  onChange,
  isPro,
  disabled,
}: {
  value: EngineChoice;
  onChange: (e: EngineChoice) => void;
  isPro: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  if (isCommunityDesktop()) return null;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1.5 rounded-full border border-border/80 px-2.5 py-1 text-xs font-medium transition-colors hover:border-border hover:bg-surface-2',
          value === 'cloud'
            ? 'border-primary/30 bg-primary/10 text-primary-ink font-semibold'
            : 'bg-surface-2/60 text-content-muted',
        )}
      >
        {value === 'cloud' ? (
          <>
            <Cloud className="h-3 w-3 text-primary-ink" />
            <span>Sentinel Cloud</span>
          </>
        ) : (
          <>
            <Cpu className="h-3 w-3 text-muted" />
            <span>Local Engine</span>
          </>
        )}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {open && (
        <div className="absolute left-0 bottom-full z-30 mb-1.5 w-60 rounded-xl border border-border bg-surface p-1.5 shadow-elevated text-xs">
          <button
            type="button"
            onClick={() => {
              onChange('local');
              setOpen(false);
            }}
            className={cn(
              'flex w-full items-start gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-surface-2',
              value === 'local' && 'bg-surface-2 font-medium',
            )}
          >
            <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
            <div>
              <div className="font-medium text-content">Local Engine</div>
              <div className="text-[11px] text-faint">In-browser Gemini API processing</div>
            </div>
          </button>

          <button
            type="button"
            disabled={!isPro}
            onClick={() => {
              if (isPro) {
                onChange('cloud');
                setOpen(false);
              }
            }}
            className={cn(
              'flex w-full items-start gap-2.5 rounded-lg p-2 text-left transition-colors',
              isPro ? 'hover:bg-surface-2 cursor-pointer' : 'opacity-50 cursor-not-allowed',
              value === 'cloud' && 'bg-primary/10 font-medium text-primary-ink',
            )}
          >
            <Cloud className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-ink" />
            <div>
              <div className="flex items-center justify-between gap-1 text-content font-medium">
                <span>Sentinel Cloud Agent</span>
                {!isPro && (
                  <span className="rounded bg-primary/10 px-1 py-0.2 text-[9px] font-semibold text-primary-ink">
                    Pro
                  </span>
                )}
              </div>
              <div className="text-[11px] text-faint">Cloud Run + 24/7 CourtListener Scraper</div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}

function InputPill({
  prompt,
  setPrompt,
  region,
  setRegion,
  engine,
  setEngine,
  isPro,
  onSubmit,
  disabled,
  hasKey,
  showHint,
}: {
  prompt: string;
  setPrompt: (v: string) => void;
  region: string;
  setRegion: (v: string) => void;
  engine: EngineChoice;
  setEngine: (v: EngineChoice) => void;
  isPro: boolean;
  onSubmit: (e: FormEvent) => void;
  disabled: boolean;
  hasKey: boolean;
  showHint: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="w-full max-w-2xl">
      <div className="rounded-2xl border border-border bg-surface p-3 shadow-soft">
        <textarea
          className="w-full resize-none border-0 bg-transparent text-[15px] text-content placeholder:text-faint focus:outline-none"
          rows={1}
          placeholder="Describe a market…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void onSubmit(e);
            }
          }}
          disabled={disabled}
          autoFocus
        />
        <div className="mt-1.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RegionPicker value={region} onChange={setRegion} disabled={disabled} />
            <EnginePicker value={engine} onChange={setEngine} isPro={isPro} disabled={disabled} />
          </div>
          <div className="flex items-center gap-1.5">
            <MicButton
              onTranscript={(text) => setPrompt(prompt ? `${prompt} ${text}` : text)}
              disabled={disabled}
            />
            <button
              type="submit"
              disabled={!prompt.trim() || disabled}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-fg transition-opacity disabled:opacity-30"
              aria-label="Research this market"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      {showHint && !hasKey && (
        <p className="mt-2 text-center text-[11px] text-faint">
          <span>
            <SettingsLink className="text-primary-ink hover:underline">
              Add Gemini API key
            </SettingsLink>{' '}
            in Settings for live Google grounded research.
          </span>
        </p>
      )}
    </form>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

function timeLabel(): string {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function NewDeckPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const repo = useRepository();
  const { user, getToken } = useAuth();
  const isPro = user?.subscriptionTier === 'pro';
  const hasKey = useApiKey((s) => s.hasKey);

  const [prompt, setPrompt] = useState('');
  const [region, setRegion] = useState('');
  const { engine, setEngine } = useEngineChoice();

  useEffect(() => {
    if (user && !localStorage.getItem('mi.researchEngine')) {
      setEngine('cloud');
    }
  }, [user, setEngine]);

  // Session from the store — survives navigation
  const session = useResearchSession((s) => s.session);
  const startSession = useResearchSession((s) => s.startSession);
  const addLog = useResearchSession((s) => s.addLog);
  const addFound = useResearchSession((s) => s.addFound);
  const finish = useResearchSession((s) => s.finish);
  const fail = useResearchSession((s) => s.fail);
  const clear = useResearchSession((s) => s.clear);

  useEffect(() => {
    if (session && !session.running) clear();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const liveLines = useMemo<LogLine[]>(
    () =>
      (session?.logLines ?? []).map((message, index) => ({
        message,
        kind: /error|failed|warning|could not/i.test(message)
          ? 'warn'
          : /^(found|discovered|added)|verified|built/i.test(message)
            ? 'find'
            : 'step',
        at: index,
      })),
    [session?.logLines],
  );

  // Honest demo gate: without a key (and outside the cloud engine), "research"
  // would be pure theater — the mock transport returns the built-in SAMPLE deck
  // renamed to whatever was typed. A user asking for "frontier ai labs" got
  // Christian-apparel sample companies wearing an AI-labs title, under a "Live
  // research" pill. Never fake research: say what demo mode is, link the fix.
  const [demoGate, setDemoGate] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const q = prompt.trim();
    if (!q || session?.running) return;

    if (engine !== 'cloud' && !hasKey) {
      setDemoGate(true);
      return;
    }
    setDemoGate(false);

    const regionStr = region.trim();
    const userText = regionStr ? `${q} — ${regionStr}` : q;

    startSession(userText, timeLabel());
    setPrompt('');
    setRegion('');

    if (engine === 'cloud') {
      try {
        let targetCompanies = 10;
        try {
          const raw = Number(localStorage.getItem('mi.targetCompanies'));
          if (Number.isFinite(raw) && raw >= 2 && raw <= 30) targetCompanies = raw;
        } catch {
          /* opaque origin — keep default */
        }

        addLog('Connecting to Sentinel Cloud Agent…', { stage: 'interpret' });
        const authToken = await getToken();
        const res = await runCloudResearchDeck(q, regionStr || null, targetCompanies, authToken);
        const market =
          res.market ||
          res.result?.market ||
          (res.deckId ? { id: res.deckId } : null) ||
          (res.deck?.marketId ? { id: res.deck.marketId as string } : null) ||
          (res.deck?.id ? { id: res.deck.id as string } : null);
        if (res.ok && market && (market as { id?: string }).id) {
          const m = market as { id: string };
          if (
            'cacheCloudDeckResponse' in repo &&
            typeof repo.cacheCloudDeckResponse === 'function'
          ) {
            (repo as { cacheCloudDeckResponse: (r: typeof res) => void }).cacheCloudDeckResponse(
              res,
            );
          }
          const cardCount =
            res.cards?.length || res.candidates?.length || res.result?.cards?.length || 0;
          finish(`/markets/${m.id}/deck`, cardCount);
          // The deck exists NOW — every deck list refetches immediately.
          void qc.invalidateQueries({ queryKey: qk.markets });
          navigate(`/markets/${m.id}/deck`);
          return;
        } else {
          const errMsg = res.error || 'Sentinel Cloud Agent failed to create deck.';
          addLog('Sentinel Cloud Agent error: ' + errMsg);
          fail(errMsg);
          return;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        addLog('Sentinel Cloud Agent request failed: ' + errMsg);
        fail('Sentinel Cloud Agent error: ' + errMsg);
        return;
      }
    }

    let cardCount = 0;
    let listedEarly = false;
    try {
      const { market } = await repo.createResearchedDeck(
        { prompt: q, region: regionStr || null },
        {
          onProgress: (p) => {
            if (p.message) {
              addLog(p.message, { stage: p.stage ?? null, progress: p.progress ?? null });
              if (p.kind === 'find') cardCount++;
            }
            // The market row is born early in the pipeline — refetch the deck
            // lists ONCE so the new deck appears in "recent decks" while the
            // research is still running (the filmed "my deck isn't here" bug).
            if (!listedEarly && (p.card || p.kind === 'find')) {
              listedEarly = true;
              void qc.invalidateQueries({ queryKey: qk.markets });
            }
            // Stream every discovery onto the screen the moment it happens.
            if (p.card?.company?.name) {
              addFound([p.card.company.name]);
            } else if (p.kind === 'find' && p.message.includes('entities:')) {
              const list = p.message.split('entities:')[1] ?? '';
              addFound(
                list
                  .replace(/…$/, '')
                  .split(',')
                  .map((n) => n.trim())
                  .filter((n) => n.length > 1 && n.length < 60),
              );
            }
          },
        },
      );
      finish(`/markets/${market.id}/deck`, cardCount);
      // Belt & braces: the finished deck must be in every list before we land on it.
      void qc.invalidateQueries({ queryKey: qk.markets });
      navigate(`/markets/${market.id}/deck`);
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Research failed.');
    }
  };

  const hasSession = session !== null;
  const running = session?.running ?? false;

  return (
    <div className="relative flex min-h-full flex-col">
      {/* Floating System Notification at Top */}
      {demoGate && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4 transition-all duration-300 animate-in fade-in slide-in-from-top-4">
          <NotificationToast
            variant="warning"
            title="Gemini API Key Required"
            description={
              <span>
                Grounded research runs on your own key — nothing here is ever faked.{' '}
                <SettingsLink className="font-semibold underline hover:opacity-80">
                  Add your key in Settings
                </SettingsLink>{' '}
                (free tier works), then come back and run “{prompt.trim() || 'this market'}” for
                real.
              </span>
            }
            onClose={() => setDemoGate(false)}
          />
        </div>
      )}

      {/* Main content area */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
        {!hasSession ? (
          /* ── Empty state ── */
          <div className="w-full max-w-2xl pb-24">
            <div className="mb-6">
              <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-primary-ink">
                Market research
              </p>
              <div className="flex items-center gap-2.5">
                <img src={logoMark} alt="Stratemark" className="h-8 w-8" />
                <span className="font-display text-lg font-bold tracking-tight text-content">
                  Stratemark
                </span>
              </div>
              <h1 className="mt-2 font-display text-2xl font-semibold text-content md:text-3xl">
                Research any market. Understand every company.
              </h1>
              <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted">
                Start with a market question. Stratemark finds the companies, records sourced
                figures, and builds a research deck you can keep investigating.
              </p>
            </div>

            <div className="mb-6 w-full">
              <InputPill
                prompt={prompt}
                setPrompt={setPrompt}
                region={region}
                setRegion={setRegion}
                engine={engine}
                setEngine={setEngine}
                isPro={isPro || !!user}
                onSubmit={onSubmit}
                disabled={running}
                hasKey={hasKey}
                showHint={true}
              />
            </div>

            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[.16em] text-faint">
              Try a market
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setPrompt(ex)}
                  className="rounded-full border border-border bg-surface px-4 py-2 text-[13px] text-muted transition-colors hover:border-content/20 hover:bg-surface-2 hover:text-content"
                >
                  {ex}
                </button>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 text-[11px] text-muted">
              <span>Grounded Google research</span>
              <span>Evidence and unknowns stay visible</span>
              <span>Your research stays on your machine</span>
            </div>
          </div>
        ) : (
          /* ── Active / completed session ── */
          <div className="w-full max-w-2xl pb-28 pt-8">
            {/* User message */}
            <div className="flex justify-end">
              <div>
                <div className="mb-1 text-right text-[11px] text-faint">{session.time}</div>
                <div className="rounded-2xl rounded-br-md bg-content/5 px-4 py-2.5 text-[14px] text-content">
                  {session.query}
                </div>
              </div>
            </div>

            {/* AI status card */}
            <div className="mt-5">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-content">
                <img src={logoMark} alt="" className="h-4 w-4" />
                <span>Research desk</span>
              </div>

              {running && (
                <ResearchStage
                  lines={liveLines}
                  message={
                    (session.stage && STAGE_LABELS[session.stage]) ||
                    session.logLines.at(-1) ||
                    'Starting grounded research…'
                  }
                  pct={session.progress ?? 0}
                />
              )}

              {session.done && (
                <div className="rounded-xl border border-border bg-surface p-4">
                  <p className="text-[14px] text-content">
                    Your deck is ready —{' '}
                    {session.done.count > 0
                      ? `${session.done.count} cards built`
                      : 'cards are built'}
                    , with source receipts and evidence-aware size bands. Every company card has a
                    grounded researcher ready for your next question.
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    <Link
                      to={session.done.link}
                      className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13px] font-medium text-primary-fg transition-opacity hover:opacity-90"
                    >
                      View your deck <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                    <button
                      type="button"
                      onClick={clear}
                      className="text-[13px] text-muted hover:text-content"
                    >
                      New research
                    </button>
                  </div>
                </div>
              )}

              {session.error && (
                <div className="rounded-xl border border-negative/30 bg-negative/5 p-4">
                  <p className="text-[13px] text-negative">{session.error}</p>
                  <button
                    type="button"
                    onClick={clear}
                    className="mt-2 text-[13px] text-muted hover:text-content"
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Floating input pill */}
      {hasSession && !running && (
        <div
          className="sticky bottom-0 z-20 flex justify-center px-6 pb-5 pt-3"
          style={{ background: 'linear-gradient(transparent, rgb(var(--c-bg)) 40%)' }}
        >
          <InputPill
            prompt={prompt}
            setPrompt={setPrompt}
            region={region}
            setRegion={setRegion}
            engine={engine}
            setEngine={setEngine}
            isPro={isPro || !!user}
            onSubmit={onSubmit}
            disabled={running}
            hasKey={hasKey}
            showHint={false}
          />
        </div>
      )}
    </div>
  );
}
