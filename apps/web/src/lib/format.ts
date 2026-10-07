import type { CompanyMetric, Confidence, MetricType } from '@mi/contracts';

/** Compact USD (e.g. $6.2B, $145.0M, $600K). */
export function formatUsd(value: number | null | undefined): string {
  if (value == null) return 'Unknown';
  if (value === 0) return '$0';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

/** Compact count (e.g. 48M, 1.4M, 9K, 620). */
export function formatCount(value: number | null | undefined): string {
  if (value == null) return 'Unknown';
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return value.toLocaleString();
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null) return 'Unknown';
  return `${value.toFixed(digits)}%`;
}

/** Human relative time from an ISO string (e.g. "2h ago", "3d ago"). */
export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const diffMs = now - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Format a metric row's value according to its type. */
export function formatMetricValue(type: MetricType, value: number | null): string {
  if (value == null) return 'Unknown';
  switch (type) {
    case 'market_cap':
    case 'valuation':
    case 'arr':
      return formatUsd(value);
    case 'market_share':
      return formatPercent(value);
    case 'users':
    case 'employees':
      return formatCount(value);
  }
}

export const CONFIDENCE_STYLES: Record<Confidence, string> = {
  verified: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  estimated: 'border-amber-300 bg-amber-50 text-amber-700',
  unknown: 'border-slate-300 bg-slate-100 text-slate-600',
  user_verified: 'border-sky-300 bg-sky-50 text-sky-700',
};

/** Does a set of metrics include any estimated / unknown figures? Drives the card disclaimer. */
export function hasSoftData(metrics: CompanyMetric[]): boolean {
  return metrics.some((m) => m.confidence === 'estimated' || m.confidence === 'unknown');
}

/** Monogram initials for the logo fallback. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
