/**
 * The four-step company report: read what is stored, find the gaps, research
 * the gaps more deeply, write it up.
 *
 * The repository hands this module a handful of capabilities (read a cached
 * tab, research a never-researched tab, ground, structure, read usage); the
 * module owns the order of operations and the spending rules, so both can be
 * tested with stubs and no network.
 *
 * Spending, in order of cost:
 *   1. Stored research is free to read (digests are deterministic).
 *   2. A tab that was never researched goes through the existing lane
 *      (`getDashboardTab`), which already tries free structured sources before
 *      paid grounding.
 *   3. A topic that still has gaps gets at most ONE focused grounded pass,
 *      asking only for the gaps. A topic with no gaps is never grounded.
 *   4. Each topic is written up by one ungrounded model call from the digest
 *      plus the deeper findings only. The Sources topic and a topic with
 *      nothing to write from need no model call at all.
 * So the worst case for N topics is N lane runs (only for never-researched
 * tabs) + N grounded passes + N write-ups; the best case is N write-ups.
 *
 * What a report does and does not change:
 *   - Findings from the focused grounded pass live in the report only. They are
 *     never written back to the stored tabs or the evidence vault.
 *   - A never-researched tab that goes through the lane IS written to the
 *     dashboard, exactly as opening that tab would have done. That is intended:
 *     the free-first lane fills the dashboard like a click would.
 *   - Cancelling stops the report and saves nothing. The lane itself has its own
 *     deadline and no cancel hook from here, so a lane already running when the
 *     user cancels finishes in the background and may still fill its tab; the
 *     report stops waiting for it at once and does not count as completed.
 */
import { z } from 'zod';
import {
  REPORT_TOPICS,
  REPORT_TOPIC_LABELS,
  type Citation,
  type Company,
  type CompanyMetric,
  type DashboardTab,
  type ReportCost,
  type ReportSection,
  type ReportTopic,
} from '@mi/contracts';
import { GROUNDED_SYSTEM } from './prompts';
import { snapshotAggregate } from './call-cost';
import { usageSince } from './deck-run';
import { AbortError, throwIfAborted } from './util';
import type { CallMetricsAggregate, LlmClient } from './types';
import {
  REPORT_WRITER_SYSTEM,
  allowedFigures,
  cleanCitations,
  deeperResearchPrompt,
  digestSectionMarkdown,
  dropUntraceableFigures,
  emptySectionMarkdown,
  sanitizeSectionMarkdown,
  sectionPrompt,
  sourcesSectionMarkdown,
  topicGaps,
  topicIsTabBacked,
  topicStoredEvidence,
  topicTab,
  unreadableSectionMarkdown,
  type StoredEvidence,
  type StoredTab,
  type TopicInput,
} from './report-topics';

export const reportSectionOutSchema = z.object({ markdown: z.string() });

/** Findings from one grounded pass are capped so a runaway answer cannot bloat the write-up prompt. */
const FINDINGS_MAX_CHARS = 6000;
const CONVERSATION_PROMPT_CHARS = 3000;
const SECTION_CITATIONS_MAX = 40;
/** Topics researched / written in parallel; the provider's own limiter paces the rest. */
const REPORT_CONCURRENCY = 3;

export interface CompanyReportDeps {
  company: Company;
  /**
   * The stored tab as the user sees it, read from the cache only; null = never researched.
   * Must never research. If the stored research cannot be read in its source-bound form it
   * must THROW: the topic then reports the gap instead of showing raw, unbound content.
   */
  readStoredTab(tab: DashboardTab): Promise<StoredTab | null>;
  /** Run the existing dashboard lane for a tab that was never researched; returns what it found (the cache may not keep it). */
  researchTab(tab: DashboardTab): Promise<StoredTab | null>;
  /** The company's figures as the dashboard shows them. Throws when they cannot be read source-bound. */
  facts(): Promise<CompanyMetric[]>;
  /** Retained research passages for this company. */
  evidence(): StoredEvidence[];
  /** Citations from every stored tab. */
  tabCitations(): Citation[];
  client: LlmClient;
  now?: () => Date;
  /** True while other research the report cannot tell apart from its own is running (deck jobs, tab lanes). */
  busy?: () => boolean;
}

