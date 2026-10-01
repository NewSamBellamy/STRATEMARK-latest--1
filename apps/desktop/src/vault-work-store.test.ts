import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type * as NodeSqlite from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SIGNAL_CARD_TYPES, type CardWithCompany, type Market, type Deck } from '@mi/contracts';
import type { NativeResearchTask, ResearchBrief } from '@mi/contracts';
import { openVault } from './vault';
import { createWorkStore, workStoreLimits, type NativeRun } from './vault-work-store';

const { DatabaseSync } = createRequire(process.execPath)('node:sqlite') as typeof NodeSqlite;
const at = '2026-10-01T12:00:00.000Z';
const roots: string[] = [];
const handles: ReturnType<typeof openVault>[] = [];
const market: Market = {
  id: 'market_a',
  name: 'Fixture market',
  scopeDefinition: { vertical: 'Fixture', geography: null, notes: null },
  refreshCadence: 'weekly',
  createdAt: at,
};
const deck: Deck = { id: 'deck_a', marketId: market.id, createdAt: at, lastRefreshedAt: null };
const briefUrl = 'https://fixture.example/products';
const brief: ResearchBrief = {
  sections: [
    {
      section: 'offering',
      blocks: [
        {
          id: 'offering_1',
          text: 'Fixture Labs makes modular inspection equipment for manufacturers.',
          kind: 'reported',
          support: 'unreviewed',
          timeWindow: null,
          citations: [{ title: 'Fixture product page', url: briefUrl }],
        },
      ],
    },
  ],
  openQuestions: ['Which manufacturers use this equipment?'],
  limitations: ['Source-linked model notes have not been semantically reviewed.'],
};
function briefCard(): CardWithCompany {
  const data = card();
  return {
    ...data,
    card: {
      ...data.card,
      citations: [{ title: 'Fixture product page', url: briefUrl, credibility: 'unknown' }],
    },
    researchBrief: brief,
  };
}
function run(overrides: Partial<NativeRun> = {}): NativeRun {
  return {
    id: 'run_a',
    marketId: market.id,
    deckId: deck.id,
    requestKey: 'request_a',
    requestFingerprint: 'a'.repeat(64),
    researchProvenance: 'synthetic_fixture',
    status: 'queued',
    generation: 0,
    scope: {
      goal: 'Fixture market',
      inclusions: [],
      exclusions: [],
      region: null,
      depth: 'quick',
      seeds: [{ name: 'Fixture Labs' }],
    },
    maxCompanies: 2,
    limits: { maxRequests: 10, maxInputTokens: 50_000, maxOutputTokens: 10_000 },
    usage: { requests: 0, inputTokens: 0, outputTokens: 0, complete: false },
    createdAt: at,
    updatedAt: at,
    error: null,
    ...overrides,
  };
}
function card(cardId = 'card_a', companyId = 'company_a'): CardWithCompany {
  return {
    card: {
      id: cardId,
      deckId: deck.id,
      companyId,
      cardType: 'company',
      title: null,
      summary: null,
      tier: null,
      tierReason: null,
      citations: [],
      keyPoints: [],
      createdAt: at,
    },
    company: {
      id: companyId,
      name: 'Fixture Labs',
      oneLiner: 'Generated result for inspection.',
      logoUrl: null,
      hqLocation: null,
      websiteUrl: null,
      brandTheme: null,
    },
    metrics: [],
    viceClaims: [],
  };
}
function task(companyId = 'company_a', name = 'Fixture Labs'): NativeResearchTask {
  return {
    companyId,
    candidate: {
      name,
      domain: 'fixture.example',
      descriptor: 'Selected fixture candidate',
      cardTypes: ['company'],
    },
    status: 'queued',
    attempts: 0,
    cardIds: [],
    error: null,
  };
}
function location() {
  const root = mkdtempSync(path.join(tmpdir(), 'stratemark-work-test-'));
  roots.push(root);
  return path.join(root, 'vault.sqlite');
}
function open(file = location(), mode: 'owner' | 'reader' = 'owner') {
  const vault = openVault(file, 'vault_work', mode);
  handles.push(vault);
  return vault;
}
function start(vault: ReturnType<typeof openVault>, overrides: Partial<NativeRun> = {}) {
  const work = vault.writer().work;
  const accepted = work.acceptRun(run(overrides), market, deck);
  return work.updateRun({ ...accepted, status: 'running' }, accepted.generation);
}
afterEach(() => {
  for (const vault of handles.splice(0)) vault.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

describe('native bounded operational ledger', () => {
  it('commits a brief with its completed task and preserves it through bookmarks and reader reopen', () => {
    const file = location();
    const vault = open(file);
    const work = vault.writer().work;
    const current = start(vault);
    const selected = work.updateRun({ ...current, tasks: [task()] }, 0);
    const started = work.updateRun(
      { ...selected, tasks: [{ ...task(), status: 'running', attempts: 1 }] },
      0,
    );
    const completed = {
      ...started,
      tasks: [{ ...started.tasks![0]!, status: 'completed' as const, cardIds: ['card_a'] }],
    };
    work.updateRun(completed, 0, [briefCard()]);
    expect(vault.work.getCard('card_a')).toEqual(briefCard());
    expect(vault.work.getRun(current.id)?.tasks).toEqual(completed.tasks);
    expect(vault.work.listEvents(current.id)[0]?.progress.card?.researchBrief).toEqual(brief);
    work.bookmarkCard('card_a');
    vault.close();
    handles.splice(handles.indexOf(vault), 1);
    const reader = open(file, 'reader');
    expect(reader.work.listSavedCards()).toEqual([briefCard()]);
    expect(reader.work.getCard('card_a')?.researchBrief).toEqual(brief);
    expect(reader.work.getRun(current.id)?.tasks).toEqual(completed.tasks);
  });

  it('rolls the brief, card, event and completed task back when the captured fence fails at commit', () => {
    const file = location();
    const vault = open(file);
    const current = start(vault);
    const writer = vault.writer().work;
    const selected = writer.updateRun({ ...current, tasks: [task()] }, 0);
    const started = writer.updateRun(
      { ...selected, tasks: [{ ...task(), status: 'running', attempts: 1 }] },
      0,
    );
    const revision = vault.status().revision;
    const db = new DatabaseSync(file);
    let checks = 0;
    const work = createWorkStore(
      db,
      'vault_work',
      () => {},
      () => {
        if (++checks === 3) throw new Error('Fixture fence lost at commit');
      },
    );
    try {
      expect(() =>
        work.updateRun(
          {
            ...started,
            tasks: [{ ...started.tasks![0]!, status: 'completed', cardIds: ['card_a'] }],
          },
          0,
          [briefCard()],
        ),
      ).toThrow(/fence lost at commit/i);
      expect(vault.work.getCard('card_a')).toBeNull();
      expect(vault.work.getRun(current.id)).toEqual(started);
      expect(vault.work.listEvents(current.id)).toEqual([]);
      expect(vault.status().revision).toBe(revision);
    } finally {
      db.close();
    }
  });

  it('fences stale brief output without completing the selected company task', () => {
    const vault = open();
    const work = vault.writer().work;
    const current = start(vault);
    const selected = work.updateRun({ ...current, tasks: [task()] }, 0);
    const started = work.updateRun(
      { ...selected, tasks: [{ ...task(), status: 'running', attempts: 1 }] },
      0,
    );
    const paused = work.updateRun({ ...started, status: 'paused', generation: 1 }, 0);
    const revision = vault.status().revision;
    expect(() =>
      work.updateRun(
        {
          ...started,
          tasks: [{ ...started.tasks![0]!, status: 'completed', cardIds: ['card_a'] }],
        },
        0,
        [briefCard()],
      ),
    ).toThrow(/generation|fenced/i);
    expect(vault.work.getCard('card_a')).toBeNull();
    expect(vault.work.getRun(current.id)).toEqual(paused);
    expect(vault.status().revision).toBe(revision);
  });

  it('enforces the shared 128 KiB UTF-8 brief cap without completing a task or saving partial output', () => {
    const vault = open();
    const work = vault.writer().work;
    const current = start(vault);
    const selected = work.updateRun({ ...current, tasks: [task()] }, 0);
    const started = work.updateRun(
      { ...selected, tasks: [{ ...task(), status: 'running', attempts: 1 }] },
      0,
    );
    const oversized: ResearchBrief = {
      ...brief,
      sections: (['overview', 'offering', 'position', 'updates'] as const).map((section) => ({
        section,
        blocks: Array.from({ length: 6 }, (_, index) => ({
          ...brief.sections[0]!.blocks[0]!,
          id: `${section}_${index}`,
          citations: Array.from({ length: 3 }, () => ({ title: 'é'.repeat(1000), url: briefUrl })),
        })),
      })),
    };
    const json = JSON.stringify(oversized);
    expect(json.length).toBeLessThan(128 * 1024);
    expect(Buffer.byteLength(json, 'utf8')).toBeGreaterThan(128 * 1024);
    const revision = vault.status().revision;
    expect(() =>
      work.updateRun(
        {
          ...started,
          tasks: [{ ...started.tasks![0]!, status: 'completed', cardIds: ['card_a'] }],
        },
        0,
        [{ ...briefCard(), researchBrief: oversized }],
      ),
    ).toThrow(/128 KiB/i);
    expect(vault.work.getCard('card_a')).toBeNull();
    expect(vault.work.getRun(current.id)).toEqual(started);
    expect(vault.work.listEvents(current.id)).toEqual([]);
    expect(vault.status().revision).toBe(revision);
  });

  it.each(['foreign_citation', 'promoted_support', 'duplicate_ids', 'too_many_questions'] as const)(
    'rejects a brief with %s without retaining card/task output',
    (invalid) => {
      const vault = open();
      const work = vault.writer().work;
      const current = start(vault);
      const selected = work.updateRun(
        { ...current, tasks: [task(), task('company_b', 'Other')] },
        0,
      );
      const started = work.updateRun(
        {
          ...selected,
          tasks: selected.tasks!.map((entry) => ({ ...entry, status: 'running', attempts: 1 })),
        },
        0,
      );
      const foreignUrl = 'https://other.example/borrowed';
      const other = card('card_other', 'company_b');
      work.saveCard(current.id, 0, {
        ...other,
        card: {
          ...other.card,
          citations: [{ title: 'Other company', url: foreignUrl, credibility: 'unknown' }],
        },
      });
      const block = brief.sections[0]!.blocks[0]!;
      const candidate = {
        ...brief,
        sections: [
          {
            section: 'offering',
            blocks:
              invalid === 'duplicate_ids'
                ? [block, block]
                : [
                    {
                      ...block,
                      support: invalid === 'promoted_support' ? 'verified' : 'unreviewed',
                      citations:
                        invalid === 'foreign_citation'
                          ? [{ title: 'Borrowed', url: foreignUrl }]
                          : block.citations,
                    },
                  ],
          },
        ],
        openQuestions:
          invalid === 'too_many_questions' ? Array(9).fill('Too many') : brief.openQuestions,
      } as ResearchBrief;
      const revision = vault.status().revision;
      const reason = {
        foreign_citation: /own citation leads/i,
        promoted_support: /unreviewed/i,
        duplicate_ids: /identities must be unique/i,
        too_many_questions: /at most 8/i,
      }[invalid];
      expect(() =>
        work.updateRun(
          {
            ...started,
            tasks: [
              { ...started.tasks![0]!, status: 'completed', cardIds: ['card_a'] },
              started.tasks![1]!,
            ],
          },
          0,
          [{ ...briefCard(), researchBrief: candidate }],
        ),
      ).toThrow(reason);
      expect(vault.work.getCard('card_a')).toBeNull();
      expect(vault.work.getRun(current.id)).toEqual(started);
      expect(vault.work.getCard('card_other')?.researchBrief).toBeUndefined();
      expect(vault.status().revision).toBe(revision);
    },
  );

  it('bookmarks exact card roles idempotently and removes only the saved reference', () => {
    const vault = open();
    const current = start(vault);
    const work = vault.writer().work;
    work.saveCard(current.id, 0, card());
    work.saveCard(current.id, 0, {
      ...card('card_infra'),
      card: { ...card('card_infra').card, cardType: 'infrastructure' },
    });
    const before = vault.work.getRun(current.id);
    const first = work.bookmarkCard('card_a');
    expect(first.cardId).toBe('card_a');
    expect(first.savedAt).toEqual(expect.any(String));
    const revision = vault.status().revision;
    expect(work.bookmarkCard('card_a')).toEqual(first);
    expect(vault.status().revision).toBe(revision);
    work.bookmarkCard('card_infra');
    expect(
      vault.work
        .listSavedCards()
        .map(({ card }) => card.id)
        .sort(),
    ).toEqual(['card_a', 'card_infra']);
    work.unbookmarkCard('card_a');
    const after = vault.status().revision;
    work.unbookmarkCard('card_a');
    expect(vault.status().revision).toBe(after);
    expect(vault.work.listSavedCards().map(({ card }) => card.id)).toEqual(['card_infra']);
    expect(vault.work.getCard('card_a')).toEqual(card());
    expect(vault.work.getRun(current.id)).toEqual(before);
  });

  it('retains bookmarks through keyless reader reopen and never exposes write capabilities', () => {
    const file = location();
    const vault = open(file);
    const current = start(vault);
    vault.writer().work.saveCard(current.id, 0, card());
    const saved = vault.writer().work.bookmarkCard('card_a');
    vault.close();
    handles.splice(handles.indexOf(vault), 1);
    const reader = open(file, 'reader');
    const before = reader.status().revision;
    expect(reader.work.listSavedCards()).toEqual([card()]);
    expect(reader.work.getCard('card_a')).not.toHaveProperty('researchBrief');
    expect(reader.work).not.toHaveProperty('bookmarkCard');
    expect(reader.work).not.toHaveProperty('unbookmarkCard');
    expect(() => reader.writer().work.bookmarkCard(saved.cardId)).toThrow(/read-only|owner/i);
    expect(reader.status().revision).toBe(before);
  });

  it('rejects invalid or missing bookmark identities without mutating the vault', () => {
    const vault = open();
    const revision = vault.status().revision;
    expect(vault.writer().work.bookmarkCard).toEqual(expect.any(Function));
    expect(vault.writer().work.unbookmarkCard).toEqual(expect.any(Function));
    for (const candidate of ['../secret', 'card_missing']) {
      expect(() => vault.writer().work.bookmarkCard(candidate)).toThrow();
      expect(() => vault.writer().work.unbookmarkCard(candidate)).toThrow();
    }
    expect(vault.status().revision).toBe(revision);
  });

  it('fences an old bookmark writer after closing and opening a new owner', () => {
    const file = location();
    const vault = open(file);
    const current = start(vault);
    const old = vault.writer().work;
    old.saveCard(current.id, 0, card());
    vault.close();
    handles.splice(handles.indexOf(vault), 1);
    const reopened = open(file);
    const before = reopened.status().revision;
    expect(() => old.bookmarkCard('card_a')).toThrow();
    expect(() => old.unbookmarkCard('card_a')).toThrow();
    expect(reopened.work.listSavedCards()).toEqual([]);
    expect(reopened.status().revision).toBe(before);
  });

  it('preserves generated cards and run identity through the version 7 bookmark upgrade', () => {
    const file = location();
    const vault = open(file);
    const current = start(vault);
    vault.writer().work.saveCard(current.id, 0, card());
    const before = vault.status().revision;
    vault.close();
    handles.splice(handles.indexOf(vault), 1);
    const old = new DatabaseSync(file);
    old.exec('DROP TABLE work_saved_cards; PRAGMA user_version=7;');
    old.close();
    const upgraded = open(file);
    expect(upgraded.work.getCard('card_a')).toEqual(card());
    expect(upgraded.work.getRun(current.id)).toEqual(current);
    expect(upgraded.status().revision).toBe(before);
    expect(upgraded.work.listSavedCards()).toEqual([]);
    upgraded.writer().work.bookmarkCard('card_a');
    expect(upgraded.work.listSavedCards()).toEqual([card()]);
  });

  it('keeps source capture reservations monotonic and within the explicitly approved ceiling', () => {
    const vault = open();
    const current = start(vault, { limits: { ...run().limits, maxSourceRequests: 2 } });
    const work = vault.writer().work;
    const used = work.updateRun({ ...current, usage: { ...current.usage, sourceRequests: 1 } }, 0);
    expect(vault.work.getRun(used.id)?.usage.sourceRequests).toBe(1);
    expect(() =>
      work.updateRun({ ...used, usage: { ...used.usage, sourceRequests: 0 } }, 0),
    ).toThrow();
    expect(() =>
      work.updateRun({ ...used, usage: { ...used.usage, sourceRequests: 3 } }, 0),
    ).toThrow();
    expect(vault.work.getRun(used.id)?.usage.sourceRequests).toBe(1);
  });

  it('rejects a corrupt saved source reservation exceeding its original approval', () => {
    const file = location();
    const vault = open(file);
    const current = start(vault, { limits: { ...run().limits, maxSourceRequests: 2 } });
    const direct = new DatabaseSync(file);
    try {
      direct
        .prepare('UPDATE work_runs SET body=? WHERE id=?')
        .run(
          JSON.stringify({ ...current, usage: { ...current.usage, sourceRequests: 3 } }),
          current.id,
        );
    } finally {
      direct.close();
    }
    expect(() => vault.work.getRun(current.id)).toThrow(/source|allowance/i);
  });

  it('accepts atomically, dedupes by key/fingerprint, and retains native scope versions', () => {
    const vault = open();
    const work = vault.writer().work;
    const accepted = work.acceptRun(run(), market, deck);
    const revision = vault.status().revision;
    expect(work.acceptRun(run({ id: 'retry_id' }), market, deck)).toEqual(accepted);
    expect(vault.status().revision).toBe(revision);
    expect(vault.work.listRuns()).toEqual([accepted]);
    expect(vault.work.listMarkets()).toEqual([market]);
    expect(vault.work.getMarket(market.id)).toEqual(market);
    expect(vault.work.getDeckByMarket(market.id)).toEqual(deck);
    expect(vault.getMarket(market.id)).toMatchObject({
      record: { revision: 1, vaultId: 'vault_work' },
      scopeDraft: accepted.scope,
    });
    expect(() => work.acceptRun(run({ requestFingerprint: 'b'.repeat(64) }), market, deck)).toThrow(
      /fingerprint conflict/i,
    );
    expect(() =>
      work.acceptRun(run({ id: 'run_b', requestKey: 'request_b' }), market, deck),
    ).toThrow(/live run/i);
    expect(vault.marketHistory(market.id).items).toHaveLength(1);
    expect(vault.status().revision).toBe(revision);
  });

  it('rolls back acceptance for a missing seed and preserves preexisting inventory context', () => {
    const vault = open();
    const writer = vault.writer();
    const record = {
      contractVersion: '1' as const,
      vaultId: 'vault_work',
      id: market.id,
      revision: 1,
      createdAt: at,
      updatedAt: at,
    };
    writer.saveMarket({ record, name: 'Prior name', legacyScope: market.scopeDefinition }, 0);
    const revision = vault.status().revision;
    const scope = { ...run().scope, seeds: [{ companyId: 'missing_company' }] };
    expect(() => writer.work.acceptRun(run({ scope }), market, deck)).toThrow(/missing company/i);
    expect(vault.status().revision).toBe(revision);
    expect(vault.work.listRuns()).toEqual([]);
    expect(vault.work.listMarkets()).toEqual([]);
    writer.saveCompany(
      { record: { ...record, id: 'seed_company' }, name: 'Seed', officialDomain: null },
      0,
    );
    const accepted = writer.work.acceptRun(
      run({ scope: { ...scope, seeds: [{ companyId: 'seed_company' }] } }),
      market,
      deck,
    );
    expect(vault.getMarket(market.id)).toEqual({
      record: { ...record, revision: 2 },
      name: market.name,
      scopeDraft: accepted.scope,
      legacyScope: market.scopeDefinition,
    });
    expect(vault.marketHistory(market.id).items).toHaveLength(2);
    expect(vault.integrity()).toBe('ok');
  });

  it.each(['paused', 'cancelled', 'completed', 'failed'] as const)(
    'blocks late output and events after %s while keeping partial results',
    (status) => {
      const vault = open();
      const work = vault.writer().work;
      const current = start(vault);
      work.saveCard(current.id, current.generation, card());
      const terminal = { ...current, status, generation: current.generation + 1 };
      work.updateRun(terminal, current.generation);
      const revision = vault.status().revision;
      expect(() => work.saveCard(current.id, current.generation, card('late'))).toThrow(/fenced/i);
      expect(() => work.appendEvent(current.id, current.generation, { message: 'late' })).toThrow(
        /fenced/i,
      );
      expect(() => work.saveCard(current.id, terminal.generation, card('late'))).toThrow(/fenced/i);
      expect(() => work.updateRun({ ...current, status: 'running' }, current.generation)).toThrow(
        /generation conflict/i,
      );
      expect(vault.work.listCards(deck.id)).toEqual([card()]);
      expect(vault.work.listEvents(current.id)).toHaveLength(1);
      expect(vault.status().revision).toBe(revision);
    },
  );

  it('requires generation advance for pause/resume and keeps old attempts fenced', () => {
    const vault = open();
    const work = vault.writer().work;
    const current = start(vault);
    expect(() => work.updateRun({ ...current, status: 'paused' }, 0)).toThrow(
      /advance generation/i,
    );
    const paused = work.updateRun({ ...current, status: 'paused', generation: 1 }, 0);
    const resumed = work.updateRun({ ...paused, status: 'running', generation: 2 }, 1);
    expect(() => work.appendEvent(current.id, 0, { message: 'old worker' })).toThrow(/fenced/i);
    work.saveCard(current.id, resumed.generation, card());
    const completed = work.updateRun({ ...resumed, status: 'completed' }, 2);
    expect(() => work.updateRun({ ...completed, status: 'running', generation: 3 }, 2)).toThrow(
      /transition/i,
    );
    expect(vault.work.getDeckByMarket(market.id)?.lastRefreshedAt).toBe(at);
  });

  it('persists ordered replay, cards and status across reopen with read-only access', () => {
    const file = location();
    const vault = open(file);
    const current = start(vault);
    const work = vault.writer().work;
    const first = work.appendEvent(current.id, 0, {
      message: 'Catalog',
      stage: 'catalog',
      progress: 0.2,
    });
    expect(work.saveCard(current.id, 0, card())).toEqual(card());
    const last = work.appendEvent(current.id, 0, { message: 'Done', progress: 1 });
    work.updateRun({ ...current, status: 'completed' }, 0);
    vault.close();
    const reader = open(file, 'reader');
    const events = reader.work.listEvents(current.id);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(events[0]).toEqual(first);
    expect(events[1]?.progress.card).toEqual(card());
    expect(events[2]).toEqual(last);
    expect(Object.keys(first).sort()).toEqual(['createdAt', 'progress', 'sequence']);
    expect(Date.parse(first.createdAt)).toBeGreaterThan(0);
    expect(reader.work.listEvents(current.id, 2)).toEqual([last]);
    expect(reader.work.getRun(current.id)?.status).toBe('completed');
    expect(reader.work.getCard('card_a')).toEqual(card());
    expect(reader.work.getCard('missing')).toBeNull();
    expect(reader.work.listCards(deck.id)).toEqual([card()]);
    expect('saveCard' in reader.work).toBe(false);
    expect(() => reader.writer()).toThrow(/read-only/i);
    expect(reader.getObservation('metric_a')).toBeNull();
  });

  it('uses the captured vault owner fence for every work mutation', () => {
    const vault = open();
    const current = start(vault);
    const stale = vault.writer().work;
    vault.advanceWriterGeneration();
    expect(() => stale.appendEvent(current.id, 0, { message: 'stale' })).toThrow(/fenced/i);
    expect(() => stale.saveCard(current.id, 0, card())).toThrow(/fenced/i);
    expect(() => stale.updateRun({ ...current, status: 'completed' }, 0)).toThrow(/fenced/i);
    expect(() => stale.acceptRun(run(), market, deck)).toThrow(/fenced/i);
    vault.writer().work.saveCard(current.id, 0, card());
    expect(vault.work.getCard('card_a')).toEqual(card());
  });

  it('rejects cross-deck/metric links, generated human verification, and company overflow', () => {
    const vault = open();
    const current = start(vault, { maxCompanies: 1 });
    const work = vault.writer().work;
    expect(() =>
      work.saveCard(current.id, 0, { ...card(), card: { ...card().card, deckId: 'other_deck' } }),
    ).toThrow(/another deck/i);
    const metric = {
      id: 'metric_a',
      companyId: 'other_company',
      metricType: 'arr' as const,
      value: 1,
      confidence: 'estimated' as const,
      source: null,
      citations: [],
      methodNote: null,
      capturedAt: at,
    };
    expect(() => work.saveCard(current.id, 0, { ...card(), metrics: [metric] })).toThrow(
      /metric company link/i,
    );
    expect(() =>
      work.saveCard(current.id, 0, {
        ...card(),
        metrics: [{ ...metric, companyId: 'company_a', confidence: 'user_verified' }],
      }),
    ).toThrow(/estimated or unknown/i);
    expect(() =>
      work.appendEvent(current.id, 0, {
        message: 'wrong card',
        card: { ...card(), card: { ...card().card, deckId: 'other_deck' } },
      }),
    ).toThrow(/another deck/i);
    expect(vault.work.listEvents(current.id)).toEqual([]);
    work.saveCard(current.id, 0, card());
    expect(() => work.saveCard(current.id, 0, card('card_b', 'company_b'))).toThrow(
      /company limit/i,
    );
    expect(vault.work.listCards(deck.id)).toHaveLength(1);
    expect(vault.work.listEvents(current.id)).toHaveLength(1);
  });

  it.each(['verified', 'user_verified'] as const)(
    'rejects %s generated metrics in both saved cards and replay events',
    (confidence) => {
      const vault = open();
      const current = start(vault);
      const work = vault.writer().work;
      const data: CardWithCompany = {
        ...card(),
        metrics: [
          {
            id: 'metric_a',
            companyId: 'company_a',
            metricType: 'arr',
            value: 1,
            confidence,
            source: 'https://fixture.example/annual-report',
            citations: [
              { title: 'Fixture annual report', url: 'https://fixture.example/annual-report' },
            ],
            methodNote: null,
            capturedAt: at,
          },
        ],
      };
      const revision = vault.status().revision;
      expect(() => work.saveCard(current.id, 0, data)).toThrow(/estimated or unknown/i);
      expect(() =>
        work.appendEvent(current.id, 0, { message: 'Generated projection', card: data }),
      ).toThrow(/estimated or unknown/i);
      expect(data.metrics[0]?.confidence).toBe(confidence);
      expect(vault.work.listCards(deck.id)).toEqual([]);
      expect(vault.work.listEvents(current.id)).toEqual([]);
      expect(vault.status().revision).toBe(revision);
    },
  );

  it.each(SIGNAL_CARD_TYPES)('requires empty metrics on generated %s findings', (cardType) => {
    const vault = open();
    const current = start(vault);
    const work = vault.writer().work;
    const data: CardWithCompany = {
      ...card(),
      card: { ...card().card, cardType },
      metrics: [
        {
          id: 'metric_a',
          companyId: 'company_a',
          metricType: 'arr',
          value: 1,
          confidence: 'estimated',
          source: null,
          citations: [],
          methodNote: null,
          capturedAt: at,
        },
      ],
    };
    const revision = vault.status().revision;
    expect(() => work.saveCard(current.id, 0, data)).toThrow(/empty metrics/i);
    expect(() =>
      work.appendEvent(current.id, 0, { message: 'Finding projection', card: data }),
    ).toThrow(/empty metrics/i);
    expect(vault.work.listEvents(current.id)).toEqual([]);
    expect(vault.status().revision).toBe(revision);
    const finding = { ...data, metrics: [] };
    expect(work.saveCard(current.id, 0, finding)).toEqual(finding);
  });

  it.each(['estimated', 'unknown'] as const)(
    'retains legitimate %s generated metrics',
    (confidence) => {
      const vault = open();
      const current = start(vault);
      const data: CardWithCompany = {
        ...card(),
        metrics: [
          {
            id: 'metric_a',
            companyId: 'company_a',
            metricType: 'arr',
            value: confidence === 'unknown' ? null : 1,
            confidence,
            source: null,
            citations: [],
            methodNote: null,
            capturedAt: at,
          },
        ],
      };
      expect(vault.writer().work.saveCard(current.id, 0, data)).toEqual(data);
      expect(vault.work.getCard('card_a')).toEqual(data);
      expect(vault.work.listEvents(current.id)[0]?.progress.card).toEqual(data);
    },
  );

  it('settles reserved tokens within an attempt but retains charged usage on retry', () => {
    const vault = open();
    const current = start(vault);
    const work = vault.writer().work;
    const reserved = work.updateRun(
      { ...current, usage: { requests: 1, inputTokens: 100, outputTokens: 100, complete: false } },
      0,
    );
    const settled = work.updateRun(
      { ...reserved, usage: { requests: 1, inputTokens: 20, outputTokens: 10, complete: true } },
      0,
    );
    expect(() =>
      work.updateRun({ ...settled, scope: { ...settled.scope, goal: 'Changed' } }, 0),
    ).toThrow(/immutable/i);
    expect(() =>
      work.updateRun({ ...settled, usage: { ...settled.usage, requests: 0 } }, 0),
    ).toThrow(/usage/i);
    const failed = work.updateRun({ ...settled, status: 'failed' }, 0);
    expect(() =>
      work.updateRun({ ...failed, status: 'queued', generation: 1, usage: current.usage }, 0),
    ).toThrow(/usage/i);
    const retry = work.updateRun({ ...failed, status: 'queued', generation: 1 }, 0);
    expect(retry.usage).toEqual(settled.usage);
  });

  it('rolls card and event back together if the owner fence fails at commit', () => {
    const file = location();
    const vault = open(file);
    const current = start(vault);
    const db = new DatabaseSync(file);
    try {
      let checks = 0;
      const work = createWorkStore(
        db,
        'vault_work',
        () => {},
        () => {
          if (++checks === 3) throw new Error('Fence lost before commit');
        },
      );
      const revision = vault.status().revision;
      expect(() => work.saveCard(current.id, 0, card())).toThrow(/fence lost/i);
      expect(vault.work.getCard('card_a')).toBeNull();
      expect(vault.work.listEvents(current.id)).toEqual([]);
      expect(vault.status().revision).toBe(revision);
    } finally {
      db.close();
    }
  });

  it('enforces payload limits atomically, including the event paired with output', () => {
    const vault = open();
    const current = start(vault);
    const work = vault.writer().work;
    const revision = vault.status().revision;
    const oversized = {
      ...card(),
      company: { ...card().company!, oneLiner: 'x'.repeat(workStoreLimits.maxBodyBytes) },
    };
    expect(() => work.saveCard(current.id, 0, oversized)).toThrow(/storage limit/i);
    expect(vault.work.listCards(deck.id)).toEqual([]);
    expect(vault.work.listEvents(current.id)).toEqual([]);
    expect(vault.status().revision).toBe(revision);
  });
  it('rolls output back when its paired event would exceed the bounded ledger', () => {
    const file = location();
    const vault = open(file);
    const current = start(vault);
    const work = vault.writer().work;
    work.saveCard(current.id, 0, card());
    const db = new DatabaseSync(file);
    try {
      db.exec('BEGIN IMMEDIATE;');
      const insert = db.prepare('INSERT INTO work_events VALUES(?,?,?,?,?)');
      for (let sequence = 2; sequence <= workStoreLimits.maxEventsPerRun; sequence++)
        insert.run(current.id, sequence, 0, '{"message":"Existing fixture progress"}', at);
      db.exec('COMMIT;');
    } finally {
      db.close();
    }
    const revision = vault.status().revision;
    expect(() => work.saveCard(current.id, 0, card('late_card'))).toThrow(/event storage limit/i);
    expect(vault.work.getCard('late_card')).toBeNull();
    expect(vault.work.getCard('card_a')).toEqual(card());
    expect(vault.work.listEvents(current.id, workStoreLimits.maxEventsPerRun - 1)).toHaveLength(1);
    expect(vault.status().revision).toBe(revision);
  });

  it('bounds and freezes the selected queue, retaining it through reopen', () => {
    const file = location();
    const vault = open(file);
    const work = vault.writer().work;
    const current = start(vault, { maxCompanies: 1 });
    expect(() =>
      work.updateRun({ ...current, tasks: [task(), task('company_b', 'Other')] }, 0),
    ).toThrow(/company allowance/i);
    expect(() => work.updateRun({ ...current, tasks: [task(), task()] }, 0)).toThrow(/unique/i);
    const selected = work.updateRun({ ...current, tasks: [task()] }, 0);
    expect(() => work.updateRun({ ...selected, tasks: undefined }, 0)).toThrow(
      /queue is immutable/i,
    );
    expect(() =>
      work.updateRun({ ...selected, tasks: [task('company_b', 'Replacement')] }, 0),
    ).toThrow(/queue is immutable/i);
    const paused = work.updateRun({ ...selected, status: 'paused', generation: 1 }, 0);
    vault.close();
    const reopened = open(file);
    expect(reopened.work.getRun(current.id)).toEqual(paused);
    expect(reopened.status().schemaVersion).toBe(8);
  });
  it.each(['synthetic_fixture', 'live_provider'] as const)(
    'persists immutable %s research provenance without upgrading schema',
    (researchProvenance) => {
      const file = location();
      const vault = open(file);
      const current = start(vault, { researchProvenance });
      const work = vault.writer().work;
      const revision = vault.status().revision;
      const opposite =
        researchProvenance === 'synthetic_fixture' ? 'live_provider' : 'synthetic_fixture';
      expect(() =>
        work.updateRun({ ...current, researchProvenance: opposite }, current.generation),
      ).toThrow(/provenance is immutable/i);
      expect(() =>
        work.updateRun({ ...current, researchProvenance: undefined }, current.generation),
      ).toThrow(/provenance is immutable/i);
      expect(() =>
        work.acceptRun({ ...run(), researchProvenance: opposite }, market, deck),
      ).toThrow(/provenance conflict/i);
      expect(vault.status().revision).toBe(revision);
      vault.close();
      const reader = open(file, 'reader');
      expect(reader.work.getRun(current.id)?.researchProvenance).toBe(researchProvenance);
      expect(reader.status().schemaVersion).toBe(8);
    },
  );
  it('retains accepted untagged local records as read-only instead of assigning an origin', () => {
    const vault = open();
    const work = vault.writer().work;
    const old = work.acceptRun(run({ researchProvenance: undefined }), market, deck);
    const revision = vault.status().revision;
    expect(vault.work.getRun(old.id)?.researchProvenance).toBeUndefined();
    expect(() => work.updateRun({ ...old, status: 'running' }, old.generation)).toThrow(
      /provenance.*read-only/i,
    );
    expect(() =>
      work.updateRun(
        { ...old, researchProvenance: 'live_provider', status: 'running' },
        old.generation,
      ),
    ).toThrow(/provenance.*read-only/i);
    expect(() => work.saveCard(old.id, old.generation, card())).toThrow(/provenance.*read-only/i);
    expect(() =>
      work.appendEvent(old.id, old.generation, { message: 'Late unclassified progress' }),
    ).toThrow(/provenance.*read-only/i);
    expect(vault.work.getRun(old.id)).toEqual(old);
    expect(vault.work.listEvents(old.id)).toEqual([]);
    expect(vault.status().revision).toBe(revision);
  });

  it('commits task completion with its cards/events, rejects stale outcomes, and replays identical writes once', () => {
    const vault = open();
    const work = vault.writer().work;
    const current = start(vault);
    const selected = work.updateRun({ ...current, tasks: [task()] }, 0);
    const started = work.updateRun(
      { ...selected, tasks: [{ ...task(), status: 'running', attempts: 1 }] },
      0,
    );
    const completed: NativeRun = {
      ...started,
      tasks: [{ ...started.tasks![0]!, status: 'completed', cardIds: ['card_a'] }],
    };
    const revision = vault.status().revision;
    expect(() =>
      work.updateRun(
        { ...completed, tasks: [{ ...completed.tasks![0]!, cardIds: ['missing_card'] }] },
        0,
        [card()],
      ),
    ).toThrow(/card does not belong/i);
    expect(vault.work.getCard('card_a')).toBeNull();
    expect(vault.work.listEvents(current.id)).toEqual([]);
    expect(vault.work.getRun(current.id)).toEqual(started);
    expect(vault.status().revision).toBe(revision);
    expect(work.updateRun(completed, 0, [card()])).toEqual(completed);
    expect(work.updateRun(completed, 0, [card()])).toEqual(completed);
    expect(vault.work.listCards(deck.id)).toEqual([card()]);
    expect(vault.work.listEvents(current.id)).toHaveLength(1);
    expect(() => work.updateRun(started, 0)).toThrow(/task outcome is fenced/i);
    expect(() =>
      work.saveCard(current.id, 0, {
        ...card(),
        company: { ...card().company!, oneLiner: 'Late changed output' },
      }),
    ).toThrow(/unfinished selected task/i);
    expect(vault.work.getRun(current.id)).toEqual(completed);
  });

  it('bounds activity pages while preserving an incremental replay cursor', () => {
    const vault = open();
    const work = vault.writer().work;
    const current = start(vault);
    for (let index = 0; index < 105; index += 1) {
      work.appendEvent(current.id, current.generation, { kind: 'step', message: `Step ${index}` });
    }
    const first = vault.work.listEvents(current.id, 0, 100);
    expect(first).toHaveLength(100);
    expect(first[99]!.sequence).toBe(100);
    expect(vault.work.listEvents(current.id, 100, 100)).toHaveLength(5);
    expect(() => vault.work.listEvents(current.id, 0, 0)).toThrow();
  });

  it('fences atomic task output after pause and requires all selected tasks to finish', () => {
    const vault = open();
    const work = vault.writer().work;
    const current = start(vault);
    const selected = work.updateRun({ ...current, tasks: [task()] }, 0);
    const started = work.updateRun(
      { ...selected, tasks: [{ ...task(), status: 'running', attempts: 1 }] },
      0,
    );
    expect(() => work.updateRun({ ...started, status: 'completed' }, 0)).toThrow(
      /unfinished selected tasks/i,
    );
    const paused = work.updateRun({ ...started, status: 'paused', generation: 1 }, 0);
    expect(() =>
      work.updateRun(
        {
          ...started,
          tasks: [{ ...started.tasks![0]!, status: 'completed', cardIds: ['card_a'] }],
        },
        0,
        [card()],
      ),
    ).toThrow(/generation conflict/i);
    expect(vault.work.getCard('card_a')).toBeNull();
    expect(vault.work.getRun(current.id)).toEqual(paused);
  });
});
