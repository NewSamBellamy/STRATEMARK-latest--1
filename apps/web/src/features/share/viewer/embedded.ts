/**
 * The shared research inside a share page: one JSON script element, plus an
 * optional sign-up URL. Reading is defensive because the page may be opened
 * from the bare template, or hand-edited.
 */
import type { ShareSnapshot } from '@mi/contracts';

export const SHARE_DATA_ID = 'stratemark-share-data';

export interface EmbeddedShare {
  snapshot: ShareSnapshot | null;
  signupUrl: string | undefined;
}

export function isShareSnapshot(value: unknown): value is ShareSnapshot {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<ShareSnapshot>;
  return v.v === 1
    && (v.kind === 'card' || v.kind === 'deck')
    && Array.isArray(v.markets) && Array.isArray(v.decks) && Array.isArray(v.cards)
    && Array.isArray(v.companies) && Array.isArray(v.metrics) && Array.isArray(v.viceClaims)
    && typeof v.dashboards === 'object' && v.dashboards !== null
    && v.markets.length > 0 && v.decks.length > 0 && v.cards.length > 0;
}

export function readEmbeddedShare(doc: Pick<Document, 'getElementById'>): EmbeddedShare {
  const el = doc.getElementById(SHARE_DATA_ID);
  if (!el?.textContent) return { snapshot: null, signupUrl: undefined };
  try {
    const parsed = JSON.parse(el.textContent) as { snapshot?: unknown; signupUrl?: unknown };
    const signup = typeof parsed.signupUrl === 'string' && /^https:\/\//i.test(parsed.signupUrl) ? parsed.signupUrl : undefined;
    return { snapshot: isShareSnapshot(parsed.snapshot) ? parsed.snapshot : null, signupUrl: signup };
  } catch {
    return { snapshot: null, signupUrl: undefined };
  }
}
