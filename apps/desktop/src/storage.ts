import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { marketSchema, deckSchema, companySchema, companyMetricSchema, cardSchema, viceClaimSchema } from '@mi/contracts';
import { migrateSnapshot, prepareImportedSnapshot, REPO_SCHEMA_VERSION, type RepoSnapshot, type ResearchStore } from '@mi/research';

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

const MAX_EXPORT_BYTES = 50 * 1024 * 1024;

/** Reject malformed or future-format files before touching existing research. */
export function parseResearchExport(json: string): RepoSnapshot {
  if (Buffer.byteLength(json, 'utf8') > MAX_EXPORT_BYTES) throw new Error('Research exports must be smaller than 50 MB.');
  return checkedExport(JSON.parse(json));
}

function checkedExport(parsed: unknown): RepoSnapshot {
  const raw = snapshotSchema.parse(parsed);
  for (const field of ['reports', 'briefings', 'savedCards', 'threads', 'researchJobs']) {
    if (raw[field] !== undefined && !Array.isArray(raw[field])) throw new Error(`Invalid ${field} in research export.`);
  }
  return migrateSnapshot(raw as unknown as RepoSnapshot).snapshot;
}

/**
 * A file the person picked, ready to become the workspace. Unlike a read of the
 * saved workspace (parseResearchExport), it carries no process state: a warm-up
 * or research job recorded in someone else's file is not this machine's to resume.
 */
export function parseResearchImport(json: string): RepoSnapshot {
  if (Buffer.byteLength(json, 'utf8') > MAX_EXPORT_BYTES) throw new Error('Research exports must be smaller than 50 MB.');
  // Rows are checked first, so one unreadable row is left out (as on the web) instead of refusing the whole file;
  // the full check then runs on what is kept.
  return checkedExport(prepareImportedSnapshot(JSON.parse(json) as RepoSnapshot).snapshot);
}

/**
 * Keeps the research an import is about to replace as a plain export file,
 * `repo.before-import.json`, beside the research file. The last-good backup is
 * only the revision before the latest save, so after one save in the imported
 * workspace it would be the import itself. This file is written by an import and
 * by nothing else, and the person can import it again to go back.
 * Nothing is written for a workspace with no decks.
 */
export function keepBeforeImport(store: ResearchStore, file: string): boolean {
  const current = store.read();
  if (!current || current.markets.length === 0) return false;
  const target = path.join(path.dirname(file), 'repo.before-import.json');
  const temp = `${target}.tmp`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(temp, JSON.stringify(current), { mode: 0o600, flush: true });
  renameSync(temp, target);
  return true;
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
