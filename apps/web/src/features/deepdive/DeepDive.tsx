/**
 * AI Research Panel — docked conversation.
 *
 * Instead of an overlay/modal, the AI panel docks to the right side of the
 * app layout, sharing the screen width with the main content (like Shopify's
 * Sidekick). The panel slides in/out and the main content area flexes to
 * accommodate it.
 *
 * Grounding contract (non-negotiable): answers come from the deck's stored
 * research plus a fresh Google Search — never from model memory.
 */
import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowUp,
  ExternalLink,
  FilePlus2,
  FileText,
  Layers,
  MessageCircle,
  PanelRight,
  PictureInPicture2,
  X,
  Paperclip,
  MessagesSquare,
} from 'lucide-react';
import { publisherOf, type Citation, type DeepDiveInput, type ResearchScope, type ResearchThread } from '@mi/contracts';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { useCards, useCompany, useReports } from '@/hooks/data';
import { cn } from '@/lib/cn';
import { MicButton } from '@/components/ui/MicButton';
import { Logo } from '@/features/card/Logo';

type PanelMode = 'locked' | 'floating';

const WIDTH_MIN = 340;
const WIDTH_MAX = 760;
const WIDTH_DEFAULT = 400;

// localStorage throws in sandboxed iframes (no allow-same-origin) and in some
// private-browsing modes, so every access is guarded — matching theme.ts.
function safeGetItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSetItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* sandboxed iframe / private mode — preference simply won't persist */
  }
}

function readStoredMode(): PanelMode {
  return safeGetItem('deepdive:mode') === 'floating' ? 'floating' : 'locked';
}
function readStoredWidth(): number {
  const v = Number(safeGetItem('deepdive:width'));
  return Number.isFinite(v) && v >= WIDTH_MIN && v <= WIDTH_MAX ? v : WIDTH_DEFAULT;
}

/** Track whether we're at the sm+ breakpoint (panel docks) vs mobile (full-screen). */
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 640px)').matches
      : true,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 640px)');
    const on = () => setDesktop(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return desktop;
}

function useCurrentRoute(): { isStartingPage: boolean } {
  const [hash, setHash] = useState(() => (typeof window !== 'undefined' ? window.location.hash : ''));
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const isStart =
    !hash ||
    hash === '#/' ||
    hash.startsWith('#/new') ||
    path === '/' ||
    path === '/new';

  return { isStartingPage: isStart };
}

/** Rotating status phrases shown inside the assistant "typing" bubble. */
const THINKING_PHASES = [
  'Searching the web…',
  'Reading sources…',
  'Cross-checking claims…',
  'Drafting the answer…',
] as const;

function useThinkingPhase(active: boolean): string {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) {
      setIndex(0);
      return;
    }
    const id = setInterval(() => setIndex((i) => (i + 1) % THINKING_PHASES.length), 2200);
    return () => clearInterval(id);
  }, [active]);
  return THINKING_PHASES[index]!;
}

/** Assistant-bubble-shaped "typing" indicator — bouncing dots + cycling status text. */
function TypingBubble({ active }: { active: boolean }) {
  const phase = useThinkingPhase(active);
  return (
    <div className="flex justify-start py-1">
      <div className="flex max-w-[85%] items-center gap-2 rounded-2xl rounded-bl-md bg-surface-2 px-3 py-2.5">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.2s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.1s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
        </span>
        <span className="text-[12.5px] text-muted">{phase}</span>
      </div>
    </div>
  );
}

interface ChatOptions {
  seed?: string;
  placeholder?: string;
}

interface DeepDiveContextValue {
  open: (input: DeepDiveInput) => void;
  chat: (scope: ResearchScope, opts?: ChatOptions) => void;
  openThread: (threadId: string) => void;
  /** Close the AI panel. Called by AppShell on route changes. */
  closePanel: () => void;
  /** Whether the AI panel is currently open — used by AppShell to adjust layout. */
  isOpen: boolean;
  /** Display mode: docked (locked) or overlay (floating). */
  mode: PanelMode;
  setMode: (m: PanelMode) => void;
  /** Current panel width in px. */
  width: number;
  /** Horizontal space the main content should reserve (0 unless locked + open on desktop). */
  pushWidth: number;
  /** Company currently anchored to the open chat (for "In chat" card badges). */
  attachedCompanyId: string | null;
  /** Card ids currently anchored to the open chat (comparison sets). */
  attachedCardIds: string[];
}

