import { Pause, Play } from 'lucide-react';
import { useResearchControl } from './researchControl';

const NOTE = 'Opening tabs and manual checks can still use your key; work already sent may finish.';

/**
 * A quiet switch: a small icon button (label and tooltip carry the words), plus a
 * plain note only once paused. Renders inline: the parent supplies the flex-wrap
 * row, so it shares the dashboard's freshness row instead of adding its own.
 */
export function BackgroundResearchControl({ showState = false }: {
  /** Say the current state in words too, so a row with no freshness line is not a bare icon. */
  showState?: boolean;
}) {
  const { paused, storageError, setPaused } = useResearchControl();
  const label = paused ? 'Resume background research' : 'Pause background research';
  return <>
    {paused && <span className="text-[11.5px]">Background research paused across this app. {NOTE}</span>}
    {!paused && showState && <span>Background research is on</span>}
    <button type="button" aria-label={label} title={`${paused ? 'Background research is paused' : 'Background research is on'}. ${NOTE}`}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-content"
      onClick={() => setPaused(!paused)}>
      {paused ? <Play className="h-3.5 w-3.5" aria-hidden /> : <Pause className="h-3.5 w-3.5" aria-hidden />}
    </button>
    {storageError && <p role="alert" className="basis-full text-right text-[11px]">{storageError}</p>}
  </>;
}
