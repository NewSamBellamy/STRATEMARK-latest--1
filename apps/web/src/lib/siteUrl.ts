/**
 * Research sometimes stores a company website as a bare domain
 * ("anthropic.com"). As an href that resolves against our own origin, so
 * normalise to an absolute https URL; anything that isn't a plausible web
 * address stays null.
 */
export function siteUrl(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v.replace(/^\/+/, '')}`;
  try {
    const u = new URL(withScheme);
    // A bare domain never carries credentials; `trusted.com@evil.example` is a disguise.
    if (u.username || u.password) return null;
    return u.hostname.includes('.') ? u.href : null;
  } catch { return null; }
}
