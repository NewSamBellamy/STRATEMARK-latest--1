/** Existing desktop IPC read seam; never activates a migration candidate. */
import { z } from 'zod';
import {
  IPC_CHANNELS,
  marketSchema,
  deckSchema,
  companySchema,
  cardSchema,
  dashboardTabSchema,
  type CardWithCompany,
} from '@mi/contracts';
import { cardFilterSchema } from './ipc-schemas';
import { openStagedVault } from './staged-vault-reader';

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const noArgs = z.tuple([]);
const oneId = z.tuple([id]);
const maxReplyBytes = 512 * 1024;
const maxItems = 500;
class PreviewReadError extends Error {}
const readOnly = () => {
  throw new PreviewReadError(
    'This is a read-only migration preview. Research, editing, sharing and settings are disabled.',
  );
};

export function openStagedAppReads(directory: string) {
  const reader = openStagedVault(directory);
  let closed = false;
  function markets() {
    const items = [];
    let afterId: string | undefined;
    while (true) {
      const page = reader.listMarkets({ limit: 100, afterId });
      items.push(
        ...page.items.map((item) =>
          marketSchema.parse(reader.getLegacyRecord('markets', item.record.id)),
        ),
      );
      // Existing array IPC has no cursor. Fail explicitly, NEVER silently drop a page.
      if (items.length > maxItems)
        throw new PreviewReadError(
          'This preview reply is too large. A paginated library is required.',
        );
      if (page.nextCursor === null) return items;
      afterId = page.nextCursor;
    }
  }
  function company(companyId: string) {
    const item = reader.getCompany(companyId);
    if (!item) return null;
    return companySchema.parse({
      id: item.record.id,
      name: item.name,
      oneLiner: item.profile?.oneLiner ?? '',
      hqLocation: item.profile?.hqLocation ?? null,
      websiteUrl: item.profile?.websiteUrl ?? null,
      // Remote assets and imported theme fonts must not trigger retrieval on a cached read.
      logoUrl: null,
      brandTheme: null,
    });
  }
  function cards(deckId: string): CardWithCompany[] {
    const native = reader.listCards(deckId).items;
    if (native.length > maxItems)
      throw new PreviewReadError('This preview reply is too large. A paginated deck is required.');
    return native.map((item) => {
      const original = reader.getLegacyRecord('cards', item.id);
      return {
        card: cardSchema.parse({
          id: item.id,
          deckId,
          companyId: item.companyId,
          // One company card regardless of market role; role filters use marketRoles.
          cardType: 'company',
          title: null,
          summary: null,
          tier: null,
          tierReason: null,
          citations: [],
          keyPoints: [],
          createdAt: original?.createdAt,
        }),
        company: company(item.companyId),
        metrics: [],
        viceClaims: [],
        marketRoles: item.roles,
        evidenceState: item.evidenceState,
      };
    });
  }
  function dispatch(channel: string, args: unknown[]) {
    switch (channel) {
      case IPC_CHANNELS.listMarkets:
        noArgs.parse(args);
        return markets();
      case IPC_CHANNELS.getMarket: {
        const [marketId] = oneId.parse(args);
        return reader.getMarket(marketId)
          ? marketSchema.parse(reader.getLegacyRecord('markets', marketId))
          : null;
      }
      case IPC_CHANNELS.getDeckByMarket: {
        const [marketId] = oneId.parse(args);
        const item = reader.getDeckByMarket(marketId);
        return item ? deckSchema.parse(item.deck) : null;
      }
      case IPC_CHANNELS.listCards: {
        const [deckId, filter] = z
          .tuple([id, cardFilterSchema])
          .parse(args.length === 1 ? [...args, undefined] : args);
        return cards(deckId).filter(
          (item) =>
            (filter?.cardType === undefined ||
              item.marketRoles?.includes(
                filter.cardType as 'company' | 'infrastructure' | 'distribution',
              )) &&
            (filter?.tier === undefined || item.card.tier === filter.tier),
        );
      }
      case IPC_CHANNELS.getCard: {
        const [cardId] = oneId.parse(args);
        const original = reader.getLegacyRecord('cards', cardId);
        if (!original || typeof original.deckId !== 'string') return null;
        const group = reader
          .listCards(original.deckId)
          .items.find((item) => item.originalCardIds.includes(cardId));
        return group
          ? (cards(original.deckId).find((item) => item.card.id === group.id) ?? null)
          : null;
      }
      case IPC_CHANNELS.getCompany:
        return company(oneId.parse(args)[0]);
      case IPC_CHANNELS.getCompanyMetrics:
      case IPC_CHANNELS.getViceClaims:
      case IPC_CHANNELS.listDeckBriefings:
        oneId.parse(args);
        return [];
      case IPC_CHANNELS.listSavedCards:
      case IPC_CHANNELS.listReports:
      case IPC_CHANNELS.listResearchJobs:
        noArgs.parse(args);
        return [];
      case IPC_CHANNELS.getReport:
      case IPC_CHANNELS.getResearchJob:
      case IPC_CHANNELS.getResearchThread:
        oneId.parse(args);
        return null;
      case IPC_CHANNELS.listResearchThreads:
        z.tuple([
          z.object({ deckId: id.optional(), companyId: id.optional() }).strict().optional(),
        ]).parse(args.length === 0 ? [undefined] : args);
        return [];
      case IPC_CHANNELS.getDashboardTab: {
        const [, , force] = z
          .tuple([id, dashboardTabSchema, z.boolean().optional()])
          .parse(args.length === 2 ? [...args, undefined] : args);
        if (force) return readOnly();
        return null;
      }
      default:
        return readOnly();
    }
  }
  return {
    read(channel: string, args: unknown[]): unknown {
      if (closed) throw new PreviewReadError('Read-only migration preview is closed.');
      try {
        reader.status();
        const result = dispatch(channel, args);
        reader.status();
        if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxReplyBytes)
          throw new PreviewReadError(
            'This preview reply is too large. A paginated read is required.',
          );
        return result;
      } catch (error) {
        if (error instanceof PreviewReadError) throw error;
        // No source payload, paths, validation values or database internals cross IPC errors.
        throw new PreviewReadError(
          error instanceof z.ZodError
            ? 'Invalid read-only preview request.'
            : 'The read-only migration candidate is unavailable or changed. Reopen a verified candidate.',
        );
      }
    },
    close() {
      if (!closed) {
        closed = true;
        reader.close();
      }
    },
  };
}
