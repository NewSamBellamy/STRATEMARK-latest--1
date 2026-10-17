import { describe, expect, it, vi } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { completenessFixture } from './completeness-report.fixture';
import { classifyCompanyType, companyTypeFocus } from './company-type';
import { companyTabsBatchPrompt } from './company-tabs-batch';
import { GeminiRepository, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';

const cited = [{ title: 'Filing', url: 'https://sec.example/10-k' }];
const fact = (metricType: CompanyMetric['metricType'], value: number | null, confidence: CompanyMetric['confidence'] = 'verified',
  citations = cited) => ({ metricType, value, confidence, citations });
const firm = (oneLiner: string) => ({ oneLiner });

describe('what kind of company this is comes only from figures the app would show', () => {
  it('a sourced market cap: a listed company, researched from its filings', () => {
    const type = classifyCompanyType(firm('Payroll software.'), [fact('market_cap', 9e9, 'estimated')]);
    expect(type).toEqual({ listing: 'public', stage: 'enterprise' });
    expect(companyTypeFocus(type)).toMatch(/filings/);
  });

  it('a sourced funding round and a small team: a startup, researched for its rounds and founders', () => {
    const type = classifyCompanyType(firm('Payroll software.'), [fact('last_round', 2e7), fact('employees', 40)]);
    expect(type).toEqual({ listing: 'private', stage: 'startup' });
    expect(companyTypeFocus(type)).toMatch(/funding round/);
  });

  it('a restaurant: a local business, researched for its locations and reviews', () => {
    const type = classifyCompanyType(firm('A family restaurant in Austin.'), [fact('employees', 30)]);
    expect(type.stage).toBe('local');
    expect(companyTypeFocus(type)).toMatch(/locations/);
  });

  it('a large private company: researched for its divisions', () => {
    expect(companyTypeFocus(classifyCompanyType(firm('Warehouse robots.'), [fact('employees', 5000)]))).toMatch(/divisions/);
  });

  it('nothing on file: no type, and the searches stay as they were', () => {
    const type = classifyCompanyType(firm('Payroll software.'), []);
    expect(type).toEqual({ listing: 'unknown', stage: 'unknown' });
    expect(companyTypeFocus(type)).toBeNull();
  });

  it('an unknown figure, an empty one, or an uncited "verified" one never sets the type', () => {
    expect(classifyCompanyType(firm('Payroll software.'), [
      fact('market_cap', 9e9, 'unknown'), fact('last_round', null), fact('employees', 5000, 'verified', []),
    ])).toEqual({ listing: 'unknown', stage: 'unknown' });
  });

  it('a figure a person entered counts without a link', () => {
    expect(classifyCompanyType(firm('Payroll software.'), [fact('employees', 5000, 'user_verified', [])]).stage).toBe('enterprise');
  });
});

describe('the shared tab searches ask what matters for that kind of company', () => {
  function fixtureRepo() {
    const snap = { ...completenessFixture(), viceClaims: [], reports: [], briefings: [], savedCards: [],
      opportunity: {}, researchJobs: [], threads: [] } as unknown as RepoSnapshot;
    const prompts: Array<{ label: string | undefined; prompt: string }> = [];
    const ground = vi.fn(async (prompt: string, opts?: { label?: string }) => { prompts.push({ label: opts?.label, prompt }); throw new Error('offline'); });
    const structure = vi.fn(async () => { throw new Error('offline'); });
    let saved = structuredClone(snap);
    const repo = new GeminiRepository({ apiKey: 'test', client: { ground, structure } as unknown as LlmClient, dashboardWarmup: false,
      store: { read: () => structuredClone(saved), write: async (next) => { saved = structuredClone(next); } } });
    return { repo, prompts };
  }

  it('a large company (1,200 people, entered by an analyst) is asked about its divisions', async () => {
    const { repo, prompts } = fixtureRepo();
    await repo.getDashboardTab('acme', 'products_roadmap').catch(() => null);
    const briefing = prompts.find((p) => p.label === 'company_briefing');
    expect(briefing?.prompt).toMatch(/divisions and main brands/);
  });

  it('a company with a sourced market cap is sent to its filings for its story', async () => {
    const { repo, prompts } = fixtureRepo();
    await repo.getDashboardTab('gamma', 'history').catch(() => null);
    const story = prompts.find((p) => p.label === 'company_story');
    expect(story?.prompt).toMatch(/annual and quarterly filings/);
  });

  it('the combined warm-up search names each company\'s focus on its own line, and only where one is known', () => {
    const prompt = companyTabsBatchPrompt([
      { company: { name: 'Acme', websiteUrl: 'https://acme.example' }, marketName: 'Robots', focus: 'It is a large company: cover its divisions.' },
      { company: { name: 'Beta', websiteUrl: null }, marketName: 'Robots', focus: null },
    ]);
    const lines = prompt.split('\n');
    expect(lines.find((l) => l.startsWith('- "Acme"'))).toMatch(/cover its divisions\.$/);
    expect(lines.find((l) => l.startsWith('- "Beta"'))).toMatch(/market: "Robots"\)$/);
  });
});
