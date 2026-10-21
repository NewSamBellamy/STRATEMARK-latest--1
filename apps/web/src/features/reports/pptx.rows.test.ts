import { describe, expect, it, vi } from 'vitest';
import type { CardWithCompany, CompanyMetric, Ownership } from '@mi/contracts';
import { buildCardView } from '@/features/card/card-view';

const deck = vi.hoisted(() => ({ texts: [] as string[], shapes: [] as Array<{ fill?: { color?: string } }> }));

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
        return { addShape: (_kind: unknown, o: { fill?: { color?: string } }) => { deck.shapes.push(o); }, addText: (t: unknown) => collect(t), addTable: (rows: unknown) => collect(rows) };
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
    // The line names the figure it shows (the face calls it "Valuation"); the pair only stands when neither is known.
    expect(deck.texts).toContain('Valuation: $2B');
    expect(deck.texts).toContain('reuters.com');
  });

  it('labels a figure the way the card face does, not as Users', async () => {
    const paying = row({ metricType: 'users', value: 1200, passageSupport: { sourceUrl: 'https://reuters.com/acme', quote: 'q', asOf: '2025-03-01', basis: 'users', unit: 'count', definition: 'paying_customers' } });
    deck.texts.length = 0;
    await exportDeckPptx({ marketName: 'Mkt', cards: [cardOf([paying], null)] });
    expect(deck.texts).toContain('Paying customers: 1.2K');
    expect(deck.texts.join('\n')).not.toContain('Users:');
  });

  it('does not print a figure the company one-liner states without a source', async () => {
    const withLiner = (oneLiner: string) => {
      const data = cardOf([], null);
      data.company = { ...data.company!, oneLiner };
      return data;
    };
    deck.texts.length = 0;
    await exportDeckPptx({ marketName: 'Mkt', cards: [withLiner('Acme is a $5B robotics company with 12,000 employees and 3 million users.')] });
    expect(deck.texts.join('\n')).not.toMatch(/robotics company|\$5B|12,000/);
    // Sentences that state no figure are kept.
    deck.texts.length = 0;
    await exportDeckPptx({ marketName: 'Mkt', cards: [withLiner('Acme builds warehouse robots. It has 12,000 employees.')] });
    expect(deck.texts).toContain('Acme builds warehouse robots.');
    expect(deck.texts.join('\n')).not.toContain('12,000');
  });

  it('survives a brand colour that is not a string, and never writes a bad colour into the file', async () => {
    const withBrand = (primary: unknown) => {
      const data = cardOf([], null);
      data.company = { ...data.company!, brandTheme: { primary } as unknown as NonNullable<CardWithCompany['company']>['brandTheme'] };
      return data;
    };
    for (const primary of [123, { r: 1 }, null, 'not-a-colour', '#12']) {
      deck.shapes.length = 0;
      await expect(exportDeckPptx({ marketName: 'Mkt', cards: [withBrand(primary)] })).resolves.toBeUndefined();
      expect(deck.shapes.at(-1)?.fill?.color).toBe('F15A24');
    }
    deck.shapes.length = 0;
    await exportDeckPptx({ marketName: 'Mkt', cards: [withBrand('#1A2B3C')] });
    expect(deck.shapes.at(-1)?.fill?.color).toBe('1A2B3C');
  });
});
