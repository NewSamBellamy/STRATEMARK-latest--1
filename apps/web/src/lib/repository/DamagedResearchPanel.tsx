import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { downloadBytes } from '@/lib/share/download';
import { readBrowserResearchData, readDamagedResearch, setDamagedResearchAside } from './browserResearchStore';

/**
 * Shown instead of the app when the saved workspace cannot be read. The research is the
 * person's own: nothing here runs on load. Each action is an explicit click, and starting
 * over only moves the damaged data to a backup key after the person confirms.
 */
export function DamagedResearchPanel({ message, onTryAgain, onStartedEmpty }: {
  message: string;
  onTryAgain: () => void;
  /** The damaged data has been set aside; open an empty workspace. */
  onStartedEmpty: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // The app keeps the previous save beside the current one: when the current one is damaged that copy is usually fine. Read only.
  const [lastGoodSave, setLastGoodSave] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    readBrowserResearchData().then((data) => { if (!cancelled) setLastGoodSave(data.backup); }, () => undefined);
    return () => { cancelled = true; };
  }, []);

  const downloadLastGoodSave = () => {
    if (lastGoodSave == null) return;
    downloadBytes(`stratemark-last-good-research-${new Date().toISOString().slice(0, 10)}.json`, new TextEncoder().encode(lastGoodSave), 'application/json');
  };

  const download = async () => {
    setNote(null);
    try {
      const saved = await readDamagedResearch();
      const stamp = new Date().toISOString().slice(0, 10);
      if (saved?.text != null) downloadBytes(`stratemark-damaged-research-${stamp}.txt`, new TextEncoder().encode(saved.text), 'text/plain');
      else if (saved?.bytes) downloadBytes(`stratemark-damaged-research-${stamp}.gz`, saved.bytes, 'application/octet-stream');
      else setNote('There is no saved data to download.');
    } catch {
      setNote('The damaged data could not be read from this browser to download. It has not been changed.');
    }
  };

  const startEmpty = async () => {
    setBusy(true);
    setNote(null);
    try {
      await setDamagedResearchAside();
      onStartedEmpty();
    } catch {
      setNote('Nothing was changed: the damaged data could not be safely set aside.');
      setConfirming(false);
    }
    setBusy(false);
  };

  return (
    <div role="alert" className="m-8 max-w-prose space-y-3 text-content">
      <p>{message}</p>
      <p>Your saved research has not been changed or deleted. You can keep a copy, try again, or start with an empty workspace.</p>
      <div className="flex flex-wrap gap-2">
        {lastGoodSave != null && <button className="btn-ghost" type="button" onClick={downloadLastGoodSave}><Download className="h-4 w-4" />Download the last good save</button>}
        <button className="btn-ghost" type="button" onClick={() => void download()}><Download className="h-4 w-4" />Download the damaged data</button>
        <button className="btn-ghost" type="button" onClick={onTryAgain}>Try again</button>
        {!confirming && <button className="btn-ghost" type="button" disabled={busy} onClick={() => setConfirming(true)}>Start with an empty workspace</button>}
      </div>
      {confirming && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p>This replaces your saved research with an empty workspace. Have you downloaded a copy?</p>
          <p className="text-sm text-muted">The damaged data is kept in this browser under a backup name, but a downloaded copy is the safe one.</p>
          <div className="flex gap-2">
            <button className="btn-ghost" type="button" disabled={busy} onClick={() => void startEmpty()}>Yes, start with an empty workspace</button>
            <button className="btn-ghost" type="button" disabled={busy} onClick={() => setConfirming(false)}>No, go back</button>
          </div>
        </div>
      )}
      {note && <p className="text-sm text-negative">{note}</p>}
    </div>
  );
}
