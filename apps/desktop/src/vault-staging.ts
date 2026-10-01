/** Internal offline candidate builder. No live file replacement or approval authority. */
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  recordVersionSchema,
  vaultCompanySchema,
  vaultMarketSchema,
  vaultMembershipSchema,
  brandThemeSchema,
  scopeDefinitionSchema,
} from '@mi/contracts';
import { inspectLegacySnapshot } from './snapshot-inspection';
import { legacyFamilies } from './vault-legacy-store';
import { openAssetStore } from './vault-assets';
import { openVault } from './vault';
import { currentVaultSchemaVersion } from './vault-schema';

const maxChunkBytes = 8 * 1024 * 1024;
const maxSourceBytes = 50 * 1024 * 1024;
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const id = recordVersionSchema.innerType().shape.id;
const countsSchema = z
  .object(
    Object.fromEntries(
      [...legacyFamilies, 'dashboardTabs'].map((family) => [
        family,
        z.number().int().min(0).max(200_000),
      ]),
    ),
  )
  .strict();
const stageManifestSchema = z
  .object({
    format: z.literal('stratemark-stage-v1'),
    vaultId: id,
    schemaVersion: z.literal(currentVaultSchemaVersion),
    vaultRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sourceByteLength: z.number().int().positive().max(maxSourceBytes),
    importedAt: z.string().datetime(),
    authority: z.literal('disabled'),
    canApply: z.literal(false),
    originalSourceChunks: z
      .array(
        z
          .object({
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            byteLength: z.number().int().positive().max(maxChunkBytes),
          })
          .strict(),
      )
      .min(1)
      .max(7),
    counts: countsSchema,
    projectionCounts: z
      .object({
        companies: z.number().int().min(0).max(200_000),
        markets: z.number().int().min(0).max(200_000),
        memberships: z.number().int().min(0).max(200_000),
      })
      .strict(),
    warnings: z
      .array(
        z
          .string()
          .regex(/^[a-z_]+$/)
          .max(100),
      )
      .max(20),
  })
  .strict();
export type StageManifest = z.infer<typeof stageManifestSchema>;
export type StageProgress = {
  phase: 'source_retained' | 'history_retained' | 'inventory_retained' | 'candidate_validated';
  directory: string;
  authority: 'disabled';
};

export class VaultStagingError extends Error {
  constructor(readonly directory: string | null) {
    super('Research staging failed. The original was not changed and no candidate was approved.');
    this.name = 'VaultStagingError';
  }
}

function localDirectory(directory: string) {
  if (!path.isAbsolute(directory) || directory.startsWith('\\\\'))
    throw new Error('Invalid staging directory.');
  const stat = lstatSync(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid staging directory.');
  const actual = realpathSync.native(directory);
  if (actual.startsWith('\\\\')) throw new Error('Network staging directory is unsupported.');
  const expected = path.join(
    realpathSync.native(path.dirname(directory)),
    path.basename(directory),
  );
  if (actual.toLowerCase() !== expected.toLowerCase())
    throw new Error('Staging directory identity is invalid.');
  return { actual, dev: stat.dev, ino: stat.ino };
}
function captureDirectory(directory: string) {
  const initial = localDirectory(directory);
  return () => {
    const current = localDirectory(directory);
    if (
      current.dev !== initial.dev ||
      current.ino !== initial.ino ||
      current.actual !== initial.actual
    )
      throw new Error('Staging directory was replaced.');
  };
}
function readManifest(directory: string): StageManifest {
  const assertDirectory = captureDirectory(directory);
  const file = path.join(directory, 'manifest.json');
  const before = lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > 65_536n)
    throw new Error('Invalid staging manifest.');
  const descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    assertDirectory();
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    )
      throw new Error('Staging manifest was replaced.');
    const bytes = readFileSync(descriptor);
    assertDirectory();
    if (
      bytes.byteLength > 65_536 ||
      bytes.byteLength !== Number(before.size) ||
      !Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)
    )
      throw new Error('Invalid staging manifest content.');
    return stageManifestSchema.parse(JSON.parse(bytes.toString('utf8')));
  } finally {
    closeSync(descriptor);
  }
}

