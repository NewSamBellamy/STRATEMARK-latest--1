import { Pause, Play } from 'lucide-react';
import { useResearchControl } from './researchControl';

export function BackgroundResearchControl() {
  const { paused, storageError, setPaused } = useResearchControl();
  return <div className="mb-3 text-[11px] text-muted">
    <button type="button" className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 hover:bg-surface-2"
      aria-pressed={paused} onClick={() => setPaused(!paused)}>
      {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
      {paused ? 'Resume background research' : 'Pause background research'}
    </button>
    <span className="ml-2">{paused ? 'Background research paused across this app.' : 'Background research on.'} Opening tabs and manual checks can still use your key; work already sent may finish.</span>
    {storageError && <p role="alert" className="mt-1">{storageError}</p>}
  </div>;
}
