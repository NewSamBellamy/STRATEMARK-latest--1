/**
 * "Create report" for a company, as a short guided process in three steps:
 * what to focus on (everything on the card, one conversation, or a topic),
 * which sections, then start. The report reads the research already on file
 * (the card's conversations and stored findings), researches what is missing,
 * and writes it up with sources. Nothing here calls a model: the suggestions
 * come from what the card already remembers.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, FilePlus2 } from 'lucide-react';
import { REPORT_TOPICS, REPORT_TOPIC_LABELS, type ReportTopic, type ResearchThread } from '@mi/contracts';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Modal';
import { useCards } from '@/hooks/data';
import { cn } from '@/lib/cn';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { reportSuggestions, TOPIC_HINTS, type ReportSuggestion } from './reportSuggestions';

export type ReportFocusKind = 'all' | 'thread' | 'topic';

/** What the wizard hands back when the user starts the report. */
export interface ReportWizardStart {
  cardId: string | null;
  /** All of the card's conversations for "Everything", the chosen one for "One conversation", none for "A topic". */
  threadIds: string[];
  topics: ReportTopic[];
  focus: string | null;
}

export interface ReportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  companyName: string;
  /** The card this report is about; lets the wizard read that card's memory. */
  cardId?: string | null;
  deckId?: string | null;
  /** A conversation to start with ("Save this chat as a report"): opens on "One conversation" with it chosen. */
  thread?: ResearchThread | null;
  onStart: (input: ReportWizardStart) => void;
}

/** The sections ticked by default: everything except the bare source list. */
const DEFAULT_TOPICS: ReportTopic[] = REPORT_TOPICS.filter((t) => t !== 'sources');
const THREAD_TOPICS: ReportTopic[] = ['overview', 'metrics', 'live_intel'];

const TOPIC_WORDS: Array<[RegExp, ReportTopic]> = [
  [/\b(news|recent|latest|sentiment|press|rumou?rs?)\b/i, 'live_intel'],
  [/\b(team|ceo|founders?|leaders?|executives?|hiring|org(?:ani[sz]ation)?)\b/i, 'team_org'],
  [/\b(products?|pricing|price|roadmap|launch(?:es)?|features?)\b/i, 'products_roadmap'],
  [/\b(history|origins?|founded)\b/i, 'history'],
  [/\b(funding|investors?|board|mission|governance)\b/i, 'mission_governance'],
  [/\b(revenue|arr|metrics?|figures?|valuation|growth)\b/i, 'metrics'],
];

function sectionsFor(kind: ReportFocusKind, topicText: string, suggested: ReportTopic | null): ReportTopic[] {
  if (kind === 'all') return DEFAULT_TOPICS;
  if (kind === 'thread') return THREAD_TOPICS;
  const found = new Set<ReportTopic>(['overview']);
  if (suggested) found.add(suggested);
  for (const [pattern, topic] of TOPIC_WORDS) if (pattern.test(topicText)) found.add(topic);
  return found.size > 1 ? REPORT_TOPICS.filter((t) => found.has(t)) : DEFAULT_TOPICS;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function ReportWizard({ open, onOpenChange, ...rest }: ReportWizardProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <WizardBody onOpenChange={onOpenChange} {...rest} />
      </DialogContent>
    </Dialog>
  );
}

const STEP_TITLES = ['What should the report focus on?', 'Which sections should it have?', 'Ready to start'] as const;

