import type { CompanyMetric, CurrencyStatus } from '@mi/contracts';
import { cn } from '@/lib/cn';

/**
 * The CRAAP "Source check" in plain English. It only reads the stored
 * assessment (never computes or imputes one): a figure with no assessment, no
 * value, or a human's own correction shows nothing here.
 */
type Checked = Pick<CompanyMetric, 'value' | 'confidence' | 'assessment'>;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const stated = (date: string): string => {
  const [y, m] = date.split('-');
  return m && MONTHS[Number(m) - 1] ? `${MONTHS[Number(m) - 1]} ${y}` : y!;
};

const assessable = (m: Checked) => m.value != null && m.confidence !== 'user_verified' && m.confidence !== 'unknown' ? m.assessment ?? null : null;

/** The figure's currency, or null when it is a human's figure, empty, or never assessed. */
export const figureCurrency = (m: Checked): CurrencyStatus | null => assessable(m)?.currency.status ?? null;

/** Stored figures whose evidence is older than usual or undated (the same rule the refresh uses). */
export const staleFigureCount = (metrics: readonly Checked[]): number =>
  metrics.filter((m) => { const s = figureCurrency(m); return s === 'stale' || s === 'undated'; }).length;

/** The lines to show, in order. `label` names the figure for the "older than usual for ..." reason. */
export function sourceCheckLines(m: Checked, label: string): string[] {
  const a = assessable(m);
  if (!a) return [];
  const { currency } = a;
  const first = currency.status === 'undated' || !currency.date ? 'No publication date: age unknown'
    : `${currency.basis === 'asOf' ? 'As of' : 'Published'} ${stated(currency.date)} (${currency.status === 'stale'
      ? `older than usual for ${label.toLowerCase()}: ${Math.floor(currency.ageMonths ?? 0)} months` : currency.status})`;
  return [first, ...a.plainEnglish.slice(1)];
}

const STATUS_WORD: Record<CurrencyStatus, string> = { current: 'Current', aging: 'Aging', stale: 'Stale', undated: 'Undated' };
// The freshness row's own colours: its warning red for old research, quiet text otherwise.
const STATUS_TONE: Record<CurrencyStatus, string> = {
  current: 'text-faint', aging: 'text-muted', stale: 'text-red-700 dark:text-negative', undated: 'text-red-700 dark:text-negative',
};

export function SourceCheck({ metric, label, className }: { metric: Checked; label: string; className?: string }) {
  const lines = sourceCheckLines(metric, label);
  if (lines.length === 0) return null;
  const status = figureCurrency(metric)!;
  return (
    <p className={cn('text-[11px] leading-snug text-faint', className)} aria-label={`Source check for ${label}`}>
      <span className="font-medium text-muted">Source check: </span>
      <span className={cn(lines[0] && (status === 'stale' || status === 'undated') && STATUS_TONE[status])}>{lines[0]}</span>
      {lines.slice(1).map((line) => <span key={line}>{' · '}{line}</span>)}
      {metric.confidence === 'estimated' && <>{' · '}<abbr title="Estimated" className="no-underline">est.</abbr></>}
    </p>
  );
}

/** A small word for a figure's freshness (Overview tiles); nothing when it was never assessed. */
export function FreshnessMark({ metric }: { metric: Checked }) {
  const status = figureCurrency(metric);
  if (!status) return null;
  return <span className={cn('text-[11px]', STATUS_TONE[status])} data-freshness={status}>{STATUS_WORD[status]}</span>;
}
