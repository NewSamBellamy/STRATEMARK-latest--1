/**
 * What a card's face says, as plain data for the link-preview picture. It is the card face's own model (`buildCardView`, the
 * same rules the app and the share viewer use), so the picture can only show a figure the card itself shows, with the same
 * wording, and a signal card never borrows a company's figures.
 */
import type { Card, CardWithCompany, ShareSnapshot } from '@mi/contracts';
import { deriveTriad } from '@/lib/brand';
import { buildCardView } from '@/features/card/card-view';
import { DEFAULT_CARD_ART } from '@/features/card/MarketCardArt';
import { SIGNAL_FINDING_LABEL } from '@/features/card/CollectibleCard';

export interface OgFaceSlot {
  label: string;
  /** What the face prints for this place; `known` is false for "Not found yet". */
  value: string;
  known: boolean;
}

export interface OgFace {
  kind: 'company' | 'signal';
  /** The word on the corner chip of a company card, or above the headline of a signal card ("Company", "Risk"). */
  typeLabel: string;
  /** Where the company is, or the signal's type. */
  eyebrow: string;
  name: string;
  blurb: string | null;
  findingLabel: string | null;
  finding: string | null;
  slots: OgFaceSlot[];
  /** The two footer lines of the face. */
  position: string;
  provenance: string;
  logoUrl: string | null;
  /** The illustration of a signal card (an address inside this app), and the two colours that tint the frame. */
  artSrc: string | null;
  accent: string;
  highlight: string;
}

function dataFor(snapshot: ShareSnapshot, card: Card): CardWithCompany {
  const company = card.companyId ? snapshot.companies.find((c) => c.id === card.companyId) ?? null : null;
  return {
    card,
    company,
    metrics: company ? snapshot.metrics.filter((m) => m.companyId === company.id) : [],
    viceClaims: snapshot.viceClaims.filter((v) => v.cardId === card.id),
  } as CardWithCompany;
}

export function ogFace(data: CardWithCompany): OgFace {
  const view = buildCardView(data);
  const art = DEFAULT_CARD_ART[data.card.cardType];
  const brand = ['scraped', 'manual'].includes(data.company?.brandTheme?.source ?? '') ? data.company?.brandTheme ?? null : null;
  const triad = deriveTriad(brand, null);
  const hasBrand = Boolean(brand?.primary);
  const signal = view.signal || Boolean(art);
  return {
    kind: signal ? 'signal' : 'company',
    typeLabel: view.type,
    eyebrow: signal ? view.type : data.company?.hqLocation?.trim() || 'Location unknown',
    name: view.frontTitle,
    blurb: view.frontDescription ?? null,
    findingLabel: signal && view.frontFinding
      ? SIGNAL_FINDING_LABEL[data.card.cardType as keyof typeof SIGNAL_FINDING_LABEL] ?? 'Research finding'
      : null,
    finding: signal ? view.frontFinding ?? null : null,
    slots: signal ? [] : view.faceMetrics.map((m) => ({
      label: m.label,
      value: m.display,
      known: m.metric?.value != null || m.metric?.reportedBand != null,
    })),
    position: view.position,
    provenance: view.sourceCount > 0 ? `${view.sourceCount} ${view.sourceCount === 1 ? 'source' : 'sources'} tracked` : 'Research needed',
    logoUrl: signal ? null : data.company?.logoUrl ?? null,
    artSrc: art?.src ?? null,
    accent: art ? art.accent : hasBrand ? triad.primary : '#46524e',
    highlight: art ? art.highlight : hasBrand ? triad.accent : '#6a756f',
  };
}

/** The faces a share's picture draws: the card itself for a card share, the first few company cards for a deck. */
export function ogFaces(snapshot: ShareSnapshot): OgFace[] {
  if (snapshot.kind === 'card') {
    const card = snapshot.cards.find((c) => c.id === snapshot.focusCardId) ?? snapshot.cards[0];
    return card ? [ogFace(dataFor(snapshot, card))] : [];
  }
  return snapshot.cards.filter((c) => c.cardType === 'company').slice(0, 3).map((c) => ogFace(dataFor(snapshot, c)));
}
