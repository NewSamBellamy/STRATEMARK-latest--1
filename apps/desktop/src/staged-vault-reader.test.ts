import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { legacyRetentionFixture } from './legacy-retention-fixture';
import { openVault as openNativeVault } from './vault';
import { stageLegacySnapshot } from './vault-staging';
import { openStagedVault } from './staged-vault-reader';

const roots: string[] = [];
const readers: ReturnType<typeof openStagedVault>[] = [];

function tempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'stratemark-staged-reader-'));
  roots.push(root);
  return root;
}

function stage(root = tempRoot(), source = legacyRetentionFixture(2)) {
  const candidate = stageLegacySnapshot(
    JSON.stringify(source),
    root,
    'vault_staged_reader',
    '2026-09-30T12:00:00.000Z',
  );
  return { ...candidate, source };
}

function withExtraEntityCard() {
  const source = legacyRetentionFixture(2);
  source.cards.unshift({
    ...source.cards[0]!,
    id: 'card_0_distribution',
    cardType: 'distribution',
  });
  const directory = tempRoot();
  return stage(directory, source);
}

afterEach(() => {
  for (const reader of readers.splice(0)) reader.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('read-only staged vault navigation', () => {
  it('navigates library to both market decks and the same immutable company identity offline', () => {
    const { directory } = stage();
    const reader = openStagedVault(directory);
    readers.push(reader);

    const markets = reader.listMarkets();
    expect(markets.items.map((item) => item.record.id)).toEqual(['mkt_a', 'mkt_b']);
    const firstDeck = reader.getDeckByMarket('mkt_a');
    const secondDeck = reader.getDeckByMarket('mkt_b');
    expect(firstDeck?.deck.id).toBe('deck_mkt_a');
    expect(firstDeck?.selection).toBe('latest_created');
    expect(secondDeck?.deck.id).toBe('deck_mkt_b');
    expect(reader.listCards(firstDeck!.deck.id).items.map((item) => item.id)).toEqual(['card_0']);
    expect(reader.listCards(secondDeck!.deck.id).items.map((item) => item.id)).toEqual(['card_1']);
    expect(reader.getCompany('co_shared')?.name).toBe('Synthetic Fixture Labs');
    expect(reader.listCards(firstDeck!.deck.id).items[0]?.company.record.id).toBe('co_shared');
  });

  it('keeps legacy cards explicitly unreviewed and does not project unsupported facts', () => {
    const { directory } = stage();
    const reader = openStagedVault(directory);
    readers.push(reader);

    const cards = reader.listCards('deck_mkt_a');
    expect(cards).toEqual({
      items: [
        expect.objectContaining({
          id: 'card_0',
          companyId: 'co_shared',
          role: 'company',
          evidenceState: 'legacy_unreviewed',
          metrics: [],
        }),
      ],
      vaultRevision: reader.status().revision,
      coverageGaps: ['legacy_evidence_not_adjudicated'],
    });
    expect(JSON.stringify(cards)).not.toMatch(/user_verified|Attributed synthetic risk|metric_a/);
    expect(reader.getCompany('co_shared')).not.toHaveProperty('metrics');
  });

  it('groups same-company cards and preserves all original card IDs and entity roles', () => {
    const { directory } = withExtraEntityCard();
    const reader = openStagedVault(directory);
    readers.push(reader);

    const cards = reader.listCards('deck_mkt_a');
    expect(cards.items).toHaveLength(1);
    expect(cards.items[0]).toMatchObject({
      id: 'card_0',
      originalCardIds: ['card_0', 'card_0_distribution'],
      companyId: 'co_shared',
      role: 'company',
      roles: ['company', 'distribution'],
      evidenceState: 'legacy_unreviewed',
      metrics: [],
    });
  });

  it('orders all retained decks by instant, fractional precision, then stable ID', () => {
    const source = legacyRetentionFixture(2);
    source.decks.push({
      id: 'deck_mkt_a_offset',
      marketId: 'mkt_a',
      createdAt: '2026-09-30T13:00:00+01:00',
      lastRefreshedAt: null,
    });
    source.decks.push({
      id: 'deck_mkt_a_ten_ms',
      marketId: 'mkt_a',
      createdAt: '2026-09-30T12:00:00.010Z',
      lastRefreshedAt: null,
    });
    source.decks.push({
      id: 'deck_mkt_a_hundred_ms',
      marketId: 'mkt_a',
      createdAt: '2026-09-30T12:00:00.1Z',
      lastRefreshedAt: null,
    });
    const { directory } = stage(tempRoot(), source);
    const reader = openStagedVault(directory);
    readers.push(reader);

    expect(reader.getDeckByMarket('mkt_a')?.deck.id).toBe('deck_mkt_a_hundred_ms');
    expect(reader.listDecksByMarket('mkt_a')?.items.map((deck) => deck.id)).toEqual([
      'deck_mkt_a_hundred_ms',
      'deck_mkt_a_ten_ms',
      'deck_mkt_a',
      'deck_mkt_a_offset',
    ]);
    expect(reader.listDecksByMarket('mkt_a')?.selection).toBe('all_history');
  });

  it('retains passive job history without exposing job execution or write operations', () => {
    const { directory, manifest } = stage();
    const reader = openStagedVault(directory);
    readers.push(reader);

    expect(manifest.authority).toBe('disabled');
    expect(manifest.canApply).toBe(false);
    expect(reader).not.toHaveProperty('writer');
    expect(reader).not.toHaveProperty('runResearchJob');
    expect(reader).not.toHaveProperty('startResearch');
    expect(reader).not.toHaveProperty('promoteLegacyEvidence');

    reader.close();
    readers.splice(readers.indexOf(reader), 1);
    const archive = openNativeVault(
      path.join(directory, 'vault.sqlite'),
      manifest.vaultId,
      'reader',
    );
    try {
      const jobs = archive.readLegacyRecords(manifest.sourceSha256, 'researchJobs');
      expect(jobs.items[0]?.payload).toMatchObject({ id: 'job_running', status: 'running' });
      expect(jobs.items[0]?.payload).toHaveProperty('partialCards.0.card.id', 'card_partial');
    } finally {
      archive.close();
    }
  });

  it('rejects candidate inventory changes made after the reader was pinned', () => {
    const { directory, manifest } = stage();
    const reader = openStagedVault(directory);
    readers.push(reader);
    const writer = openNativeVault(path.join(directory, 'vault.sqlite'), manifest.vaultId);
    try {
      writer.writer().saveCompany(
        {
          record: {
            contractVersion: '1',
            id: 'co_new',
            vaultId: manifest.vaultId,
            revision: 1,
            createdAt: '2026-09-30T12:00:00.000Z',
            updatedAt: '2026-09-30T12:00:00.000Z',
          },
          name: 'New Synthetic Company',
          officialDomain: null,
        },
        0,
      );
    } finally {
      writer.close();
    }
    expect(() => reader.searchCompanies('Synthetic')).toThrow(/revision|changed|candidate/i);
  });

  it('reports missing records as unknown and errors after close', () => {
    const { directory } = stage();
    const reader = openStagedVault(directory);
    expect(reader.getCompany('co_missing')).toBeNull();
    expect(reader.getDeckByMarket('mkt_missing')).toBeNull();
    reader.close();
    expect(() => reader.listMarkets()).toThrow(/closed/i);
    expect(() => reader.status()).toThrow(/closed/i);
  });
});
