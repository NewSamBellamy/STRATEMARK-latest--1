import { Info, ShieldAlert } from 'lucide-react';

/** Shown on any card carrying estimated/unknown figures (spec §6.4 UI requirement). */
export function SoftDataDisclaimer({ compact = false }: { compact?: boolean }) {
  if (compact) {
    // Card-footer variant: one quiet line; the full sentence lives in the tooltip.
    return (
      <p
        className="flex items-center gap-1 text-[9px] leading-tight text-slate-500"
        title="Some figures are estimated from indirect signals, not company-disclosed data."
      >
        <Info className="h-2.5 w-2.5 shrink-0" aria-hidden />
        <span>Contains estimates</span>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-snug text-slate-600">
      <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span>Some figures are estimated from indirect signals, not company-disclosed data.</span>
    </p>
  );
}

/** Stronger, always-on disclaimer for Vice cards (reputational sensitivity, spec §4/§9). */
export function ViceDisclaimer() {
  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted">
      <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span>
        Each claim below is quoted from its source.
      </span>
    </p>
  );
}
