import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import { completenessFixture } from './completeness-report.fixture';
import { companyTabsBatchPrompt, companyTabsParts } from './company-tabs-batch';
import { companyStoryPart } from './company-team';
import { companySection, GeminiRepository, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

type Ground = Awaited<ReturnType<LlmClient['ground']>>;

/** A batched answer: one "### Name" section per company, each sentence grounded on its own page. */
function batchAnswer(sections: Array<{ name: string; sentences: string[] }>): Ground {
  const text = sections.map(({ name, sentences }) => `### ${name}\n${sentences.join('\n')}`).join('\n\n');
  const supports = sections.flatMap(({ sentences }) => sentences)
    .filter((sentence) => !/^COMPANY (TEAM|STORY)$/.test(sentence))
    .map((sentence, i) => ({ supportIndex: i, text: sentence, sources: [{ chunkIndex: i, url: `https://src.example/${i}`, title: `Source ${i}` }] }));
  return { text, citations: supports.map((s) => ({ url: s.sources[0]!.url, title: s.sources[0]!.title })), queries: ['q'],
    grounding: { provider: 'google-search', answerText: text, supports } };
}

const section = (name: string) => ({ name, sentences: [
  `${name} builds warehouse robots for retailers.`,
  `${name} operates Picker, a picking robot.`,
  'COMPANY TEAM',
  `Pat Lee currently serves as Chief Executive Officer of ${name}.`,
  'COMPANY STORY',
  `${name} was founded in 2014 in Oakland.`,
] });

describe('one combined tabs search for several companies', () => {
  it('gives each company only its own briefing and story, and drops sentences naming another company of the batch', () => {
    const acme = section('Acme Robotics');
    acme.sentences.splice(2, 0, 'Acme Robotics partners with Gamma Shop on gadgets.');
    const g = batchAnswer([acme, section('Gamma Shop')]);
    const names = ['Acme Robotics', 'Gamma Shop'];
    const parts = companyTabsParts(g, companySection(g.text, 'Acme Robotics', names), 'Acme Robotics', ['Gamma Shop']);
    expect(parts.briefing!.grounding!.supports.map((s) => s.text)).toEqual([
      'Acme Robotics builds warehouse robots for retailers.', 'Acme Robotics operates Picker, a picking robot.']);
    expect(parts.briefing!.text).not.toContain('Pat Lee');
    // The story still splits into Team and History for companyStoryPart, each with only its own support.
    expect(companyStoryPart(parts.story!, 'team')!.grounding!.supports.map((s) => s.text))
      .toEqual(['Pat Lee currently serves as Chief Executive Officer of Acme Robotics.']);
    expect(companyStoryPart(parts.story!, 'story')!.grounding!.supports.map((s) => s.text))
      .toEqual(['Acme Robotics was founded in 2014 in Oakland.']);
    expect(parts.story!.text).not.toContain('Gamma Shop');
    // Provider offsets index the whole answer and never survive the cut.
    expect(parts.briefing!.grounding!.supports.every((s) => s.startIndex === undefined && s.endIndex === undefined)).toBe(true);
  });

  it('a section without its markers, or with a sentence shared with another section, is not used', () => {
    const plain = batchAnswer([{ name: 'Acme Robotics', sentences: ['Acme Robotics builds robots.'] }]);
    expect(companyTabsParts(plain, companySection(plain.text, 'Acme Robotics'), 'Acme Robotics', [])).toEqual({ briefing: null, story: null });
    // No COMPANY STORY line: the briefing is still usable, the story is not.
    const noStory = batchAnswer([{ name: 'Acme Robotics', sentences: ['Acme Robotics builds robots.', 'COMPANY TEAM', 'Pat Lee currently serves as CEO of Acme Robotics.'] }]);
    const partial = companyTabsParts(noStory, companySection(noStory.text, 'Acme Robotics'), 'Acme Robotics', []);
    expect(partial.briefing).not.toBeNull();
    expect(partial.story).toBeNull();
    // The same sentence in two sections cannot be told apart: it counts for neither.
    const twin = batchAnswer([section('Acme Robotics'), { ...section('Gamma Shop'), sentences: [...section('Gamma Shop').sentences, 'Robots are popular.'] }]);
    const twinText = twin.text.replace('Acme Robotics builds warehouse robots for retailers.', 'Robots are popular.\nAcme Robotics builds warehouse robots for retailers.');
    const shared = { ...twin, text: twinText, grounding: { ...twin.grounding!, answerText: twinText } };
    const acme = companyTabsParts(shared, companySection(shared.text, 'Acme Robotics', ['Acme Robotics', 'Gamma Shop']), 'Acme Robotics', ['Gamma Shop']);
    expect(acme.briefing!.grounding!.supports.map((s) => s.text)).not.toContain('Robots are popular.');
  });

  it('lists every company with its own domain and market', () => {
    const prompt = companyTabsBatchPrompt([
      { company: { name: 'Acme Robotics', websiteUrl: 'https://acme.example' }, marketName: 'Robots' },
      { company: { name: 'Gamma Shop', websiteUrl: null }, marketName: 'Gadgets' }]);
    expect(prompt).toContain('1. "Acme Robotics" (known official domain: "https://acme.example"; market: "Robots")');
    expect(prompt).toContain('2. "Gamma Shop" (known official domain: "not established"; market: "Gadgets")');
    expect(prompt).toMatch(/exactly COMPANY TEAM/);
    expect(prompt).toMatch(/exactly COMPANY STORY/);
  });
});

/** Fixture tab rows every tab schema accepts (zod strips the keys a tab does not use). */
const TAB_ANSWER = {
  markdown: '## What they do\nWarehouse robots.', founderStory: 'Founded in a garage.',
  timeline: [{ date: '2014', title: 'Company founded', detail: 'Founded in Oakland.' }], quotes: [],
  nodes: [{ id: 'p1', name: 'Pat Lee', role: 'CEO', group: 'exec', parentId: null, bio: 'Co-founder.' }],
  products: [{ name: 'Picker', description: 'A picking robot.', revenueNote: 'not disclosed', url: null, status: 'live' }],
  roadmap: [], items: [], cadence: 'weekly', lastRefreshedAt: null,
};

function fixtureRepo(ground: (prompt: string) => Promise<Ground>) {
  let saved = { ...completenessFixture(), viceClaims: [], reports: [], briefings: [], savedCards: [],
    opportunity: {}, researchJobs: [], threads: [] } as unknown as RepoSnapshot;
  const llm = {
    ground: vi.fn(async (prompt: string, _opts?: unknown) => ground(prompt)),
    structure: (async (_prompt: string, schema: ZodType<unknown>) => schema.parse(structuredClone(TAB_ANSWER))) as LlmClient['structure'],
  };
  // A key allowed 60 searches a minute warms eight companies at once (warmupConcurrency).
  const repo = new GeminiRepository({ apiKey: 'test', client: llm as unknown as LlmClient, groundedRpm: 60,
    originalSourceReader: async (url) => ({ requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString(), reason: 'offline' }),
    store: { read: () => structuredClone(saved), write: async (next) => { saved = structuredClone(next); } } });
  const labels = () => llm.ground.mock.calls.map((call) => { const opts = call[1] as { label?: string; researchContext?: { companyId?: string } } | undefined;
    return [opts?.label ?? 'ground', opts?.researchContext?.companyId].filter(Boolean).join(':'); });
  return { repo, llm, labels, saved: () => saved };
}

const NAMES = ['Acme Robotics', 'Beta Capital', 'Gamma Shop'];
const single = async (): Promise<Ground> => ({ text: 'Acme Robotics was founded in 2014 in Oakland.', citations: [{ title: 'About', url: 'https://acme.example/about' }], queries: ['q'] });

describe('dashboard warm-up with a combined tabs search', () => {
  it('researches Overview, Products, Team and History of the deck\'s companies in one search instead of two per company', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const { repo, labels, saved } = fixtureRepo(async (prompt) => prompt.includes('Write one section per company')
      ? batchAnswer(NAMES.filter((name) => prompt.includes(JSON.stringify(name))).map(section)) : single());
    repo.warmDeckDashboards('deck_fx', 'creation');
    await repo.waitForDashboardWarmup();
    expect(labels().filter((label) => label === 'company_tabs_batch')).toHaveLength(1);
    // Acme's Team tab was cached empty, so the warm-up re-researches it on purpose (forced): its own search.
    expect(labels().filter((label) => /^company_(briefing|story)/.test(label))).toEqual(['company_story:acme']);
    // Each company's part is filed as its own evidence under the tab topics the scoreboard counts.
    const gamma = (saved().researchEvidence ?? []).filter((row) => row.companyId === 'gamma').map((row) => row.topic);
    expect(gamma).toEqual(expect.arrayContaining(['company_briefing', 'company_story']));
    expect(saved().dashboards.gamma?.overview).toBeDefined();
    expect(saved().dashboards.gamma?.team_org).toBeDefined();
  });

  it('a failed combined search falls back to each company\'s own searches', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const { repo, labels, saved } = fixtureRepo(async (prompt) => {
      if (prompt.includes('Write one section per company')) throw new Error('503');
      return single();
    });
    repo.warmDeckDashboards('deck_fx', 'creation');
    await repo.waitForDashboardWarmup();
    expect(labels().filter((label) => label === 'company_tabs_batch')).toHaveLength(1);
    expect(labels().filter((label) => label.startsWith('company_briefing')).length).toBeGreaterThanOrEqual(2);
    expect(saved().dashboards.gamma?.overview).toBeDefined();
  });

  it('a tab the user opens is not held back to wait for a batch', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const { repo, labels } = fixtureRepo(single);
    await repo.getDashboardTab('gamma', 'overview');
    expect(labels()).toEqual(['company_briefing:gamma']);
  });
});
