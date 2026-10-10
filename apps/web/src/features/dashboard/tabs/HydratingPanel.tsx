import { useEffect, useState } from 'react';

/**
 * The "actively hydrating" state for a dashboard tab whose research pass is in
 * flight. A bare spinner reads as a hang; a named, pulsing skeleton reads as a
 * cascade in motion — the tab fills in the moment the evidence lands.
 *
 * Used as the `loading` branch of each tab's QueryBoundary, so a tab is either
 * fully cached (instant) or visibly hydrating — never a dead wall.
 */
const SKELETON_PANELS = ['w-3/4', 'w-full', 'w-5/6', 'w-2/3'];

export function HydratingPanel({ label }: { label?: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-busy="true">
      <div className="flex items-center gap-3 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3">
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-content">
            Actively hydrating{label ? ` — ${label}` : ''}
          </p>
          <p className="text-xs text-muted">
            This section is being researched from live sources right now. It fills in as evidence
            lands{elapsed >= 30 ? ' — your key’s rate cap keeps research paced; it will land.' : '.'}
          </p>
        </div>
        {elapsed >= 5 && (
          <span className="ml-auto shrink-0 tabular-nums text-[11px] text-faint">{elapsed}s</span>
        )}
      </div>
      {/* Skeletons in the shape of the sections to come — cascade, not void. */}
      <div className="panel space-y-3 p-6">
        {SKELETON_PANELS.map((width, i) => (
          <div
            key={i}
            className={`h-3.5 animate-pulse rounded bg-border ${width}`}
            style={{ animationDelay: `${i * 90}ms` }}
          />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel space-y-3 p-6">
          {SKELETON_PANELS.slice(0, 3).map((width, i) => (
            <div
              key={i}
              className={`h-3.5 animate-pulse rounded bg-border ${width}`}
              style={{ animationDelay: `${(i + 4) * 90}ms` }}
            />
          ))}
        </div>
        <div className="panel space-y-3 p-6">
          {SKELETON_PANELS.slice(0, 3).map((width, i) => (
            <div
              key={i}
              className={`h-3.5 animate-pulse rounded bg-border ${width}`}
              style={{ animationDelay: `${(i + 7) * 90}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