const DeepDiveContext = createContext<DeepDiveContextValue | null>(null);

export function useDeepDive(): DeepDiveContextValue {
  const ctx = useContext(DeepDiveContext);
  if (!ctx) throw new Error('useDeepDive must be used within a DeepDiveProvider');
  return ctx;
}

function SourceChips({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {citations.slice(0, 6).map((c, i) => (
        <a
          key={i}
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[10.5px] text-muted hover:border-primary/50 hover:text-primary-ink"
          title={c.url}
        >
          <ExternalLink className="h-2.5 w-2.5" />
          {publisherOf(c.url, c.title)}
        </a>
      ))}
      {citations.length > 6 && (
        <span className="text-[10.5px] text-faint">+{citations.length - 6} more</span>
      )}
    </div>
  );
}

/**
 * Lightweight provider for tests — no panel UI, just the context so consumers
 * (useDeepDive, DigDeeper) don't throw. The production app uses
 * DeepDiveProviderWithPanel instead.
 */
export function DeepDiveProvider({ children }: { children: ReactNode }) {
  const noop = () => {};
  return (
    <DeepDiveContext.Provider
      value={{
        open: noop,
        chat: noop,
        openThread: noop,
        closePanel: noop,
        isOpen: false,
        mode: 'locked',
        setMode: noop,
        width: WIDTH_DEFAULT,
        pushWidth: 0,
        attachedCompanyId: null,
        attachedCardIds: [],
      }}
    >
      {children}
    </DeepDiveContext.Provider>
  );
}

/**
 * Full provider with the docked AI conversation panel. Used by main.tsx.
 * The panel is fixed-positioned at the right edge; AppShell reads `isOpen`
 * and applies a right margin so the main content area shrinks to accommodate.
 */
