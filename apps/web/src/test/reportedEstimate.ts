import type { CompanyMetric } from '@mi/contracts';

const PHRASE: Partial<Record<CompanyMetric['metricType'], (name: string, n: string) => string>> = {
  employees: (name, n) => `${name} reported ${n} employees as of 2026-08-31.`,
  valuation: (name, n) => `${name} has a valuation of $${n} as of 2026-08-31.`,
  distribution: (name, n) => `${name} operates in ${n} countries as of 2026-08-31.`,
  users: (name, n) => `${name} reported ${n} users as of 2026-08-31.`,
  market_share: (name, n) => `${name} holds a market share of ${n}% as of 2026-08-31.`,
  arr: (name, n) => `${name} reported ARR of $${n} as of 2026-08-31.`,
};

/**
 * A test figure that a card would also show: an estimate carrying the
 * provider-reported support the card face re-checks (company named, figure and
 * basis in one dated sentence, a usable source). Dashboard surfaces now read
 * the card's gate, so a fixture that needs to appear must pass it.
 */
export function reportedEstimate(metric: CompanyMetric, companyName: string,
  { url = 'https://sec.gov/Archives/report', text, asOf = '2026-08-31' }: { url?: string; text?: string; asOf?: string | null } = {}): CompanyMetric {
  const phrase = PHRASE[metric.metricType];
  if (!phrase || metric.value == null) throw new Error(`No reported-support phrase for ${metric.metricType}`);
  const unit = metric.metricType === 'market_share' ? 'percent'
    : ['employees', 'distribution', 'users'].includes(metric.metricType) ? 'count' : 'USD';
  // A figure that holds always has a usable link; the row's own, when the test set one, stays.
  const linked = metric.citations.length > 0 ? {} : { source: url, citations: [{ title: 'Annual report', url }] };
  return { ...metric, ...linked, confidence: 'estimated',
    reportedSupport: { provider: 'google-search', companyName, basis: metric.metricType, definition: metric.metricType,
      value: metric.value, unit, asOf,
      support: { supportIndex: 0, text: text ?? phrase(companyName, metric.value.toLocaleString('en-US')), sources: [{ chunkIndex: 0, url, title: 'Annual report' }] } } };
}
