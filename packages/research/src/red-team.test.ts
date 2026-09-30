/**
 * The pre-report RED-TEAM pass — "double-check the metrics and kind of
 * red-team it before formulating this report" (founder, Round 31).
 *
 * Contract under test: generating a report first challenges the soft
 * face-value figures against live sources; a figure confirmed wrong (with
 * verification-grade sourcing) is CORRECTED in the stored deck before the
 * report composes, and the composer's evidence digest carries the red-team
 * summary so the prose reflects reconciled numbers.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Citation } from '@mi/contracts';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

function seededSnapshot(): RepoSnapshot {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    markets: [
      {
        id: 'mkt_1',
        name: 'Frontier AI',
        scopeDefinition: { vertical: 'AI', geography: 'Global', inclusions: [], exclusions: [] },
        refreshCadence: 'weekly',
        createdAt: now,
        lastRefreshedAt: now,
      },
    ],
    decks: [{ id: 'deck_1', marketId: 'mkt_1', generatedAt: now, cardCount: 1 }],
    companies: [
      {
        id: 'cmp_openai',
        name: 'OpenAI',
        oneLiner: 'Frontier AI research and deployment company.',
        websiteUrl: 'https://openai.com',
        logoUrl: null,
        hqLocation: 'San Francisco, CA',
        foundedYear: 2015,
        isPublic: false,
      },
    ],
    metrics: [
      {
        id: 'met_arr',
        companyId: 'cmp_openai',
        metricType: 'arr',
        value: 990_000_000,
        confidence: 'estimated',
        source: null,
        citations: [],
        methodNote: 'Headcount proxy estimate',
        capturedAt: now,
      },
      {
        id: 'met_users',
        companyId: 'cmp_openai',
        metricType: 'users',
        value: 1_000_000_000,
        confidence: 'user_verified',
        source: 'Confirmed by the analyst',
        citations: [],
        methodNote: null,
        capturedAt: now,
      },
    ],
    cards: [
      {
        id: 'card_openai',
        deckId: 'deck_1',
        companyId: 'cmp_openai',
        cardType: 'company',
        title: null,
        summary: null,
        tier: 5,
        tierReason: null,
        citations: [],
      },
    ],
    viceClaims: [],
    dashboards: { cmp_openai: { overview: { content: {}, lastRefreshedAt: now } } },
    companyMarket: { cmp_openai: 'Frontier AI' },
    opportunity: {},
    reports: [],
    savedCards: [],
    researchJobs: [],
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

const CITED: Citation[] = [
  {
    title: 'reuters.com',
    url: 'https://reuters.com/openai-arr',
    credibility: 'reputable_secondary',
  },
];

/** Routes by prompt content: the red-team audit vs. the report composer. */
function routedClient(): LlmClient {
  return {
    ground: vi.fn().mockImplementation((prompt: string) =>
      Promise.resolve(
        prompt.includes('RED-TEAM')
          ? {
              text: 'OpenAI ARR is reported at $40B as of July 2026 per Reuters — the stored $990M is stale.',
              citations: CITED,
              queries: ['openai arr 2026'],
            }
          : {
              text: '## Executive summary\n\nComposed from the corrected digest.',
              citations: CITED,
              queries: ['frontier ai market'],
            },
      ),
    ),
    structure: vi.fn().mockImplementation((prompt: string) =>
      Promise.resolve(
        prompt.includes('red-team notes')
          ? {
              findings: [
                {
                  companyName: 'OpenAI',
                  metricType: 'arr',
                  verdict: 'wrong',
                  correctedValue: 40_000_000_000,
                  note: 'Reuters reporting, July 2026',
                },
              ],
            }
          : {},
      ),
    ),
  } as unknown as LlmClient;
}

