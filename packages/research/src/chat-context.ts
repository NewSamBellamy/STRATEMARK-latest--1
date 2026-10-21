/**
 * Compact, human-readable grounding for the research chat.
 *
 * The chat model should see the deck the way an analyst would: each company
 * with its sourced figures, the as-of date, the confidence tier and the source
 * it came from. Unknown figures are stated as Unknown (never a number), so the
 * model has nothing to "round up" from. Pure functions — no I/O.
 */
import { METRIC_TYPE_LABELS, metricDefinitionLabel, MONEY_METRIC_TYPES, usableCitations, type CompanyMetric, type MetricType } from '@mi/contracts';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

const SUFFIXES: Array<[number, string]> = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];

function compact(n: number): string {
  for (const [size, s] of SUFFIXES) {
    if (Math.abs(n) >= size) return `${Number((n / size).toFixed(2))}${s}`;
  }
  return String(Number(n.toFixed(2)));
}

export function formatMetricValue(type: MetricType, value: number): string {
  if ((MONEY_METRIC_TYPES as readonly string[]).includes(type)) return `$${compact(value)}`;
  if (type === 'market_share') return `${Number(value.toFixed(2))}%`;
  return compact(value);
}

/** When a source says the figure was true, falling back to when we captured it. */
export function metricAsOf(m: CompanyMetric): string | null {
  return m.passageSupport?.asOf || m.reportedSupport?.asOf || m.quotedSupport?.asOf || null;
}

/** A figure the chat may state: a value with a source, or a human-checked value. */
function isStatable(m: CompanyMetric): m is CompanyMetric & { value: number } {
  if (m.confidence === 'unknown' || m.value === null) return false;
  return m.confidence === 'user_verified' || usableCitations(m.citations ?? []).length > 0;
}

/**
 * What the figure actually measures, as the card shows it: the stored 'arr' row of a public company
 * is its filed annual revenue, not ARR, and 'users' may be customers. The slot's type name alone
 * would tell the chat model (and the user) the wrong thing.
 */
function figureLabel(m: CompanyMetric): string {
  return metricDefinitionLabel(m) ?? METRIC_TYPE_LABELS[m.metricType] ?? m.metricType;
}

/** One line per metric. Unknown / unsourced figures never carry a number. */
export function formatMetricLine(m: CompanyMetric): string {
  const label = figureLabel(m);
  if (!isStatable(m)) return `- ${label}: Unknown (not in this deck's research)`;
  const asOf = metricAsOf(m);
  const sources = usableCitations(m.citations ?? []);
  const src = sources.length
    ? sources.slice(0, 2).map((c) => `${c.title || 'source'} <${c.url}>`).join('; ')
    : 'confirmed by the analyst (human-checked)';
  return `- ${label}: ${formatMetricValue(m.metricType, m.value)} [${m.confidence}]${asOf ? `, as of ${asOf}` : ', as-of date not stated'}; source: ${src}`;
}

/**
 * Comparative questions ("which company has the highest valuation?") answered
 * from the deck itself: per metric, every company's statable figure, highest
 * first. Small enough to always fit ahead of the per-company blocks, so a
 * ranking never depends on which companies survived the length budget.
 */
export function formatDeckRankings(companies: ReadonlyArray<{ name: string; metrics: readonly CompanyMetric[] }>): string {
  // One ranking per measured thing, not per slot: annual revenue and ARR share the 'arr' slot but are
  // different measurements, and ranking one company's revenue against another's ARR misleads.
  const byGroup = new Map<string, { type: MetricType; label: string; rows: Array<{ name: string; metric: CompanyMetric & { value: number } }> }>();
  const coveredBy = new Map<MetricType, Set<string>>();
  for (const company of companies) {
    for (const metric of company.metrics) {
      if (!isStatable(metric)) continue;
      const label = figureLabel(metric);
      const group = byGroup.get(`${metric.metricType}|${label}`) ?? { type: metric.metricType, label, rows: [] };
      group.rows.push({ name: company.name, metric });
      byGroup.set(`${metric.metricType}|${label}`, group);
      coveredBy.set(metric.metricType, (coveredBy.get(metric.metricType) ?? new Set<string>()).add(company.name));
    }
  }
  const lines: string[] = [];
  for (const { type, label, rows } of byGroup.values()) {
    rows.sort((a, b) => b.metric.value - a.metric.value);
    const missing = companies.length - (coveredBy.get(type)?.size ?? rows.length);
    lines.push(`${label} (highest first): ${rows.map(({ name, metric }) => {
      const asOf = metricAsOf(metric);
      return `${name} ${formatMetricValue(type, metric.value)} [${metric.confidence}${asOf ? `, as of ${asOf}` : ''}]`;
    }).join('; ')}${missing > 0 ? `; ${missing} compan${missing === 1 ? 'y has' : 'ies have'} no sourced figure` : ''}`);
  }
  return lines.length ? lines.join('\n') : 'No sourced figures in this deck yet.';
}

export interface ChatCompanyBlock {
  name: string;
  oneLiner?: string | null;
  tier?: number | null;
  metrics: readonly CompanyMetric[];
  /** The card the figures live on, so answers can say "on the X card". */
  cardLabel?: string | null;
}

export function formatCompanyBlock(c: ChatCompanyBlock): string {
  const head = `COMPANY: ${c.name}${c.oneLiner ? ` — ${c.oneLiner}` : ''}`;
  const lines = c.metrics.length ? c.metrics.map(formatMetricLine) : ['- No figures recorded yet (Unknown)'];
  return [head, ...lines].join('\n');
}