function profileUrl(value: string | null) {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? value
      : null;
  } catch {
    return null;
  }
}
function projections(
  inspection: ReturnType<typeof inspectLegacySnapshot>,
  vaultId: string,
  at: string,
) {
  const record = (recordId: string) => ({
    contractVersion: '1' as const,
    vaultId,
    id: recordId,
    revision: 1,
    createdAt: at,
    updatedAt: at,
  });
  let unusableProfileUrls = false;
  const companies = inspection.snapshot.companies.map((company) => {
    const websiteUrl = profileUrl(company.websiteUrl);
    const logoUrl = profileUrl(company.logoUrl);
    if (websiteUrl !== company.websiteUrl || logoUrl !== company.logoUrl)
      unusableProfileUrls = true;
    return vaultCompanySchema.parse({
      record: record(company.id),
      name: company.name,
      officialDomain: null,
      profile: {
        oneLiner: company.oneLiner,
        hqLocation: company.hqLocation,
        websiteUrl,
        logoUrl,
        brandTheme: company.brandTheme === null ? null : brandThemeSchema.parse(company.brandTheme),
      },
    });
  });
  const markets = inspection.snapshot.markets.map((market) =>
    vaultMarketSchema.parse({
      record: record(market.id),
      name: market.name,
      legacyScope: scopeDefinitionSchema.parse(market.scopeDefinition),
    }),
  );
  const memberships = inspection.memberships.map((member) =>
    vaultMembershipSchema.parse({
      record: record(
        `mem_${hash(JSON.stringify([member.companyId, member.marketId])).slice(0, 48)}`,
      ),
      companyId: member.companyId,
      marketId: member.marketId,
      roles: member.roles,
    }),
  );
  return { companies, markets, memberships, unusableProfileUrls };
}
function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function validateCandidate(directory: string, manifest: StageManifest) {
  const assertDirectory = captureDirectory(directory);
  const assetDirectory = path.join(directory, 'assets');
  if (!existsSync(assetDirectory)) throw new Error('Candidate original assets are missing.');
  const assets = openAssetStore(assetDirectory, () => {
    throw new Error('Candidate verification is read-only.');
  });
  const size = manifest.originalSourceChunks.reduce((sum, ref) => sum + ref.byteLength, 0);
  if (size !== manifest.sourceByteLength || size > maxSourceBytes)
    throw new Error('Candidate original byte count is invalid.');
  const bytes = Buffer.concat(manifest.originalSourceChunks.map((ref) => assets.read(ref)));
  if (hash(bytes) !== manifest.sourceSha256) throw new Error('Candidate original checksum failed.');
  const json = bytes.toString('utf8');
  const inspection = inspectLegacySnapshot(json);
  if (
    inspection.source.sha256 !== manifest.sourceSha256 ||
    !sameJson(inspection.counts, manifest.counts)
  )
    throw new Error('Candidate original source does not match its manifest.');
  const projected = projections(inspection, manifest.vaultId, manifest.importedAt);
  const expectedCounts = {
    companies: projected.companies.length,
    markets: projected.markets.length,
    memberships: projected.memberships.length,
  };
  const expectedRevision = 1 + Object.values(expectedCounts).reduce((sum, value) => sum + value, 0);
  if (
    !sameJson(expectedCounts, manifest.projectionCounts) ||
    manifest.vaultRevision !== expectedRevision
  )
    throw new Error('Candidate projected counts do not match.');
  const reader = openVault(path.join(directory, 'vault.sqlite'), manifest.vaultId, 'reader');
  try {
    const status = reader.status();
    if (
      status.revision !== manifest.vaultRevision ||
      status.schemaVersion !== manifest.schemaVersion
    )
      throw new Error('Candidate vault revision changed.');
    if (!sameJson(JSON.parse(reader.exportLegacySnapshot(manifest.sourceSha256)), JSON.parse(json)))
      throw new Error('Candidate retained content does not match its original.');
    for (const company of projected.companies)
      if (!sameJson(reader.getCompany(company.record.id), company))
        throw new Error('Candidate company projection changed.');
    for (const market of projected.markets)
      if (!sameJson(reader.getMarket(market.record.id), market))
        throw new Error('Candidate market projection changed.');
    for (const member of projected.memberships)
      if (!sameJson(reader.getMembership(member.record.id), member))
        throw new Error('Candidate membership projection changed.');
    const retained = reader.verifyLegacySnapshot(manifest.sourceSha256);
    if (
      !sameJson(retained.counts, inspection.counts) ||
      retained.proposedAuthority.runnableJobs !== 0 ||
      retained.proposedAuthority.localAttestations !== 0 ||
      reader.status().revision !== manifest.vaultRevision
    )
      throw new Error('Candidate history or authority changed.');
    assertDirectory();
  } finally {
    reader.close();
  }
  return manifest;
}

