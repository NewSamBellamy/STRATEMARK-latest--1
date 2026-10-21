import { describe, expect, it } from 'vitest';
import { renderCompanyTeamOrg, startedAtSupported } from './company-team';

const company = { id: 'cmp', name: 'Acme', websiteUrl: 'https://acme.com', oneLiner: '', logoUrl: null, hqLocation: null, brandTheme: null };
const url = 'https://acme.com/company/leadership';
const quote = 'Florian Bressand joined Acme in March 2026 as Chief Operating Officer; he was previously Chief Operating Officer at Doctolib and is a co-founder of the Paris office.';
const source = { requestedUrl: url, finalUrl: url, status: 'retrieved' as const, httpStatus: 200,
  contentHash: 'a'.repeat(64), text: quote, retrievedAt: '2026-10-06T00:00:00.000Z' };
const row = (over: Record<string, unknown> = {}) => ({ id: 'florian', name: 'Florian Bressand', role: 'Chief Operating Officer', group: 'exec',
  parentName: null, bio: '', tenure: null, priorCompany: null, notableProject: null, isFounder: null, startedAt: null, sourceUrl: url, quote, ...over });
const render = (over: Record<string, unknown>) => renderCompanyTeamOrg(company, [source], { nodes: [row(over)] }).content.nodes[0]!;

describe('structured person fields come only from the supporting quote', () => {
  it('fills priorCompany, founder flag and start month when the quote states them, and persists the source', () => {
    const node = render({ priorCompany: 'Doctolib', isFounder: true, startedAt: '2026-03', tenure: 'joined Acme in March 2026' });
    expect(node).toMatchObject({ priorCompany: 'Doctolib', isFounder: true, startedAt: '2026-03', tenure: 'joined Acme in March 2026',
      sourceUrl: url, supportingQuote: quote, sourceRetrievedAt: source.retrievedAt });
  });

  it('leaves every field null when the quote does not support it', () => {
    const node = render({ priorCompany: 'Google', notableProject: 'Le Chat', tenure: '5 years', isFounder: true,
      quote: 'Florian Bressand is Chief Operating Officer at Acme and leads operations across Europe.' });
    // The page text must contain the new quote for the row to survive at all.
    expect(node).toBeUndefined();
    const kept = renderCompanyTeamOrg(company, [{ ...source, text: 'Florian Bressand is Chief Operating Officer at Acme and leads operations across Europe.' }],
      { nodes: [row({ priorCompany: 'Google', notableProject: 'Le Chat', tenure: '5 years', isFounder: true, startedAt: '2026-03',
        quote: 'Florian Bressand is Chief Operating Officer at Acme and leads operations across Europe.' })] }).content.nodes[0]!;
    expect(kept.priorCompany).toBeNull();
    expect(kept.notableProject).toBeNull();
    expect(kept.tenure).toBeNull();
    expect(kept.startedAt ?? null).toBeNull();
    expect(kept.isFounder).toBeUndefined();
  });

  it('never invents a founder flag from the model alone, and ignores a false one', () => {
    expect(render({ isFounder: null }).isFounder).toBeUndefined();
    expect(render({ isFounder: false }).isFounder).toBeUndefined();
  });

  it('validates start dates against the quote text', () => {
    expect(startedAtSupported(quote, '2026-03')).toBe('2026-03');
    expect(startedAtSupported(quote, '2026-03-15')).toBe('2026-03-15');
    expect(startedAtSupported(quote, '2026-04')).toBeNull();
    expect(startedAtSupported(quote, '2025-03')).toBeNull();
    expect(startedAtSupported(quote, 'March 2026')).toBeNull();
    expect(startedAtSupported('Ada leads Acme since 2026.', '2026-01')).toBeNull();
    expect(startedAtSupported('Ada is Acme CEO. The firm opened in March 2026.', '2026-03')).toBeNull();
  });
});
