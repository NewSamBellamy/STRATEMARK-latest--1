import { describe, expect, it } from 'vitest';
import type { OrgNode } from '@mi/contracts';
import { buildPersonReportModel } from './personReportModel';

const company = { name: 'Acme', logoUrl: null, website: null, hq: null };
const person = (over: Partial<OrgNode> = {}): OrgNode => ({
  id: 'p', name: 'Ada Lovelace', role: 'CEO', group: 'exec', parentId: null, bio: '', ...over,
});

describe('buildPersonReportModel', () => {
  it('leaves unreported facts null and drops an evidence block with no source', () => {
    const m = buildPersonReportModel({ company, person: person({ supportingQuote: 'A quote with no source' }), groupLabel: 'Executive', portrait: null, deeper: null });
    expect(m.facts.find((f) => f.label === 'Tenure')?.value).toBeNull();
    expect(m.facts.find((f) => f.label === 'Role')?.value).toBe('CEO');
    expect(m.bio).toBeNull();
    expect(m.evidence).toBeNull();
    expect(m.deeper).toBeNull();
  });

  it('keeps quote and source together and numbers only web citations, once each', () => {
    const m = buildPersonReportModel({
      company,
      person: person({ supportingQuote: 'Led the lab.', sourceUrl: 'https://news.example/a', sourceRetrievedAt: '2026-10-02T10:00:00Z' }),
      groupLabel: 'Executive',
      portrait: null,
      deeper: { markdown: 'Text [1]', citations: [
        { title: 'One', url: 'https://x.example/1' },
        { title: 'Dup', url: 'https://x.example/1' },
        { title: 'Bad', url: 'javascript:alert(1)' },
      ] },
    });
    expect(m.evidence).toMatchObject({ quote: 'Led the lab.', url: 'https://news.example/a', retrieved: '2026-10-02' });
    expect(m.deeper?.footnotes.map((f) => f.n)).toEqual([1]);
  });

  it('treats blank deeper research as none', () => {
    const m = buildPersonReportModel({ company, person: person(), groupLabel: 'Executive', portrait: null, deeper: { markdown: '  ', citations: [] } });
    expect(m.deeper).toBeNull();
  });
});
