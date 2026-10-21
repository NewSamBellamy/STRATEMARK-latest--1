/**
 * Pagination rules for the printed market report. The render harness (`pnpm --filter @mi/web render:pdf`) is the
 * visual check; these tests pin what can be asserted from the markup and the stylesheet so a rule cannot be dropped silently.
 */
import { describe, expect, it, vi } from 'vitest';
import { MockRepository } from '@mi/mocks';
import type { CardWithCompany } from '@mi/contracts';
import { renderWithProviders } from '@/test/test-utils';
import { buildFullReport, type FullReportModel } from '../fullReportModel';
import { PrintDocument } from '../PrintDocument';
import { Lineup, LINEUP_FACE_PX, lineupLayout } from './Lineup';
import { SignalSection } from './SignalSection';
import marketCss from './market.css?raw';
import signalsCss from './signals.css?raw';

vi.mock('@/features/card/Logo', () => ({ Logo: () => <span data-testid="logo" /> }));

async function sampleModel(): Promise<FullReportModel> {
  const repo = new MockRepository({ latencyMs: 0 });
  const [market] = await repo.listMarkets();
  const deck = (await repo.getDeckByMarket(market!.id))!;
  const cards = await repo.listCards(deck.id);
  const snapshot = await repo.exportShareSnapshot({ deckId: deck.id });
  return buildFullReport({ title: market!.name, cards, tabs: snapshot.dashboards });
}

/** A rule's body from the stylesheet, whitespace squashed ("" when the selector is absent). */
function rule(css: string, selector: string): string {
  const flat = css.replace(/\s+/g, ' ');
  const at = flat.indexOf(`${selector} {`);
  if (at < 0) return '';
  return flat.slice(at, flat.indexOf('}', at) + 1);
}