/** What the user asked the report to emphasise and which conversation to fold in. Neither changes the evidence rules. */
export interface CompanyReportOptions {
  focus?: string | null;
  /** The analyst's earlier research session: its sourced findings, already filtered to turns with usable sources. */
  conversation?: { text: string; citations: Citation[] } | null;
}

export interface CompanyReportResult {
  title: string;
  topics: ReportTopic[];
  sections: ReportSection[];
  cost: ReportCost;
  citations: Citation[];
  markdown: string;
  evidenceDigest: string;
  evidenceCitations: Citation[];
}

const NO_STORED_RESEARCH = (name: string): string =>
  `There is no stored research for ${name} yet, and the research service did not return anything new, so a report cannot be written. Check the connection and the API key, then try again.`;

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'));
}

/** The topics asked for, de-duplicated and in dashboard order so the report reads like the tabs. */
export function normalizeReportTopics(topics: readonly string[] | undefined): ReportTopic[] {
  const asked = new Set(Array.isArray(topics) ? topics : []);
  return REPORT_TOPICS.filter((t) => asked.has(t));
}

/** A deeper-research citation counts as a source only when it is a real, https page (not a search redirect or a local address). */
export function isSourcedFinding(c: Citation): boolean {
  return /^https:\/\//i.test(c.url);
}

/**
 * Run `fn` over `items`, `limit` at a time. The first failure stops everything:
 * no further item is started, and the shared controller is aborted so calls
 * already in flight receive the abort where their client supports it.
 */
