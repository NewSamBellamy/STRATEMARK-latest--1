import { SearchX } from 'lucide-react';

/** The one honest-unknown vocabulary. Unknown is a finding, not a blank
 * (design system §4): every surface that lacks a figure states so the same
 * way — full slot on metric tiles, compact chip inline — with the same
 * explanation attached. Never a zero, never a blank, never bespoke wording. */
export const UNKNOWN_REASON =
  'No confirmed figure is recorded. Missing evidence does not mean the figure is zero or unavailable publicly.';

/** Full-size unknown, sized for metric tiles. */
export function UnknownSlot() {
  return (
    <div className="flex h-full min-h-[72px] flex-col items-start justify-center gap-1 rounded-lg border border-dashed border-border bg-surface-2/50 px-3 py-2.5">
      <span className="flex items-center gap-1.5 font-display text-lg font-semibold text-muted">
        <SearchX className="h-4 w-4" />
        Unknown
      </span>
      <span className="text-[11px] leading-snug text-faint">{UNKNOWN_REASON}</span>
    </div>
  );
}

/** Compact unknown for inline values (funding rows, org details). */
export function UnknownInline() {
  return (
    <span
      className="inline-flex items-center rounded border border-dashed border-border bg-surface-2/50 px-1.5 py-px align-baseline text-[11px] font-medium text-faint"
      title={UNKNOWN_REASON}
    >
      Unknown
    </span>
  );
}