describe('company spread pagination', () => {
  it('puts the figures table straight after the spread, before the long profile blocks, so it never trails on a page of its own', async () => {
    const model = await sampleModel();
    const { container } = renderWithProviders(<PrintDocument job={{ kind: 'marketReport', model }} />);
    const section = container.querySelector('section.sm-spreadsec')!;
    const cells = [...section.querySelectorAll('table.sm-run > tbody > tr > td')];
    expect(cells[0]!.querySelector('[data-testid="company-spread"]')).not.toBeNull();
    expect(cells[1]!.querySelector('.sm-fig-table')).not.toBeNull();
    // Every profile block (Overview, Products, ...) follows the table.
    for (const cell of cells.slice(2)) expect(cell.querySelector('.sm-fig-table')).toBeNull();
  });

  it('keeps table rows, the table and the spread whole, and gives the last block no trailing margin', () => {
    expect(rule(marketCss, '.sm-fig-table tr')).toContain('break-inside: avoid');
    expect(rule(marketCss, '.sm-mkt .sm-figblock')).toContain('break-inside: avoid');
    expect(rule(marketCss, '.sm-spread')).toContain('break-inside: avoid');
    expect(marketCss).toContain('.sm-mkt .sm-run > tbody > tr:last-child .sm-block:last-child { margin-bottom: 0; }');
  });

  it('pairs Leadership with History in one row when a company has both, and tightens the spread on Letter', async () => {
    const model = await sampleModel();
    const both = model.companies.filter((c) => c.leaders.length > 0 && c.timeline.length > 0);
    const { container } = renderWithProviders(<PrintDocument job={{ kind: 'marketReport', model }} />);
    expect(container.querySelectorAll('.sm-pair')).toHaveLength(both.length);
    for (const pair of container.querySelectorAll('.sm-pair')) {
      expect([...pair.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Leadership', 'History']);
    }
    expect(rule(marketCss, '.sm-mkt .sm-pair')).toContain('break-inside: avoid');
    // Letter (1056 px sheet) matches, A4 (1123 px) does not.
    expect(marketCss).toContain('@media print and (max-height: 1090px)');
  });

  it('keeps a qualifying note with the list it qualifies and wraps no figure table cell tighter than its row rule', () => {
    expect(rule(marketCss, '.sm-mkt .sm-block .sm-methods')).toContain('break-before: avoid');
    expect(rule(marketCss, '.sm-mkt .sm-fig-table td')).toContain('padding: 0.9mm');
  });
});

describe('contents and lineup balance', () => {
  it('anchors the legend at the foot of a contents page as tall as the sheet', () => {
    expect(rule(marketCss, '.sm-toc2')).toContain('min-height: calc(var(--sm-page-h');
    expect(rule(marketCss, '.sm-toc2__legend')).toContain('margin-top: auto');
  });

  it('scales the lineup faces up for a short lineup and keeps every layout inside one page', () => {
    // Content width about 658 px; height under the heading about 890 px; a face is 1.4 times as tall as it is wide.
    const rowGap = 8 * 3.78;
    const colGap = 4 * 3.78;
    const widths: number[] = [];
    for (let n = 1; n <= 12; n += 1) {
      const { cols, width } = lineupLayout(n);
      const rows = Math.ceil(n / cols);
      expect(cols * width + (cols - 1) * colGap).toBeLessThanOrEqual(658);
      expect(rows * width * 1.4 + (rows - 1) * rowGap).toBeLessThanOrEqual(890);
      widths.push(width);
    }
    // Fewer companies never print smaller than more companies.
    for (let i = 1; i < widths.length; i += 1) expect(widths[i]!).toBeLessThanOrEqual(widths[i - 1]!);
    expect(lineupLayout(3).width).toBeGreaterThan(lineupLayout(10).width);
    expect(lineupLayout(40)).toEqual({ cols: 4, width: 144 });
  });

  it('hands the chosen face size to the page as custom properties', async () => {
    const model = await sampleModel();
    const { container } = renderWithProviders(<Lineup model={model} />);
    const el = container.querySelector<HTMLElement>('[data-testid="lineup"]')!;
    const { width } = lineupLayout(model.companies.length);
    expect(el.style.getPropertyValue('--lw')).toBe(`${width}px`);
    expect(Number(el.style.getPropertyValue('--ls'))).toBeCloseTo(width / LINEUP_FACE_PX, 5);
    expect(rule(marketCss, '.sm-lineup .sm-cardface--lineup .sm-cardface__inner')).toContain('scale(var(--ls');
  });
});

describe('signals pagination', () => {
  const cite = (id: string) => ({ title: 'example.com', url: `https://example.com/${id}` });
  const signalOf = (base: CardWithCompany, id: string, cardType: 'barrier' | 'vice'): CardWithCompany => ({
    ...base, company: null, metrics: [],
    card: { ...base.card, id, cardType, title: `Fixture ${id}`, summary: null, keyPoints: [], citations: [] },
    viceClaims: [],
  } as unknown as CardWithCompany);

  it('opens with the intro line under the first group that prints, whatever order the cards arrive in', async () => {
    const repo = new MockRepository({ latencyMs: 0 });
    const [market] = await repo.listMarkets();
    const deck = (await repo.getDeckByMarket(market!.id))!;
    const base = (await repo.listCards(deck.id)).find((c) => c.card.cardType === 'company')!;
    const brief = (n: string) => ({ lead: `Lead ${n}.`, sources: [cite(`l${n}`)], points: [{ text: `Point ${n}.`, sources: [cite(`p${n}`)] }] });
    // The risk card arrives first; the first group printed is still Barriers to entry.
    const model = buildFullReport({
      title: 'Fixture', cards: [signalOf(base, 'sig_risk', 'vice'), signalOf(base, 'sig_barrier', 'barrier')], tabs: {},
      signalBriefs: { sig_risk: brief('r'), sig_barrier: brief('b') },
    });
    const { container } = renderWithProviders(<SignalSection model={model} />);
    const rows = [...container.querySelectorAll('td.sm-signals-row')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('.sm-signals-line')).not.toBeNull();
    expect(rows[0]!.querySelector('.sm-signals-group')?.textContent).toBe('Barriers to entry');
    expect(rows[1]!.querySelector('.sm-signals-line')).toBeNull();
    // Each group title travels inside its first card's row, so a title can never be stranded on a page alone.
    expect(rows[1]!.querySelector('.sm-signals-group')?.textContent).toBe('Risks');
  });

  it('keeps a signal whole, and fits two short signals on a page', () => {
    expect(rule(signalsCss, '.sm-signals-row')).toContain('break-inside: avoid');
    expect(rule(signalsCss, '.sm-sigcard')).toContain('margin: 0 0 4mm');
    expect(signalsCss).toContain('.sm-signals-sec .sm-run > tbody > tr:last-child .sm-sigcard { margin-bottom: 0; }');
  });
});