export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  controller: AbortController,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failure: { error: unknown } | null = null;
  const worker = async (): Promise<void> => {
    while (!failure && cursor < items.length) {
      const index = cursor++;
      try {
        throwIfAborted(controller.signal);
        results[index] = await fn(items[index] as T, index);
      } catch (error) {
        if (!failure) {
          failure = { error };
          controller.abort();
        }
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw (failure as { error: unknown }).error;
  return results;
}

/** Stop waiting for `work` the moment `signal` aborts. The work itself is not cancelled (see the header). */
export function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  work.catch(() => undefined);
  if (signal.aborted) return Promise.reject(new AbortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new AbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Report builds running at once in this process. The client's usage counters
 * are global, so two overlapping builds (or a build beside other research)
 * cannot be told apart from the counters alone; both then report an unknown
 * cost rather than someone else's calls as their own.
 */
const activeBuilds = new Set<object>();
const overlappedBuilds = new WeakSet<object>();

/**
 * What the report cost: the provider's own counters before and after, or null
 * where they are not measured. `unattributable` = other research may have run
 * during the report, so the counters cannot be trusted to be this report's.
 */
export function reportCost(
  base: CallMetricsAggregate | undefined,
  now: CallMetricsAggregate | undefined,
  knownCalls: number,
  unattributable = false,
): ReportCost {
  // No calls were made: spending nothing is a fact, not a gap in measurement.
  if (knownCalls === 0) return { estUsd: 0, calls: 0, searches: 0 };
  if (unattributable || !base || !now) return { estUsd: null, calls: null, searches: null };
  const usage = usageSince(now, base);
  // A client that reports no usage at all (zeros) while we know we called it is unmeasured, not free.
  if (!usage || usage.calls === 0) return { estUsd: null, calls: null, searches: null };
  return {
    estUsd: now.estCostUsd === undefined ? null : Math.round(usage.estCostUsd * 10_000) / 10_000,
    calls: usage.calls,
    searches: now.searchQueries === undefined ? null : usage.searchQueries,
  };
}

interface TopicState {
  topic: ReportTopic;
  input: TopicInput;
  digest: string;
  hasContent: boolean;
  storedCitations: Citation[];
  gaps: string[];
  findings: string;
  findingCitations: Citation[];
  researchedDeeper: boolean;
}

export async function buildCompanyTopicReport(
  deps: CompanyReportDeps,
  requested: readonly string[],
  signal?: AbortSignal,
  options: CompanyReportOptions = {},
): Promise<CompanyReportResult> {
  const { company, client } = deps;
  const topics = normalizeReportTopics(requested);
  if (!topics.length) throw new Error('Choose at least one topic for the report.');
  throwIfAborted(signal);

  // One controller for the whole build: the caller's cancel, or the first failure, aborts it.
  const controller = new AbortController();
  const onCallerAbort = (): void => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', onCallerAbort, { once: true });
  const sig = controller.signal;

  const token = {};
  if (activeBuilds.size > 0) {
    overlappedBuilds.add(token);
    for (const other of activeBuilds) overlappedBuilds.add(other);
  }
  activeBuilds.add(token);
  const busyAtStart = deps.busy?.() ?? false;

  try {
    const nowDate = (): Date => deps.now?.() ?? new Date();
    const today = nowDate().toISOString().slice(0, 10);
    const focus = (options.focus ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const conversation = options.conversation?.text.trim().slice(0, CONVERSATION_PROMPT_CHARS) ?? '';
    const conversationCitations = cleanCitations(options.conversation?.citations, company.websiteUrl);
    const baseMetrics = client.metrics?.();
    const base = baseMetrics ? snapshotAggregate(baseMetrics) : undefined;
    // Calls we know we asked for (a lane run counts as one: it may make more).
    let knownCalls = 0;

    let factsReadable = true;
    const facts = await deps.facts().catch(() => { factsReadable = false; return [] as CompanyMetric[]; });
    const evidence = deps.evidence();
    const otherCitations = deps.tabCitations();
    const companyView = {
      name: company.name,
      oneLiner: company.oneLiner,
      hqLocation: company.hqLocation,
      websiteUrl: company.websiteUrl,
      founded: company.founded ?? null,
      ownership: company.ownership ?? null,
    };
    const readInput = async (topic: ReportTopic): Promise<TopicInput> => {
      let tab: StoredTab | null = null;
      let unreadable = topic === 'metrics' && !factsReadable;
      if (topicIsTabBacked(topic)) {
        try { tab = await deps.readStoredTab(topicTab(topic)); } catch { unreadable = true; }
      }
      return { company: companyView, metrics: facts, tab, ...(unreadable ? { unreadable } : {}), evidence, otherCitations, now: nowDate() };
    };
    const snapshotOf = (topic: ReportTopic, input: TopicInput): Pick<TopicState, 'digest' | 'hasContent' | 'storedCitations' | 'gaps'> => {
      const stored = topicStoredEvidence(topic, input);
      return { digest: stored.text, hasContent: stored.hasContent, storedCitations: stored.citations, gaps: topicGaps(topic, input) };
    };

    // Steps 1-3: read what is stored, find the gaps, research them.
    const states = await mapLimited(topics, REPORT_CONCURRENCY, async (topic): Promise<TopicState> => {
      let input = await readInput(topic);
      let view = snapshotOf(topic, input);
      let researchedDeeper = false;

      // A tab nobody ever researched goes through the existing, free-first lane (which fills the dashboard, as a click would).
      if (topicIsTabBacked(topic) && input.tab === null && !input.unreadable) {
        knownCalls += 1;
        let fresh: StoredTab | null = null;
        try {
          fresh = await raceAbort(deps.researchTab(topicTab(topic)), sig);
        } catch (error) {
          if (isAbort(error, sig)) throw error;
          // The lane failed: the section reports the gap instead.
        }
        input = await readInput(topic);
        // The lane answered but the cache did not keep it (the company was re-researched meanwhile): the answer still counts.
        if (input.tab === null && !input.unreadable && fresh) input = { ...input, tab: fresh };
        const after = snapshotOf(topic, input);
        researchedDeeper = input.tab !== null && after.hasContent;
        view = after;
      }

      // One focused grounded pass, only for what is still missing.
      let findings = '';
      let findingCitations: Citation[] = [];
      // (A topic that could not be READ has a storage problem, not a research gap: nothing is searched for it.)
      if (view.gaps.length > 0 && topic !== 'sources' && !input.unreadable) {
        throwIfAborted(sig);
        knownCalls += 1;
        try {
          const g = await client.ground(
            deeperResearchPrompt({ companyName: company.name, websiteUrl: company.websiteUrl, hqLocation: company.hqLocation, topic, gaps: view.gaps, today, focus }),
            { system: GROUNDED_SYSTEM, label: `company_report:${topic}`, signal: sig },
          );
          const cited = cleanCitations(g.citations, company.websiteUrl).filter(isSourcedFinding);
          // Findings nothing credible stands behind are dropped, not displayed.
          if (g.text.trim() && cited.length > 0) {
            findings = g.text.trim().slice(0, FINDINGS_MAX_CHARS);
            findingCitations = cited;
            researchedDeeper = true;
          }
        } catch (error) {
          if (isAbort(error, sig)) throw error;
          // The gap stays; the write-up says it was not found.
        }
      }
      return { topic, input, ...view, findings, findingCitations, researchedDeeper };
    }, controller);

    if (!states.some((s) => s.hasContent || s.findings)) throw new Error(NO_STORED_RESEARCH(company.name));

    // Step 4: write each section from its digest and findings only.
    const sections = await mapLimited(states, REPORT_CONCURRENCY, async (state): Promise<ReportSection> => {
      const { topic } = state;
      const label = REPORT_TOPIC_LABELS[topic];
      const gaps = [...state.gaps];
      let markdown: string;
      let usedConversation = false;

      if (topic === 'sources') {
        markdown = sourcesSectionMarkdown(state.input);
      } else if (state.input.unreadable) {
        markdown = unreadableSectionMarkdown(topic, company.name);
      } else if (!state.hasContent && !state.findings) {
        markdown = emptySectionMarkdown(topic, company.name);
      } else {
        knownCalls += 1;
        usedConversation = conversation.length > 0;
        let drafted: string | null = null;
        try {
          const out = await client.structure(
            sectionPrompt({ companyName: company.name, topic, digest: state.digest, findings: state.findings, gaps: state.gaps, today, focus, conversation }),
            reportSectionOutSchema,
            { system: REPORT_WRITER_SYSTEM, label: `company_report:${topic}:write`, signal: sig },
          );
          drafted = out.markdown;
        } catch (error) {
          if (isAbort(error, sig)) throw error;
        }
        if (drafted === null || !drafted.trim()) {
          markdown = digestSectionMarkdown(state.digest);
          gaps.push('The write-up could not be produced, so this section lists the stored research as it was saved');
        } else {
          // The guard: a statement carrying a figure the digest, the findings and the conversation cannot account for does not ship.
          // The gaps text and the dates inside the digest are deliberately NOT allowed to license free-standing numbers.
          const allowed = allowedFigures(state.digest, state.findings, conversation, company.name, label, today.slice(0, 4));
          const guarded = dropUntraceableFigures(sanitizeSectionMarkdown(drafted), allowed);
          if (guarded.removed > 0) {
            gaps.push(`${guarded.removed} statement${guarded.removed === 1 ? ' was' : 's were'} left out because a figure in ${guarded.removed === 1 ? 'it' : 'them'} could not be traced to the research`);
          }
          markdown = guarded.markdown.trim() ? guarded.markdown : digestSectionMarkdown(state.digest);
        }
      }

      // Conversation sources are attached only to sections the conversation was shown to.
      const pool = topic === 'sources'
        ? cleanCitations(state.storedCitations, company.websiteUrl).slice(0, SECTION_CITATIONS_MAX * 2)
        : cleanCitations([...state.storedCitations, ...state.findingCitations, ...(usedConversation ? conversationCitations : [])], company.websiteUrl).slice(0, SECTION_CITATIONS_MAX);
      if (pool.length === 0 && !gaps.some((g) => g.startsWith('No source found'))) {
        gaps.push(`No source found for ${label.toLowerCase()}`);
      }
      return { topic, title: label, markdown, citations: pool, gaps, researchedDeeper: state.researchedDeeper };
    }, controller);

    // A cancel that arrived during the last write-up must not become a saved report.
    throwIfAborted(signal);
    throwIfAborted(sig);

    const unattributable = busyAtStart || (deps.busy?.() ?? false) || overlappedBuilds.has(token);
    const cost = reportCost(base, client.metrics?.(), knownCalls, unattributable);
    return {
      title: `${company.name} — Company Report`,
      topics,
      sections,
      cost,
      citations: cleanCitations(sections.flatMap((s) => s.citations), company.websiteUrl),
      markdown: sections.map((s) => `## ${s.title}\n\n${s.markdown}`).join('\n\n'),
      evidenceDigest: states.map((s) => s.digest).join('\n\n'),
      evidenceCitations: cleanCitations(states.flatMap((s) => s.storedCitations), company.websiteUrl),
    };
  } finally {
    signal?.removeEventListener('abort', onCallerAbort);
    activeBuilds.delete(token);
  }
}
