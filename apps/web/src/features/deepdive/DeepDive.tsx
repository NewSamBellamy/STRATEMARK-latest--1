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
import { sourceHref } from '@/lib/sourceHref';
import { SafeMarkdown } from '@/components/ResearchMarkdown';
import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowUp,
  ExternalLink,
  FileText,
  Layers,
  MessageCircle,
  PanelRight,
  PictureInPicture2,
  X,
  Paperclip,
  MessagesSquare,
  History,
  Plus,
} from 'lucide-react';
import { publisherOf, type Citation, type DeepDiveInput, type ResearchScope, type ResearchThread } from '@mi/contracts';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { useCards, useCompany, useReports } from '@/hooks/data';
import { cn } from '@/lib/cn';
import { MicButton } from '@/components/ui/MicButton';
import { Logo } from '@/features/card/Logo';
import { useApiKey } from '@/lib/settings/apiKey';
import { useSettingsModal } from '@/lib/settings/settingsModal';
import { ExportMenu } from '@/features/export/ExportMenu';
import { ReportWizard } from '@/features/reports/ReportWizard';
import { useCompanyReportRun } from '@/features/reports/useCompanyReportRun';
import { splitFollowUps } from './followUps';
import { AskOrb } from './AskOrb';
import { CardThumbStrip } from './CardThumbs';
import { resolveOrbScope } from './orbScope';
import { PanelHistory, sortThreadsNewest, type MemoryKey } from './PanelHistory';
import logoMark from '@/assets/logo-mark.svg';
import { useSupports } from '@/lib/repository/RepositoryProvider';

type PanelMode = 'locked' | 'floating';

/** A question asked this soon after a conversation's last turn is added to it; later ones start a new conversation. */
const CONTINUE_WITHIN_MS = 14 * 24 * 60 * 60 * 1000;

function lastTurnAt(thread: ResearchThread): number {
  const last = thread.messages[thread.messages.length - 1]?.at ?? thread.updatedAt;
  const ms = Date.parse(last);
  return Number.isFinite(ms) ? ms : Date.parse(thread.updatedAt);
}

/** Whether a question asked now still belongs to this conversation. */
function isRecentThread(thread: ResearchThread, now = Date.now()): boolean {
  const at = lastTurnAt(thread);
  return Number.isFinite(at) && now - at <= CONTINUE_WITHIN_MS;
}

/** What a scope's conversations hang on: one card, or (for a company card) its company. Several cards or a deck have none. */
function memoryKeyOf(s: ResearchScope | null): MemoryKey | null {
  if (!s) return null;
  if (s.cardIds?.length === 1) return { cardId: s.cardIds[0] };
  if ((s.kind === 'company' || s.kind === 'datapoint') && s.companyId) return { companyId: s.companyId };
  return null;
}

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

/**
 * Honest progress: what the engine is doing (one grounded search, then the
 * write-up) and how long it has taken — not a timer pretending to be steps.
 */
function useThinkingPhase(active: boolean): string {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [active]);
  const label = seconds < 45 ? 'Searching and reading sources' : 'Still working — deep questions can take a minute';
  return seconds < 3 ? `${label}…` : `${label} · ${seconds}s`;
}

/** Markdown tables (compare-two-companies answers) scroll sideways instead of overflowing the panel. */
const CHAT_MD_COMPONENTS = {
  table: ({ children }: { children?: ReactNode }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="border-b border-border bg-surface-2 px-2 py-1 text-left font-semibold text-content">{children}</th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="border-b border-border px-2 py-1 align-top">{children}</td>
  ),
};

