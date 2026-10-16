import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import { completenessFixture } from './completeness-report.fixture';
import { companyTabsBatchPrompt, companyTabsParts, companyTabsSections } from './company-tabs-batch';
import { companyStoryPart } from './company-team';
import { GeminiRepository, type RepoSnapshot } from './repository';
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
    const parts = companyTabsParts(g, companyTabsSections(g.text, names)!.get('Acme Robotics'), 'Acme Robotics', ['Gamma Shop']);
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
    expect(companyTabsParts(plain, companyTabsSections(plain.text, ['Acme Robotics'])!.get('Acme Robotics'), 'Acme Robotics', [])).toEqual({ briefing: null, story: null });
    // No COMPANY STORY line: the briefing is still usable, the story is not.
    const noStory = batchAnswer([{ name: 'Acme Robotics', sentences: ['Acme Robotics builds robots.', 'COMPANY TEAM', 'Pat Lee currently serves as CEO of Acme Robotics.'] }]);
    const partial = companyTabsParts(noStory, companyTabsSections(noStory.text, ['Acme Robotics'])!.get('Acme Robotics'), 'Acme Robotics', []);
    expect(partial.briefing).not.toBeNull();
    expect(partial.story).toBeNull();
    // The same sentence in two sections cannot be told apart: it counts for neither.
    const twin = batchAnswer([section('Acme Robotics'), { ...section('Gamma Shop'), sentences: [...section('Gamma Shop').sentences, 'Robots are popular.'] }]);
    const twinText = twin.text.replace('Acme Robotics builds warehouse robots for retailers.', 'Robots are popular.\nAcme Robotics builds warehouse robots for retailers.');
    const shared = { ...twin, text: twinText, grounding: { ...twin.grounding!, answerText: twinText } };
    const acme = companyTabsParts(shared, companyTabsSections(shared.text, ['Acme Robotics', 'Gamma Shop'])!.get('Acme Robotics'), 'Acme Robotics', ['Gamma Shop']);
    expect(acme.briefing!.grounding!.supports.map((s) => s.text)).not.toContain('Robots are popular.');
  });

  it('lists every company with its own domain and market', () => {
    const prompt = companyTabsBatchPrompt([
      { company: { name: 'Acme Robotics', websiteUrl: 'https://acme.example' }, marketName: 'Robots' },
      { company: { name: 'Gamma Shop', websiteUrl: null }, marketName: 'Gadgets' }]);
    // Bullets, not numbers: a numbered roster invites "### 1. Acme" headings.
    expect(prompt).toContain('- "Acme Robotics" (known official domain: "https://acme.example"; market: "Robots")');
    expect(prompt).toContain('- "Gamma Shop" (known official domain: "not established"; market: "Gadgets")');
    expect(prompt).not.toMatch(/^1\. "/m);
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

describe('cutting a combined answer into companies', () => {
  const roster = ['Acme Robotics', 'Gamma Shop'];
  const sectionText = (name: string) => section(name).sentences.join('\n');

  it('ends a section at the next heading of its level, whatever it names', () => {
    // A trailing notes heading holds a rival's round: it is in nobody's section.
    const notes = `### Acme Robotics\n${sectionText('Acme Robotics')}\n\n### Gamma Shop\n${sectionText('Gamma Shop')}\n\n### Notes\nIn 2021 the retailer raised a 20 million dollar Series B.`;
    const cut = companyTabsSections(notes, roster)!;
    expect(cut.get('Gamma Shop')).not.toContain('Series B');
    expect(cut.get('Acme Robotics')).not.toContain('Gamma Shop');
    // A misnamed heading for a rival ends Acme's section, and Gamma then has no section: nobody's part is used.
    const misnamed = `### Acme Robotics\n${sectionText('Acme Robotics')}\n\n### Gamma Shop Inc. (gammashop.com) overview\nIn 2021 the retailer raised a 20 million dollar Series B.`;
    expect(companyTabsSections(misnamed, roster)).toBeNull();
    // A company named twice, or at another heading level, cannot be cut either.
    expect(companyTabsSections('### Acme Robotics\na\n### Gamma Shop\nb\n### Acme Robotics\nc', roster)).toBeNull();
    expect(companyTabsSections('### Acme Robotics\na\n#### Gamma Shop\nb', roster)).toBeNull();
    // Part markers written as headings are not boundaries; a rule after the last section ends it.
    const marked = notes.replace(/^COMPANY (TEAM|STORY)$/gm, '### COMPANY $1').replace('### Notes', '---');
    const markedCut = companyTabsSections(marked, roster)!;
    expect(markedCut.get('Acme Robotics')).toContain('Acme Robotics was founded in 2014');
    expect(markedCut.get('Gamma Shop')).toContain('Gamma Shop was founded in 2014');
    expect(markedCut.get('Gamma Shop')).not.toContain('Series B');
    // A rule inside the last section, before its story, does not cut it off from its own parts.
    const midRule = notes.replace('### Notes\n', '').replace('Gamma Shop operates Picker, a picking robot.', 'Gamma Shop operates Picker, a picking robot.\n---');
    expect(companyTabsSections(midRule, roster)!.get('Gamma Shop')).toContain('Gamma Shop was founded in 2014');
  });

  it('reads numbered headings', () => {
    for (const [a, b] of [['### 1. Acme Robotics', '### 2. Gamma Shop'], ['### **1) Acme Robotics**', '### **2) Gamma Shop**'],
      ['## Company 1: Acme Robotics', '## Company 2: Gamma Shop']] as const) {
      const cut = companyTabsSections(`${a}\n${sectionText('Acme Robotics')}\n\n${b}\n${sectionText('Gamma Shop')}`, roster);
      expect(cut?.get('Acme Robotics')).toContain('Acme Robotics was founded in 2014');
      expect(cut?.get('Gamma Shop')).toContain('Gamma Shop was founded in 2014');
    }
    // A name that starts with digits is still itself.
    expect(companyTabsSections('### 3M\nx\n### Gamma Shop\ny', ['3M', 'Gamma Shop'])?.get('3M')).toContain('x');
  });

  it("gives companies that share a name key no part, and files only a company's own queries", () => {
    const text = `### Scale\n${sectionText('Scale')}\n\n### Gamma Shop\n${sectionText('Gamma Shop')}`;
    const cut = companyTabsSections(text, ['Scale', 'Scale Inc', 'Gamma Shop'])!;
    expect(cut.has('Scale')).toBe(false);
    expect(cut.has('Scale Inc')).toBe(false);
    expect(cut.get('Gamma Shop')).toBeDefined();
    const g = { ...batchAnswer([section('Acme Robotics'), section('Gamma Shop')]), queries: ['Acme Robotics products', 'Gamma Shop leadership team'] };
    const parts = companyTabsParts(g, companyTabsSections(g.text, roster)!.get('Acme Robotics'), 'Acme Robotics', ['Gamma Shop']);
    expect(parts.briefing!.queries).toEqual(['Acme Robotics products']);
  });
});

describe('dashboard warm-up with a combined tabs search', () => {
  it('researches Overview, Products, Team and History of the deck\'s companies in one search instead of two per company', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const { repo, labels, saved } = fixtureRepo(async (prompt) => prompt.includes('Write one section per company')
      ? batchAnswer(NAMES.filter((name) => prompt.includes(JSON.stringify(name))).map(section)) : single());
    repo.warmDeckDashboards('deck_fx', 'creation');
    await repo.waitForDashboardWarmup();
    expect(labels().filter((label) => label === 'company_tabs_batch')).toHaveLength(1);
    // Beta and Gamma share the combined search. Acme's other pair was already researched (History
    // filled, Team cached empty and re-researched on purpose), so Acme searches on its own and its
    // story is never searched early for a batch.
    expect(labels().filter((label) => /^company_(briefing|story)/.test(label)).sort()).toEqual(['company_briefing:acme', 'company_story:acme']);
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

  it('a combined search that never settles frees its companies, and pays for no late search', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    vi.useFakeTimers();
    try {
      // The provider ignores the abort and never answers the combined search.
      const { repo, labels } = fixtureRepo((prompt) => prompt.includes('Write one section per company') ? new Promise<Ground>(() => {}) : single());
      repo.warmDeckDashboards('deck_fx', 'creation');
      await vi.advanceTimersByTimeAsync(49_000);
      expect(labels().filter((label) => label === 'company_tabs_batch')).toHaveLength(1);
      expect(labels().filter((label) => /^company_(briefing|story):(beta|gamma)$/.test(label))).toEqual([]);
      await vi.advanceTimersByTimeAsync(120_000);
      // Released at the batch deadline, the waiting tabs fail at once: too late for a search of their
      // own. The warm-up's next tabs then each run the company's own search, in their own time,
      // once per tab pair (the slots are free), and never a second combined search.
      expect(labels().filter((label) => label === 'company_tabs_batch')).toHaveLength(1);
      expect(labels().filter((label) => label === 'company_briefing:gamma')).toHaveLength(1);
      expect(labels().filter((label) => label === 'company_story:gamma')).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });

  it('a tab the user opens while a combined search hangs still gets its own search, and a late answer is not filed', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    vi.useFakeTimers();
    try {
      let answer: ((g: Ground) => void) | undefined;
      const { repo, labels, saved } = fixtureRepo((prompt) => prompt.includes('Write one section per company')
        ? new Promise<Ground>((resolve) => { answer = resolve; }) : single());
      repo.warmDeckDashboards('deck_fx', 'creation');
      await vi.advanceTimersByTimeAsync(1_000);
      // The user opens Gamma's Team while its pair waits on the combined search.
      const opened = repo.getDashboardTab('gamma', 'team_org');
      await vi.advanceTimersByTimeAsync(60_000);
      await expect(opened).resolves.toBeDefined();
      expect(labels()).toContain('company_story:gamma');
      // The provider answers long after the deadline: nobody waits for it, so nothing of it is filed.
      answer!(batchAnswer(NAMES.map(section)));
      await vi.advanceTimersByTimeAsync(1_000);
      expect((saved().researchEvidence ?? []).some((row) => row.text.includes('Gamma Shop builds warehouse robots'))).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('a user who opens a tab the warm-up has just started is never failed for a late batch', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    vi.useFakeTimers();
    try {
      const { repo } = fixtureRepo((prompt) => prompt.includes('Write one section per company') ? new Promise<Ground>(() => {}) : single());
      repo.warmDeckDashboards('deck_fx', 'creation');
      // Same tick: the user joins the warm-up's run before it reached its search.
      const opened = Promise.allSettled([repo.getDashboardTab('gamma', 'overview')]);
      await vi.advanceTimersByTimeAsync(90_000);
      const [outcome] = await opened;
      expect(outcome!.status === 'rejected' ? String(outcome.reason) : 'ok').not.toMatch(/nothing in time/);
    } finally { vi.useRealTimers(); }
  });

  it('a tab the user opens is not held back to wait for a batch', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const { repo, labels } = fixtureRepo(single);
    await repo.getDashboardTab('gamma', 'overview');
    expect(labels()).toEqual(['company_briefing:gamma']);
  });
});
