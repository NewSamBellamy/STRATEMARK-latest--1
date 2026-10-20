import { useEffect, useState } from 'react';
import { DatabaseBackup, Download, Trash2 } from 'lucide-react';
import { clearBrowserResearch, installResearchImport, planResearchImport, readBrowserResearchData, type InstallKind } from '@/lib/repository/browserResearchStore';
import { importQuestion } from '@/lib/repository/importSummary';
import { exportSnapshot } from '@/lib/repository/vault';
import { ErrorState } from './ErrorState';

/**
 * The ways out when the app cannot start, kept free of everything that has to
 * start first: no router, no query client, no repository, and no research
 * parsed into screens. Whatever is wrong with the saved research, these three
 * read and write it as plain stored text.
 *
 * Why this exists: Settings, the only place to export, restore or replace the
 * workspace, is inside the app. A saved workspace that crashes the app on every
 * start left the person with an error and a Try again button that could only
 * fail the same way.
 */
export function RecoveryActions() {
  const [saved, setSaved] = useState<{ current: boolean; backup: string | null; beforeImport: string | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    readBrowserResearchData({ tolerateUnreadable: true })
      .then((data) => {
        if (!live) return;
        setSaved({ current: data.current !== null, backup: data.backup, beforeImport: data.beforeImport });
        if (data.unreadable) setMessage('Your saved research could not be read, so it cannot be downloaded. The backup below, if there is one, is untouched.');
      })
      .catch(() => {
        if (!live) return;
        setSaved({ current: false, backup: null, beforeImport: null });
        setMessage('Saved research could not be opened in this browser. Nothing has been deleted.');
      });
    return () => { live = false; };
  }, []);

  /** Runs one recovery step; nothing else is touched if it fails, and the page only reloads when it worked. */
  const run = async (step: () => Promise<boolean | void>, failure: string) => {
    setBusy(true);
    setMessage(null);
    try {
      if (await step() === false) return;
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : failure);
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (!(await exportSnapshot())) setMessage('There is nothing saved in this browser to download.');
    } catch {
      setMessage('Your saved research could not be read, so it cannot be downloaded. Nothing has been deleted.');
    } finally {
      setBusy(false);
    }
  };

  /** Restores one of the two saved copies after saying what it brings in. The recovery install works on a workspace that cannot be read. */
  const restoreFrom = (json: string, what: string, kind: InstallKind) => run(async () => {
    const plan = planResearchImport(json);
    if (!window.confirm(importQuestion(plan, what, { kind }))) return false;
    await installResearchImport(plan, { recovering: true, kind });
    return true;
  }, 'That copy could not be restored. Nothing has been deleted.');
  const restore = () => restoreFrom(saved!.backup!, 'the last backup', 'backup');
  const restoreBeforeImport = () => restoreFrom(saved!.beforeImport!, 'your research from before the import', 'before-import');

  const startFresh = () => run(async () => {
    const sure = window.confirm('Start fresh?\n\nThis deletes the research saved in this browser, including its backup and any copy kept from before an import. Download it first if you want a copy. Your API key and settings are kept.');
    if (!sure) return false;
    await clearBrowserResearch();
    return true;
  }, 'Saved research could not be deleted.');

  return (
    <div className="panel mx-auto mt-4 max-w-md space-y-3 px-6 py-5 text-sm">
      <h3 className="font-display text-lg text-content">Recover your research</h3>
      <p className="text-muted">Your research is still saved in this browser. Download a copy first, then go back to the last backup or start over.</p>
      <div className="flex flex-wrap gap-2">
        {saved?.current && (
          <button type="button" className="btn-ghost border border-border" disabled={busy} onClick={() => void download()}>
            <Download className="h-4 w-4" aria-hidden /> Download my research
          </button>
        )}
        {saved?.backup && (
          <button type="button" className="btn-ghost border border-border" disabled={busy} onClick={() => void restore()}>
            <DatabaseBackup className="h-4 w-4" aria-hidden /> Restore the last backup
          </button>
        )}
        {saved?.beforeImport && (
          <button type="button" className="btn-ghost border border-border" disabled={busy} onClick={() => void restoreBeforeImport()}>
            <DatabaseBackup className="h-4 w-4" aria-hidden /> Restore my research from before the import
          </button>
        )}
        <button type="button" className="btn-ghost border border-border" disabled={busy} onClick={() => void startFresh()}>
          <Trash2 className="h-4 w-4" aria-hidden /> Start fresh
        </button>
      </div>
      {message && <p role="status" className="text-negative">{message}</p>}
    </div>
  );
}

/** What the whole app shows in place of itself when it fails to start. */
export function StartupFailure({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="p-8">
      <ErrorState title="The app failed to start" message={error.message} onRetry={onRetry} />
      <RecoveryActions />
    </div>
  );
}
