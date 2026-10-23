import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MockRepository, type SeedSnapshot } from '@mi/mocks';
import type { CardWithCompany } from '@mi/contracts';
import sample from '@/sample/frontier-snapshot.json';
import { renderWithProviders } from '@/test/test-utils';
import { buildCardView } from '@/features/card/card-view';
import { PrintDocument, type PrintJob } from '../PrintDocument';
import { buildFullReport } from '../fullReportModel';
import { buildReportModel, companiesFromCards } from '../exportModel';
import type { TopicReportModel } from '../topicReportModel';
import type { DailyReportModel } from '../dailyReportModel';
import type { PersonReportModel } from '../personReportModel';
import type { ProductReportModel } from '../productReportModel';
import { UNSOURCED_PROFILE_NOTE } from './reportParts';

// The Logo probes the network; the printed text is what is under test.
vi.mock('@/features/card/Logo', () => ({ Logo: () => <span data-testid="logo" /> }));

let cards: CardWithCompany[] = [];
let tabs: Parameters<typeof buildFullReport>[0]['tabs'] = {};
beforeAll(async () => {
  const repo = new MockRepository({ seedSnapshot: sample as unknown as SeedSnapshot, latencyMs: 0 });
  const deckId = sample.decks[0]!.id;
  cards = await repo.listCards(deckId);
  tabs = (await repo.exportShareSnapshot({ deckId })).dashboards;
});

const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const printed = (job: PrintJob) => renderWithProviders(<PrintDocument job={job} />).container;

function companyReport(id?: string) {
  const card = cards.find((c) => c.card.cardType === 'company' && c.company && (!id || c.company.id === id))!;
  const full = buildFullReport({ title: card.company!.name, cards: [card], tabs });
  return { card, model: { ...full, kind: 'company' as const } };
}

describe('the printed company report', () => {
  it('prints the four face figures exactly as the card face does, and Unknown for an empty slot', () => {
    for (const co of cards.filter((c) => c.card.cardType === 'company' && c.company).slice(0, 6)) {
      const { card, model } = companyReport(co.company!.id);
      const view = buildCardView(card);
      const el = printed({ kind: 'report', model });
      const shown = [...el.querySelectorAll('[data-testid="face-figure"]')];
      expect(shown).toHaveLength(view.faceMetrics.length);
      view.faceMetrics.forEach((m, i) => {
        const value = squash(shown[i]!.querySelector('[data-testid="face-figure-value"]')?.textContent);
        const has = m.metric?.value != null || m.metric?.reportedBand != null;
        // A sourced slot prints the card's own string; an empty one prints the word, never a number.
        expect(value).toBe(has ? squash(m.display) : 'Unknown');
        expect(squash(shown[i]!.querySelector('.sm-r-fig-label')?.textContent)).toBe(squash(m.label));
        if (!has) expect(value).not.toMatch(/\d/);
      });
    }
  });

  it('opens with a dark cover carrying the real card face and the title, and has no <header> or <aside>', () => {
    const { card, model } = companyReport();
    const el = printed({ kind: 'report', model });
    const cover = el.querySelector('[data-testid="print-cover"]')!;
    expect(cover.querySelector('h1')?.textContent).toBe(card.company!.name);
    expect(cover.querySelector('[data-testid="print-card-face"]')).not.toBeNull();
    expect(cover.querySelector('[data-testid="print-card-face"]')?.getAttribute('data-face-size')).toBe('hero');
    expect(el.querySelectorAll('header, aside')).toHaveLength(0);
  });

  it('prints each figure one way: unknown as the word, estimated with est., and says how to read it', () => {
    const { model } = companyReport();
    const el = printed({ kind: 'report', model });
    const rows = [...el.querySelectorAll('[data-testid="figures-table"] tbody tr')];
    expect(rows.length).toBe(model.companies[0]!.rows.length);
    model.companies[0]!.rows.forEach((r, i) => {
      const value = squash(rows[i]!.querySelector('.sm-r-num')?.textContent);
      if (r.unknown) {
        expect(value).toBe('Unknown');
        expect(rows[i]!.className).toContain('sm-r-row--unknown');
      } else if (r.confidence === 'estimated') {
        expect(value).toBe(`${squash(r.valueText)}est.`);
      } else {
        expect(value).toBe(squash(r.valueText));
      }
    });
    expect(el.querySelector('[data-testid="how-to-read"]')?.textContent).toContain('Unknown');
  });

  it('labels profile items that carry no source, and names the company on the running head of every section', () => {
    const { model } = companyReport();
    const c = model.companies[0]!;
    const el = printed({ kind: 'report', model });
    const text = squash(el.textContent);
    if (c.overview.length || c.products.some((p) => !p.sourced) || c.timeline.length) expect(text).toContain(UNSOURCED_PROFILE_NOTE);
    const heads = [...el.querySelectorAll('table.sm-run > thead .sm-r-eyebrow')].map((h) => squash(h.textContent));
    expect(heads.length).toBeGreaterThan(0);
    for (const h of heads) expect(h).toBe(c.name);
  });

  it('prints the short figures-only report for a deck with every company named and no card', () => {
    const model = buildReportModel({ title: 'Frontier', kind: 'deck', companies: companiesFromCards(cards) });
    const el = printed({ kind: 'report', model });
    expect(el.querySelector('[data-testid="print-card-face"]')).toBeNull();
    expect(el.querySelectorAll('[data-testid="figures-table"]')).toHaveLength(model.companies.length);
    expect(el.querySelectorAll('header, aside')).toHaveLength(0);
  });
});

