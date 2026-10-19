import { describe, expect, it, vi } from 'vitest';
import type { CardWithCompany, CompanyMetric, Ownership } from '@mi/contracts';
import { buildCardView } from '@/features/card/card-view';

const deck = vi.hoisted(() => ({ texts: [] as string[] }));

// A recording stand-in for pptxgenjs: every string the slides would carry ends up in `deck.texts`.
vi.mock('pptxgenjs', () => {
  const collect = (value: unknown): void => {
    if (typeof value === 'string') deck.texts.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object' && 'text' in value) collect((value as { text: unknown }).text);
  };
  return {
    default: class {
      layout = '';
      author = '';
      addSlide() {
        return { addShape() {}, addText: (t: unknown) => collect(t), addTable: (rows: unknown) => collect(rows) };
      }
      async writeFile() {}
    },
  };
});

const { exportDeckPptx } = await import('./pptx');

const reuters = [{ title: 'reuters.com', url: 'https://reuters.com/acme' }];
const row = (o: Partial<CompanyMetric>): CompanyMetric =>
  ({
    id: 'm', companyId: 'c', metricType: 'arr', value: null, confidence: 'verified', source: null, citations: reuters,
    methodNote: null, capturedAt: '2026-01-02T00:00:00.000Z', ...o,
  }) as CompanyMetric;

const acquired: Ownership = {
  status: 'acquired', acquirer: 'PepsiCo', announcedOn: '2025-03-17', closedOn: '2025-05-01',
  price: { value: 1.95e9, currency: 'USD' }, confidence: 'verified', methodNote: null,
  citations: [{ title: 'reuters.com', url: 'https://reuters.com/acme-deal' }],
};

function cardOf(metrics: CompanyMetric[], ownership: Ownership | null): CardWithCompany {
  return {
    card: { id: 'card_c', deckId: 'd', companyId: 'c', cardType: 'company', title: 'Acme', tier: 3, summary: null, keyPoints: [], citations: [] } as unknown as CardWithCompany['card'],
    company: { id: 'c', name: 'Acme, Inc.', oneLiner: 'Makes things', logoUrl: null, hqLocation: 'Austin', websiteUrl: null, brandTheme: null, ownership },
    metrics,
    viceClaims: [],
  };
}

describe('PowerPoint export matches the card face', () => {
  it('prints an acquired company\'s purchase price, a rival\'s figure and an invalid figure as Unknown', async () => {
    const valuation = row({ metricType: 'valuation', value: 1.95e9,
      passageSupport: { sourceUrl: 'https://reuters.com/acme', quote: 'Acme is valued at $1.95 billion.', asOf: '2025-03-01', basis: 'valuation', unit: 'USD' } });
    const rival = row({ id: 'rival', companyId: 'rival-co', metricType: 'arr', value: 90e9 });
    const impossible = row({ id: 'share', metricType: 'market_share', value: 340 });
    const data = cardOf([valuation, rival, impossible], acquired);
    // The face agrees: nothing to show for any of the three.
    const face = buildCardView(data);
    expect(face.faceMetrics.filter((s) => s.metric?.value != null)).toEqual([]);

    deck.texts.length = 0;
    await exportDeckPptx({ marketName: 'Mkt', cards: [data] });
    const printed = deck.texts.join('\n');
    expect(printed).toContain('Valuation/Cap: Unknown');
    expect(printed).toContain('ARR: Unknown');
    expect(printed).toContain('Market share: Unknown');
    expect(printed).not.toMatch(/\$1\.9B|\$2B|\$2\.0B|\$90B|340/);
  });

  it('prints a sourced figure the way the card writes it, with its source', async () => {
    const data = cardOf([row({ metricType: 'valuation', value: 1.95e9 })], null);
    deck.texts.length = 0;
    await exportDeckPptx({ marketName: 'Mkt', cards: [data] });
    expect(deck.texts).toContain('Valuation/Cap: $2B');
    expect(deck.texts).toContain('reuters.com');
  });
});