/** Blocks joined under a character budget; says plainly what was left out. */
export function buildDeckChatContext(input: {
  marketName?: string | null;
  companies: readonly ChatCompanyBlock[];
  maxChars?: number;
}): string {
  const max = input.maxChars ?? 14000;
  const out: string[] = [];
  if (input.marketName) out.push(`MARKET: ${input.marketName}`);
  let used = out.join('\n').length;
  let omitted = 0;
  for (const c of input.companies) {
    const block = formatCompanyBlock(c);
    if (used + block.length + 2 > max) {
      omitted += 1;
      continue;
    }
    out.push(block);
    used += block.length + 2;
  }
  if (omitted) out.push(`(${omitted} more compan${omitted === 1 ? 'y' : 'ies'} omitted for length — say so if asked about them)`);
  return out.join('\n\n');
}

/** Full multi-turn transcript, newest turns kept when it must be trimmed. */
export function formatConversation(history: readonly ChatTurn[], opts?: { maxTurns?: number; perTurnChars?: number }): string {
  const maxTurns = opts?.maxTurns ?? 12;
  const per = opts?.perTurnChars ?? 1600;
  return history
    .slice(-maxTurns)
    .map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.text.length > per ? `${m.text.slice(0, per)}…` : m.text}`)
    .join('\n\n');
}

/** How long an answer should be. A small question gets a small answer; a request for the whole picture gets one. */
export type AnswerSize = 'brief' | 'standard' | 'deep';

export const ANSWER_WORD_LIMITS: Record<AnswerSize, number> = { brief: 60, standard: 250, deep: 700 };

const GREETING_OPENER = /^(?:hi|hey|hello|yo|hiya|sup|good (?:morning|afternoon|evening)|thanks|thank you|thx|ok|okay|cool|great|nice)\b[\s,!.]*/i;
const SMALL_TALK = /^(?:what'?s up|whats up|how are you|how'?s it going|hows it going|how is it going|there|again|team|stratemark|you|friend|man|mate|bud|all)?[\s,!.?]*$/i;

/** A greeting or a thank-you: nothing in it is a question about a company, so it never starts a search. */
export function isGreeting(question: string): boolean {
  const text = question.trim();
  if (!text || text.split(/\s+/).length > 7) return false;
  const rest = text.replace(GREETING_OPENER, '');
  if (rest.length === text.length) return /^(?:what'?s up|whats up|how are you|how'?s it going)[\s!.?]*$/i.test(text);
  return SMALL_TALK.test(rest);
}

const DEEP_ASK = /\b(?:full picture|deep dive|in[- ]depth|report|everything (?:you know|about|on)|complete (?:analysis|overview)|walk me through|big picture)\b/i;
const ONE_FIGURE = /^(?:what(?:'s| is| was| are)|how (?:much|many|big|old|large)|who(?:'s| is| are| founded| runs| owns)|when|where)\b/i;

/**
 * Chooses the answer length from the question itself, by fixed rules (no model call): greetings and short one-figure questions are
 * brief; asking for the full picture, a deep dive or a report, or comparing three or more cards, is deep; everything else is standard.
 */
export function answerSize(question: string, scope?: { cardIds?: readonly string[] | null } | null): AnswerSize {
  const text = question.trim();
  if (isGreeting(text)) return 'brief';
  if (DEEP_ASK.test(text) || (scope?.cardIds?.length ?? 0) >= 3) return 'deep';
  if (text.split(/\s+/).length <= 8 && ONE_FIGURE.test(text) && !/\b(?:compare|versus|vs\.?|and)\b/i.test(text)) return 'brief';
  return 'standard';
}

/** What was said last time on this card, kept short: the previous conversation's gist and the titles of the three most recent. */
export interface LastTime {
  summary?: string | null;
  titles?: readonly string[];
}

export const LAST_TIME_MAX_CHARS = 600;

export function formatLastTime(last: LastTime | null | undefined): string {
  if (!last) return '';
  const titles = (last.titles ?? []).filter(Boolean).slice(0, 3).map((t) => `"${t}"`);
  const body = [last.summary?.trim() ? last.summary.trim() : '', titles.length ? `Recent conversations: ${titles.join(', ')}.` : ''].filter(Boolean).join(' ');
  if (!body) return '';
  const clipped = body.length > LAST_TIME_MAX_CHARS ? `${body.slice(0, LAST_TIME_MAX_CHARS - 1).trimEnd()}…` : body;
  return `LAST TIME (the previous conversation about this, for continuity: pick up from it, never recite it back, and never treat it as a source):\n${clipped}`;
}

/** The final user-facing prompt: data first, conversation next, the ask LAST and unmissable. */
export function buildChatPrompt(parts: {
  dataBlocks: readonly string[];
  history: readonly ChatTurn[];
  question: string;
  /** How long to answer; chosen from the question when not given. */
  size?: AnswerSize;
  lastTime?: LastTime | null;
}): string {
  const convo = formatConversation(parts.history);
  const size = parts.size ?? answerSize(parts.question);
  return [
    ...parts.dataBlocks.filter(Boolean),
    formatLastTime(parts.lastTime),
    convo ? `CONVERSATION SO FAR (oldest first):\n${convo}` : '',
    `ANSWER LENGTH: ${size}, at most ${ANSWER_WORD_LIMITS[size]} words. ${size === 'brief' ? 'Answer in a sentence or two; a greeting gets a warm line and a question about what to dig into.' : size === 'deep' ? 'Take the room this needs, organised with short headings, and still lead with the answer.' : 'Lead with the answer, then the one or two details that matter.'}`,
    `THE USER'S NEW MESSAGE — reply to exactly this, directly and conversationally, using the conversation above for context (follow-ups like "and them?" or "why?" refer to it):\n${parts.question}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