const company = { name: 'Acme', logoUrl: null, website: null, hq: 'Austin, Texas' };
const note = { n: 1, title: 'reuters.com', url: 'https://www.reuters.com/acme', direct: true };

describe('the other printed reports', () => {
  it('prints the topic report with a dark cover, a contents page and each section with its notes', () => {
    const model: TopicReportModel = {
      id: 'r', title: 'Acme report', company, dateText: 'Oct 20, 2026', costLine: null, openGapCount: 1, demo: false, hero: null,
      sections: [
        { topic: 'overview', title: 'Overview', markdown: 'Acme makes anvils.', footnotes: [note], gaps: [], researchedDeeper: false, images: [] },
        { topic: 'metrics', title: 'Metrics', markdown: 'Revenue: not found.', footnotes: [], gaps: ['Revenue has no sourced figure.'], researchedDeeper: false, images: [] },
      ],
    };
    const el = printed({ kind: 'topicReport', model });
    expect(el.querySelector('[data-testid="print-cover"] h1')?.textContent).toBe('Acme');
    expect(el.querySelectorAll('.sm-r-toc li')).toHaveLength(2);
    const text = squash(el.textContent);
    expect(text).toContain('Acme makes anvils.');
    expect(text).toContain('reuters.com');
    expect(text).toContain('Not found.');
    expect(el.querySelectorAll('table.sm-run')).toHaveLength(2);
    expect(el.querySelectorAll('header, aside')).toHaveLength(0);
  });

  it('prints the daily report with each update and its source', () => {
    const model: DailyReportModel = {
      company, dateText: 'Oct 20, 2026', counts: [{ label: 'News', count: 1 }],
      items: [{ n: 1, kindLabel: 'News', title: 'Acme raises', byline: 'Reuters · Oct 15, 2026', summary: 'A summary.', sentiment: null, images: [], source: { title: 'Reuters', url: 'https://www.reuters.com/a', direct: true } }],
    };
    const el = printed({ kind: 'dailyReport', model });
    expect(el.querySelectorAll('.sm-r-update')).toHaveLength(1);
    expect(squash(el.textContent)).toContain('https://www.reuters.com/a');
    expect(el.querySelectorAll('header, aside')).toHaveLength(0);
  });

  it('prints the person report with Not reported for a missing fact', () => {
    const model: PersonReportModel = {
      company, person: { name: 'Ada Lovelace', role: 'CTO', group: 'exec' }, dateText: 'Oct 20, 2026', portrait: null,
      facts: [{ label: 'Education', value: null }, { label: 'Joined', value: '2020' }], bio: 'A bio.', evidence: null, deeper: { markdown: 'Deeper.', footnotes: [note] },
    };
    const el = printed({ kind: 'personReport', model });
    const text = squash(el.textContent);
    expect(text).toContain('Not reported');
    expect(text).toContain('Deeper research');
    expect(text).toContain('reuters.com');
    expect(el.querySelector('[data-testid="print-cover"] h1')?.textContent).toBe('Ada Lovelace');
  });

  it('prints the product report with a note number on a sourced metric', () => {
    const model: ProductReportModel = {
      company, product: { name: 'Anvil', status: 'Live', url: null }, dateText: 'Oct 20, 2026', researched: true,
      overview: { stored: 'Stored overview.', researched: null },
      metrics: [{ label: 'Users', value: '5 million', asOf: '2026', source: { title: 'Reuters', url: note.url } }, { label: 'Revenue', value: null, asOf: null, source: null }],
      sentiment: null, stories: [], timeline: [], footnotes: [note], noteByUrl: { [note.url]: 1 },
      audience: null, launched: null, news: [], videos: [],
    };
    const el = printed({ kind: 'productReport', model });
    const text = squash(el.textContent);
    expect(text).toContain('5 million');
    expect(text).toContain('[1]');
    expect(text).toContain('Not reported');
    expect(el.querySelectorAll('header, aside')).toHaveLength(0);
  });

  it('prints the transcript with its turns and numbered sources', () => {
    const job: PrintJob = {
      kind: 'transcript', title: 'Chat', scopeLabel: 'Frontier AI', dateText: 'Oct 20, 2026',
      messages: [
        { id: 'm1', role: 'user', text: 'What is Acme?', createdAt: '2026-10-20T10:00:00.000Z' },
        { id: 'm2', role: 'assistant', text: 'An anvil maker.', createdAt: '2026-10-20T10:00:01.000Z', citations: [{ title: 'Reuters', url: note.url }] },
      ] as never,
    };
    const el = printed(job);
    expect(el.querySelectorAll('.sm-r-turn')).toHaveLength(2);
    expect(squash(el.textContent)).toContain('An anvil maker.');
    expect(el.querySelectorAll('.sm-r-notes li')).toHaveLength(1);
  });
});
