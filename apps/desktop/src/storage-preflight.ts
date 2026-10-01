/** Read-only status and A44 migration-readiness inspection for the active legacy workspace. */
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import type { BigIntStats } from 'node:fs';
import type { MigrationReadiness, ResearchStorageInfo } from '@mi/contracts';
import { inspectLegacySnapshot } from './snapshot-inspection';

type VerifiedSource = {
  state: 'verified';
  byteLength: number;
  sourceRevision: string;
  marketCount: number;
  deckCount: number;
  inspection: ReturnType<typeof inspectLegacySnapshot>;
};
type InspectedSource = VerifiedSource | { state: 'missing' | 'invalid' };

function sameFile(before: BigIntStats, after: BigIntStats) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs
  );
}

/** Reads one regular local file through a stable descriptor; it never repairs or creates files. */
function inspectFile(file: string): InspectedSource {
  if (!existsSync(file)) return { state: 'missing' };
  let descriptor: number | null = null;
  try {
    const pathStat = lstatSync(file, { bigint: true });
    if (
      !pathStat.isFile() ||
      pathStat.isSymbolicLink() ||
      pathStat.nlink !== 1n ||
      pathStat.size <= 0n ||
      pathStat.size > BigInt(50 * 1024 * 1024)
    )
      return { state: 'invalid' };
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = fstatSync(descriptor, { bigint: true });
    if (!sameFile(pathStat, before)) return { state: 'invalid' };
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (!sameFile(before, after) || bytes.byteLength !== Number(before.size))
      return { state: 'invalid' };
    const finalPathStat = lstatSync(file, { bigint: true });
    if (!sameFile(after, finalPathStat)) return { state: 'invalid' };
    const json = bytes.toString('utf8');
    if (!Buffer.from(json, 'utf8').equals(bytes)) return { state: 'invalid' };
    const inspection = inspectLegacySnapshot(json);
    return {
      state: 'verified',
      byteLength: inspection.source.byteLength,
      sourceRevision: inspection.source.sha256,
      marketCount: inspection.counts.markets,
      deckCount: inspection.counts.decks,
      inspection,
    };
  } catch {
    return { state: 'invalid' };
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

/** Safe A61 summary. Unlike ResearchStore.read(), this cannot invoke backup recovery. */
export function inspectResearchStorage(
  primaryFile: string,
  demoSourceRevision?: string,
): ResearchStorageInfo {
  const primary = inspectFile(primaryFile);
  const backup = inspectFile(`${primaryFile}.bak`);
  const health =
    primary.state === 'verified'
      ? 'ready'
      : backup.state === 'verified'
        ? 'recovery_needed'
        : primary.state === 'missing' && backup.state === 'missing'
          ? 'empty'
          : 'unavailable';
  const verifiedPrimary = primary.state === 'verified' ? primary : null;
  const verifiedBackup = backup.state === 'verified' ? backup : null;
  return {
    engine: 'legacy_json',
    health,
    primaryState: primary.state,
    contentKind: verifiedPrimary
      ? verifiedPrimary.sourceRevision === demoSourceRevision
        ? 'demo'
        : 'workspace'
      : 'none',
    marketCount: verifiedPrimary?.marketCount ?? 0,
    deckCount: verifiedPrimary?.deckCount ?? 0,
    sizeBytes: verifiedPrimary?.byteLength ?? 0,
    sourceRevision: verifiedPrimary?.sourceRevision ?? null,
    backup: {
      state: backup.state,
      marketCount: verifiedBackup?.marketCount ?? 0,
      deckCount: verifiedBackup?.deckCount ?? 0,
      sizeBytes: verifiedBackup?.byteLength ?? 0,
    },
  };
}

/** Explicit A44 check only: no staging, provider access, authority, approval or filesystem write. */
export function preflightCurrentResearch(
  primaryFile: string,
  demoSourceRevision?: string,
): MigrationReadiness {
  const source = inspectFile(primaryFile);
  if (source.state === 'missing')
    return {
      state: 'blocked',
      reason: 'source_missing',
      canApply: false,
      performedWrites: false,
    };
  if (source.state !== 'verified')
    return {
      state: 'blocked',
      reason: 'invalid_or_unsupported',
      canApply: false,
      performedWrites: false,
    };
  if (source.sourceRevision === demoSourceRevision)
    return {
      state: 'blocked',
      reason: 'demo_workspace',
      canApply: false,
      performedWrites: false,
    };
  return {
    state: 'ready',
    sourceRevision: source.sourceRevision,
    counts: {
      markets: source.inspection.counts.markets,
      decks: source.inspection.counts.decks,
      companies: source.inspection.counts.companies,
      cards: source.inspection.counts.cards,
    },
    warnings: [...source.inspection.warnings],
    canApply: false,
    performedWrites: false,
  };
}
