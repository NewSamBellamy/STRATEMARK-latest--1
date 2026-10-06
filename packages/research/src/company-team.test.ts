import { describe, expect, it, vi } from 'vitest';
import { renderCompanyTeamOrg, researchCompanyTeamOrg, teamOrgSupportReferences } from './company-team';
import { GeminiRepository, migrateSnapshot, type ResearchStore } from './repository';

const company = { id: 'cmp', name: 'Acme', websiteUrl: 'https://acme.com', oneLiner: 'Research tools', logoUrl: null, hqLocation: null, brandTheme: null };
const url = 'https://acme.com/company/leadership';
const quote = 'Avery Founder is Acme co-founder and Chief Executive Officer. Jordan Chief Research Officer reports directly to Avery Founder.';
const source = { requestedUrl: url, finalUrl: url, status: 'retrieved' as const, httpStatus: 200,
  contentHash: 'a'.repeat(64), text: quote, retrievedAt: '2026-10-06T00:00:00.000Z' };
const selections = { nodes: [
  { id: 'avery', name: 'Avery Founder', role: 'Chief Executive Officer', group: 'exec', parentName: null,
    bio: 'Avery Founder is Acme co-founder and Chief Executive Officer.', tenure: null, priorCompany: null, notableProject: null,
    sourceUrl: url, quote: 'Avery Founder is Acme co-founder and Chief Executive Officer.' },
  { id: 'jordan', name: 'Jordan Chief', role: 'Chief Research Officer', group: 'ai', parentName: 'Avery Founder',
    bio: 'Jordan Chief Research Officer reports directly to Avery Founder.', tenure: null, priorCompany: null, notableProject: null,
    sourceUrl: url, quote: 'Jordan Chief Research Officer reports directly to Avery Founder.' },
] };

