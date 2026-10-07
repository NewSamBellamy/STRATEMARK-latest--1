/**
 * The share dialog — a Share button that actually goes somewhere.
 *
 * The old buttons relied on `navigator.share` / `navigator.clipboard`, both of
 * which silently don't exist in the sandboxed serving context (same failure
 * class as the access-code WebCrypto bug) — so clicking Share did NOTHING.
 * This dialog assumes nothing about the platform:
 *
 *  - The link is packaged in front of the user (with an honest status line —
 *    including the fact-check pass a card share runs first).
 *  - The URL sits in a visible input, selected on focus, with a copy button
 *    that falls back from the async clipboard API to `document.execCommand`.
 *  - One-tap destinations that are just links (work everywhere, sandbox
 *    included): Email, Telegram, WhatsApp, X. Discord/Slack get the copy path
 *    plus a hint — they unfurl the pasted link.
 *  - The native share sheet appears as an extra option only where it exists.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  Copy,
  Link2,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  Share2,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { encodeSharePayload, shareUrlFor, type SharePayload } from '@/lib/share/codec';

/** Clipboard with the sandbox-proof fallback chain. */
async function copyText(text: string, input: HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* clipboard API missing or blocked — fall through */
  }
  try {
    if (input) {
      input.focus();
      input.select();
      return document.execCommand('copy');
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Keyless short link (TinyURL first — real CORS headers — then is.gd).
 * The share URL carries the whole snapshot, which can run to several KB;
 * Telegram/X/WhatsApp intent endpoints reject long URLs outright (the
 * filmed "Bad Request"). A short link makes every one-tap target reliable.
 * TinyURL's redirect breaks above ~8KB targets, so oversized snapshots skip
 * shortening and the dialog guards each target by length instead.
 */
const SHORTEN_MAX = 8000;
async function shortenUrl(longUrl: string): Promise<string | null> {
  if (longUrl.length > SHORTEN_MAX) return null;
  try {
    const res = await fetch('https://tinyurl.com/api-create.php', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `url=${encodeURIComponent(longUrl)}`,
    });
    if (res.ok) {
      const text = (await res.text()).trim();
      if (/^https:\/\/tinyurl\.com\/\S+$/.test(text)) return text;
    }
  } catch {
    /* CSP-sandboxed serving may block the fetch — fall through */
  }
  try {
    const res = await fetch(
      `https://is.gd/create.php?format=simple&url=${encodeURIComponent(longUrl)}`,
    );
    if (res.ok) {
      const text = (await res.text()).trim();
      if (/^https:\/\/is\.gd\/\S+$/.test(text)) return text;
    }
  } catch {
    /* fall through — the dialog degrades to length-guarded targets */
  }
  return null;
}

/** Practical intent-URL ceilings per destination (measured, conservative). */
const TARGET_LIMITS = { email: 1900, telegram: 3800, whatsapp: 3800, x: 1900 } as const;

function TargetLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: ReactNode;
  label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-medium text-content transition-colors hover:bg-surface-2"
    >
      {icon}
      {label}
    </a>
  );
}

/** Small inline "𝕏" mark (lucide dropped the Twitter bird). */
function XMark({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M18.9 1.15h3.68l-8.04 9.2L24 22.85h-7.4l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93Zm-1.29 19.5h2.04L6.49 3.24H4.3L17.6 20.66Z" />
    </svg>
  );
}