/** Friendlier wording for the failures people actually hit. */
function chatErrorMessage(raw: string, hasKey: boolean): string {
  if (!hasKey || /api[ _-]?key|unauthori[sz]ed|permission_denied|\b40[13]\b/i.test(raw)) {
    return 'Chat needs a Gemini API key. Add yours in Settings and ask again - your question is still in the box.';
  }
  if (/\b429\b|quota|rate/i.test(raw)) return 'The research service is rate-limited right now. Wait a moment and send again.';
  return raw;
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
  /** Prefills the box (editable) without sending — a ready question to start from. */
  draft?: string;
  /** Start a new conversation on purpose instead of resuming the card's latest one. */
  newChat?: boolean;
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
          href={sourceHref(c.url, c.title)}
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
  const canSaveReport = useSupports('saveThreadAsReport');
  const qc = useQueryClient();
  const conversational = typeof repo.askResearch === 'function';
  const hasKey = useApiKey((st) => st.hasKey);
  const openSettings = useSettingsModal((st) => st.open);
  const location = useLocation();

  const [openState, setOpenState] = useState(false);
  const [scope, setScope] = useState<ResearchScope | null>(null);
  const [thread, setThread] = useState<ResearchThread | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placeholder, setPlaceholder] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState('');
  // The question in flight: shown as your bubble at once, restored to the box
  // if it fails so nothing you typed is lost.
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ question: string; scope: ResearchScope | null; threadId?: string } | null>(null);
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
  const [wizardOpen, setWizardOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Latest chat() call, so a slow lookup of the card's last conversation cannot land on a panel that moved on.
  const runRef = useRef(0);
  // A conversation picked from History on purpose keeps going whatever its age.
  const pickedRef = useRef<string | null>(null);
  const runCompanyReport = useCompanyReportRun();
  const reportCompanyName = useCompany(thread?.scope.companyId ?? undefined).data?.name ?? thread?.scope.subject ?? 'this company';

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
  }, [thread?.messages.length, busy, pending]);

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
    setWizardOpen(false);
    setDraft('');
    setPending(null);
    setFailed(null);
    setAttachOpen(false);
    setAttachedReportIds([]);
    setAttachedThreadIds([]);
    setHistoryOpen(false);
  };

  const ask = async (question: string, forScope: ResearchScope | null, threadId?: string, fresh?: boolean) => {
    if (!repo.askResearch) return;
    setHistoryOpen(false);
    setBusy(true);
    setError(null);
    setFailed(null);
    setPending(question);
    try {
      const attachments =
        attachedReportIds.length > 0 || attachedThreadIds.length > 0
          ? { reportIds: attachedReportIds, threadIds: attachedThreadIds }
          : undefined;
      const t = await repo.askResearch(
        threadId
          ? { threadId, question, attachments, ...(fresh ? { fresh: true } : {}) }
          : { scope: forScope ?? undefined, question, attachments, ...(fresh ? { fresh: true } : {}) },
      );
      setThread(t);
      void qc.invalidateQueries({ queryKey: ['researchThreads'] });
      void qc.invalidateQueries({ queryKey: ['cardMemory'] });
    } catch (e) {
      setError(chatErrorMessage(e instanceof Error ? e.message : String(e), hasKey));
      setFailed({ question, scope: forScope, threadId });
      setDraft((d) => (d.trim() ? d : question));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const chat = (s: ResearchScope, opts?: ChatOptions) => {
    // Reopening the same conversation keeps it: closing the panel is not
    // "start over". A seeded question or a different subject starts fresh.
    const same = scope && thread && thread.id !== 'oneshot' &&
      scope.kind === s.kind && scope.deckId === s.deckId && scope.companyId === s.companyId &&
      (scope.cardIds ?? []).join() === (s.cardIds ?? []).join();
    if (same && !opts?.seed) {
      setOpenState(true);
      return;
    }
    reset();
    pickedRef.current = null;
    const run = ++runRef.current;
    setScope(s);
    setPlaceholder(opts?.placeholder);
    if (opts?.draft) setDraft(opts.draft);
    setOpenState(true);
    const key = memoryKeyOf(s);
    if (!key || opts?.newChat || typeof repo.listResearchThreads !== 'function') {
      if (opts?.seed) void ask(opts.seed, s);
      return;
    }
    // A card remembers: reopen its latest conversation. A question asked soon after it is added to it; an older
    // conversation stays in History and the question starts a new one. Nothing here calls a model.
    void repo
      .listResearchThreads(key)
      .then((list) => {
        if (run !== runRef.current) return;
        const latest = sortThreadsNewest(list)[0];
        if (!latest) {
          if (opts?.seed) void ask(opts.seed, s);
        } else if (!opts?.seed) {
          setThread(latest);
        } else if (isRecentThread(latest)) {
          setThread(latest);
          void ask(opts.seed, s, latest.id);
        } else void ask(opts.seed, s);
      })
      .catch(() => {
        if (run === runRef.current && opts?.seed) void ask(opts.seed, s);
      });
  };

  /** Start a fresh conversation about the same subject, on purpose. */
  const newChat = () => {
    const s = scope;
    reset();
    pickedRef.current = null;
    runRef.current += 1;
    setScope(s);
  };

  /** The conversation a typed question belongs to: the open one, unless it has gone cold (opened from History on purpose excepted). */
  const threadIdFor = (t: ResearchThread | null): string | undefined =>
    t && t.id !== 'oneshot' && (t.id === pickedRef.current || isRecentThread(t)) ? t.id : undefined;

  const openThread = (threadId: string) => {
    reset();
    pickedRef.current = threadId;
    runRef.current += 1;
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
      // Completeness gate: before the report is served, the same readiness
      // pass the living deck uses (free recovery → structured lanes → one
      // hunt) takes its shot at the company's known gaps. Research failure
      // must never block the answer the user asked for.
      const readiness = input.companyId && repo.ensureReportReadiness
        ? repo.ensureReportReadiness([input.companyId]).catch(() => undefined)
        : Promise.resolve();
      void readiness
        .then(() => repo.deepDive(input))
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
          // A finished deep-dive is a finished product (red team #10): persist it
          // as a Report so "Saved" opens the full-page reader instead of leaving
          // long-form findings trapped in this panel.
          void repo.saveReport?.({
            kind: input.companyId ? 'company' : 'deck',
            subjectId: input.companyId ?? 'deep-dive',
            title: input.topic,
            markdown: r.markdown,
            citations: r.citations.map((c) => ({ title: c.title, url: c.url })),
          })
            .then((report) => {
              if (report) setThread((prev) => (prev && prev.id === 'oneshot' ? { ...prev, reportId: report.id } : prev));
            })
            .catch(() => { /* the modal copy still reads fine unsaved; saving is best-effort */ });
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
    void ask(q, scope, threadIdFor(thread));
  };

  // "Save this chat as a report": a company chat opens the report wizard with this conversation chosen;
  // a deck-wide chat has no company sections to pick, so it is saved straight away.
  const saveReport = async () => {
    if (!repo.saveThreadAsReport || !thread || thread.id === 'oneshot') return;
    if (thread.scope.companyId) { setWizardOpen(true); return; }
    setError(null);
    try {
      const report = await repo.saveThreadAsReport(thread.id, null);
      setThread({ ...thread, reportId: report.id });
      void qc.invalidateQueries({ queryKey: ['reports'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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

      {/* The Ask orb: from any page, one press asks about what you are looking at, or reopens the conversation you left. */}
      {!openState && conversational && !location.pathname.startsWith('/share/') && (
        <AskOrb
          hint={thread ? 'Back to your conversation. Drag to move.' : 'Ask Stratemark about what you are looking at. Drag to move.'}
          onAsk={() => {
            if (scope && thread) { setOpenState(true); return; }
            void resolveOrbScope(`#${location.pathname}${location.search}`, repo)
              .then((s) => { if (s) chat(s, { placeholder: 'Ask me anything about this…' }); })
              .catch(() => undefined);
          }}
        />
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
            {conversational && thread && thread.id !== 'oneshot' && (
              <button
                type="button"
                onClick={newChat}
                className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-medium text-muted hover:bg-surface-2 hover:text-content"
                title="Start a new conversation"
              >
                <Plus className="h-3.5 w-3.5" /> New chat
              </button>
            )}
            {conversational && typeof repo.listResearchThreads === 'function' && (
              <button
                type="button"
                onClick={() => setHistoryOpen((v) => !v)}
                aria-pressed={historyOpen}
                className={cn('rounded-lg p-1 hover:bg-surface-2 hover:text-content', historyOpen ? 'bg-surface-2 text-content' : 'text-muted')}
                aria-label="History"
                title="Your conversations"
              >
                <History className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setMode(mode === 'locked' ? 'floating' : 'locked')}
              className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-content"
              aria-label={mode === 'locked' ? 'Float panel' : 'Dock panel'}
              title={mode === 'locked' ? 'Float panel (overlay)' : 'Dock panel (locked)'}
            >
              {mode === 'locked' ? <PictureInPicture2 className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
            </button>
            {thread && hasAnswer && (
              <ExportMenu
                variant="icon"
                transcript={{ title: thread.title ?? scopeLabel, scopeLabel, messages: thread.messages }}
                report={canConverse && canSaveReport && !thread.reportId
                  ? { label: 'Save this chat as a report', onClick: () => void saveReport() }
                  : undefined}
              />
            )}
            {thread?.reportId && (
              <Link
                to={`/reports/${thread.reportId}`}
                onClick={close}
                className="inline-flex items-center gap-1 rounded-lg border border-positive/40 bg-positive/10 px-2 py-1 text-[11px] text-positive"
              >
                <FileText className="h-3 w-3" /> Open full report
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

        {wizardOpen && thread && thread.id !== 'oneshot' && thread.scope.companyId && (
          <ReportWizard
            open
            onOpenChange={setWizardOpen}
            companyId={thread.scope.companyId}
            companyName={reportCompanyName}
            cardId={thread.scope.cardIds?.length === 1 ? thread.scope.cardIds[0] : null}
            deckId={thread.scope.deckId}
            thread={thread}
            onStart={(input) => {
              const threadId = thread.id;
              void runCompanyReport({
                companyId: thread.scope.companyId as string,
                companyName: reportCompanyName,
                ...input,
              }).then((reportId) => {
                if (reportId) setThread((prev) => (prev && prev.id === threadId ? { ...prev, reportId } : prev));
              });
            }}
          />
        )}

        {historyOpen && (
          <PanelHistory
            memoryKey={memoryKeyOf(scope)}
            cardLabel={scope?.subject ?? null}
            currentThreadId={thread?.id ?? null}
            onOpenThread={openThread}
            onOpenReport={close}
          />
        )}

        {/* Conversation */}
        <div ref={scrollRef} className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-4', historyOpen && 'hidden')}>
          {(thread?.messages ?? []).length === 0 && !busy && !error && (
            <div className="flex flex-col gap-4 py-4 text-muted">
              {scope && <Greeting scope={scope} scopeLabel={scopeLabel} />}
              {conversational && (
                <div className="flex flex-wrap gap-2 pl-9">
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
              <p className="max-w-xs pl-9 text-[11px] leading-relaxed text-faint">
                Or type your own below. Every answer comes from this deck&apos;s research plus a
                fresh search, with the sources next to it.
              </p>
            </div>
          )}

          <div className="space-y-4">
            {(thread?.messages ?? []).map((m, idx, all) => {
              const isLast = idx === all.length - 1;
              const parsed = m.role === 'assistant' ? splitFollowUps(m.text) : null;
              return m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-content/5 px-3 py-2 text-[13px] text-content">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="max-w-full">
                  <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-faint">Stratemark</p>
                  <article className="markdown text-[13px] text-content/90">
                    <SafeMarkdown components={CHAT_MD_COMPONENTS} linkClassName="link">
                      {parsed?.body ?? m.text}
                    </SafeMarkdown>
                  </article>
                  <SourceChips citations={m.citations} />
                  {m.origin === 'memory' && (
                    <p className="mt-1.5 text-[11px] text-faint">
                      From your research on file
                      {conversational && !busy && all[idx - 1]?.role === 'user' && (
                        <>
                          {' · '}
                          <button
                            type="button"
                            className="underline hover:text-content"
                            onClick={() => void ask(all[idx - 1]!.text, scope, thread && thread.id !== 'oneshot' ? thread.id : undefined, true)}
                          >
                            Search again
                          </button>
                        </>
                      )}
                    </p>
                  )}
                  {isLast && !busy && conversational && parsed && parsed.followUps.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Suggested follow-up questions">
                      {parsed.followUps.map((q) => (
                        <button
                          key={q}
                          type="button"
                          className="rounded-full border border-border bg-surface px-2.5 py-1 text-left text-[11.5px] text-muted transition-colors hover:border-primary/50 hover:text-primary-ink"
                          onClick={() => void ask(q, scope, threadIdFor(thread))}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {busy && pending && (
            <div className="mt-4 flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-content/5 px-3 py-2 text-[13px] text-content">{pending}</div>
            </div>
          )}
          {busy && <TypingBubble active={busy} />}
          {error && (
            <div className="mt-4 rounded-lg border border-negative/40 bg-negative/10 p-3 text-[13px] text-negative">
              {error}
              {failed && hasKey && (
                <button
                  type="button"
                  className="ml-2 font-semibold underline"
                  onClick={() => { setDraft(''); void ask(failed.question, failed.scope, failed.threadId); }}
                >
                  Retry
                </button>
              )}
              {!hasKey && (
                <button type="button" className="ml-2 font-semibold underline" onClick={openSettings}>
                  Open Settings
                </button>
              )}
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

/**
 * The analyst's opening line: who they are looking at, in plain words, with no
 * figures in it. For cards the user lined up it names them, so the chat starts
 * as a conversation about those cards and not an empty box.
 */
function Greeting({ scope, scopeLabel }: { scope: ResearchScope; scopeLabel: string }) {
  const cards = useCards(scope.kind === 'cards' && scope.deckId ? scope.deckId : undefined).data ?? [];
  const company = useCompany(scope.kind === 'company' || scope.kind === 'datapoint' ? scope.companyId ?? undefined : undefined).data;
  let line: string;
  if (scope.kind === 'cards') {
    const wanted = new Set(scope.cardIds ?? []);
    const names = cards.filter((c) => wanted.has(c.card.id)).map((c) => c.company?.name ?? c.card.title ?? '').filter(Boolean);
    line = names.length >= 2
      ? `You've lined up ${names.length <= 3 ? names.join(', ').replace(/, ([^,]*)$/, ' and $1') : `${names.length} cards`}. I'll put them side by side and be straight about where the research has gaps. Where do you want to start?`
      : `I have ${names[0] ?? 'this card'}'s research in front of me. Ask me anything: what stands out, where they're exposed, what I'd check next.`;
  } else if (scope.kind === 'company' || scope.kind === 'datapoint') {
    const name = company?.name ?? scope.subject ?? 'this company';
    line = `I have ${name}'s research in front of me. Ask me what changed, how they make money, or where they're exposed, and I'll tell you what the sources say.`;
  } else {
    line = `I've been through everything in ${scopeLabel === 'This deck' ? 'this deck' : scopeLabel}. Ask me who's winning, who looks overhyped, or where the gaps are.`;
  }
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-surface">
        <img src={logoMark} alt="" className="h-4 w-4" />
      </span>
      <p className="max-w-[88%] rounded-2xl rounded-tl-md bg-surface-2 px-3 py-2 text-[13px] leading-relaxed text-content">{line}</p>
    </div>
  );
}

/** Renders the reference chips appropriate to the current chat scope. */
function ContextChips({ scope }: { scope: ResearchScope }) {
  if (scope.kind === 'cards' && scope.deckId) {
    return <CardThumbStrip deckId={scope.deckId} cardIds={scope.cardIds ?? []} />;
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
export function DigDeeperMenu(props: Parameters<typeof DigDeeperMenuInner>[0]) {
  return useSupports('deepDive') ? <DigDeeperMenuInner {...props} /> : null;
}

function DigDeeperMenuInner({
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
export function DigDeeper(props: Parameters<typeof DigDeeperInner>[0]) {
  return useSupports('deepDive') ? <DigDeeperInner {...props} /> : null;
}

function DigDeeperInner({
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
