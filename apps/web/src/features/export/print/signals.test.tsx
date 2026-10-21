import { describe, expect, it, vi } from 'vitest';
import { MockRepository } from '@mi/mocks';
import type { CardWithCompany } from '@mi/contracts';
import { renderWithProviders } from '@/test/test-utils';
import { buildFullReport, type FullReportModel } from '../fullReportModel';
import { SignalSection } from './SignalSection';
import { SignalCard } from './SignalCard';
import { MethodsPage } from './MethodsPage';
import { SourcesList } from './SourcesList';

vi.mock('@/features/card/Logo', () => ({ Logo: () => <span data-testid="logo" /> }));

const cite = (id: string) => ({ title: 'reuters.com', url: `https://reuters.com/${id}` });
const signalOf = (base: CardWithCompany, id: string, cardType: 'barrier' | 'insight' | 'culture', over: Record<string, unknown> = {}): CardWithCompany => ({
  ...base,
  company: null,
  metrics: [],
  card: { ...base.card, id, cardType, title: `Title ${id}`, summary: `Summary of ${id}.`, keyPoints: [`Point of ${id}.`], citations: [], ...over },
  viceClaims: [],
} as unknown as CardWithCompany);

async function build(extra: (base: CardWithCompany) => CardWithCompany[], briefs?: Parameters<typeof buildFullReport>[0]['signalBriefs']) {
  const repo = new MockRepository({ latencyMs: 0 });
  const [market] = await repo.listMarkets();
  const deck = (await repo.getDeckByMarket(market!.id))!;
  const all = await repo.listCards(deck.id);
  const cards = all.filter((c) => !['vice', 'culture', 'barrier', 'insight'].includes(c.card.cardType));
  const snapshot = await repo.exportShareSnapshot({ deckId: deck.id });
  const model = buildFullReport({ title: market!.name, cards: [...cards, ...extra(cards[0]!)], tabs: snapshot.dashboards, signalBriefs: briefs ?? null });
  return model;
}

const briefs = {
  sig_brief: {
    lead: 'The brief lead sentence.',
    sources: [cite('lead')],
    points: [
      { text: 'First sourced brief point.', sources: [cite('p1')] },
      { text: 'Second sourced brief point.', sources: [cite('p1'), cite('p2')] },
    ],
  },
};

const mixed = () => build((b) => [
  signalOf(b, 'sig_brief', 'insight'),
  signalOf(b, 'sig_stored', 'barrier', { citations: [cite('s1')] }),
  signalOf(b, 'sig_held', 'culture'),
], briefs);

const text = (el: Element) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const entry = (m: FullReportModel, id: string) => m.signals.find((s) => s.cardId === id)!;

describe('SignalCard', () => {
  it('prints a brief: the lead, every point and its own notes, and none of the card raw summary', async () => {
    const m = await mixed();
    const e = entry(m, 'sig_brief');
    const { container } = renderWithProviders(<SignalCard entry={e} />);
    const t = text(container.querySelector('.sm-sigcard__body')!);
    expect(t).toContain('The brief lead sentence.');
    expect(t).toContain('First sourced brief point.');
    expect(t).toContain('Second sourced brief point.');
    expect(t).not.toContain('Summary of sig_brief');
    expect(t).not.toContain('Point of sig_brief');
    const refs = Array.from(container.querySelectorAll('.sm-sigcard__points li [data-testid="note-refs"]')).map((n) => n.textContent);
    expect(refs).toEqual(e.brief!.points.map((p) => p.notes.join(', ')));
    expect(e.brief!.points[1]!.notes).toHaveLength(2);
    expect(container.querySelector('[data-testid="print-card-face"]')).not.toBeNull();
  });

  it('prints a stored-citation entry from its stored text, with its notes', async () => {
    const m = await mixed();
    const e = entry(m, 'sig_stored');
    const { container } = renderWithProviders(<SignalCard entry={e} />);
    const t = text(container.querySelector('.sm-sigcard__body')!);
    expect(t).toContain('Summary of sig_stored.');
    expect(t).toContain('Point of sig_stored.');
    expect(container.querySelector('[data-testid="note-refs"]')!.textContent).toBe(e.stored!.notes.join(', '));
  });

  it('prints nothing of a held-back entry, not even the card title or summary', async () => {
    const m = await mixed();
    const e = entry(m, 'sig_held');
    expect(e.printable).toBe(false);
    const { container } = renderWithProviders(<SignalCard entry={e} />);
    expect(container.innerHTML).toBe('');
    const sec = renderWithProviders(<SignalSection model={m} />).container;
    expect(text(sec)).not.toContain('Title sig_held');
    expect(text(sec)).not.toContain('Summary of sig_held');
    expect(text(sec)).not.toContain('Point of sig_held');
  });

  it('applies the kind accent class and label', async () => {
    const m = await mixed();
    const { container } = renderWithProviders(<SignalSection model={m} />);
    const arts = Array.from(container.querySelectorAll('[data-testid="signal-card"]'));
    expect(arts.map((a) => a.getAttribute('data-kind')).sort()).toEqual(['barrier', 'insight']);
    for (const a of arts) {
      expect(a.className).toContain(`sm-sigcard--${a.getAttribute('data-kind')}`);
      expect(a.querySelector('.sm-sigcard__kind')!.textContent).toMatch(/Barrier to entry|Insight/);
    }
    const group = Array.from(container.querySelectorAll('.sm-signals-group')).map((h) => h.textContent);
    expect(group).toEqual(['Barriers to entry', 'Insights']);
  });
});

