import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Research-aware loader. A bare "Loading…" makes a 20-second grounded research
 * pass feel broken; naming what is actually happening makes the same wait read
 * as work. Lines rotate so a long pass visibly progresses instead of freezing.
 */
const RESEARCH_LINES = [
  'Researching from live sources…',
  'Running grounded Google searches…',
  'Reading and cross-checking coverage…',
  'Attaching citations to every claim…',
  'Assembling the sourced result…',
];

export function FullPageLoader({ label }: { label?: string }) {
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const tick = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    if (label) return;
    const t = setInterval(() => setStep((s) => (s + 1) % RESEARCH_LINES.length), 4000);
    return () => clearInterval(t);
  }, [label]);

  return (
    <div
      className="flex h-full min-h-[60vh] w-full flex-col items-center justify-center gap-3 text-muted"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
      <span className="text-sm transition-opacity duration-300">
        {label ?? RESEARCH_LINES[step]}
      </span>
      {/* An honest clock: a long pass must read as WORK, never as a hang. */}
      {elapsed >= 5 && (
        <span className="tabular-nums text-[11px] text-faint">{elapsed}s</span>
      )}
      {!label && (
        <span className="max-w-sm text-center text-[11px] leading-relaxed text-faint">
          {elapsed < 35
            ? 'Live research usually runs 15–30 seconds — every figure arrives with its sources.'
            : 'Still working — your key’s rate cap keeps research paced, and this section is in line. It will land; feel free to browse other tabs meanwhile.'}
        </span>
      )}
    </div>
  );
}