describe('pre-report red-team pass', () => {
  it('corrects a wrong figure in the deck BEFORE composing, and the digest carries the red-team summary', async () => {
    const store = memoryStore(seededSnapshot());
    const client = routedClient();
    const repo = new GeminiRepository({ apiKey: 'k', store, client });

    const report = await repo.generateReport({ kind: 'company', subjectId: 'cmp_openai' });

    // The stored metric was corrected through the fast verify path.
    const arr = (await repo.getCompanyMetrics('cmp_openai')).find((m) => m.metricType === 'arr');
    expect(arr?.value).toBe(40_000_000_000);
    expect(arr?.confidence).toBe('verified');

    // The composer's evidence digest names the red-team correction and reads
    // the corrected value — the report's face numbers are the audited ones.
    expect(report.evidenceDigest).toContain('RED-TEAM VERIFICATION');
    expect(report.evidenceDigest).toContain('CORRECTED: OpenAI ARR');
    expect(report.evidenceDigest).toContain('40000000000');
  });

  it('user-verified figures are law — never challenged by the red-team pass', async () => {
    const store = memoryStore(seededSnapshot());
    const client = routedClient();
    const repo = new GeminiRepository({ apiKey: 'k', store, client });

    await repo.generateReport({ kind: 'company', subjectId: 'cmp_openai' });

    const ground = client.ground as ReturnType<typeof vi.fn>;
    const redTeamPrompt = ground.mock.calls
      .map((c: unknown[]) => c[0] as string)
      .find((p: string) => p.includes('RED-TEAM'));
    expect(redTeamPrompt).toBeDefined();
    // The estimated ARR is audited; the user-verified Users figure is not.
    expect(redTeamPrompt).toContain('ARR');
    expect(redTeamPrompt).not.toContain('Users = 1000000000');
  });

  it('routes red-team corrections to the exact footprint row, not the first users metric', async () => {
    const initial = seededSnapshot();
    initial.metrics.push(
      {
        id: 'met_mau',
        companyId: 'cmp_openai',
        metricType: 'users',
        userBasis: 'monthly_active_users',
        value: 800_000_000,
        confidence: 'estimated',
        source: null,
        citations: [],
        methodNote: 'Monthly active users',
        capturedAt: new Date().toISOString(),
      },
      {
        id: 'met_stars',
        companyId: 'cmp_openai',
        metricType: 'users',
        userBasis: 'github_stars',
        value: 50_000,
        confidence: 'estimated',
        source: null,
        citations: [],
        methodNote: 'GitHub stars',
        capturedAt: new Date().toISOString(),
      },
    );
    const client = routedClient();
    (client.ground as ReturnType<typeof vi.fn>).mockImplementation((prompt: string) =>
      Promise.resolve(
        prompt.includes('RED-TEAM')
          ? {
              text: 'OpenAI has 12,000 GitHub stars as of July 2026 per Reuters.',
              citations: CITED,
              queries: ['OpenAI GitHub stars'],
            }
          : {
              text: '## Executive summary\n\nComposed from the audited digest.',
              citations: CITED,
              queries: ['Frontier AI market'],
            },
      ),
    );
    (client.structure as ReturnType<typeof vi.fn>).mockImplementation((prompt: string) =>
      Promise.resolve(
        prompt.includes('red-team notes')
          ? {
              findings: [
                {
                  auditId: 'R3',
                  companyName: 'OpenAI',
                  metricType: 'users',
                  verdict: 'wrong',
                  correctedValue: 12_000,
                  note: 'Reuters reporting, July 2026',
                },
              ],
            }
          : {},
      ),
    );
    const repo = new GeminiRepository({ apiKey: 'k', store: memoryStore(initial), client });

    await repo.generateReport({ kind: 'company', subjectId: 'cmp_openai' });

    const users = (await repo.getCompanyMetrics('cmp_openai')).filter(
      (m) => m.metricType === 'users',
    );
    expect(users.find((m) => m.id === 'met_users')?.value).toBe(1_000_000_000);
    expect(users.find((m) => m.id === 'met_mau')?.value).toBe(800_000_000);
    expect(users.find((m) => m.id === 'met_stars')?.value).toBe(12_000);
    expect(users.find((m) => m.id === 'met_stars')?.confidence).toBe('verified');
  });
});
