import { expect, it } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { savedCompanyProfile } from './saved-profile';
import type { ResearchEvidence } from './research-evidence';
import { GeminiRepository, migrateSnapshot } from './repository';
import type { LlmClient } from './types';
const company = { id: 'c', name: 'Acme', websiteUrl: 'https://acme.com', logoUrl: null, hqLocation: null, brandTheme: null, oneLiner: 'No source-backed company snapshot is ready yet.' };
const text = 'Acme employs 450 employees as of October 1, 2026.';
const evidence: ResearchEvidence = { id: 'e', companyId: 'c', companyName: 'Acme', topic: 'company_profile', capturedAt: '2026-10-02T00:00:00Z', text, citations: [], queries: [],
  grounding: { provider: 'google-search', answerText: text, supports: [{ supportIndex: 0, text, sources: [{ chunkIndex: 0, url: 'https://acme.com/team', title: 'Acme team' }] }] } };
it('recovers an unambiguous saved measurement without model or source calls', () => {
  expect(savedCompanyProfile(company, [], [evidence]).metrics).toEqual([expect.objectContaining({ value: 450, confidence: 'estimated', metricType: 'employees' })]);
});
it('never replaces a saved observation or human confirmation', () => {
  const row = { id: 'm', companyId: 'c', metricType: 'employees', value: 20, confidence: 'user_verified' } as CompanyMetric;
  expect(savedCompanyProfile(company, [row], [evidence]).metrics).toEqual([row]);
});
it('does not use another company, topic or older profile', () => {
  for (const change of [{ companyId: 'other' }, { companyName: 'Other' }, { topic: 'chat' }])
    expect(savedCompanyProfile(company, [], [{ ...evidence, ...change }]).metrics).toEqual([]);
  expect(savedCompanyProfile(company, [], [evidence, { ...evidence, id: 'new', capturedAt: '2026-10-03T00:00:00Z', text: 'Unavailable', grounding: undefined }]).metrics).toEqual([]);
});
it('projects saved profile repair consistently into card, company and metrics dashboard without changing stored history', async () => {
  const snapshot = migrateSnapshot(null).snapshot;
  const description = 'Acme develops collaboration software for researchers.';
  snapshot.companies = [company];
  snapshot.dashboards.c = { overview: { overviewEvidenceVersion: 3, content: { markdown: 'Untrusted cache' }, lastRefreshedAt: '2026-10-02T00:00:00Z',
    overviewNarrative: { companyId: 'c', basis: 'google-search', answerText: description, citations: [{ title: 'Acme', url: 'https://acme.com/team' }],
      paragraphs: [{ section: 'background', text: 'Fabricated unsupported paragraph', sourceUrls: ['https://invented.example'], supportIndices: [99] }] } } };
  snapshot.researchEvidence = [{ ...evidence, text: `${description}\n${text}`, grounding: { ...evidence.grounding!, answerText: `${description}\n${text}`,
    supports: [...evidence.grounding!.supports, { supportIndex: 1, text: description, sources: evidence.grounding!.supports[0]!.sources }] } }];
  snapshot.researchEvidence.push({ ...evidence, id: 'overview', topic: 'overview', text: description, citations: [{ url: 'https://acme.com/team', title: 'Acme team' }], grounding: { ...evidence.grounding!, answerText: description,
    supports: [{ ...evidence.grounding!.supports[0]!, text: description }] } });
  const repo = new GeminiRepository({ apiKey: 'test-placeholder', store: { read: () => snapshot, write: () => { throw new Error('Read must not overwrite user data'); } },
    client: { ground: () => { throw new Error('No paid calls'); }, structure: () => { throw new Error('No paid calls'); } } as unknown as LlmClient });
  expect((await repo.getCompanyFacts('c')).find(row => row.metricType === 'employees')?.value).toBe(450);
  expect((await repo.getCompany('c'))?.oneLiner).toBe(description);
  const dashboard = await repo.getDashboardTab('c', 'overview');
  expect(dashboard?.content.markdown).toContain('Employees: 450');
  expect(dashboard?.content.markdown).toContain('not verified');
  expect(dashboard?.content.markdown).toContain(description);
  expect(snapshot.companies[0]!.oneLiner).toBe(company.oneLiner);
});
