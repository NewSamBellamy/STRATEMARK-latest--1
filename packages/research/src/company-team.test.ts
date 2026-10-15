import { describe, expect, it, vi } from 'vitest';
import { renderCompanyTeamOrg, researchCompanyTeamOrg, roleSupported, teamOrgSupportReferences } from './company-team';
import { GeminiRepository, migrateSnapshot, type ResearchStore } from './repository';
import { extractProviderGrounding } from './grounding-support';

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
    expect(structure.mock.calls[0]![0]).toContain('Never infer biography, tenure, hierarchy');
    expect(ground).toHaveBeenCalledTimes(1);
    expect(ground.mock.calls[0]![0]).toContain('plain, complete sentences, one person per sentence');
    expect(ground.mock.calls[0]![0]).toContain('Do not use headings, name-only bullets');
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

  it('uses a separately labeled, per-person provider-supported roster when the original is blocked', async () => {
    const quote = 'Acme appointed Avery Founder as its current Chief Executive Officer.';
    const sourceUrl = 'https://reuters.com/acme-leadership';
    const grounding = extractProviderGrounding(quote, { groundingChunks: [{ web: { uri: sourceUrl, title: 'Leadership report' } }],
      groundingSupports: [{ segment: { text: quote, startIndex: 0, endIndex: quote.length }, groundingChunkIndices: [0] }] });
    const ground = vi.fn().mockResolvedValue({ text: quote, citations: [{ title: 'Leadership report', url: sourceUrl }], queries: [], grounding });
    const structure = vi.fn().mockResolvedValue({ nodes: [], reportedNodes: [{ id: 'avery', name: 'Avery Founder',
      role: 'Chief Executive Officer', group: 'exec', supportIndex: 0, quote }] });
    const sources = { list: vi.fn().mockResolvedValue([]), retrieve: vi.fn().mockResolvedValue({ requestedUrl: url,
      status: 'blocked', retrievedAt: source.retrievedAt }), save: vi.fn().mockResolvedValue(undefined) };

    const result = await researchCompanyTeamOrg({ company, client: { ground, structure } as never, originalSources: sources });

    expect(result.content.nodes).toEqual([expect.objectContaining({ name: 'Avery Founder', role: 'Chief Executive Officer',
      parentId: null, sourceUrl: null, supportingQuote: null, bio: expect.stringContaining('Google Search reports') })]);
    expect(result.citations).toEqual([expect.objectContaining({ url: sourceUrl, title: expect.stringContaining('Avery Founder') })]);
    expect(sources.save).toHaveBeenCalledTimes(1);
  });

  it('combines irrelevant readable originals and Google-supported people in one extraction call', async () => {
    const report = 'Acme appointed Avery Founder as its current Chief Executive Officer.';
    const reportUrl = 'https://reuters.com/acme-leadership';
    const grounding = extractProviderGrounding(report, { groundingChunks: [{ web: { uri: reportUrl, title: 'Leadership report' } }],
      groundingSupports: [{ segment: { text: report, startIndex: 0, endIndex: report.length }, groundingChunkIndices: [0] }] });
    const ground = vi.fn().mockResolvedValue({ text: report, citations: [{ title: 'Leadership report', url: reportUrl }], queries: [], grounding });
    const structure = vi.fn().mockResolvedValue({ nodes: [], reportedNodes: [{ id: 'avery', name: 'Avery Founder', role: 'Chief Executive Officer',
      group: 'exec', supportIndex: 0, quote: report }] });
    const irrelevant = { ...source, requestedUrl: 'https://acme.com/company/about', finalUrl: 'https://acme.com/company/about', text: 'Acme supports better research.' };
    const sources = { list: vi.fn().mockResolvedValue([{ id: 'saved', companyId: 'cmp', metricType: 'team_org', capturedAt: source.retrievedAt, receipts: [irrelevant] }]),
      retrieve: vi.fn(), save: vi.fn() };

    const result = await researchCompanyTeamOrg({ company, client: { ground, structure } as never, originalSources: sources });

    expect(result.content.nodes).toEqual([expect.objectContaining({ name: 'Avery Founder', bio: expect.stringContaining('Google Search reports') })]);
    expect(result.teamOrgSelections.reportedGrounding).toMatchObject({ provider: 'google-search', supports: [expect.objectContaining({ text: report })] });
    expect(ground).toHaveBeenCalledTimes(1);
    expect(structure).toHaveBeenCalledTimes(1);
    expect(structure.mock.calls[0]![0]).toContain('RETAINED ORIGINAL PAGES');
    expect(structure.mock.calls[0]![0]).toContain('GOOGLE SEARCH SUPPORTS');
  });

  it('reopens the source-linked org chart offline from local selections and retained originals', async () => {
    let snapshot = migrateSnapshot(null).snapshot;
    snapshot.companies.push(company);
    const store: ResearchStore = { read: () => structuredClone(snapshot), write: async value => { snapshot = structuredClone(value); } };
    const attempts: Array<{ id: string; companyId: string; metricType: string; capturedAt: string; receipts: typeof source[] }> = [];
    // The team half of the shared Team + History search.
    const answer = 'Leadership\nCOMPANY STORY\nStory';
    const ground = vi.fn().mockResolvedValue({ text: answer, citations: [{ title: 'Company leadership', url }], queries: [],
      grounding: { provider: 'google-search', answerText: answer, supports: [
        { supportIndex: 0, text: 'Leadership', sources: [{ chunkIndex: 0, url, title: 'Company leadership' }] }] } });
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

describe('legal-name companies and title synonyms: real people survive, invented ones do not', () => {
  const heineken = { ...company, name: 'Heineken N.V. / Heineken 0.0', websiteUrl: 'https://www.theheinekencompany.com' };
  const anthropic = { ...company, name: 'Anthropic, PBC', websiteUrl: 'https://www.anthropic.com' };
  const reportUrl = 'https://www.reuters.com/business/heineken-ceo';
  function reported(target: typeof company, segments: string[], rows: unknown[]) {
    const answer = segments.join(' ');
    const grounding = extractProviderGrounding(answer, { groundingChunks: [{ web: { uri: reportUrl, title: 'reuters.com' } }],
      groundingSupports: segments.map(text => ({ segment: { text, startIndex: answer.indexOf(text), endIndex: answer.indexOf(text) + text.length }, groundingChunkIndices: [0] })) });
    return renderCompanyTeamOrg(target, [], { nodes: [], reportedNodes: rows, reportedGrounding: grounding });
  }

  it('accepts Google-supported Heineken executives when sentences say "Heineken" and "CEO"', () => {
    const s0 = "Dolf van den Brink is Heineken's Chief Executive Officer and Chairman of the Executive Board.";
    const s1 = 'Harold van den Broek currently serves as Chief Financial Officer of Heineken.';
    const result = reported(heineken, [s0, s1], [
      { id: 'dolf', name: 'Dolf van den Brink', role: 'CEO', group: 'exec', supportIndex: 0, quote: s0 },
      { id: 'harold', name: 'Harold van den Broek', role: 'CFO', group: 'exec', supportIndex: 1, quote: s1 },
    ]);
    expect(result.content.nodes.map(node => [node.name, node.role])).toEqual([['Dolf van den Brink', 'CEO'], ['Harold van den Broek', 'CFO']]);
    expect(result.content.nodes[0]!.bio).toContain(`Google Search reports (original page not retrieved): “${s0}”`);
    expect(result.citations).toEqual(expect.arrayContaining([expect.objectContaining({ url: reportUrl })]));
  });

  it.each([
    ['a different title', 'Dolf van den Brink is the Chief Executive Officer of Heineken.', 'Dolf van den Brink', 'Chief Financial Officer'],
    ['president from vice president', 'Jan Smit is the Vice President of Sales at Heineken.', 'Jan Smit', 'President'],
    ['a person not named in the quote', 'The Chief Executive Officer of Heineken is based in Amsterdam.', 'Dolf van den Brink', 'CEO'],
    ['a former role', 'Jean-François van Boxmeer is the former CEO of Heineken.', 'Jean-François van Boxmeer', 'CEO'],
    ['a different company', 'Debra Crew is the CEO of Diageo.', 'Debra Crew', 'CEO'],
  ])('rejects %s', (_case, sentence, name, role) => {
    expect(reported(heineken, [sentence], [{ id: 'p', name, role, group: 'exec', supportIndex: 0, quote: sentence }]).content.nodes).toEqual([]);
  });

  it('never borrows a parenthetical parent company: Diageo executives are not Seedlip team members', () => {
    const seedlip = { ...company, name: 'Seedlip (Diageo plc)', websiteUrl: 'https://seedlipdrinks.com' };
    const s0 = 'Debra Crew is the CEO of Diageo.';
    expect(reported(seedlip, [s0], [{ id: 'debra', name: 'Debra Crew', role: 'CEO', group: 'exec', supportIndex: 0, quote: s0 }]).content.nodes).toEqual([]);
  });

  it('accepts an off-domain original that names "Anthropic" (not "Anthropic, PBC") with a synonym title', () => {
    const page = 'https://en.wikipedia.org/wiki/Anthropic';
    const quote = 'Dario Amodei is the co-founder and CEO of Anthropic, an AI safety company.';
    const original = { ...source, requestedUrl: page, finalUrl: page, text: `Anthropic is an AI company. ${quote}` };
    const result = renderCompanyTeamOrg(anthropic, [original], { nodes: [{ id: 'dario', name: 'Dario Amodei', role: 'Co-founder & Chief Executive Officer',
      group: 'exec', parentName: null, bio: '', tenure: null, priorCompany: null, notableProject: null, sourceUrl: page, quote }] });
    expect(result.content.nodes).toEqual([expect.objectContaining({ name: 'Dario Amodei', sourceUrl: page, supportingQuote: quote })]);
  });

  it('still rejects an off-domain original that never names the company', () => {
    const page = 'https://example.org/ai-leaders';
    const quote = 'Dario Amodei is the co-founder and CEO of a leading AI safety company.';
    const original = { ...source, requestedUrl: page, finalUrl: page, text: quote };
    expect(renderCompanyTeamOrg(anthropic, [original], { nodes: [{ id: 'dario', name: 'Dario Amodei', role: 'CEO', group: 'exec', parentName: null,
      bio: '', tenure: null, priorCompany: null, notableProject: null, sourceUrl: page, quote }] }).content.nodes).toEqual([]);
  });

  it('roleSupported: synonym-aware, whole-title, never a different office', () => {
    expect(roleSupported('Avery is the Chief Executive Officer of Acme.', 'CEO')).toBe(true);
    expect(roleSupported('Avery, CEO and co-founder of Acme.', 'Co-founder and Chief Executive Officer')).toBe(true);
    expect(roleSupported('Avery is a co-founder of Acme.', 'Founder')).toBe(true);
    expect(roleSupported('Avery is the Chairwoman of the Board.', 'Chair')).toBe(true);
    expect(roleSupported('Avery is the Chief Executive Officer of Acme.', 'CFO')).toBe(false);
    expect(roleSupported('Avery is the Senior Vice President of Product.', 'Vice President of Product')).toBe(false);
    expect(roleSupported('Avery is Vice President of Sales.', 'President')).toBe(false);
    expect(roleSupported('Avery leads research at Acme.', 'Head of Research')).toBe(false);
  });

  it('does not let an extra candidate fail the whole extraction', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}`, role: 'CEO', group: 'exec', supportIndex: 0, quote: 'x'.repeat(30) }));
    expect(() => renderCompanyTeamOrg(heineken, [], { nodes: [], reportedNodes: many })).not.toThrow();
    expect(renderCompanyTeamOrg(company, [source], { ...selections, reportedNodes: many }).content.nodes).toHaveLength(2);
  });
});