export function DeepDiveProviderWithPanel({ children }: { children: ReactNode }) {
  const repo = useRepository();
  const qc = useQueryClient();
  const conversational = typeof repo.askResearch === 'function';
  const { isStartingPage } = useCurrentRoute();

  const [openState, setOpenState] = useState(false);
  const [scope, setScope] = useState<ResearchScope | null>(null);
  const [thread, setThread] = useState<ResearchThread | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placeholder, setPlaceholder] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState('');
  // Pinned context: reports/conversations attached to THIS chat. They ride
  // along with every question as the grounding's main focus.
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachedReportIds, setAttachedReportIds] = useState<string[]>([]);
  const [attachedThreadIds, setAttachedThreadIds] = useState<string[]>([]);
  const reportsQuery = useReports();
  const threadsQuery = useQuery({
    queryKey: ['researchThreads', 'attachable'],
    queryFn: () => repo.listResearchThreads!(),
    enabled: attachOpen && typeof repo.listResearchThreads === 'function',
  });
  const [savingReport, setSavingReport] = useState(false);
  const [reportFocus, setReportFocus] = useState('');
  const [showReportForm, setShowReportForm] = useState(false);

  // ── Layout preferences (persisted) ──
  const isDesktop = useIsDesktop();
  const [mode, setModeState] = useState<PanelMode>(readStoredMode);
  const [width, setWidth] = useState<number>(readStoredWidth);
  const setMode = (m: PanelMode) => {
    setModeState(m);
    safeSetItem('deepdive:mode', m);
  };

  // Drag-to-resize the panel from its left edge. Because the panel is docked to
  // the right, width grows as the cursor moves left (viewportWidth - clientX).
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    let latest = width;
    const onMove = (ev: MouseEvent) => {
      latest = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, window.innerWidth - ev.clientX));
      setWidth(latest);
    };
    const onUp = () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      safeSetItem('deepdive:width', String(Math.round(latest)));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [thread?.messages.length, busy]);

  // Conversation starters: quick ways in, so the chat feels like a
  // conversation you steer rather than a research job that fires instantly.
  const starters: string[] =
    scope?.kind === 'company' || scope?.kind === 'datapoint'
      ? [
          `What changed for ${scope?.subject ?? 'this company'} in the last 90 days?`,
          'How do they make money — and how durable is it?',
          'Who are their most direct competitors, and where do they lose?',
          'What are the biggest risks ahead?',
        ]
      : scope?.kind === 'cards'
        ? [
            'Compare these head-to-head: strengths, weaknesses, momentum.',
            'Which of these would you back, and why?',
            'What do these players all miss that a new entrant could take?',
          ]
        : [
            'Who is winning this market right now, and why?',
            "Where's the whitespace a new entrant could take?",
            'What moved in this market in the last month?',
            'Which players look overrated by the hype?',
          ];

  const reset = () => {
    setThread(null);
    setError(null);
    setShowReportForm(false);
    setReportFocus('');
    setDraft('');
    setAttachOpen(false);
    setAttachedReportIds([]);
    setAttachedThreadIds([]);
  };

  const ask = async (question: string, forScope: ResearchScope | null, threadId?: string) => {
    if (!repo.askResearch) return;
    setBusy(true);
    setError(null);
    try {
      const attachments =
        attachedReportIds.length > 0 || attachedThreadIds.length > 0
          ? { reportIds: attachedReportIds, threadIds: attachedThreadIds }
          : undefined;
      const t = await repo.askResearch(
        threadId
          ? { threadId, question, attachments }
          : { scope: forScope ?? undefined, question, attachments },
      );
      setThread(t);
      void qc.invalidateQueries({ queryKey: ['researchThreads'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const chat = (s: ResearchScope, opts?: ChatOptions) => {
    reset();
    setScope(s);
    setPlaceholder(opts?.placeholder);
    setOpenState(true);
    if (opts?.seed) void ask(opts.seed, s);
  };

  const openThread = (threadId: string) => {
    reset();
    setOpenState(true);
    setBusy(true);
    void repo
      .getResearchThread?.(threadId)
      .then((t) => {
        if (t) {
          setThread(t);
          setScope(t.scope);
        } else setError('That research thread was not found.');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const open = (input: DeepDiveInput) => {
    const s: ResearchScope = {
      kind: input.companyId ? 'datapoint' : 'deck',
      deckId: null,
      companyId: input.companyId,
      subject: input.topic,
    };
    const seed = `${input.topic}${input.context ? ` — ${input.context}` : ''}${
      input.companyName ? ` (for ${input.companyName})` : ''
    }`;
    if (conversational) chat(s, { seed });
    else {
      reset();
      setScope(s);
      setOpenState(true);
      setBusy(true);
      void repo
        .deepDive(input)
        .then((r) => {
          setThread({
            id: 'oneshot',
            scope: s,
            title: input.topic,
            messages: [
              { id: 'q', role: 'user', text: seed, citations: [], at: new Date().toISOString() },
              { id: 'a', role: 'assistant', text: r.markdown, citations: r.citations, at: new Date().toISOString() },
            ],
            reportId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(false));
    }
  };

  const close = () => setOpenState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = draft.trim();
    if (!q || busy) return;
    setDraft('');
    void ask(q, scope, thread && thread.id !== 'oneshot' ? thread.id : undefined);
  };

  const saveReport = async () => {
    if (!repo.saveThreadAsReport || !thread || thread.id === 'oneshot') return;
    setSavingReport(true);
    setError(null);
    try {
      const report = await repo.saveThreadAsReport(thread.id, reportFocus.trim() || null);
      setThread({ ...thread, reportId: report.id });
      setShowReportForm(false);
      void qc.invalidateQueries({ queryKey: ['reports'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingReport(false);
    }
  };

  const scopeLabel =
    scope?.subject ??
    (scope?.kind === 'cards'
      ? `${scope.cardIds?.length ?? 0} selected cards`
      : scope?.kind === 'deck'
        ? 'This deck'
        : 'Research');
  const canConverse = conversational && thread?.id !== 'oneshot';
  const hasAnswer = (thread?.messages ?? []).some((m) => m.role === 'assistant');

  // Derived layout values shared with AppShell + the card grid.
  const pushWidth = openState && mode === 'locked' && isDesktop ? width : 0;
  const attachedCompanyId =
    openState && scope && (scope.kind === 'company' || scope.kind === 'datapoint')
      ? scope.companyId ?? null
      : null;
  const attachedCardIds = openState && scope?.kind === 'cards' ? scope.cardIds ?? [] : [];

  return (
    <DeepDiveContext.Provider
      value={{
        open,
        chat,
        openThread,
        closePanel: close,
        isOpen: openState,
        mode,
        setMode,
        width,
        pushWidth,
        attachedCompanyId,
        attachedCardIds,
      }}
    >
      {children}

      {/* Floating pill — in floating mode, when minimized on deck/workspace pages, a tap reopens the chat. */}
      {mode === 'floating' && !openState && scope && !isStartingPage && (
        <button
          type="button"
          onClick={() => setOpenState(true)}
          className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-fg shadow-lg transition-transform hover:scale-105"
          aria-label="Open AI chat"
          title="Open AI chat"
        >
          <MessageCircle className="h-5 w-5" />
        </button>
      )}

      {/* AI panel — docks (locked) or overlays (floating) at the right edge.
          AppShell reserves pushWidth as a right margin only in locked mode. */}
      <aside
        className={cn(
          'fixed right-0 top-0 z-40 flex h-full w-full flex-col border-l border-border bg-surface transition-transform duration-300 ease-out',
          openState ? 'translate-x-0' : 'translate-x-full',
          mode === 'floating' && 'shadow-2xl',
        )}
        style={isDesktop ? { width } : undefined}
        role="dialog"
        aria-label="AI Research"
        aria-hidden={!openState}
        // `inert` with aria-hidden: the closed panel slides off-screen but its
        // buttons stayed in the tab order — a keyboard user tabbed into an
        // invisible panel (axe: aria-hidden-focus). inert removes them from
        // focus AND from the a11y tree while the panel is closed.
        // (React's types predate `inert`; the DOM attribute is what matters.)
        {...({ inert: openState ? undefined : '' } as { inert?: string })}
      >
        {/* Drag handle (desktop only) */}
        {isDesktop && (
          <div
            onMouseDown={startResize}
            className="group absolute left-0 top-0 z-10 flex h-full w-2 -translate-x-1/2 cursor-col-resize items-center justify-center"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
          >
            <span className="h-full w-px bg-border transition-colors group-hover:bg-primary/60" />
          </div>
        )}

        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold text-content">
              {thread?.title ?? scopeLabel}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setMode(mode === 'locked' ? 'floating' : 'locked')}
              className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-content"
              aria-label={mode === 'locked' ? 'Float panel' : 'Dock panel'}
              title={mode === 'locked' ? 'Float panel (overlay)' : 'Dock panel (locked)'}
            >
              {mode === 'locked' ? <PictureInPicture2 className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
            </button>
            {canConverse && hasAnswer && repo.saveThreadAsReport && !thread?.reportId && (
              <button
                type="button"
                onClick={() => setShowReportForm((v) => !v)}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] text-muted hover:border-primary/50 hover:text-primary-ink"
              >
                <FilePlus2 className="h-3 w-3" /> Report
              </button>
            )}
            {thread?.reportId && (
              <Link
                to={`/reports/${thread.reportId}`}
                onClick={close}
                className="inline-flex items-center gap-1 rounded-lg border border-positive/40 bg-positive/10 px-2 py-1 text-[11px] text-positive"
              >
                <FileText className="h-3 w-3" /> Saved
              </Link>
            )}
            <button
              type="button"
              onClick={close}
              className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-content"
              aria-label="Close AI panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* In-context reference chips — shows exactly what the chat is anchored to. */}
        {scope && <ContextChips scope={scope} />}

        {showReportForm && (
          <div className="border-b border-border bg-surface-2 px-4 py-2.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted" htmlFor="report-focus">
              Report focus
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="report-focus"
                className="input flex-1 py-1.5 text-[13px]"
                placeholder={thread?.title ?? 'e.g. who is winning enterprise'}
                value={reportFocus}
                onChange={(e) => setReportFocus(e.target.value)}
              />
              <button type="button" className="btn-primary px-2.5 py-1 text-[11px]" onClick={() => void saveReport()} disabled={savingReport}>
                {savingReport ? 'Saving…' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {/* Conversation */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {(thread?.messages ?? []).length === 0 && !busy && !error && (
            <div className="flex flex-col items-center justify-center gap-4 py-10 text-center text-muted">
              <p className="text-[13px]">
                What would you like to dig into about{' '}
                <span className="font-medium text-content">{scopeLabel.toLowerCase()}</span>?
              </p>
              {conversational && (
                <div className="flex max-w-sm flex-wrap justify-center gap-2">
                  {starters.map((q) => (
                    <button
                      key={q}
                      type="button"
                      className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-[12px] text-muted transition-colors hover:border-primary/50 hover:text-primary-ink"
                      onClick={() => void ask(q, scope)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
              <p className="max-w-xs text-[11px] leading-relaxed text-faint">
                Or type your own below — every answer is grounded in this deck's research plus a
                fresh search.
              </p>
            </div>
          )}

          <div className="space-y-4">
            {(thread?.messages ?? []).map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-content/5 px-3 py-2 text-[13px] text-content">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="max-w-full">
                  <article className="markdown text-[13px]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                  </article>
                  <SourceChips citations={m.citations} />
                </div>
              ),
            )}
          </div>

          {busy && <TypingBubble active={busy} />}
          {error && (
            <div className="mt-4 rounded-lg border border-negative/40 bg-negative/10 p-3 text-[13px] text-negative">
              {error}
            </div>
          )}
        </div>

        {/* Pinned context — reports/conversations riding along with every question. */}
        {conversational && (attachedReportIds.length > 0 || attachedThreadIds.length > 0) && (
          <div className="flex flex-wrap gap-1.5 border-t border-border bg-surface-2/60 px-4 py-2">
            {attachedReportIds.map((id) => {
              const r = (reportsQuery.data ?? []).find((x) => x.id === id);
              return (
                <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary-ink">
                  <FileText className="h-3 w-3" />
                  <span className="max-w-[160px] truncate">{r?.title ?? 'Report'}</span>
                  <button type="button" aria-label="Detach report" onClick={() => setAttachedReportIds((l) => l.filter((x) => x !== id))}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
            {attachedThreadIds.map((id) => {
              const t = (threadsQuery.data ?? []).find((x) => x.id === id);
              return (
                <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary-ink">
                  <MessagesSquare className="h-3 w-3" />
                  <span className="max-w-[160px] truncate">{t?.title ?? 'Conversation'}</span>
                  <button type="button" aria-label="Detach conversation" onClick={() => setAttachedThreadIds((l) => l.filter((x) => x !== id))}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* Attachment picker */}
        {conversational && attachOpen && (
          <div className="max-h-56 overflow-y-auto border-t border-border bg-surface-2/80 px-4 py-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
              Attach as grounded context
            </p>
            {(reportsQuery.data ?? []).length === 0 && (threadsQuery.data ?? []).length === 0 && (
              <p className="text-[12px] text-faint">No reports or conversations yet — generate a report or finish a chat first.</p>
            )}
            <ul className="space-y-1">
              {(reportsQuery.data ?? []).slice(0, 8).map((r) => {
                const on = attachedReportIds.includes(r.id);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors ${on ? 'bg-primary/10 text-primary-ink' : 'text-content hover:bg-surface'}`}
                      onClick={() => setAttachedReportIds((l) => (on ? l.filter((x) => x !== r.id) : [...l, r.id].slice(-3)))}
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted" />
                      <span className="truncate">{r.title}</span>
                      {on && <span className="ml-auto text-[10px] font-semibold uppercase">attached</span>}
                    </button>
                  </li>
                );
              })}
              {(threadsQuery.data ?? [])
                .filter((t) => t.id !== thread?.id)
                .slice(0, 8)
                .map((t) => {
                  const on = attachedThreadIds.includes(t.id);
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors ${on ? 'bg-primary/10 text-primary-ink' : 'text-content hover:bg-surface'}`}
                        onClick={() => setAttachedThreadIds((l) => (on ? l.filter((x) => x !== t.id) : [...l, t.id].slice(-3)))}
                      >
                        <MessagesSquare className="h-3.5 w-3.5 shrink-0 text-muted" />
                        <span className="truncate">{t.title}</span>
                        {on && <span className="ml-auto text-[10px] font-semibold uppercase">attached</span>}
                      </button>
                    </li>
                  );
                })}
            </ul>
          </div>
        )}

        {/* Composer */}
        {conversational && (
          <form onSubmit={submit} className="border-t border-border px-4 py-3">
            <div className="flex items-end gap-1.5 rounded-2xl border border-border bg-surface-2 px-2 py-1.5">
              <button
                type="button"
                onClick={() => setAttachOpen((v) => !v)}
                aria-pressed={attachOpen}
                className={`mb-0.5 rounded-lg p-1.5 transition-colors ${attachOpen || attachedReportIds.length > 0 || attachedThreadIds.length > 0 ? 'text-primary-ink' : 'text-muted hover:text-content'}`}
                title="Attach a report or conversation — its findings become the grounded focus of this chat"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <textarea
                className="max-h-28 min-h-[32px] flex-1 resize-none bg-transparent px-1 py-1 text-[13px] text-content placeholder:text-faint focus:outline-none"
                rows={1}
                placeholder={placeholder ?? 'Ask a question…'}
                aria-label="Ask a research question"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit(e);
                  }
                }}
              />
              <MicButton onTranscript={(text) => setDraft((d) => (d ? `${d} ${text}` : text))} disabled={busy} />
              <button
                type="submit"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-fg transition-opacity disabled:opacity-40"
                disabled={!draft.trim() || busy}
                aria-label="Send"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
          </form>
        )}
      </aside>
    </DeepDiveContext.Provider>
  );
}

/** A single reference chip: small logo/icon + label. */
function RefChip({ label, sub, logo }: { label: string; sub?: string | null; logo?: ReactNode }) {
  return (
    <span className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-border bg-surface-2 py-0.5 pl-1 pr-2 text-[11px] text-content">
      <span className="grid h-4 w-4 shrink-0 place-items-center overflow-hidden rounded-[4px] bg-surface">
        {logo ?? <Layers className="h-2.5 w-2.5 text-muted" />}
      </span>
      <span className="truncate font-medium">{label}</span>
      {sub && <span className="truncate text-faint">· {sub}</span>}
    </span>
  );
}

function ChipRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface px-4 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">In context</span>
      {children}
    </div>
  );
}

function CompanyChip({ companyId, subject }: { companyId: string; subject: string | null }) {
  const company = useCompany(companyId).data;
  const name = company?.name ?? subject ?? 'Company';
  const sub = company && subject && subject !== company.name ? subject : null;
  return (
    <RefChip
      label={name}
      sub={sub}
      logo={
        company ? (
          <Logo name={company.name} website={company.websiteUrl} logoUrl={company.logoUrl} className="h-full w-full" />
        ) : undefined
      }
    />
  );
}

function CardsChips({ deckId, cardIds }: { deckId: string; cardIds: string[] }) {
  const cards = useCards(deckId).data ?? [];
  const wanted = new Set(cardIds);
  const matched = cards.filter((c) => wanted.has(c.card.id));
  const shown = matched.slice(0, 6);
  return (
    <ChipRow>
      {shown.map((c) => (
        <RefChip
          key={c.card.id}
          label={c.company?.name ?? c.card.title ?? 'Card'}
          logo={
            c.company ? (
              <Logo name={c.company.name} website={c.company.websiteUrl} logoUrl={c.company.logoUrl} className="h-full w-full" />
            ) : undefined
          }
        />
      ))}
      {matched.length > shown.length && (
        <span className="text-[11px] text-faint">+{matched.length - shown.length} more</span>
      )}
      {matched.length === 0 && <span className="text-[11px] text-faint">{cardIds.length} cards</span>}
    </ChipRow>
  );
}

/** Renders the reference chips appropriate to the current chat scope. */
function ContextChips({ scope }: { scope: ResearchScope }) {
  if (scope.kind === 'cards' && scope.deckId) {
    return <CardsChips deckId={scope.deckId} cardIds={scope.cardIds ?? []} />;
  }
  if ((scope.kind === 'company' || scope.kind === 'datapoint') && scope.companyId) {
    return (
      <ChipRow>
        <CompanyChip companyId={scope.companyId} subject={scope.subject ?? null} />
      </ChipRow>
    );
  }
  // Deck-level or topic-only fallback.
  return (
    <ChipRow>
      <RefChip label={scope.subject ?? 'This deck'} />
    </ChipRow>
  );
}

/**
 * ONE chat bubble per surface — the consolidation of what used to be clusters
 * of anonymous chat circles (three side by side on the Overview tab alone).
 * A single labeled button opens a menu of the surface's curated dig topics
 * plus a free-form option, so "engage the AI about this" keeps its power with
 * exactly one entry point.
 */
export function DigDeeperMenu({
  topics,
  companyId,
  companyName,
  label = 'Ask AI about this',
  className,
}: {
  topics: string[];
  companyId: string | null;
  companyName: string;
  label?: string;
  className?: string;
}) {
  const { open: openDig, chat } = useDeepDive();
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

  return (
    <div ref={ref} className={cn('relative inline-block', className)}>
      {/* Icon-only by design (founder: "no Dig Deeper — just a little chat icon"). */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label={label}
        title={label}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors hover:border-primary/50 hover:text-primary-ink"
      >
        <MessageCircle className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-border bg-surface p-1 shadow-card"
          onClick={(e) => e.stopPropagation()}
        >
          {topics.map((topic) => (
            <button
              key={topic}
              type="button"
              className="flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-content hover:bg-surface-2"
              onClick={() => {
                setOpen(false);
                openDig({ topic, companyId, companyName, context: null });
              }}
            >
              <MessageCircle className="mt-0.5 h-3 w-3 shrink-0 text-muted" />
              {topic}
            </button>
          ))}
          <button
            type="button"
            className="flex w-full items-start gap-2 rounded-md border-t border-border px-2.5 py-1.5 text-left text-[12px] font-medium text-primary-ink hover:bg-surface-2"
            onClick={() => {
              setOpen(false);
              chat(
                { kind: 'company', deckId: null, companyId, subject: companyName },
                { placeholder: `Ask anything about ${companyName}…` },
              );
            }}
          >
            <MessageCircle className="mt-0.5 h-3 w-3 shrink-0" />
            Ask your own question…
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * AI affordance icon — replaces the old "Shovel" with a MessageCircle icon.
 * Appears beside data points everywhere, so it stays quiet.
 */
export function DigDeeper({
  topic,
  companyId,
  companyName,
  context,
  className,
  label = 'Ask AI',
}: {
  topic: string;
  companyId: string | null;
  companyName: string;
  context?: string | null;
  className?: string;
  label?: string;
}) {
  const { open } = useDeepDive();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        open({ topic, companyId, companyName, context: context ?? null });
      }}
      className={cn(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors hover:border-primary/50 hover:text-primary',
        className,
      )}
      aria-label={label}
      title={label}
    >
      <MessageCircle className="h-3 w-3" />
    </button>
  );
}
