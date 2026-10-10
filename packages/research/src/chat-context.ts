/**
 * Compact, human-readable grounding for the research chat.
 *
 * The chat model should see the deck the way an analyst would: each company
 * with its sourced figures, the as-of date, the confidence tier and the source
 * it came from. Unknown figures are stated as Unknown (never a number), so the
 * model has nothing to "round up" from. Pure functions — no I/O.
 */
import { METRIC_TYPE_LABELS, MONEY_METRIC_TYPES, usableCitations, type CompanyMetric, type MetricType } from '@mi/contracts';

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
  return m.passageSupport?.asOf || m.reportedSupport?.asOf || null;
}

/** One line per metric. Unknown / unsourced figures never carry a number. */
export function formatMetricLine(m: CompanyMetric): string {
  const label = METRIC_TYPE_LABELS[m.metricType] ?? m.metricType;
  const sources = m.confidence === 'unknown' || m.value === null ? [] : usableCitations(m.citations ?? []);
  if (m.confidence === 'unknown' || m.value === null || sources.length === 0) {
    return `- ${label}: Unknown (not in this deck's research)`;
  }
  const asOf = metricAsOf(m);
  const src = sources
    .slice(0, 2)
    .map((c) => `${c.title || 'source'} <${c.url}>`)
    .join('; ');
  return `- ${label}: ${formatMetricValue(m.metricType, m.value)} [${m.confidence}]${asOf ? `, as of ${asOf}` : ', as-of date not stated'}; source: ${src}`;
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

/** The final user-facing prompt: data first, conversation next, the ask LAST and unmissable. */
export function buildChatPrompt(parts: {
  dataBlocks: readonly string[];
  history: readonly ChatTurn[];
  question: string;
}): string {
  const convo = formatConversation(parts.history);
  return [
    ...parts.dataBlocks.filter(Boolean),
    convo ? `CONVERSATION SO FAR (oldest first):\n${convo}` : '',
    `THE USER'S NEW MESSAGE — reply to exactly this, directly and conversationally, using the conversation above for context (follow-ups like "and them?" or "why?" refer to it):\n${parts.question}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
