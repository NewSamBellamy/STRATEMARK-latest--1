import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { marketSchema, deckSchema, companySchema, companyMetricSchema, cardSchema, viceClaimSchema } from '@mi/contracts';
import { migrateSnapshot, REPO_SCHEMA_VERSION, type RepoSnapshot, type ResearchStore } from '@mi/research';

const snapshotSchema = z.object({
  schemaVersion: z.number().int().min(1).max(REPO_SCHEMA_VERSION).optional(),
  markets: z.array(marketSchema.passthrough()),
  decks: z.array(deckSchema.passthrough()),
  companies: z.array(companySchema.passthrough()),
  metrics: z.array(companyMetricSchema.passthrough()),
  cards: z.array(cardSchema.passthrough()),
  viceClaims: z.array(viceClaimSchema.passthrough()).default([]),
  dashboards: z.record(z.unknown()).default({}),
  companyMarket: z.record(z.string()).default({}),
}).passthrough();

/** Reject malformed or future-format files before touching existing research. */
export function parseResearchExport(json: string): RepoSnapshot {
  if (Buffer.byteLength(json, 'utf8') > 50 * 1024 * 1024) throw new Error('Research exports must be smaller than 50 MB.');
  const raw = snapshotSchema.parse(JSON.parse(json));
  for (const field of ['reports', 'briefings', 'savedCards', 'threads', 'researchJobs']) {
    if (raw[field] !== undefined && !Array.isArray(raw[field])) throw new Error(`Invalid ${field} in research export.`);
  }
  return migrateSnapshot(raw as unknown as RepoSnapshot).snapshot;
}

/** Atomic replacement with a last-good backup. Persistence failures are visible. */
export function createFileStore(file: string): ResearchStore {
  const readFile = (target: string) => parseResearchExport(readFileSync(target, 'utf8'));
  return {
    read() {
      if (!existsSync(file)) return existsSync(`${file}.bak`) ? readFile(`${file}.bak`) : null;
      try { return readFile(file); } catch (error) {
        // A future-format file is not corruption: never overwrite it with an older backup.
        let version = 1;
        try { version = (JSON.parse(readFileSync(file, 'utf8')) as { schemaVersion?: number }).schemaVersion ?? 1; } catch { /* malformed JSON may be recovered */ }
        if (version > REPO_SCHEMA_VERSION) throw new Error('This research was saved by a newer Stratemark version. Please upgrade.');
        if (!existsSync(`${file}.bak`)) throw error;
        const backup = readFile(`${file}.bak`);
        copyFileSync(file, `${file}.corrupt-${Date.now()}`);
        copyFileSync(`${file}.bak`, file);
        return backup;
      }
    },
    write(snapshot) {
      const json = JSON.stringify(snapshot);
      parseResearchExport(json);
      mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.tmp`;
      writeFileSync(temp, json, { mode: 0o600, flush: true });
      if (existsSync(file)) {
        readFile(file); // Never replace a good backup with an unreadable working copy.
        copyFileSync(file, `${file}.bak`);
      }
      renameSync(temp, file);
    },
  };
}
