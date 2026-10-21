/**
 * Every citation must CLICK THROUGH somewhere useful — a tribute to the
 * reporters (founder's framing). Gemini's grounding metadata often carries
 * opaque redirect URLs that expire; when a link isn't a real, durable
 * publisher URL, we send the reader to a precise search for the exact story
 * instead of a dead tab.
 */
export function isGroundingRedirect(url: string): boolean {
  return /vertexaisearch|grounding-api-redirect/i.test(url);
}

export function sourceHref(url: string, title?: string | null): string {
  if (/^https?:\/\//i.test(url) && !isGroundingRedirect(url)) return url;
  const q = (title ?? '').trim().slice(0, 120) || url;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

/** Label hint: true when the link opens the source directly. */
export function isDirectSource(url: string): boolean {
  return /^https?:\/\//i.test(url) && !isGroundingRedirect(url);
}

/**
 * The one gate between data we did not write (model output, imported
 * snapshots, shared links) and an `href`. Returns the normalised URL only for
 * http(s) with a real hostname and no embedded credentials; anything else
 * (`javascript:`, `data:`, protocol-relative `//host`, a bare path) comes back
 * `undefined` so the caller renders plain text instead of a link. A browser
 * runs `javascript:` on click even with `rel="noopener"`, so this has to be
 * checked at the link rather than trusted from the field's type.
 */
export function safeHttpUrl(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    // `https://trusted.com@evil.example` reads as the first host to a person.
    if (!url.hostname || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
