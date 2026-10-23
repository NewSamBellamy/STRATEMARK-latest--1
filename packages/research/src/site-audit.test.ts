/**
 * auditSite — the landing-page teardown, and the deck-report baked gate.
 *
 * Contract under test:
 *   1. One grounded pass → a structured, clamped, junk-filtered audit report
 *      saved into the reports library as kind 'site_audit'.
 *   2. generateReport(kind='deck') is GATED while the deck still forms —
 *      it throws before spending a research call.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

function snapshot(opts?: { formingCard?: boolean }): RepoSnapshot {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    markets: [
      {
        id: 'mkt_1',
        name: 'Frontier AI',
        scopeDefinition: { vertical: 'AI', geography: 'Global', inclusions: [], exclusions: [] },
        refreshCadence: 'manual',
        createdAt: now,
      },
    ],
    decks: [{ id: 'deck_1', marketId: 'mkt_1', createdAt: now, lastRefreshedAt: now }],
    companies: [
      {
        id: 'cmp_1',
        name: 'OpenAI',
        oneLiner: 'Frontier AI research and deployment company.',
        websiteUrl: 'https://openai.com',
        logoUrl: null,
        hqLocation: 'San Francisco, CA',
        brandTheme: null,
      },
    ],
    metrics: [],
    cards: [
      {
        id: 'card_1',
        deckId: 'deck_1',
        companyId: 'cmp_1',
        cardType: 'company',
        title: null,
        summary: null,
        tier: opts?.formingCard ? null : 8,
        tierReason: null,
        citations: [],
        keyPoints: [],
        createdAt: now,
      },
    ],
    viceClaims: [],
    dashboards: {},
    companyMarket: { cmp_1: 'Frontier AI' },
    opportunity: {},
    reports: [],
    briefings: [],
    savedCards: [],
    researchJobs: opts?.formingCard
      ? [
          {
            id: 'job_1',
            status: 'queued',
            stage: 'metrics',
            brief: { prompt: 'x', region: null },
            deck: { id: 'deck_1', marketId: 'mkt_1', createdAt: now, lastRefreshedAt: now },
            catalogNames: [],
            completedEntityNames: [],
            partialCards: [],
            warnings: [],
            error: null,
            createdAt: now,
            updatedAt: now,
          },
        ]
      : [],
    threads: [],
  } as unknown as RepoSnapshot;
}

function memoryStore(initial: RepoSnapshot): ResearchStore {
  let data: RepoSnapshot | null = initial;
  return {
    read: () => data,
    write: (snap: RepoSnapshot) => {
      data = snap;
    },
  };
}

function repoWith(client: LlmClient, snap = snapshot()): GeminiRepository {
  return new GeminiRepository({ apiKey: 'k', store: memoryStore(snap), client });
}

const PAGE_HTML = `<!doctype html><html lang="en"><head><title>OpenAI - Research and deployment</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<h1>Creating safe artificial general intelligence that benefits all of humanity</h1>
<p>${'We research and deploy frontier models and publish what we learn for everyone. '.repeat(5)}</p>
<a class="btn" href="/chatgpt">Try ChatGPT</a></body></html>`;

function pageReader(text: string | null) {
  return vi.fn().mockResolvedValue(
    text === null
      ? { requestedUrl: 'https://openai.com', status: 'unavailable', retrievedAt: 'now', reason: 'Source did not return a readable public page', httpStatus: 403 }
      : { requestedUrl: 'https://openai.com', finalUrl: 'https://openai.com/', status: 'retrieved', retrievedAt: 'now', text },
  );
}

const GROUND = {
  text: 'Press describes OpenAI as "the maker of ChatGPT".',
  citations: [
    { title: 'openai.com', url: 'https://openai.com' },
    { title: 'fatjoe.com', url: 'https://fatjoe.com/seo-blog/openai' }, // junk -> dropped
  ],
  queries: [],
};

const MODEL_OUT = {
  criteria: [
    {
      area: 'value_proposition', score: 14, // clamps to 10
      verdict: 'Ambitious but abstract.',
      findings: [{ kind: 'issue', title: 'Abstract headline', detail: 'No audience or outcome.', quote: 'Creating safe artificial general intelligence', impact: 'Visitors cannot tell what to do.' }],
    },
    { area: 'trust', score: 6, verdict: 'Press context only.', findings: [{ kind: 'working', title: 'Known product', detail: 'Press ties it to ChatGPT.', quote: 'the maker of ChatGPT' }] },
  ],
  fixes: [{ title: 'Name the audience', detail: 'Say who the models are for.', impact: 'high', effort: 'low', area: 'value_proposition', quote: 'Creating safe artificial general intelligence' }],
  testFirst: [{ title: 'Outcome headline', hypothesis: 'If the H1 names an outcome then clicks on Try ChatGPT rise.', metric: 'CTA click rate', quote: 'Try ChatGPT' }],
  designSummary: 'Not observable from the supplied evidence', designQuote: null, designNotes: [],
};

function auditRepo(reader: ReturnType<typeof pageReader> | undefined, ground = vi.fn().mockResolvedValue(GROUND), structure = vi.fn().mockResolvedValue(MODEL_OUT)) {
  const repo = new GeminiRepository({ apiKey: 'k', store: memoryStore(snapshot()), client: { ground, structure } as unknown as LlmClient, ...(reader ? { assetSourceReader: reader } : {}) });
  return { repo, ground, structure };
}

describe('auditSite — the landing-page teardown', () => {
  it('reads the page, judges it on quoted evidence, gates the result and saves a v2 report', async () => {
    const reader = pageReader(PAGE_HTML);
    const { repo, ground, structure } = auditRepo(reader);

    const report = await repo.auditSite({ url: 'openai.com', companyId: 'cmp_1' });

    expect(reader).toHaveBeenCalledWith('https://openai.com'); // protocol added
    expect(ground).toHaveBeenCalledTimes(1);
    expect(structure).toHaveBeenCalledTimes(1);
    // The judge was given the page's own headline and the fixed checklist, not just search notes.
    const prompt = String(structure.mock.calls[0]![0]);
    expect(prompt).toContain('Creating safe artificial general intelligence');
    expect(prompt).toContain('CHECKLIST RESULTS');
    expect(prompt).toContain('the maker of ChatGPT');

    const a = report.audit!;
    expect(report.kind).toBe('site_audit');
    expect(a.url).toBe('https://openai.com');
    expect(a.version).toBe(2);
    expect(a.page?.status).toBe('read');
    const vp = a.criteria!.find((c) => c.area === 'value_proposition')!;
    expect(vp.score).toBe(10); // clamped
    expect(vp.findings[0]!.evidenceSource).toBe('page');
    expect(a.missing[0]!.impact).toContain('Visitors');
    expect(a.checklist!.find((c) => c.id === 'one_h1')!.status).toBe('pass');
    expect(a.fixes!.some((f) => f.title === 'Name the audience')).toBe(true);
    expect(a.confidence!.pageRead).toBe(true);
    expect(a.confidence!.coverage).toBeLessThan(1); // messaging/cta/friction/design not scored by the model here
    expect(report.citations).toHaveLength(1); // junk domain filtered
    expect(report.markdown).toContain("## What's missing");
    expect(report.markdown).toContain('Confidence:');

    const listed = await repo.listReports();
    expect(listed[0]!.id).toBe(report.id);
  });

  it('fail-soft: a blocked page still yields an honest, low-confidence, search-only audit', async () => {
    const { repo, structure } = auditRepo(pageReader(null));
    const report = await repo.auditSite({ url: 'https://openai.com' });
    const a = report.audit!;
    expect(a.page).toMatchObject({ status: 'unavailable' });
    expect(a.confidence).toMatchObject({ level: 'low', pageRead: false });
    expect(a.confidence!.note).toMatch(/could not be read/);
    expect(String(structure.mock.calls[0]![0])).toContain('PAGE FACTS: NOT AVAILABLE');
    // Page-dependent categories are not scored; the search-only value-proposition finding that quotes the HEADLINE is dropped.
    expect(a.criteria!.find((c) => c.area === 'value_proposition')!.findings).toHaveLength(0);
    expect(a.criteria!.find((c) => c.area === 'value_proposition')!.score).toBeNull();
    expect(a.checklist!.every((c) => c.status === 'unknown')).toBe(true);
    expect(a.droppedFindings).toBeGreaterThan(0);
  });

  it('with no page reader on this device the audit still runs, flagged as search-only', async () => {
    const { repo } = auditRepo(undefined);
    const report = await repo.auditSite({ url: 'https://openai.com' });
    expect(report.audit!.page?.reason).toMatch(/No page reader/);
    expect(report.audit!.confidence!.level).toBe('low');
  });

  it('keeps the audit going on the page alone when the search call fails, and says so', async () => {
    const { repo } = auditRepo(pageReader(PAGE_HTML), vi.fn().mockRejectedValue(new Error('quota')));
    const report = await repo.auditSite({ url: 'https://openai.com' });
    expect(report.audit!.confidence!.note).toMatch(/Web search context was unavailable/);
  });

  it('still fails loudly when neither the page nor the search is available', async () => {
    const { repo } = auditRepo(pageReader(null), vi.fn().mockRejectedValue(new Error('quota')));
    await expect(repo.auditSite({ url: 'https://openai.com' })).rejects.toThrow('quota');
  });
});

describe('generateReport — deck reports gate on a baked deck', () => {
  it('throws before any research call while the deck still forms', async () => {
    const ground = vi.fn();
    const structure = vi.fn();
    const repo = repoWith(
      { ground, structure } as unknown as LlmClient,
      snapshot({ formingCard: true }),
    );

    await expect(repo.generateReport({ kind: 'deck', subjectId: 'deck_1' })).rejects.toThrow(
      /still forming/,
    );
    expect(ground).not.toHaveBeenCalled();
  });

  it('does not make a report written from a conversation wait for the deck, and digests only cards that have formed', async () => {
    const ground = vi.fn().mockResolvedValue({
      text: '## Executive summary\nFrom the conversation.',
      citations: [{ title: 'Reuters', url: 'https://reuters.com/x' }],
      queries: [],
    });
    const structure = vi.fn();
    const snap = snapshot({ formingCard: true });
    snap.threads = [{
      id: 'thr_1', scope: { kind: 'deck', deckId: 'deck_1' }, title: 'Who is winning', createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), reportId: null,
      messages: [
        { id: 'm1', role: 'user', text: 'Who is winning?', citations: [], createdAt: new Date().toISOString() },
        { id: 'm2', role: 'assistant', text: 'OpenAI leads on distribution.', citations: [{ title: 'Reuters', url: 'https://www.reuters.com/openai' }], createdAt: new Date().toISOString() },
      ],
    }] as unknown as RepoSnapshot['threads'];
    const repo = repoWith({ ground, structure } as unknown as LlmClient, snap);

    const report = await repo.saveThreadAsReport('thr_1', null);

    expect(report.kind).toBe('deck');
    // Every call that reached the model: the digest names the formed company and leaves out the one still forming.
    const prompts = ground.mock.calls.map((call) => String(call[0])).join('\n');
    expect(prompts).toContain('OpenAI');
    expect(prompts).toContain('OpenAI leads on distribution.');
    expect(prompts).not.toMatch(/COMPANY \[tier \?\] Anthropic/);
    // The same deck, asked for without a conversation, still waits.
    await expect(repo.generateReport({ kind: 'deck', subjectId: 'deck_1' })).rejects.toThrow(/still forming/);
  });

  it('composes normally once the deck is baked', async () => {
    const ground = vi.fn().mockResolvedValue({
      text: '## Executive summary\nAll good.',
      citations: [{ title: 'Reuters', url: 'https://reuters.com/x' }],
      queries: [],
    });
    const structure = vi.fn();
    const repo = repoWith({ ground, structure } as unknown as LlmClient);

    const report = await repo.generateReport({ kind: 'deck', subjectId: 'deck_1' });
    expect(report.kind).toBe('deck');
    expect(ground).toHaveBeenCalledTimes(1);
  });
});