function WizardBody({
  onOpenChange, companyId, companyName, cardId = null, deckId = null, thread = null, onStart,
}: Omit<ReportWizardProps, 'open'>) {
  const repo = useRepository();
  const hasMemory = Boolean(cardId) && typeof repo.getCardMemory === 'function';
  const memoryQuery = useQuery({
    queryKey: ['cardMemory', cardId],
    queryFn: () => repo.getCardMemory!(cardId!),
    enabled: hasMemory,
  });
  const threadsQuery = useQuery({
    queryKey: ['researchThreads', deckId ?? '', companyId],
    queryFn: () => repo.listResearchThreads!({ deckId: deckId ?? undefined, companyId }),
    enabled: !hasMemory && typeof repo.listResearchThreads === 'function',
  });
  const cardsQuery = useCards(deckId ?? undefined);

  const threads = useMemo(() => {
    const stored = hasMemory ? memoryQuery.data?.threads ?? [] : threadsQuery.data ?? [];
    const merged = thread && !stored.some((t) => t.id === thread.id) ? [thread, ...stored] : [...stored];
    return merged.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }, [hasMemory, memoryQuery.data, threadsQuery.data, thread]);

  const peerNames = useMemo(
    () => (cardsQuery.data ?? []).filter((c) => c.company && c.company.id !== companyId).map((c) => c.company!.name),
    [cardsQuery.data, companyId],
  );
  const suggestions = useMemo(
    () => reportSuggestions({ threads, reports: memoryQuery.data?.reports ?? [] }, { subjectName: companyName, peerNames }),
    [threads, memoryQuery.data, companyName, peerNames],
  );

  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<ReportFocusKind>(thread ? 'thread' : 'all');
  const [threadId, setThreadId] = useState<string | null>(thread?.id ?? null);
  const [topicText, setTopicText] = useState('');
  const [suggestedTopic, setSuggestedTopic] = useState<ReportTopic | null>(null);
  const [picked, setPicked] = useState<ReportTopic[]>(() => sectionsFor(thread ? 'thread' : 'all', '', null));
  const [touched, setTouched] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    // Keep keyboard and screen-reader users oriented: each step starts at its heading.
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus();
  }, [step]);

  const chosenThread = threads.find((t) => t.id === (threadId ?? threads[0]?.id)) ?? null;
  const focusReady = kind === 'all' || (kind === 'thread' && chosenThread !== null) || (kind === 'topic' && topicText.trim().length > 0);

  const threadIds = kind === 'all' ? threads.map((t) => t.id) : kind === 'thread' && chosenThread ? [chosenThread.id] : [];
  const focus = kind === 'thread' ? chosenThread?.title ?? null : kind === 'topic' ? topicText.trim() || null : null;
  const topics = REPORT_TOPICS.filter((t) => picked.includes(t));

  const applySuggestion = (s: ReportSuggestion) => {
    if (s.kind === 'thread') {
      setKind('thread');
      setThreadId(s.threadId);
    } else {
      setKind('topic');
      setTopicText(s.focus);
      setSuggestedTopic(s.kind === 'topic' ? s.topic : null);
    }
  };

  const toggle = (topic: ReportTopic) => {
    setTouched(true);
    setPicked((current) => (current.includes(topic) ? current.filter((t) => t !== topic) : [...current, topic]));
  };

  const next = () => {
    if (step === 0) {
      if (!focusReady) return;
      if (!touched) setPicked(sectionsFor(kind, topicText, suggestedTopic));
      setStep(1);
    } else if (step === 1 && topics.length > 0) {
      setStep(2);
    }
  };

  const start = () => {
    if (topics.length === 0 || !focusReady) return;
    onStart({ cardId, threadIds, topics, focus });
    onOpenChange(false);
  };

  const summary = (() => {
    const gaps = 'plus fresh research for gaps';
    if (kind === 'thread' && chosenThread) return `Using the conversation "${chosenThread.title}" and the research on file, ${gaps}.`;
    if (kind === 'topic') return `Researching "${topicText.trim()}" from the research on file, ${gaps}.`;
    if (threadIds.length > 0) return `Using the ${plural(threadIds.length, 'conversation', 'conversations')} and the research on file, ${gaps}.`;
    return `Using the research on file, ${gaps}.`;
  })();

  const radio = (value: ReportFocusKind, label: string, hint: string, disabled = false) => (
    <li>
      <label
        className={cn(
          'flex items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
          kind === value ? 'border-primary/50 bg-primary/5' : 'border-border bg-surface hover:bg-surface-2',
        )}
      >
        <input
          type="radio"
          name="report-focus-kind"
          className="mt-0.5 h-4 w-4 accent-[var(--color-primary,#0f766e)]"
          checked={kind === value}
          disabled={disabled}
          onChange={() => setKind(value)}
        />
        <span>
          <span className="block text-[13px] font-medium text-content">{label}</span>
          <span className="block text-[11.5px] text-faint">{hint}</span>
        </span>
      </label>
    </li>
  );

  return (
    <>
      <DialogTitle className="font-display text-lg font-semibold text-content">Create a report on {companyName}</DialogTitle>
      <DialogDescription className="mt-1 text-[13px] leading-relaxed text-muted">
        Stratemark reads the research it already has, finds what is missing, researches those gaps, then writes it up
        with sources. You can keep working; you will be told when it is ready.
      </DialogDescription>

      <h3 ref={headingRef} tabIndex={-1} className="mt-4 text-[13px] font-semibold text-content focus:outline-none">
        Step {step + 1} of 3: {STEP_TITLES[step]}
      </h3>

      {step === 0 && (
        <div className="mt-2">
          <fieldset>
            <legend className="sr-only">What to focus on</legend>
            <ul className="grid gap-1.5">
              {radio('all', 'Everything on this card', threads.length > 0
                ? `All ${plural(threads.length, 'conversation', 'conversations')} and the research on file`
                : 'The research on file')}
              {radio('thread', 'One conversation', threads.length > 0
                ? 'Turn a single conversation into a report'
                : 'No conversations on this card yet', threads.length === 0)}
              {radio('topic', 'A topic', 'Say what to look into, in a few words')}
            </ul>
          </fieldset>

          {kind === 'thread' && chosenThread && (
            <div className="mt-3">
              <label className="block text-[11px] font-semibold uppercase tracking-widest text-faint" htmlFor="report-wizard-thread">
                Conversation
              </label>
              <select
                id="report-wizard-thread"
                className="input mt-1.5 py-2 text-sm"
                value={chosenThread.id}
                onChange={(e) => setThreadId(e.target.value)}
              >
                {threads.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>
          )}

          {kind === 'topic' && (
            <div className="mt-3">
              <label className="block text-[11px] font-semibold uppercase tracking-widest text-faint" htmlFor="report-wizard-topic">
                Topic
              </label>
              <input
                id="report-wizard-topic"
                className="input mt-1.5 py-2 text-sm"
                placeholder="e.g. pricing pressure, who they compete with"
                value={topicText}
                onChange={(e) => { setTopicText(e.target.value); setSuggestedTopic(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); next(); } }}
              />
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-faint" id="report-wizard-suggestions">Suggestions</p>
              <ul className="mt-1.5 grid gap-1.5" aria-labelledby="report-wizard-suggestions">
                {suggestions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-left text-[13px] text-content transition-colors hover:bg-surface-2"
                      onClick={() => applySuggestion(s)}
                    >
                      {s.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <fieldset className="mt-2">
          <legend className="sr-only">Include</legend>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {REPORT_TOPICS.map((topic) => {
              const on = picked.includes(topic);
              return (
                <li key={topic}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors',
                      on ? 'border-primary/50 bg-primary/5' : 'border-border bg-surface hover:bg-surface-2',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-[var(--color-primary,#0f766e)]"
                      checked={on}
                      onChange={() => toggle(topic)}
                    />
                    <span>
                      <span className="block text-[13px] font-medium text-content">{REPORT_TOPIC_LABELS[topic]}</span>
                      <span className="block text-[11.5px] text-faint">{TOPIC_HINTS[topic]}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      {step === 2 && (
        <div className="mt-2 text-[13px] leading-relaxed text-content">
          <p>{summary}</p>
          <p className="mt-1 text-[11.5px] text-muted">
            {plural(topics.length, 'section', 'sections')}. Sourcing rules do not change; unknown stays unknown.
          </p>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-[11.5px] text-muted" role="status">
          {step === 0 && kind === 'topic' && !focusReady ? 'Say what to look into to continue.' : ''}
          {step === 1 && topics.length === 0 ? 'Pick at least one section.' : ''}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {step > 0 && (
            <button type="button" className="btn-ghost" onClick={() => setStep(step - 1)}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          )}
          {step < 2 ? (
            <button type="button" className="btn-primary" disabled={step === 0 ? !focusReady : topics.length === 0} onClick={next}>
              Next
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={start}>
              <FilePlus2 className="h-4 w-4" />
              Start report
            </button>
          )}
        </div>
      </div>
    </>
  );
}
