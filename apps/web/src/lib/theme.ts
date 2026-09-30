/**
 * Visual theme tokens shared across components (charts, cards, badges).
 * The per-metric colors give each card its "pops of color" — every metric type
 * has a consistent hue everywhere (ref: the colored expense-category dashboard).
 */
import type { MaturityTier, MetricType } from '@mi/contracts';

/** One hue per metric type — used on card stat bars, the Metrics tab, sparklines. */
export const METRIC_COLORS: Record<MetricType, string> = {
  market_share: '#EF4444', // red
  valuation: '#8B5CF6', // violet
  market_cap: '#8B5CF6', // violet (same family — mutually exclusive with valuation)
  arr: '#F59E0B', // amber
  users: '#3B82F6', // blue
  employees: '#14B8A6', // teal
};

/** Size-signal band scale, cool → warm as the band rises. Saturated enough to hold
 *  up on both the light and dark canvases, so it isn't theme-switched. */
export const TIER_COLORS: Record<MaturityTier, string> = {
  1: '#64748B', // slate
  2: '#0EA5E9', // sky
  3: '#14B8A6', // teal
  4: '#10B981', // emerald
  5: '#F59E0B', // amber
  6: '#F15A24', // orange (brand)
  7: '#E11D48', // rose
  8: '#7C3AED', // violet
};

export const SENTIMENT_COLORS = {
  positive: '#16A34A',
  neutral: '#CA8A04',
  negative: '#DC2626',
} as const;

/**
 * Recharts styling, per theme.
 *
 * This is the one spot where theming can't ride on CSS variables: Recharts emits
 * these as SVG presentation attributes (`stroke="…"`), and `var(--x)` doesn't
 * resolve inside an attribute value. So the chart palette gets selected in JS.
 * Values mirror the CSS tokens named beside them — keep in sync with the `.dark`
 * block in index.css.
 */
export interface ChartTheme {
  axis: string;
  grid: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  /** Separator between adjacent donut slices — reads as the panel behind them. */
  sliceStroke: string;
}

const CHART_LIGHT: ChartTheme = {
  axis: '#A3ACA9', // --c-faint
  grid: '#F0F3F2', // lighter than surface-2
  tooltipBg: '#FFFFFF',
  tooltipBorder: '#DDE8E5', // --c-border
  tooltipText: '#171A19', // --c-content
  sliceStroke: '#FFFFFF',
};

const CHART_DARK: ChartTheme = {
  axis: '#707876', // --c-faint
  grid: '#242826', // --c-surface-2
  tooltipBg: '#242826',
  tooltipBorder: '#343A38', // --c-border
  tooltipText: '#EDF0EF', // --c-content
  sliceStroke: '#181B1A', // --c-surface
};

export function chartTheme(isDark: boolean): ChartTheme {
  return isDark ? CHART_DARK : CHART_LIGHT;
}

/** Hex + alpha → rgba() string, for subtle tinted fills. */
export function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