/** New private candidate only; importedAt describes local record creation, not a business event. */
export function stageLegacySnapshot(
  json: string,
  stagingParentAbsolute: string,
  vaultId: string,
  importedAt = new Date().toISOString(),
  onProgress?: (progress: StageProgress) => void,
) {
  let directory: string | null = null;
  let owner: ReturnType<typeof openVault> | undefined;
  try {
    id.parse(vaultId);
    z.string().datetime().parse(importedAt);
    const inspection = inspectLegacySnapshot(json); // Validate before ANY filesystem changes.
    if (onProgress !== undefined && typeof onProgress !== 'function')
      throw new Error('Invalid stage progress callback.');
    const projected = projections(inspection, vaultId, importedAt);
    const parent = localDirectory(stagingParentAbsolute);
    const assertParent = captureDirectory(stagingParentAbsolute);
    directory = mkdtempSync(path.join(parent.actual, 'stratemark-stage-'));
    const assertDirectory = captureDirectory(directory);
    assertParent();
    owner = openVault(path.join(directory, 'vault.sqlite'), vaultId);
    const writer = owner.writer();
    // Synchronous trusted UI progress, not source instructions or another scheduler.
    const checkpoint = (phase: StageProgress['phase']) => {
      assertDirectory();
      writer.assertCurrent();
      onProgress?.({ phase, directory: directory!, authority: 'disabled' });
      assertDirectory();
      writer.assertCurrent();
    };
    const assets = openAssetStore(path.join(directory, 'assets'), () => {
      assertDirectory();
      writer.assertCurrent();
    });
    const bytes = Buffer.from(json, 'utf8');
    const chunks = [];
    for (let offset = 0; offset < bytes.byteLength; offset += maxChunkBytes)
      chunks.push(assets.publish(bytes.subarray(offset, offset + maxChunkBytes)));
    checkpoint('source_retained');
    writer.retainLegacySnapshot(json, 0);
    checkpoint('history_retained');
    for (const company of projected.companies) writer.saveCompany(company, 0);
    for (const market of projected.markets) writer.saveMarket(market, 0);
    for (const member of projected.memberships) writer.saveMembership(member, 0);
    checkpoint('inventory_retained');
    const manifest = stageManifestSchema.parse({
      format: 'stratemark-stage-v1',
      vaultId,
      schemaVersion: owner.status().schemaVersion,
      vaultRevision: owner.status().revision,
      sourceSha256: inspection.source.sha256,
      sourceByteLength: bytes.byteLength,
      importedAt,
      authority: 'disabled',
      canApply: false,
      originalSourceChunks: chunks,
      counts: inspection.counts,
      projectionCounts: {
        companies: projected.companies.length,
        markets: projected.markets.length,
        memberships: projected.memberships.length,
      },
      warnings: [
        ...inspection.warnings,
        ...(inspection.identityReview.length ? ['identity_review'] : []),
        ...(projected.unusableProfileUrls ? ['unusable_profile_url'] : []),
      ],
    });
    // Assets publish first; a completion manifest exists only after the full staged DB validates.
    validateCandidate(directory, manifest);
    checkpoint('candidate_validated');
    assertDirectory();
    writer.assertCurrent();
    writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest), {
      flag: 'wx',
      mode: 0o600,
      flush: true,
    });
    owner.close();
    owner = undefined;
    return { directory, manifest: verifyStagedCandidate(directory) };
  } catch {
    try {
      owner?.close();
    } catch {
      /* Preserve the original staging failure. */
    }
    // Leave an incomplete, unapproved candidate for recovery; never delete user files.
    throw new VaultStagingError(directory);
  }
}

/** No mutation, repairing, approval or second writer; missing/corrupt assets fail closed. */
export function verifyStagedCandidate(directory: string): StageManifest {
  try {
    return validateCandidate(directory, readManifest(directory));
  } catch {
    throw new VaultStagingError(null);
  }
}
