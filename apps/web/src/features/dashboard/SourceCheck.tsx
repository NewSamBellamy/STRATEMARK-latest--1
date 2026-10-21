import type { CompanyMetric, CurrencyState, FigureAssessment } from '@mi/contracts';
import { cn } from '@/lib/cn';

/**
 * The "Source check" in plain English: a one-line summary that opens to five lines
 * (when, who, how, why, how many). It only reads the assessment the repository computed
 * on read (never computes or imputes one): a figure with no assessment, no value, or a
 * human's own correction shows nothing here.
 */
type Checked = Pick<CompanyMetric, 'value' | 'confidence' | 'assessment'>;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const statedMonth = (date: string): string => {
  const [y, m] = date.split('-');
  return m && MONTHS[Number(m) - 1] ? `${MONTHS[Number(m) - 1]} ${y}` : y!;
};

const assessable = (m: Checked): FigureAssessment | null =>
  m.value != null && m.confidence !== 'user_verified' && m.confidence !== 'unknown' ? m.assessment ?? null : null;

/** The figure's currency, or null when it is a human's figure, empty, or never assessed. */
export const figureCurrency = (m: Checked): CurrencyState | null => assessable(m)?.currency.state ?? null;

/** Figures whose date is out of date or missing. */
export const staleFigureCount = (metrics: readonly Checked[]): number =>
  metrics.filter((m) => { const s = figureCurrency(m); return s === 'stale' || s === 'undated'; }).length;

/** "5 current, 2 out of date, 1 undated" counts (aging counts as current: still inside its window). */
export function figureCounts(metrics: readonly (Checked & { metricType: CompanyMetric['metricType'] })[]) {
  let current = 0; let outOfDate = 0; let undated = 0;
  let oldest: { label: CompanyMetric['metricType']; asOf: string } | null = null;
  for (const m of metrics) {
    const a = assessable(m);
    if (!a) continue;
    if (a.currency.state === 'stale') outOfDate += 1; else if (a.currency.state === 'undated') undated += 1; else current += 1;
    if (a.currency.asOf && (!oldest || a.currency.asOf < oldest.asOf)) oldest = { label: m.metricType, asOf: a.currency.asOf };
  }
  return { current, outOfDate, undated, oldest };
}

const TIER_WORD: Record<number, string> = {
  1: 'regulator or official filing', 2: 'wire service or company site', 3: 'established publisher',
  4: 'data provider or analyst', 5: 'community or unrecognised source',
};
const SUPPORT_WORD: Record<FigureAssessment['accuracy']['support'], string> = {
  human: 'Checked by a person', original_passage: 'The figure is stated on a saved copy of the page',
  page_quote: 'A quote on the saved page carries the figure', computed: 'Computed from quoted prices and share counts',
  page_confirmed: 'A page confirms the figure', search_attributed: 'Found through search; the page was not read', none: 'No page supports it',
};
const PURPOSE_WORD: Record<FigureAssessment['purpose']['kind'], string> = {
  regulatory_filing: 'Filed with a regulator', company_reported: 'Reported by the company itself', press_release: 'A press release (company-reported)',
  neutral_reporting: 'Independent reporting', industry_data: 'Industry data', sponsored_or_contributor: 'Sponsored or contributor content',
  competitor: "A competitor's page", advocacy: 'An advocacy group', community: 'Community discussion', unknown: 'Purpose of the source unclear',
};

/** The five lines, in order. `label` names the figure for the "out of date for ..." reason. */
export function sourceCheckLines(m: Checked, label: string): string[] {
  const a = assessable(m);
  if (!a) return [];
  const { currency } = a;
  const when = currency.asOf == null
    ? (currency.state === 'stale' ? 'No stated date, and the page is old: age unknown' : 'No stated date: age unknown')
    : `${currency.asOfSource === 'filing' ? 'Filed' : 'As of'} ${statedMonth(currency.asOf)} (${currency.state === 'stale'
      ? `out of date for ${label.toLowerCase()}: ${Math.floor((currency.ageDays ?? 0) / 30.4375)} months` : currency.state})`;
  const who = a.authority.tier == null ? 'Source not identified'
    : `${a.authority.publisher ?? 'Unnamed source'} (${TIER_WORD[a.authority.tier]})`;
  const n = a.accuracy.independentSources;
  const how = a.accuracy.corroboration === 'contested' ? 'Sources disagree on this figure'
    : n >= 2 ? `${n} independent sources agree` : n === 1 ? 'One source, no independent confirmation' : 'No source to check against';
  return [when, who, SUPPORT_WORD[a.accuracy.support], PURPOSE_WORD[a.purpose.kind], how];
}

const STATUS_WORD: Record<CurrencyState, string> = { current: 'Current', aging: 'Aging', stale: 'Out of date', undated: 'Undated' };
// The freshness row's own colours: its warning red for old research, quiet text otherwise.
const STATUS_TONE: Record<CurrencyState, string> = {
  current: 'text-faint', aging: 'text-muted', stale: 'text-red-700 dark:text-negative', undated: 'text-red-700 dark:text-negative',
};

export function SourceCheck({ metric, label, className }: { metric: Checked; label: string; className?: string }) {
  const lines = sourceCheckLines(metric, label);
  if (lines.length === 0) return null;
  const status = figureCurrency(metric)!;
  return (
    <details className={cn('text-[11px] leading-snug text-faint', className)} aria-label={`Source check for ${label}`}>
      <summary className="cursor-pointer list-none">
        <span className="font-medium text-muted">Source check: </span>
        <span className={cn((status === 'stale' || status === 'undated') && STATUS_TONE[status])}>{lines[0]}</span>
        {metric.confidence === 'estimated' && <>{' · '}<abbr title="Estimated" className="no-underline">est.</abbr></>}
      </summary>
      <ul className="mt-0.5 space-y-0.5">{lines.map((line) => <li key={line}>{line}</li>)}</ul>
    </details>
  );
}

/** A small word for a figure's freshness (Overview tiles); nothing when it was never assessed. */
export function FreshnessMark({ metric }: { metric: Checked }) {
  const status = figureCurrency(metric);
  if (!status) return null;
  return <span className={cn('text-[11px]', STATUS_TONE[status])} data-freshness={status}>{STATUS_WORD[status]}</span>;
}