describe('SignalSection', () => {
  it('prints no heading and no opener when nothing is printable', async () => {
    const m = await build((b) => [signalOf(b, 'only_held', 'barrier')]);
    expect(m.signals.some((s) => s.printable)).toBe(false);
    const { container } = renderWithProviders(<SignalSection model={m} />);
    expect(container.innerHTML).toBe('');
  });

  it('prints the Signals heading and its one-line opener when something is', async () => {
    const m = await mixed();
    const { container } = renderWithProviders(<SignalSection model={m} />);
    expect(container.querySelector('h2')!.textContent).toBe('Signals');
    expect(container.querySelector('tbody .sm-signals-line')).not.toBeNull();
  });
});

describe('MethodsPage', () => {
  it('prints the model counts and the one-sentence rule', async () => {
    const m = await mixed();
    const { container, getByTestId } = renderWithProviders(<MethodsPage model={m} />);
    expect(text(getByTestId('methods-verified')).replace(/\D+/g, ' ').trim().split(' ')[0]).toBe(String(m.methods.verified));
    expect(getByTestId('methods-estimated').querySelector('.sm-methods__count')!.textContent).toBe(String(m.methods.estimated));
    expect(getByTestId('methods-unknown').querySelector('.sm-methods__count')!.textContent).toBe(String(m.methods.unknown));
    expect(text(getByTestId('methods-signals'))).toBe(`${m.methods.signalsPrinted} signals printed; ${m.methods.signalsHeldBack} signal held back for lack of a source.`);
    expect(text(getByTestId('methods-profile'))).toContain(`${m.methods.unsourcedProfileItems} profile`);
    expect(text(container)).toContain('Nothing in this report is invented. A figure appears only with the source that states it.');
    expect(m.methods.signalsHeldBack).toBe(1);
  });
});

describe('SourcesList', () => {
  it('numbers match the model and long addresses are wrapped, not cut', async () => {
    const long = `https://example.com/${'a-very-long-path-segment/'.repeat(12)}end`;
    const m = await build((b) => [signalOf(b, 'sig_long', 'insight', { citations: [{ title: 'Example', url: long }] })]);
    const { container } = renderWithProviders(<SourcesList sources={m.sources} />);
    const items = Array.from(container.querySelectorAll('.sm-sources__item'));
    expect(items.map((i) => Number(i.getAttribute('data-n')))).toEqual(m.sources.map((s) => s.n));
    expect(items.map((i) => i.querySelector('.sm-sources__n')!.textContent)).toEqual(m.sources.map((s) => String(s.n)));
    const urls = Array.from(container.querySelectorAll('[data-testid="source-url"]')).map((u) => u.textContent);
    expect(urls).toEqual(m.sources.map((s) => s.url));
    expect(urls.some((u) => u!.length > 200)).toBe(true);
    for (const u of container.querySelectorAll('[data-testid="source-url"]')) expect(u.className).toContain('sm-sources__url');
  });

  it('prints nothing when there are no sources', () => {
    const { container } = renderWithProviders(<SourcesList sources={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
