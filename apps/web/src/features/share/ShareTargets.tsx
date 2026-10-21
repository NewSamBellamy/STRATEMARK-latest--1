/**
 * The small parts both share dialogs use: copying without assuming the platform,
 * and one-tap destinations that are plain links (they work everywhere, including
 * the sandboxed serving context where the native share sheet and the async
 * clipboard may not exist).
 */
import type { ReactNode } from 'react';
import { Mail, Send } from 'lucide-react';

/** Clipboard with the sandbox-proof fallback chain. */
export async function copyText(text: string, input: HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* clipboard API missing or blocked: fall through */
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

/** Practical intent-URL ceilings per destination (measured, conservative). */
const TARGET_LIMITS = { email: 1900, telegram: 3800, whatsapp: 3800, x: 1900 } as const;

/** Small inline mark for X (lucide dropped the Twitter bird). */
function XMark({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M18.9 1.15h3.68l-8.04 9.2L24 22.85h-7.4l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93Zm-1.29 19.5h2.04L6.49 3.24H4.3L17.6 20.66Z" />
    </svg>
  );
}

interface Target {
  key: string;
  href: string;
  ok: boolean;
  icon: ReactNode;
  label: string;
}

/** The destinations, each marked with whether its final address fits (an over-long intent link is a Bad Request). */
export function shareTargets(link: string, message: string): Target[] {
  const emailHref = `mailto:?subject=${encodeURIComponent(message)}&body=${encodeURIComponent(`${message}\n\n${link}`)}`;
  const telegramHref = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(message)}`;
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(`${message} ${link}`)}`;
  const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}&url=${encodeURIComponent(link)}`;
  return [
    { key: 'email', href: emailHref, ok: emailHref.length <= TARGET_LIMITS.email, icon: <Mail className="h-3.5 w-3.5 text-muted" />, label: 'Email' },
    { key: 'telegram', href: telegramHref, ok: telegramHref.length <= TARGET_LIMITS.telegram, icon: <Send className="h-3.5 w-3.5 text-muted" />, label: 'Telegram' },
    { key: 'whatsapp', href: whatsappHref, ok: whatsappHref.length <= TARGET_LIMITS.whatsapp, icon: <Send className="h-3.5 w-3.5 rotate-45 text-muted" />, label: 'WhatsApp' },
    { key: 'x', href: xHref, ok: xHref.length <= TARGET_LIMITS.x, icon: <XMark className="h-3 w-3 text-muted" />, label: 'Post on X' },
  ];
}

/** The destinations that fit, as a row of links. Renders nothing when none do. */
export function TargetGrid({ targets }: { targets: readonly Target[] }) {
  const shown = targets.filter((t) => t.ok);
  if (shown.length === 0) return null;
  const columns = shown.length >= 4 ? 'grid grid-cols-2 gap-2 sm:grid-cols-4' : shown.length === 3 ? 'grid grid-cols-2 gap-2 sm:grid-cols-3' : 'grid grid-cols-2 gap-2';
  return (
    <div className={columns}>
      {shown.map((t) => (
        <a
          key={t.key}
          href={t.href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-medium text-content transition-colors hover:bg-surface-2"
        >
          {t.icon}
          {t.label}
        </a>
      ))}
    </div>
  );
}
