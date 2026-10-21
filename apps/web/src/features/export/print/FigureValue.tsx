/**
 * One face figure as the report prints it, the same way everywhere: verified in solid ink, estimated in italics with
 * "est.", unknown as the muted word "Unknown". The text is the model's `display`; this file formats nothing.
 */
import type { OverviewEntry } from '../fullReportModel';

export function FigureValue({ entry, className }: { entry: Pick<OverviewEntry, 'status' | 'display' | 'confidence' | 'note'> | null; className?: string }) {
  const cls = (extra: string) => [className, extra].filter(Boolean).join(' ');
  if (!entry || entry.status === 'unknown' || entry.display == null) {
    return <span className={cls('sm-fv sm-fv--unknown')}>Unknown</span>;
  }
  const estimated = entry.confidence === 'estimated';
  return (
    <span className={cls(estimated ? 'sm-fv sm-fv--estimated' : 'sm-fv')}>
      {entry.display}
      {estimated && <span className="sm-fv-est"> est.</span>}
      {entry.note != null && <sup className="sm-note">{entry.note}</sup>}
    </span>
  );
}
