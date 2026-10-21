import { describe, expect, it } from 'vitest';
import type { DashboardTab } from '@mi/contracts';
import { researchDashboardWithSources } from './dashboard';
import { splitRunSpend } from './deck-run';
import type { LlmClient } from './types';

const company = { id: 'acme', name: 'Acme Robotics', oneLiner: 'Warehouse robots.', logoUrl: null, hqLocation: null,
  websiteUrl: 'https://acme.example', brandTheme: null };

/** Records what each paid call says it is for; searches answer, extractions fail: only the booking matters here. */
function bookingClient() {
  const labels: string[] = [];
  const client: LlmClient = {
    ground: async (_prompt, opts) => {
      labels.push(`ground ${opts?.label ?? opts?.researchContext?.topic ?? 'ground'}`);
      return { text: 'Acme Robotics was founded in 2015 in Austin. It sells Fleet Manager, run by CEO Jane Roe. Acme Robotics raised $20M in 2026.',
        citations: [{ url: 'https://acme.example/about', title: 'About Acme Robotics' }], queries: ['acme robotics'] };
    },
    structure: async (_prompt, _schema, opts) => { labels.push(`structure ${opts?.label ?? 'structure'}`); throw new Error('offline'); },
  };
  return { client, labels };
}

describe('every paid call a tab makes is booked to that tab', () => {
  const tabs: DashboardTab[] = ['overview', 'products_roadmap', 'team_org', 'history', 'live_intel', 'mission_governance'];
  for (const tab of tabs) {
    it(`${tab}: its searches and its extraction calls`, async () => {
      const { client, labels } = bookingClient();
      await researchDashboardWithSources(tab, { company, marketName: 'Warehouse robotics', storedMetrics: [], client,
        newsSearch: async () => [{ title: 'Acme Robotics raises $20M', url: 'https://news.example/a', snippet: 'Acme Robotics raised.', published: '2026-10-10' }],
      }).catch(() => null);
      expect(labels.filter((l) => !l.endsWith(` tab:${tab}`))).toEqual([]);
      expect(labels.length).toBeGreaterThan(0);
      // Products and Team extract only from official pages, which this test has none of.
      if (tab !== 'products_roadmap' && tab !== 'team_org') expect(labels.some((l) => l.startsWith('structure '))).toBe(true);
    });
  }
});

describe('a deck run reads as cards with their figures, and tabs', () => {
  it('books tab calls and the shared searches behind them to tabs, the rest to cards', () => {
    const row = (estCostUsd: number) => ({ calls: 1, estCostUsd, totalMs: 1 });
    const split = splitRunSpend({ calls: 6, inputTokens: 0, outputTokens: 0, searchQueries: 0, estCostUsd: 1.5, byTopic: {
      'market:discover': row(0.2), metrics_hunt_batch: row(0.5), 'tab:history': row(0.1), company_briefing: row(0.3),
      company_tabs_batch: row(0.2), structure: row(0.2) } });
    expect(split!.tabsUsd).toBeCloseTo(0.6, 9);
    expect(split!.cardsUsd).toBeCloseTo(0.9, 9);
  });

  it('is unknown, not zero, when the run was never measured', () => {
    expect(splitRunSpend(undefined)).toBeNull();
  });
});