export function ShareDialog({
  open,
  onOpenChange,
  title,
  subtitle,
  build,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What's being shared — the dialog heading and the message text. */
  title: string;
  /** Context line under the heading (market, date, report kind…). */
  subtitle?: string | null;
  /**
   * Packages the payload when the dialog opens. Report progress through
   * `onStage` ("Fact-checking ARR…", "Packaging the card…") — a card share
   * runs its verification pass in here, so the recipient never opens a card
   * with contradiction flags on its face.
   */
  build: (onStage: (stage: string) => void) => Promise<SharePayload>;
}) {
  const qc = useQueryClient();
  const [stage, setStage] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [shortUrl, setShortUrl] = useState<string | null>(null);
  const [shortening, setShortening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);

  const prepare = useCallback(async () => {
    const id = ++runId.current;
    setUrl(null);
    setError(null);
    setCopied('idle');
    setStage('Preparing…');
    try {
      const payload = await build((s) => {
        if (runId.current === id) setStage(s);
      });
      const blob = await encodeSharePayload(payload);
      if (runId.current !== id) return;
      const fullUrl = shareUrlFor(blob);
      setUrl(fullUrl);
      setStage(null);
      // Short links are OPT-IN (created by an explicit user action below):
      // the share URL carries the whole research snapshot, and shortening
      // transmits it to a third-party service. Never auto-submit research.
      // The preflight may have corrected figures — let open views reconcile.
      void qc.invalidateQueries({ queryKey: ['cards'] });
    } catch (err) {
      if (runId.current !== id) return;
      setError(err instanceof Error ? err.message : 'Could not package the share link.');
      setStage(null);
    }
  }, [build, qc]);

  useEffect(() => {
    if (open) {
      void prepare();
    } else {
      runId.current++;
      setUrl(null);
      setError(null);
      setStage(null);
      setCopied('idle');
      setShortUrl(null);
      setShortening(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const bestLink = shortUrl ?? url;

  /** Opt-in only: the shortener receives the research-bearing link. */
  const makeShortLink = async () => {
    if (!url || shortUrl || shortening) return;
    const id = runId.current;
    setShortening(true);
    try {
      const short = await shortenUrl(url);
      if (runId.current === id && short) setShortUrl(short);
    } finally {
      if (runId.current === id) setShortening(false);
    }
  };

  const onCopy = async () => {
    if (!bestLink) return;
    const ok = await copyText(bestLink, inputRef.current);
    setCopied(ok ? 'ok' : 'fail');
    setTimeout(() => setCopied('idle'), 2500);
  };

  const nav = navigator as Navigator & {
    share?: (data: { title: string; url: string }) => Promise<void>;
  };
  const hasNativeShare = typeof nav.share === 'function';
  const message = subtitle ? `${title} · ${subtitle}` : title;

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Share — ${title}`} size="md">
      <div className="space-y-4">
        {subtitle && <p className="-mt-2 text-[12px] text-muted">{subtitle}</p>}

        {/* Packaging status — including the fact-check pass. */}
        {stage && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3">
            <Loader2 className="h-4 w-4 animate-spin text-primary-ink" />
            <p className="text-[13px] text-content">{stage}</p>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-negative/30 bg-negative/5 px-4 py-3">
            <p className="flex items-center gap-2 text-[13px] font-medium text-negative">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </p>
            <button
              type="button"
              onClick={() => void prepare()}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-[12px] font-medium text-content hover:bg-surface-2"
            >
              <RefreshCw className="h-3 w-3" />
              Try again
            </button>
          </div>
        )}

        {url && (
          <>
            {/* The link itself — visible, selectable, copyable. The short
                link (when TinyURL answered) is what humans and chat apps
                actually want; the full link still works identically. */}
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                readOnly
                value={bestLink ?? ''}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-[11px] text-muted outline-none focus:border-primary/50"
                aria-label="Share link"
              />
              <button
                type="button"
                onClick={() => void onCopy()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-semibold text-content transition-colors hover:bg-surface-2"
              >
                {copied === 'ok' ? (
                  <Check className="h-3.5 w-3.5 text-positive" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied === 'ok' ? 'Copied' : 'Copy link'}
              </button>
            </div>
            {copied === 'fail' && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                This browser blocked automatic copying — the link is selected above, press{' '}
                <kbd className="rounded border border-border bg-surface-2 px-1">Ctrl/⌘ C</kbd>.
              </p>
            )}

            {shortening && (
              <p className="flex items-center gap-1.5 text-[11px] text-faint">
                <Loader2 className="h-3 w-3 animate-spin" />
                Making a short link (via TinyURL) so one-tap sharing works everywhere…
              </p>
            )}

            {/* Opt-in short link: the service receives the research-bearing
                link, so the user — not the dialog — decides to send it. */}
            {url && !shortUrl && !shortening && (
              <div className="rounded-xl border border-border bg-surface-2/60 px-3.5 py-2.5">
                <button
                  type="button"
                  onClick={() => void makeShortLink()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-[12px] font-medium text-content hover:bg-surface-2"
                >
                  <Link2 className="h-3.5 w-3.5 text-muted" />
                  Create short link
                </button>
                <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
                  Optional: makes one-tap sharing work on platforms that reject long links. The
                  short-link service (tinyurl.com) receives this link, which contains the research —
                  skip it and copy the full link to keep everything on this device.
                </p>
              </div>
            )}

            {/* One-tap destinations — plain links, LENGTH-GUARDED. Intent
                endpoints reject over-long URLs with a Bad Request, so a
                target only renders when its final URL fits. With the short
                link, all of them fit. */}
            {(() => {
              const link = bestLink ?? url;
              const emailHref = `mailto:?subject=${encodeURIComponent(message)}&body=${encodeURIComponent(`${message}\n\n${link}`)}`;
              const telegramHref = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(message)}`;
              const whatsappHref = `https://wa.me/?text=${encodeURIComponent(`${message} ${link}`)}`;
              const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}&url=${encodeURIComponent(link)}`;
              const targets = [
                { key: 'email', href: emailHref, ok: emailHref.length <= TARGET_LIMITS.email, icon: <Mail className="h-3.5 w-3.5 text-muted" />, label: 'Email' },
                { key: 'telegram', href: telegramHref, ok: telegramHref.length <= TARGET_LIMITS.telegram, icon: <Send className="h-3.5 w-3.5 text-muted" />, label: 'Telegram' },
                { key: 'whatsapp', href: whatsappHref, ok: whatsappHref.length <= TARGET_LIMITS.whatsapp, icon: <Send className="h-3.5 w-3.5 rotate-45 text-muted" />, label: 'WhatsApp' },
                { key: 'x', href: xHref, ok: xHref.length <= TARGET_LIMITS.x, icon: <XMark className="h-3 w-3 text-muted" />, label: 'Post on X' },
              ];
              const shown = targets.filter((t) => t.ok);
              return (
                <>
                  {shown.length > 0 && (
                    <div
                      className={
                        shown.length >= 4
                          ? 'grid grid-cols-2 gap-2 sm:grid-cols-4'
                          : shown.length === 3
                            ? 'grid grid-cols-2 gap-2 sm:grid-cols-3'
                            : 'grid grid-cols-2 gap-2'
                      }
                    >
                      {shown.map((t) => (
                        <TargetLink key={t.key} href={t.href} icon={t.icon} label={t.label} />
                      ))}
                    </div>
                  )}
                  {shown.length < targets.length && !shortening && (
                    <p className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
                      This snapshot is large{shortUrl ? '' : ' and a short link couldn\u2019t be made from here'} — some
                      one-tap buttons are hidden because those platforms reject long links. Copy the
                      link instead and paste it anywhere; it always works.
                    </p>
                  )}
                </>
              );
            })()}

            {hasNativeShare && (
              <button
                type="button"
                onClick={() => void nav.share!({ title: message, url: bestLink ?? url }).catch(() => {})}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-medium text-content transition-colors hover:bg-surface-2"
              >
                <Share2 className="h-3.5 w-3.5 text-muted" />
                More options (system share sheet)
              </button>
            )}

            <p className="text-[11px] leading-relaxed text-faint">
              For Discord or Slack: copy the link and paste it into the chat. The whole snapshot
              travels inside the link — the recipient opens a clean, read-only display of the
              research, no account needed.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
