import { describe, expect, it } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { buildSourceLedger, groupByPublisher } from './sourceLedger';

const metric = (citations: Array<{ title: string; url: string; credibility?: string }>) =>
  ({ id: 'm', companyId: 'c', metricType: 'arr', value: 1, confidence: 'estimated', citations }) as unknown as CompanyMetric;

describe('buildSourceLedger', () => {
  it('is empty when nothing is held', () => {
    expect(buildSourceLedger({})).toEqual([]);
  });

  it('merges one URL cited by figures, news and people into a single row', () => {
    const url = 'https://www.reuters.com/a';
    const ledger = buildSourceLedger({
      metrics: [metric([{ title: 'reuters.com', url, credibility: 'reputable_secondary' }])],
      sections: {
        live_intel: { content: { items: [{ url, title: 'Mistral raises', publisher: 'Reuters', publishedDate: '2026-08-19' }] } },
        team_org: { content: { nodes: [{ name: 'A', sourceUrl: url }] } },
      },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ publisher: 'reuters.com', strength: 'press', date: '2026-08-19', title: 'Mistral raises' });
    expect(ledger[0]!.uses).toEqual(['Figures', 'News', 'People']);
  });

  it('never invents a date or a tier', () => {
    const [row] = buildSourceLedger({ sections: { team_org: { content: { nodes: [{ sourceUrl: 'https://example.org/p' }] } } } });
    expect(row).toMatchObject({ date: null, strength: 'unrated' });
  });

  it('drops non-http and malformed links', () => {
    expect(buildSourceLedger({ sections: { live_intel: { content: { items: [{ url: 'javascript:alert(1)' }, { url: 5 }, null] } } } })).toEqual([]);
  });

  it('groups by publisher, biggest first', () => {
    const ledger = buildSourceLedger({
      metrics: [metric([
        { title: 'b.com', url: 'https://b.com/1' },
        { title: 'a.com', url: 'https://a.com/1' },
        { title: 'a.com', url: 'https://a.com/2' },
      ])],
    });
    expect(groupByPublisher(ledger).map((g) => [g.publisher, g.items.length])).toEqual([['a.com', 2], ['b.com', 1]]);
  });
});
