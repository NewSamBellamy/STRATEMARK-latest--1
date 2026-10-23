import { ExternalLink } from 'lucide-react';
import { PrintBrand, PrintColophon } from '@/components/PrintFrame';
import { publisherOf, type CardWithCompany } from '@mi/contracts';
import { sourceHref } from '@/lib/sourceHref';
import { ViceDisclaimer } from './CardDisclaimer';
import { sourceUrl } from './card-view';

export interface SignalReading {
  /** One readable paragraph: what the finding is. */
  lead: string | null;
  /** The sentences behind it (5 to 10 when the research has them), each with its own source where it has one. */
  points: Array<{ text: string; source: { url: string; title: string } | null }>;
  /** Every distinct source, once. */
  sources: Array<{ url: string; title: string }>;
}

const MAX_POINTS = 10;
const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * What a barrier, insight, risk or culture card says, as something to read: a paragraph, then a punch list. The reader
 * used to show the same finding in a clamped box, a second box of "findings" and a "Read full finding" step; the
 * paragraph was cut at two lines and the list at two items. Nothing is added here: it is the card's own summary,
 * key points and sourced claims, each shown once.
 */
export function signalReading(data: CardWithCompany, citations: ReadonlyArray<{ url: string; title: string }>): SignalReading {
  const seen = new Set<string>();
  const once = (text: string | null | undefined): string | null => {
    const t = (text ?? '').replace(/\s+/g, ' ').trim();
    if (!t || seen.has(key(t))) return null;
    seen.add(key(t));
    return t;
  };
  const sources = [...new Map(citations.map((c) => [c.url, { url: c.url, title: c.title }])).values()];
  if (data.card.cardType === 'vice') {
    // An allegation with no clickable source is never shown (Rule 9).
    const points = data.viceClaims.filter((claim) => sourceUrl(claim.sourceUrl)).flatMap((claim) => {
      const text = once(claim.claimText);
      return text ? [{ text, source: claim.sourceUrl ? { url: claim.sourceUrl, title: claim.sourceTitle ?? '' } : null }] : [];
    }).slice(0, MAX_POINTS);
    return { lead: null, points, sources };
  }
  const lead = once(data.card.summary);
  const points = data.card.keyPoints.flatMap((point) => {
    const text = once(point);
    return text ? [{ text, source: null }] : [];
  }).slice(0, MAX_POINTS);
  return { lead, points, sources };
}

/** The finding as a paragraph and a clean list, with its sources underneath. No boxes, nothing clipped. */
export function SignalFinding({ data, citations }: { data: CardWithCompany; citations: ReadonlyArray<{ url: string; title: string }> }) {
  const reading = signalReading(data, citations);
  const vice = data.card.cardType === 'vice';
  const empty = !reading.lead && reading.points.length === 0;
  return (
    <section className="brf-print-root signal-read" aria-label="Research finding">
      <PrintBrand kind="Research finding" />
      {reading.lead && <p className="signal-read__lead">{reading.lead}</p>}
      {reading.points.length > 0 && <div>
        <h3 className="signal-read__heading">{vice ? 'What sources report' : 'What the research shows'}</h3>
        {vice && <div className="mb-2"><ViceDisclaimer /></div>}
        <ul className="signal-read__points">
          {reading.points.map((point) => <li key={point.text}>
            {point.text}
            {point.source && <a className="signal-read__src" href={sourceHref(point.source.url, point.source.title)} target="_blank" rel="noopener noreferrer"
              aria-label={`Source: ${publisherOf(point.source.url, point.source.title)}`}>
              {publisherOf(point.source.url, point.source.title)} <ExternalLink size={10} aria-hidden="true" />
            </a>}
          </li>)}
        </ul>
      </div>}
      {empty && <p className="signal-read__note">The research recorded no further detail for this card.</p>}
      {reading.sources.length > 0
        ? <p className="signal-read__sources"><span>Sources</span>
          {reading.sources.slice(0, 8).map((source) => <a key={source.url} href={sourceHref(source.url, source.title)} target="_blank" rel="noopener noreferrer">
            {publisherOf(source.url, source.title)} <ExternalLink size={10} aria-hidden="true" />
          </a>)}
        </p>
        : <p className="signal-read__note">No clickable source has been saved for this finding yet.</p>}
      <PrintColophon />
    </section>
  );
}
