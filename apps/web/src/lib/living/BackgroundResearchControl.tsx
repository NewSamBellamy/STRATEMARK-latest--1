import { Pause, Play } from 'lucide-react';
import { useResearchControl } from './researchControl';

const NOTE = 'Opening tabs and manual checks can still use your key; work already sent may finish.';

/** A quiet switch: one small control while research runs, a plain note only once paused. */
export function BackgroundResearchControl() {
  const { paused, storageError, setPaused } = useResearchControl();
  return <div className="mb-3 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[11px] text-faint">
    {paused && <span>Background research paused across this app. {NOTE}</span>}
    <button type="button" title={paused ? undefined : `Background research is on. ${NOTE}`}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-muted transition-colors hover:bg-surface-2 hover:text-content"
      aria-pressed={paused} onClick={() => setPaused(!paused)}>
      {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
      {paused ? 'Resume background research' : 'Pause background research'}
    </button>
    {storageError && <p role="alert" className="basis-full text-right">{storageError}</p>}
  </div>;
}
