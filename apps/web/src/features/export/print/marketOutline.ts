/**
 * The market report's section numbering, in one place, so the contents page and every section opener agree.
 * 01 The market (card lineup and overview), 02 Companies, then Signals (only when the report prints any), then
 * Methods and sources. Counts here are read off the model; nothing is computed from figures.
 */
import type { FullReportModel } from '../fullReportModel';

export const MARKET_ANCHORS = { lineup: 'sm-lineup', overview: 'sm-glance', companies: 'sm-companies', signals: 'sm-signals', methods: 'sm-methods', sources: 'sm-sources' } as const;

export interface MarketOutline {
  market: string;
  companies: string;
  /** Null when the report prints no signal. */
  signals: string | null;
  methods: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function marketOutline(model: FullReportModel): MarketOutline {
  const hasSignals = model.signalTally.printable > 0 || model.marketSignalCount > 0;
  return { market: pad(1), companies: pad(2), signals: hasSignals ? pad(3) : null, methods: pad(hasSignals ? 4 : 3) };
}

