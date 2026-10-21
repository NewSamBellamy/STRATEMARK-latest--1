import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { DashboardTab, DashboardTabResult } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { OverviewCoverage, coverageItems } from './OverviewCoverage';

const tab = (companyId: string, t: DashboardTab, content: unknown) => ({ companyId, tab: t, content, lastRefreshedAt: '2026-10-01T00:00:00.000Z' }) as unknown as DashboardTabResult<DashboardTab>;

describe('what has been researched, judged by real content', () => {
  it('counts a part only when it has something in it', () => {
    const items = coverageItems(2, 4, {
      overview: { markdown: '  ' },
      team_org: { nodes: [{ id: 'p1' }, { id: 'p2' }] },
      products_roadmap: { products: [], roadmap: [{ title: 'x' }] },
      history: { founderStory: 'Founded in a garage.', timeline: [], quotes: [] },
      live_intel: { items: [], cadence: 'weekly' },
    });
    const by = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(by.figures).toMatchObject({ have: true, detail: '2 of 4 on the card' });
    expect(by.brief!.have).toBe(false);
    expect(by.team).toMatchObject({ have: true, detail: '2 people' });
    expect(by.products!.have).toBe(false);
    expect(by.history!.have).toBe(true);
    expect(by.news!.have).toBe(false);
    expect(by.mission!.have).toBe(false);
  });

  it('counts no figures as none, never as zero of progress shown as done', () => {
    expect(coverageItems(0, 4, {}).find((i) => i.key === 'figures')!.have).toBe(false);
  });
});

describe('the Overview coverage strip', () => {
  it('names what is missing and links each part to its tab', async () => {
    const repository = Object.assign(makeRepo(), {
      peekDashboardTab: vi.fn(async (id: string, t: DashboardTab) => (t === 'history' ? tab(id, t, { founderStory: 'x', timeline: [{ date: '2012', title: 'Founded', detail: '' }], quotes: [] }) : null)),
    });
    renderWithProviders(<OverviewCoverage companyId="cmp_x" figuresFound={0} figureSlots={4} />, { repository });
    const strip = await screen.findByRole('region', { name: 'What has been researched' });
    expect(within(strip).getByText(/1 of 7 parts/)).toBeInTheDocument();
    expect(within(strip).getByRole('link', { name: /History/ })).toHaveAttribute('href', expect.stringContaining('/company/cmp_x/dashboard/history'));
    expect(within(strip).getByRole('link', { name: /Team & org/ })).toHaveTextContent('not yet');
  });

  it('says plainly when there is only the card', async () => {
    const repository = Object.assign(makeRepo(), { peekDashboardTab: vi.fn(async () => null) });
    renderWithProviders(<OverviewCoverage companyId="cmp_x" figuresFound={0} figureSlots={4} />, { repository });
    expect(await screen.findByText(/Only the card so far/)).toBeInTheDocument();
  });

  it('disappears when everything is researched', async () => {
    const full: Record<string, unknown> = {
      overview: { markdown: 'A brief.' }, team_org: { nodes: [{ id: 'p' }] }, products_roadmap: { products: [{ name: 'P' }], roadmap: [] },
      history: { founderStory: '', timeline: [{ date: '2012', title: 'x', detail: '' }], quotes: [] }, live_intel: { items: [{ id: 'n' }] },
      mission_governance: { mission: 'To build.', board: [] },
    };
    const repository = Object.assign(makeRepo(), { peekDashboardTab: vi.fn(async (id: string, t: DashboardTab) => tab(id, t, full[t])) });
    const { container } = renderWithProviders(<OverviewCoverage companyId="cmp_x" figuresFound={4} figureSlots={4} />, { repository });
    await vi.waitFor(() => expect(repository.peekDashboardTab).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('section')).toBeNull();
  });

  it('never researches: it only peeks', async () => {
    const base = makeRepo();
    const getDashboardTab = vi.spyOn(base, 'getDashboardTab');
    const repository = Object.assign(base, { peekDashboardTab: vi.fn(async () => null) });
    renderWithProviders(<OverviewCoverage companyId="cmp_x" figuresFound={0} figureSlots={4} />, { repository });
    await screen.findByRole('region', { name: 'What has been researched' });
    expect(getDashboardTab).not.toHaveBeenCalled();
  });
});
