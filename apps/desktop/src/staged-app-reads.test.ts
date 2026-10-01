import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IPC_CHANNELS, SECURE_CHANNELS } from '@mi/contracts';
import { legacyRetentionFixture } from './legacy-retention-fixture';
import { stageLegacySnapshot } from './vault-staging';
import * as integration from './staged-app-reads';

const roots: string[] = [];
const readers: Array<{ close(): void }> = [];
function open(source: unknown = legacyRetentionFixture(2)) {
  const root = mkdtempSync(path.join(tmpdir(), 'stratemark-app-reads-'));
  roots.push(root);
  const staged = stageLegacySnapshot(
    JSON.stringify(source),
    root,
    'vault_app_preview',
    '2026-09-30T12:00:00.000Z',
  );
  const originalDb = readFileSync(path.join(staged.directory, 'vault.sqlite'));
  const app = integration.openStagedAppReads(staged.directory);
  readers.push(app);
  return { app, staged, originalDb };
}
afterEach(() => {
  for (const app of readers.splice(0)) app.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe('existing app read boundary over a staged vault', () => {
  it('reads the existing library/deck/card/company contracts without loading another repository', () => {
    const { app, staged, originalDb } = open();
    const markets = app.read(IPC_CHANNELS.listMarkets, []) as Array<{
      id: string;
      createdAt: string;
    }>;
    expect(markets.map((m) => m.id)).toEqual(['mkt_a', 'mkt_b']);
    expect(markets[0]!.createdAt).toBe(legacyRetentionFixture(2).markets[0]!.createdAt);
    const deck = app.read(IPC_CHANNELS.getDeckByMarket, ['mkt_a']) as { id: string };
    expect(deck.id).toBe('deck_mkt_a');
    const cards = app.read(IPC_CHANNELS.listCards, [deck.id]) as Array<{
      card: { id: string; tier: null };
      company: { id: string; logoUrl: null };
      metrics: unknown[];
    }>;
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      card: { id: 'card_0', tier: null },
      company: { id: 'co_shared', logoUrl: null },
      metrics: [],
      evidenceState: 'legacy_unreviewed',
      marketRoles: ['company'],
    });
    expect(app.read(IPC_CHANNELS.getCard, ['card_0'])).toEqual(cards[0]);
    expect(app.read(IPC_CHANNELS.getCompany, ['co_shared'])).toEqual(cards[0]!.company);
    expect(app.read(IPC_CHANNELS.getDashboardTab, ['co_shared', 'overview', false])).toBeNull();
    expect(app.read(IPC_CHANNELS.getCompanyMetrics, ['co_shared'])).toEqual([]);
    app.close();
    expect(readFileSync(path.join(staged.directory, 'vault.sqlite'))).toEqual(originalDb);
  });
  it('blocks every research/mutation/secret/unknown channel, including forced cached reads', () => {
    const { app } = open();
    const blocked = [
      IPC_CHANNELS.createMarket,
      IPC_CHANNELS.createResearchedDeck,
      IPC_CHANNELS.refreshDeck,
      IPC_CHANNELS.saveCard,
      IPC_CHANNELS.unsaveCard,
      IPC_CHANNELS.expandDeck,
      IPC_CHANNELS.askResearch,
      IPC_CHANNELS.overrideMetric,
      IPC_CHANNELS.resumeResearchJob,
      IPC_CHANNELS.cancelResearchJob,
      IPC_CHANNELS.deepDive,
      IPC_CHANNELS.generateReport,
      IPC_CHANNELS.googleSignIn,
      ...Object.values(SECURE_CHANNELS),
      'mi:sql',
      'arbitrary',
    ];
    for (const channel of blocked) expect(() => app.read(channel, [])).toThrow(/read-only/i);
    expect(() => app.read(IPC_CHANNELS.getDashboardTab, ['co_shared', 'overview', true])).toThrow(
      /read-only/i,
    );
    expect(app.read(IPC_CHANNELS.listResearchJobs, [])).toEqual([]);
    expect(app.read(IPC_CHANNELS.getResearchJob, ['job_running'])).toBeNull();
  });
  it('retains multi-role identity once and resolves original card aliases without promoting old rank', () => {
    const base = legacyRetentionFixture(2);
    const source = {
      ...base,
      cards: [
        ...base.cards,
        {
          ...base.cards[0]!,
          id: 'card_z_distribution',
          cardType: 'distribution',
          tier: 5,
        },
      ],
    };
    const { app } = open(source);
    const cards = app.read(IPC_CHANNELS.listCards, ['deck_mkt_a']) as unknown[];
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      marketRoles: ['company', 'distribution'],
      card: { tier: null, tierReason: null },
    });
    expect(app.read(IPC_CHANNELS.listCards, ['deck_mkt_a', { cardType: 'distribution' }])).toEqual(
      cards,
    );
    expect(app.read(IPC_CHANNELS.getCard, ['card_z_distribution'])).toEqual(cards[0]);
    expect(app.read(IPC_CHANNELS.listCards, ['deck_mkt_a', { tier: 5 }])).toEqual([]);
  });
  it('rejects invalid inputs, oversized replies and reads after closing instead of truncating or falling back', () => {
    const source = legacyRetentionFixture(2);
    Object.assign(source.markets[0]!.scopeDefinition, { notes: 'x'.repeat(600_000) });
    const { app } = open(source);
    expect(() => app.read(IPC_CHANNELS.getMarket, ['mkt_a'])).toThrow(/too large/i);
    expect(() => app.read(IPC_CHANNELS.getCard, [{ id: 'card_0' }])).toThrow();
    expect(() => app.read(IPC_CHANNELS.listMarkets, ['unexpected'])).toThrow();
    expect(app.read(IPC_CHANNELS.getCompany, ['co_missing'])).toBeNull();
    app.close();
    expect(() => app.read(IPC_CHANNELS.listMarkets, [])).toThrow(/closed/i);
  });
  it('keeps infrastructure-only companies browsable through a company card and role metadata', () => {
    const base = legacyRetentionFixture(2);
    const { app } = open({
      ...base,
      cards: base.cards.map((card) => ({ ...card, cardType: 'infrastructure' })),
    });
    const cards = app.read(IPC_CHANNELS.listCards, ['deck_mkt_a']) as unknown[];
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      card: { cardType: 'company' },
      marketRoles: ['infrastructure'],
    });
  });
});
