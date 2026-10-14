/**
 * Deck completeness scoreboard CLI. Reads an exported repository snapshot and
 * prints a compact table; optionally writes the full JSON report.
 *
 *   pnpm --filter @mi/research completeness <snapshot.json> [options]
 *
 * Options:
 *   --json <file>       also write the full JSON report to <file>
 *   --json -            print ONLY the JSON report to stdout (no table)
 *   --deck <id>         score one deck (repeatable)
 *   --originals <dir>   desktop: merge retained original-source attempts from
 *                       <userData>/original-sources/*.json (they live outside
 *                       the snapshot export)
 *
 * The snapshot may be the raw RepoSnapshot JSON ("Export my research"), or the
 * IndexedDB record wrapper { json: "<snapshot string>", revision, at }.
 * Relative paths resolve against the directory pnpm was invoked from.
 * Read-only: nothing is fetched, nothing is written except --json.
 * See packages/research/COMPLETENESS.md.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildCompletenessReport, renderCompletenessTable, type CompletenessSnapshot } from '../src/completeness-report';
import { isOriginalSourceAttempt, type OriginalSourceAttempt } from '../src/original-source';

function usage(message?: string): never {
  if (message) console.error(message);
  console.error('Usage: pnpm --filter @mi/research completeness <snapshot.json> [--json <file>|-] [--deck <id>] [--originals <dir>]');
  process.exit(2);
}

const base = process.env.INIT_CWD ?? process.cwd();
const args = process.argv.slice(2).filter((arg) => arg !== '--');
let input: string | undefined;
let jsonOut: string | undefined;
let originalsDir: string | undefined;
const deckIds: string[] = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]!;
  const next = () => args[++i] ?? usage(`${arg} needs a value`);
  if (arg === '--json') jsonOut = next();
  else if (arg === '--deck') deckIds.push(next());
  else if (arg === '--originals') originalsDir = next();
  else if (arg === '--help' || arg === '-h') usage();
  else if (arg.startsWith('--')) usage(`Unknown option ${arg}`);
  else if (!input) input = arg;
  else usage(`Unexpected argument ${arg}`);
}
if (!input) usage();

function parseSnapshot(text: string): CompletenessSnapshot {
  let parsed = JSON.parse(text) as unknown;
  // IndexedDB record wrapper: { json: string, revision?, at }.
  if (parsed && typeof parsed === 'object' && typeof (parsed as { json?: unknown }).json === 'string') {
    parsed = JSON.parse((parsed as { json: string }).json) as unknown;
  }
  const snap = parsed as CompletenessSnapshot;
  if (!snap || !Array.isArray(snap.decks) || !Array.isArray(snap.companies) || !Array.isArray(snap.cards)) {
    throw new Error('Not a Stratemark research snapshot (expected decks, companies and cards arrays).');
  }
  return snap;
}

const snapshot = parseSnapshot(readFileSync(resolve(base, input), 'utf8').replace(/^﻿/, ''));

if (originalsDir) {
  const dir = resolve(base, originalsDir);
  const known = new Set((snapshot.originalSourceAttempts ?? []).map((row) => row.id));
  const extra: OriginalSourceAttempt[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    try {
      const row = JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown;
      if (isOriginalSourceAttempt(row) && !known.has(row.id)) { extra.push(row); known.add(row.id); }
    } catch { /* an unreadable artifact is skipped, never guessed at */ }
  }
  snapshot.originalSourceAttempts = [...(snapshot.originalSourceAttempts ?? []), ...extra];
  console.error(`Merged ${extra.length} original-source attempt(s) from ${dir}.`);
}

const report = buildCompletenessReport(snapshot, deckIds.length ? { deckIds } : {});
const json = JSON.stringify(report, null, 2);
if (jsonOut === '-') {
  process.stdout.write(`${json}\n`);
} else {
  console.log(renderCompletenessTable(report));
  if (jsonOut) {
    const path = resolve(base, jsonOut);
    writeFileSync(path, `${json}\n`, 'utf8');
    console.log(`\nJSON report written to ${path}`);
  }
}
