/**
 * "Share as a page": the whole card or deck as one page anyone can open with no
 * account, with every dashboard tab inside. The app builds the files (the page,
 * a link-preview picture and a firebase.json); publishing them is one command
 * with the owner's Firebase login, so that part stays outside the app.
 */
import { useState } from 'react';
import { Download, FileArchive, Loader2 } from 'lucide-react';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { downloadBytes } from '@/lib/share/download';
import { createSharePackage, drawPreview, fetchViewerTemplate, type SharePackage } from '@/lib/share/package';

const BASE_KEY = 'stratemark.share.base';

function readBase(): string {
  try { return localStorage.getItem(BASE_KEY) ?? ''; } catch { return ''; }
}

export function SharePageSection({ deckId, cardId, bare = false }: { deckId: string; cardId?: string | null; /** Inside a disclosure that already frames it. */ bare?: boolean }) {
  const repo = useRepository();
  const [base, setBase] = useState(readBase);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<SharePackage | null>(null);

  const baseOk = base.trim() === '' || /^https:\/\/[^\s/]+(\/[^\s]*)?$/i.test(base.trim());

  const create = async () => {
    if (!repo.exportShareSnapshot || busy || !baseOk) return;
    setBusy(true);
    setError(null);
    setMade(null);
    try {
      const trimmed = base.trim().replace(/\/+$/, '');
      try { localStorage.setItem(BASE_KEY, trimmed); } catch { /* remembered next time only when storage works */ }
      const [snapshot, template] = await Promise.all([
        repo.exportShareSnapshot({ deckId, cardId: cardId ?? null }),
        fetchViewerTemplate(),
      ]);
      const pack = await createSharePackage({ snapshot, template, baseUrl: trimmed || null, renderImage: drawPreview });
      downloadBytes(pack.fileName, pack.zip, 'application/zip');
      setMade(pack);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The page could not be built.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Share as a page" className={bare ? '' : 'rounded-xl border border-border bg-surface-2/60 px-4 py-3.5'}>
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-content">
        <FileArchive className="h-4 w-4 text-muted" aria-hidden />
        Share as a page
      </h3>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        {cardId ? 'The card, with every tab of its research,' : 'The whole deck, with every tab of its research,'} as one page anyone can open on a phone
        or a laptop. No account needed, and nothing new is researched. It previews with a picture when pasted into a chat.
      </p>
      <label className="mt-3 block text-[11px] font-semibold uppercase tracking-widest text-faint" htmlFor="share-base">
        Where you will host it (optional)
      </label>
      <input
        id="share-base"
        className="input mt-1.5 py-2 text-sm"
        placeholder="https://share.example.com"
        value={base}
        onChange={(e) => setBase(e.target.value)}
        aria-invalid={!baseOk}
      />
      <p className={`mt-1 text-[11px] ${baseOk ? 'text-faint' : 'text-negative'}`}>
        {baseOk
          ? 'Chat apps need the full address to show the preview picture. Leave it blank and the page still works, without a picture.'
          : 'Use a full https address, for example https://share.example.com'}
      </p>
      <button type="button" className="btn-ghost mt-3" disabled={busy || !baseOk} onClick={() => void create()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {busy ? 'Building the page…' : 'Download the page (.zip)'}
      </button>
      {error && <p role="alert" className="mt-2 text-[12px] text-negative">{error}</p>}
      {made && (
        <div role="status" className="mt-3 space-y-1 text-[12px] leading-relaxed text-muted">
          <p className="font-medium text-content">Saved {made.fileName}</p>
          <p>
            {made.hasImage && base.trim() ? 'It includes the preview picture. ' : made.hasImage ? 'It includes a preview picture; add your hosting address to use it. ' : ''}
            To publish: unzip it, open that folder in a terminal, and run{' '}
            <code className="rounded bg-surface px-1 py-0.5 text-[11.5px]">firebase deploy --only hosting</code>. The link is{' '}
            <span className="font-medium text-content">{base.trim() ? `${base.trim().replace(/\/+$/, '')}/${made.id}/` : `your address/${made.id}/`}</span>
          </p>
        </div>
      )}
    </section>
  );
}
