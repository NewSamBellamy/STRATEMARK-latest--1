/**
 * Bot-challenge pages ("Just a moment...", "Verify you are human", Cloudflare
 * interstitials). A capture service that screenshots one hands back the
 * CAPTCHA as if it were the company's site; showing it is showing an unrelated
 * page as evidence. We only call a page a challenge on positive evidence (its
 * title or its markup); an unreadable page is "unknown", never "blocked".
 */
import { hasHostedApi, hostedUrl } from '@/lib/hostedApi';
import { fetchWithTimeout } from '@/lib/media/lookupCache';
import { hasLocalSourceBridge, readAssetSource } from '@/lib/repository/local-source-reader';

const CHALLENGE_TITLES = [
  /^just a moment/i,
  /verify (that )?you are (a )?human/i,
  /^attention required/i,
  /are you a robot/i,
  /checking (if the site connection is secure|your browser)/i,
  /security check/i,
  /^access denied$/i,
  /^please wait\b/i,
  /ddos protection/i,
  /^one more step/i,
];

const CHALLENGE_MARKUP = [/challenges\.cloudflare\.com/i, /cf-chl-/i, /__cf_chl/i, /id=["']challenge-form["']/i, /cf-browser-verification/i];

export function isChallengeTitle(title: string | null | undefined): boolean {
  const t = (title ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 0 && CHALLENGE_TITLES.some((re) => re.test(t));
}

export function titleOfHtml(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1]!.replace(/\s+/g, ' ').trim().slice(0, 300) : null;
}

export function isChallengeHtml(html: string): boolean {
  return isChallengeTitle(titleOfHtml(html)) || CHALLENGE_MARKUP.some((re) => re.test(html));
}

/** True when the page is a challenge, false when it is readable and is not, null when we could not tell. */
export async function probeSiteChallenge(url: string): Promise<boolean | null> {
  try {
    if (hasHostedApi()) {
      const res = await fetchWithTimeout(hostedUrl(`preview?url=${encodeURIComponent(url)}`), { credentials: 'omit' });
      if (!res.ok) return null;
      const p = await res.json() as { title?: string | null };
      return typeof p.title === 'string' ? isChallengeTitle(p.title) : null;
    }
    if (hasLocalSourceBridge()) {
      const receipt = await readAssetSource(url);
      if (receipt.status !== 'retrieved' || !receipt.text) return null;
      return isChallengeHtml(receipt.text);
    }
  } catch { /* unknown */ }
  return null;
}