describe('source-backed company team records', () => {
  it('retains original pages before extraction and returns only exact person-level evidence', async () => {
    const ground = vi.fn().mockResolvedValue({ text: 'A leadership page.', citations: [{ title: 'Leadership', url }], queries: [] });
    const structure = vi.fn().mockResolvedValue(selections);
    const sources = { list: vi.fn().mockResolvedValue([]), retrieve: vi.fn().mockResolvedValue(source), save: vi.fn().mockResolvedValue(undefined) };
    const result = await researchCompanyTeamOrg({ company, client: { ground, structure } as never, originalSources: sources });
    expect(sources.retrieve).toHaveBeenCalledTimes(1);
    expect(sources.save).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'cmp', metricType: 'team_org', receipts: [source] }));
    expect(structure.mock.calls[0]![0]).toContain('RETAINED ORIGINAL PAGES');
    expect(result.content.nodes).toHaveLength(2);
    expect(result.content.nodes[0]).toMatchObject({ sourceUrl: url, supportingQuote: selections.nodes[0]!.quote });
    expect(result.content.nodes[0]!.sourceRetrievedAt).toBe(source.retrievedAt);
    expect(structure.mock.calls[0]![0]).toContain('Do not infer currentness, personality');
    expect(ground).toHaveBeenCalledTimes(1);
  });

  it('does not synthesize people when original-page retrieval is blocked', async () => {
    const structure = vi.fn();
    const sources = { list: vi.fn().mockResolvedValue([]), retrieve: vi.fn().mockResolvedValue({ requestedUrl: url, status: 'blocked', retrievedAt: source.retrievedAt }),
      save: vi.fn().mockResolvedValue(undefined) };
    const result = await researchCompanyTeamOrg({ company, client: { ground: vi.fn().mockResolvedValue({ text: '', citations: [{ title: 'Team', url }], queries: [] }), structure } as never,
      originalSources: sources });
    expect(result.content.nodes).toEqual([]);
    expect(sources.save).toHaveBeenCalledTimes(1);
    expect(structure).not.toHaveBeenCalled();
  });

  it('reopens the source-linked org chart offline from local selections and retained originals', async () => {
    let snapshot = migrateSnapshot(null).snapshot;
    snapshot.companies.push(company);
    const store: ResearchStore = { read: () => structuredClone(snapshot), write: async value => { snapshot = structuredClone(value); } };
    const attempts: Array<{ id: string; companyId: string; metricType: string; capturedAt: string; receipts: typeof source[] }> = [];
    const ground = vi.fn().mockResolvedValue({ text: 'Leadership', citations: [{ title: 'Company leadership', url }], queries: [] });
    const structure = vi.fn().mockResolvedValue(selections);
    const originals = { list: vi.fn(async () => structuredClone(attempts)),
      retrieve: vi.fn(async () => structuredClone(source)),
      save: vi.fn(async (attempt: typeof attempts[number]) => { attempts.push(structuredClone(attempt)); }) };
    const repository = () => new GeminiRepository({ apiKey: 'test', client: { ground, structure } as never, store, originalSources: originals });
    const first = await repository().getDashboardTab('cmp', 'team_org');
    expect(first!.content.nodes[0]).toMatchObject({ sourceUrl: url, supportingQuote: selections.nodes[0]!.quote });
    const reopened = await repository().getDashboardTab('cmp', 'team_org');
    expect(reopened).toEqual(first);
    expect(originals.retrieve).toHaveBeenCalledTimes(1);
    expect(ground).toHaveBeenCalledTimes(1);
    expect(structure).toHaveBeenCalledTimes(1);
  });

  it('accepts only exact quotes from retained originals that contain each person and reported title', () => {
    const result = renderCompanyTeamOrg(company, [source], selections);
    expect(result.content.nodes).toHaveLength(2);
    expect(result.content.nodes[1]).toMatchObject({ name: 'Jordan Chief', role: 'Chief Research Officer', parentId: 'avery', sourceUrl: url,
      supportingQuote: selections.nodes[1]!.quote });
    expect(result.citations).toEqual([expect.objectContaining({ url })]);
  });

  it.each(['invented-quote', 'wrong-source', 'wrong-title', 'invented-parent', 'unsupported-bio'])(
    'rejects %s person evidence', fault => {
      const candidate = structuredClone(selections);
      if (fault === 'invented-quote') candidate.nodes[0]!.quote = 'Avery Founder is Acme co-founder and Chief Executive Officer of its lunar division.';
      if (fault === 'wrong-source') candidate.nodes[0]!.sourceUrl = 'https://other.example/team';
      if (fault === 'wrong-title') candidate.nodes[0]!.role = 'Chief Financial Officer';
      if (fault === 'invented-parent') candidate.nodes[1]!.parentName = 'Unknown Executive';
      if (fault === 'unsupported-bio') candidate.nodes[0]!.bio = 'Avery is known for a bold and visionary leadership style.';
      const result = renderCompanyTeamOrg(company, [source], candidate);
      if (fault === 'invented-parent') expect(result.content.nodes[1]!.parentId).toBeNull();
      else if (fault === 'unsupported-bio') expect(result.content.nodes[0]!.bio).not.toContain('visionary');
      else expect(result.content.nodes.some(node => node.id === 'avery')).toBe(false);
    },
  );

  it('returns an honest empty result when no retained original supports a person', () => {
    const blocked = { requestedUrl: url, status: 'blocked' as const, retrievedAt: source.retrievedAt };
    expect(renderCompanyTeamOrg(company, [blocked], selections).content.nodes).toEqual([]);
  });

  it('keeps offline support lookups inside the shared twelve-reference limit', () => {
    const many = { nodes: Array.from({ length: 30 }, (_, i) => ({ ...selections.nodes[0]!, id: `person-${i}`,
      name: `Person ${i}`, sourceUrl: `https://acme.com/team/${i}`, quote: `Person ${i} has a Chief Executive Officer title at Acme.` })) };
    expect(teamOrgSupportReferences(many)).toHaveLength(12);
  });
});
