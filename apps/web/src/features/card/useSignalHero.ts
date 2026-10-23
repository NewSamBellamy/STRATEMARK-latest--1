import { useEffect, useState } from 'react';
import { usableCitations, type CardWithCompany, type SourceCredibility } from '@mi/contracts';
import { heroNamesOtherCompany } from '@/lib/media/heroGuard';
import { getRealCover } from '@/lib/media/realCover';
import { useInView } from '@/components/media/StoryMedia';
import { recordImage } from '@/lib/media/imageAudit';

export interface SignalHero {
  /** Displayable picture address (through the hosted image proxy when there is one). */
  src: string;
  /** Who published the picture: "Image: reuters.com". */
  credit: string | null;
  /** The page it came from. */
  pageUrl: string;
}

const RANK: Record<SourceCredibility, number> = { primary: 0, reputable_secondary: 1, industry: 2, unknown: 3, user_generated: 4 };
/** Pages tried per card before the default art stays. */
const MAX_PAGES = 3;

/**
 * The pages a signal card's finding rests on, best source first. A vice card's own claims carry the sources; the
 * other signal cards carry citations. Only clickable sources count.
 */
export function heroCandidates(data: CardWithCompany): Array<{ url: string; credibility: SourceCredibility }> {
  const fromClaims = data.viceClaims.map((claim) => ({ url: claim.sourceUrl ?? '', title: claim.sourceTitle ?? '' }));
  const fromCard = (data.card.citations ?? []).map((c) => ({ url: c.url, title: c.title, credibility: c.credibility }));
  const credibilityOf = new Map(fromCard.map((c) => [c.url, c.credibility ?? 'unknown'] as const));
  const usable = usableCitations([...fromCard, ...fromClaims]);
  const seen = new Set<string>();
  return usable
    .filter((c) => /^https:\/\//i.test(c.url) && !seen.has(c.url) && (seen.add(c.url), true))
    .map((c) => ({ url: c.url, credibility: credibilityOf.get(c.url) ?? ('unknown' as const) }))
    .sort((a, b) => RANK[a.credibility] - RANK[b.credibility])
    .slice(0, MAX_PAGES);
}

/**
 * The picture the finding's own source published for link previews: a hero for a vice, barrier, culture or insight
 * card, true to the story and credited. Nothing is generated; with no usable picture the card keeps its default art.
 * Reads only once the card comes near the screen. A company-specific card never takes a picture that names another
 * company (heroGuard).
 */
export function useSignalHero(data: CardWithCompany, enabled: boolean): [React.RefObject<HTMLDivElement>, SignalHero | null] {
  const [ref, seen] = useInView<HTMLDivElement>('240px');
  const [hero, setHero] = useState<SignalHero | null>(null);
  const cardId = data.card.id;
  const subject = data.company?.name ?? null;
  const website = data.company?.websiteUrl ?? null;
  const candidates = enabled ? heroCandidates(data) : [];
  const key = candidates.map((c) => c.url).join('|');

  useEffect(() => {
    setHero(null);
    if (!enabled || !seen) return;
    if (!key) { recordImage('signal-hero', 'fallback', null); return; }
    recordImage('signal-hero', 'requested', key.split('|')[0]);
    let live = true;
    void (async () => {
      for (const url of key.split('|')) {
        const cover = await getRealCover(url);
        if (!live) return;
        if (!cover?.src) continue;
        if (subject && heroNamesOtherCompany(cover.src, null, { name: subject, website })) continue;
        setHero({ src: cover.src, credit: cover.publisher, pageUrl: url });
        return;
      }
      // Every candidate page came back empty or named another company: the card keeps its default art.
      recordImage('signal-hero', 'fallback', key.split('|')[0]);
    })();
    return () => { live = false; };
  }, [enabled, seen, key, cardId, subject, website]);

  return [ref, hero];
}
