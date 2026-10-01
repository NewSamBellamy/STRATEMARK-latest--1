/** Internal, read-only navigation over a verified synthetic staging candidate. */
import path from 'node:path';
import type { VaultCompany, VaultMarket } from '@mi/contracts';
import { openVault } from './vault';
import { verifyStagedCandidate } from './vault-staging';

type NativeVault = ReturnType<typeof openVault>;
type LegacyPayload = Record<string, unknown>;
type LegacyDeck = LegacyPayload & { id: string; marketId: string };
type Role = 'company' | 'infrastructure' | 'distribution';
const roleOrder: readonly Role[] = ['company', 'infrastructure', 'distribution'];
const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

function record(value: unknown): LegacyPayload | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as LegacyPayload)
    : null;
}

function role(value: unknown): Role | null {
  return value === 'company' || value === 'infrastructure' || value === 'distribution'
    ? value
    : null;
}

/**
 * Opens a verified staged candidate as a fixed-revision reader. This module is
 * intentionally internal: it has no IPC/MCP, job, provider, or write surface.
 */
export function openStagedVault(directory: string) {
  const manifest = verifyStagedCandidate(directory);
  const vault = openVault(path.join(directory, 'vault.sqlite'), manifest.vaultId, 'reader');
  let closed = false;
  const initial = vault.status();
  if (initial.revision !== manifest.vaultRevision) {
    vault.close();
    throw new Error('Staged candidate revision changed after verification.');
  }
  const pinnedRevision = initial.revision;

  function assertOpen() {
    if (closed) throw new Error('Staged vault reader is closed.');
  }

  function checkRevision(revision?: number) {
    assertOpen();
    if (revision !== undefined && revision !== pinnedRevision)
      throw new Error('Staged candidate revision changed during read.');
    if (vault.status().revision !== pinnedRevision)
      throw new Error('Staged candidate revision changed after reader opened.');
  }

  function findLegacy(family: 'decks' | 'cards', predicate: (item: unknown) => boolean) {
    let afterOrdinal: number | undefined;
    const matches: LegacyPayload[] = [];
    while (true) {
      checkRevision();
      const page = vault.readLegacyRecords(manifest.sourceSha256, family, {
        limit: 100,
        afterOrdinal,
      });
      checkRevision(page.vaultRevision);
      for (const item of page.items) {
        const payload = record(item.payload);
        if (payload && predicate(payload)) matches.push(payload);
      }
      if (page.nextOrdinal === null) return matches;
      afterOrdinal = page.nextOrdinal;
    }
  }

  function company(id: string): VaultCompany | null {
    checkRevision();
    const result = vault.getCompany(id);
    checkRevision();
    return result;
  }

  function decksForMarket(marketId: string): LegacyDeck[] {
    return findLegacy('decks', (candidate) => record(candidate)?.marketId === marketId).flatMap(
      (candidate) =>
        typeof candidate.id === 'string' && typeof candidate.marketId === 'string'
          ? [{ ...candidate, id: candidate.id, marketId: candidate.marketId }]
          : [],
    );
  }

  function deckInstant(deck: LegacyDeck) {
    if (typeof deck.createdAt !== 'string') return null;
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(
      deck.createdAt,
    );
    if (match) {
      const milliseconds = Date.parse(`${match[1]}${match[3]}`);
      if (!Number.isNaN(milliseconds))
        return { milliseconds, fraction: (match[2] ?? '').replace(/0+$/, '') };
    }
    const milliseconds = Date.parse(deck.createdAt);
    return Number.isNaN(milliseconds) ? null : { milliseconds, fraction: '' };
  }

  function deckOrder(left: LegacyDeck, right: LegacyDeck) {
    const leftInstant = deckInstant(left);
    const rightInstant = deckInstant(right);
    if (leftInstant === null || rightInstant === null) {
      if (leftInstant !== rightInstant) return leftInstant === null ? 1 : -1;
      return compareStrings(left.id, right.id);
    }
    if (leftInstant.milliseconds !== rightInstant.milliseconds)
      return rightInstant.milliseconds - leftInstant.milliseconds;
    const fractionWidth = Math.max(leftInstant.fraction.length, rightInstant.fraction.length);
    const leftFraction = leftInstant.fraction.padEnd(fractionWidth, '0');
    const rightFraction = rightInstant.fraction.padEnd(fractionWidth, '0');
    const fractionOrder = compareStrings(rightFraction, leftFraction);
    return fractionOrder || compareStrings(left.id, right.id);
  }

  function market(id: string): VaultMarket | null {
    checkRevision();
    const result = vault.getMarket(id);
    checkRevision();
    return result;
  }

  return {
    status() {
      checkRevision();
      return {
        vaultId: manifest.vaultId,
        schemaVersion: manifest.schemaVersion,
        revision: pinnedRevision,
        authority: manifest.authority,
        canApply: manifest.canApply,
      };
    },
    listMarkets(options?: Parameters<NativeVault['listMarkets']>[0]) {
      checkRevision();
      const page = vault.listMarkets(options);
      checkRevision(page.vaultRevision);
      return page;
    },
    searchCompanies(query: string, options?: Parameters<NativeVault['searchCompanies']>[1]) {
      checkRevision();
      const page = vault.searchCompanies(query, options);
      checkRevision(page.vaultRevision);
      return page;
    },
    getCompany: company,
    getDeckByMarket(marketId: string) {
      const nativeMarket = market(marketId);
      if (!nativeMarket) return null;
      const deck = decksForMarket(marketId).sort(deckOrder)[0];
      if (!deck) return null;
      return {
        deck,
        market: nativeMarket,
        evidenceState: 'legacy_unreviewed' as const,
        selection: 'latest_created' as const,
        vaultRevision: pinnedRevision,
      };
    },
    listDecksByMarket(marketId: string) {
      const nativeMarket = market(marketId);
      if (!nativeMarket) return null;
      const items = decksForMarket(marketId).sort(deckOrder);
      checkRevision();
      return {
        items,
        market: nativeMarket,
        selection: 'all_history' as const,
        vaultRevision: pinnedRevision,
      };
    },
    listCards(deckId: string) {
      const cards = findLegacy('cards', (candidate) => record(candidate)?.deckId === deckId);
      const grouped = new Map<string, { ids: string[]; roles: Set<Role>; company: VaultCompany }>();
      for (const card of cards) {
        const cardRole = role(card.cardType);
        if (cardRole === null || typeof card.id !== 'string' || typeof card.companyId !== 'string')
          continue;
        const nativeCompany = company(card.companyId);
        if (!nativeCompany) continue;
        const existing = grouped.get(card.companyId) ?? {
          ids: [],
          roles: new Set<Role>(),
          company: nativeCompany,
        };
        existing.ids.push(card.id);
        existing.roles.add(cardRole);
        grouped.set(card.companyId, existing);
      }
      const items = [...grouped.entries()]
        .map(([companyId, group]) => {
          const originalCardIds = [...new Set(group.ids)].sort(compareStrings);
          const roles = roleOrder.filter((candidate) => group.roles.has(candidate));
          return {
            id: originalCardIds[0]!,
            originalCardIds,
            companyId,
            role: roles[0]!,
            roles,
            company: group.company,
            evidenceState: 'legacy_unreviewed' as const,
            metrics: [] as const,
          };
        })
        .sort((a, b) => compareStrings(a.id, b.id));
      checkRevision();
      return {
        items,
        vaultRevision: pinnedRevision,
        coverageGaps: ['legacy_evidence_not_adjudicated'] as const,
      };
    },
    close() {
      if (!closed) {
        closed = true;
        vault.close();
      }
    },
  };
}
