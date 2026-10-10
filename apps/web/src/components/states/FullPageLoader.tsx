import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Page loader. Most waits here are local reads or code loading, so it says
 * "Loading" and never claims research is happening; callers doing real
 * research pass a `label`. An honest clock appears after 5s and, after a
 * minute, a way out instead of an endless spinner.
 */
export function FullPageLoader({ label }: { label?: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const tick = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  return (
    <div
      className="flex h-full min-h-[60vh] w-full flex-col items-center justify-center gap-3 text-muted"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
      <span className="text-sm">{label ?? 'Loading…'}</span>
      {elapsed >= 5 && <span className="tabular-nums text-[11px] text-faint">{elapsed}s</span>}
      {elapsed >= 60 && (
        <span className="max-w-sm text-center text-[11px] leading-relaxed text-faint">
          This is taking longer than it should.{' '}
          <button type="button" className="font-medium text-primary-ink underline" onClick={() => window.location.reload()}>
            Reload
          </button>
        </span>
      )}
    </div>
  );
}
