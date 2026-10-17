#!/usr/bin/env node
/**
 * Change the hosted research budget and redeploy in one step.
 *
 *   pnpm --filter @mi/stratemark-api budget 250        # $250/day total
 *   pnpm --filter @mi/stratemark-api budget 250 30     # ...and $30/day per visitor
 *
 * Edits wrangler.toml (so the value is kept in git and survives later
 * deploys), then runs `wrangler deploy`. Takes effect within seconds.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [total, visitor] = process.argv.slice(2).map(Number);
if (!Number.isFinite(total) || total <= 0 || (visitor !== undefined && (!Number.isFinite(visitor) || visitor <= 0))) {
  console.error('Usage: budget <total-usd-per-day> [per-visitor-usd-per-day]');
  process.exit(1);
}
const file = fileURLToPath(new URL('../wrangler.toml', import.meta.url));
let toml = readFileSync(file, 'utf8');
toml = toml.replace(/^DAILY_BUDGET_USD = ".*"$/m, `DAILY_BUDGET_USD = "${total}"`);
if (visitor !== undefined) toml = toml.replace(/^DAILY_VISITOR_BUDGET_USD = ".*"$/m, `DAILY_VISITOR_BUDGET_USD = "${visitor}"`);
writeFileSync(file, toml);
console.log(`Budget set to $${total}/day${visitor !== undefined ? `, $${visitor}/day per visitor` : ''}. Deploying…`);
execSync('npx wrangler deploy', { stdio: 'inherit', cwd: fileURLToPath(new URL('..', import.meta.url)), shell: true });
