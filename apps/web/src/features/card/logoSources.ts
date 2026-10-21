/**
 * What may become a logo request. A card is drawn from a company's website and
 * logo URL, and in a shared link both come from whoever made the link. Opening
 * it makes the viewer's browser fetch whatever these resolve to, so each value
 * is parsed and checked rather than pasted into a URL template.
 */

/** Letters, digits and hyphens in dot-separated labels, ending in a TLD that starts with a letter. */
const PUBLIC_HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;
/** Names that only resolve on a private network, or are reserved placeholders (RFC 2606, RFC 6761). */
const NON_PUBLIC_SUFFIX = /(?:^|\.)(?:example(?:\.(?:com|org|net))?|test|invalid|localhost|local|internal|intranet|lan|home|corp|private|arpa)$/;

/** The host of a URL if it names a company on the public web, else null. IP
 * literals fail by construction: a public TLD starts with a letter. */
function publicHost(url: URL): string | null {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  return PUBLIC_HOST.test(host) && !NON_PUBLIC_SUFFIX.test(host) ? host : null;
}

/** The registrable-looking host to ask logo services about, from a researched
 * website ("https://www.sunrun.com/x", "sunrun.com", "shop.spacex.com"). Only
 * the host survives, so a path, query or fragment can never reach a request. */
export function logoDomainOf(website: string | null | undefined): string | null {
  const raw = website?.trim();
  if (!raw) return null;
  // Any scheme but http(s) is not a website.
  if (raw.includes('://') && !/^https?:\/\//i.test(raw)) return null;
  try {
    const host = publicHost(new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`));
    return host ? host.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
}

const INLINE_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml)[;,]/i;

/** A stored logo address we are willing to request: https on a public host (no
 * credentials, no port), or an image embedded in the value itself, which makes
 * no request at all. Anything else falls back to the letter avatar. */
export function safeLogoUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (INLINE_IMAGE.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !publicHost(url)) return null;
    // A fragment never reaches the server, and would sit in front of a cache-buster.
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}
