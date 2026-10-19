/**
 * "Create link": one tap makes a short link that opens a read-only copy of a
 * card or a whole deck, with every tab of its research, and that chat apps show
 * with a title and a picture. Nothing is uploaded until the person presses the
 * button, and the dialog says what is kept, for how long, and how to stop it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, Loader2, Link2, Share2, Trash2 } from 'lucide-react';
import type { SharePayload } from '@/lib/share/codec';
import { Modal } from '@/components/ui/Modal';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { drawPreview } from '@/lib/share/package';
import {
  createHostedShare, findReusableShare, forgetShare, rememberShare, snapshotFingerprint, stopHostedShare, type HostedShare,
} from '@/lib/share/hostedShare';
import { copyText, shareTargets, TargetGrid } from './ShareTargets';

type View =
  | { step: 'ready' }
  | { step: 'working'; stage: string }
  | { step: 'done'; share: HostedShare }
  | { step: 'stopped' }
  | { step: 'error'; message: string };

export function HostedShareDialog({
  open,
  onOpenChange,
  title,
  subtitle,
  build,
  page,
  onPrivate,
  ttlDays = 90,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string | null;
  /** Runs the card's fact-check pass (a deck's is instant). Its payload is not used: the link is made from the stored snapshot. */
  build: (onStage: (stage: string) => void) => Promise<SharePayload>;
  page: { deckId: string; cardId?: string | null };
  /** Switch to the private link (nothing is uploaded). */
  onPrivate: () => void;
  ttlDays?: number;
}) {
  const repo = useRepository();
  const [view, setView] = useState<View>({ step: 'ready' });
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [busyStop, setBusyStop] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const run = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subject = `${page.cardId ? 'card' : 'deck'}:${page.deckId}${page.cardId ? `:${page.cardId}` : ''}`;
  const message = subtitle ? `${title} · ${subtitle}` : title;

  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);
  useEffect(() => {
    if (!open) {
      run.current += 1;
      setView({ step: 'ready' });
      setCopied('idle');
      setStopError(null);
      setBusyStop(false);
    }
  }, [open]);

  const create = useCallback(async () => {
    const id = ++run.current;
    const current = () => run.current === id;
    setStopError(null);
    setCopied('idle');
    setView({ step: 'working', stage: 'Preparing…' });
    try {
      if (!repo.exportShareSnapshot) throw new Error('This version of Stratemark cannot make a share link.');
      // A card runs its fact-check pass first, so the figures it carries are the reconciled ones. A deck's call is instant.
      await build((stage) => { if (current()) setView({ step: 'working', stage }); });
      if (!current()) return;
      setView({ step: 'working', stage: 'Gathering the research…' });
      const snapshot = await repo.exportShareSnapshot({ deckId: page.deckId, cardId: page.cardId ?? null });
      if (!current()) return;
      const fingerprint = snapshotFingerprint(snapshot);
      const reusable = findReusableShare(subject, fingerprint);
      if (reusable) { setView({ step: 'done', share: reusable }); return; }
      setView({ step: 'working', stage: 'Making the link…' });
      const share = await createHostedShare(snapshot, { renderImage: drawPreview });
      if (!current()) return;
      rememberShare({ ...share, subject, fingerprint, title });
      setView({ step: 'done', share });
    } catch (error) {
      if (current()) setView({ step: 'error', message: error instanceof Error ? error.message : 'The link could not be made.' });
    }
  }, [build, page.cardId, page.deckId, repo, subject, title]);

  const onCopy = async (url: string) => {
    const ok = await copyText(url, input.current);
    setCopied(ok ? 'ok' : 'fail');
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied('idle'), 2500);
  };

  const stop = async (share: HostedShare) => {
    setBusyStop(true);
    setStopError(null);
    try {
      await stopHostedShare(share);
      forgetShare(share.id);
      setView({ step: 'stopped' });
    } catch (error) {
      setStopError(error instanceof Error ? error.message : 'Could not stop sharing just now.');
    } finally {
      setBusyStop(false);
    }
  };

  const nav = navigator as Navigator & { share?: (data: { title: string; url: string }) => Promise<void> };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Share: ${title}`} size="md">
      <div className="space-y-4">
        {subtitle && <p className="-mt-2 text-[12px] text-muted">{subtitle}</p>}

        {view.step === 'ready' && (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-content">
              Make a link to a read-only copy of {page.cardId ? 'this card' : 'this deck'} with its research and sources. Anyone with the link can open it on a
              phone or a laptop, with no account, and it shows a preview in chat apps.
            </p>
            <button type="button" className="btn-primary" onClick={() => void create()}>
              <Link2 className="h-4 w-4" />
              Create link
            </button>
            <p className="text-[11.5px] leading-relaxed text-faint">
              To make the link work, Stratemark keeps a copy of this research on its servers for {ttlDays} days. Anyone who has the link can read it. You can stop
              sharing at any time, and nothing is uploaded until you press the button.
            </p>
            <button type="button" className="text-[12px] font-medium text-primary-ink underline-offset-2 hover:underline" onClick={onPrivate}>
              Use a private link instead (nothing is uploaded)
            </button>
          </div>
        )}

        {view.step === 'working' && (
          <div role="status" className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3">
            <Loader2 className="h-4 w-4 animate-spin text-primary-ink" />
            <p className="text-[13px] text-content">{view.stage}</p>
          </div>
        )}

        {view.step === 'error' && (
          <div role="alert" className="rounded-xl border border-negative/30 bg-negative/5 px-4 py-3">
            <p className="flex items-start gap-2 text-[13px] font-medium text-negative">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {view.message}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" className="btn-ghost border border-border" onClick={() => void create()}>Try again</button>
              <button type="button" className="text-[12px] font-medium text-primary-ink underline-offset-2 hover:underline" onClick={onPrivate}>
                Use a private link instead
              </button>
            </div>
          </div>
        )}

        {view.step === 'done' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                ref={input}
                readOnly
                value={view.share.url}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-muted outline-none focus:border-primary/50"
                aria-label="Share link"
              />
              <button
                type="button"
                onClick={() => void onCopy(view.share.url)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-semibold text-content transition-colors hover:bg-surface-2"
              >
                {copied === 'ok' ? <Check className="h-3.5 w-3.5 text-positive" /> : <Copy className="h-3.5 w-3.5" />}
                {copied === 'ok' ? 'Copied' : 'Copy link'}
              </button>
            </div>
            {copied === 'fail' && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                This browser blocked automatic copying. The link is selected above: press <kbd className="rounded border border-border bg-surface-2 px-1">Ctrl/⌘ C</kbd>.
              </p>
            )}

            {view.share.imageUrl && (
              <figure className="overflow-hidden rounded-xl border border-border bg-surface-2">
                <img src={view.share.imageUrl} alt={`The preview chat apps show for ${title}`} className="block h-auto w-full" loading="lazy" referrerPolicy="no-referrer" />
                <figcaption className="px-3 py-1.5 text-[11px] text-faint">This is the preview a chat app shows with the link.</figcaption>
              </figure>
            )}

            <TargetGrid targets={shareTargets(view.share.url, message)} />
            {typeof nav.share === 'function' && (
              <button
                type="button"
                onClick={() => void nav.share!({ title: message, url: view.share.url }).catch(() => undefined)}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-medium text-content transition-colors hover:bg-surface-2"
              >
                <Share2 className="h-3.5 w-3.5 text-muted" />
                More options (system share sheet)
              </button>
            )}

            <p className="text-[11.5px] leading-relaxed text-faint">
              Anyone with this link can read this copy until {new Date(view.share.expiresAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}.
              It is read-only and nothing new is researched when it is opened.
            </p>
            <div className="border-t border-border pt-3">
              <button type="button" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-negative hover:underline disabled:opacity-60" disabled={busyStop} onClick={() => void stop(view.share)}>
                {busyStop ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Stop sharing
              </button>
              <p className="mt-1 text-[11px] text-faint">The link stops working and the copy is deleted from Stratemark's servers.</p>
              {stopError && <p role="alert" className="mt-1 text-[12px] text-negative">{stopError}</p>}
            </div>
          </div>
        )}

        {view.step === 'stopped' && (
          <div role="status" className="space-y-3">
            <p className="text-[13px] text-content">Sharing stopped. That link no longer opens anything, and the copy is deleted.</p>
            <button type="button" className="btn-ghost border border-border" onClick={() => setView({ step: 'ready' })}>Make a new link</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
