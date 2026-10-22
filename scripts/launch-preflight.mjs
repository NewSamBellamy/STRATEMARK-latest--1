#!/usr/bin/env node
/**
 * Is the beta actually set up? Run this against the deployed Worker and the deployed app before telling anyone.
 *
 *   node scripts/launch-preflight.mjs https://stratemark-api.<account>.workers.dev https://<the app address>
 *
 * It checks, from the outside, what a visitor and a chat app would hit: the Worker answers and holds a hosted
 * research key, the app's address is allowed to call it (and a stranger's is not), a real share can be made, read,
 * and stopped, the app serves its pages and its share viewer, the build points at this Worker and carries no
 * localhost address or key, and the private-preview gate is in the state you meant. It prints every check and exits
 * non-zero if anything that must be true is not. It spends nothing: no research is run.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const worker = (process.argv[2] ?? '').replace(/\/+$/, '');
const app = (process.argv[3] ?? '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(worker) || !/^https?:\/\//.test(app)) {
  console.error('Usage: node scripts/launch-preflight.mjs <worker address> <app address>');
  process.exit(2);
}
const appOrigin = new URL(app).origin;

let failed = 0;
let warned = 0;
const ok = (name) => console.log(`ok    ${name}`);
const warn = (name, detail = '') => { warned += 1; console.log(`warn  ${name}${detail ? ` - ${detail}` : ''}`); };
const bad = (name, detail = '') => { failed += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ''}`); };
const check = (name, pass, detail = '') => (pass ? ok(name) : bad(name, detail));

async function get(url, init) {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000), ...init });
    return { response, text: await response.text().catch(() => '') };
  } catch (error) {
    return { response: null, text: '', error: error instanceof Error ? error.message : String(error) };
  }
}

// ---- The Worker -------------------------------------------------------------------------------
console.log(`\nWorker  ${worker}`);
const health = await get(`${worker}/health`);
check('the Worker answers /health', health.response?.status === 200, health.error ?? String(health.response?.status));
let info = {};
try { info = JSON.parse(health.text); } catch { /* reported below */ }
check('/health is the Stratemark Worker', info.ok === true && 'budgetUsd' in info, health.text.slice(0, 80));
if (info.hostedResearch === true) {
  ok('hosted research has a key (GEMINI_API_KEY is set)');
  check('the key has the shape of a Google AI Studio key', info.keyLooksValid === true, `length ${info.keyLength}`);
} else {
  bad('hosted research has no key: visitors without their own key cannot research', 'run: npx wrangler secret put GEMINI_API_KEY');
}
console.log(`      daily budget $${info.budgetUsd} in all, $${info.visitorBudgetUsd} a visitor; spent today $${info.spentTodayUsd ?? '?'} by ${info.visitorsToday ?? '?'} visitors`);
check('the daily budget is a sane number (1 to 1000 dollars)', info.budgetUsd >= 1 && info.budgetUsd <= 1000, String(info.budgetUsd));
const problems = Array.isArray(info.budgetMisconfigured) ? info.budgetMisconfigured : info.budgetMisconfigured ? [String(info.budgetMisconfigured)] : [];
check('the Worker reports no budget misconfiguration', problems.length === 0, problems.join('; '));
// The app's covered amount is read from its source text (this script does not import web code).
let coveredUsd = null;
try {
  const beta = readFileSync(fileURLToPath(new URL('../apps/web/src/lib/beta.ts', import.meta.url)), 'utf8');
  const match = /COVERED_USAGE_USD\s*=\s*([0-9]+(?:\.[0-9]+)?)/.exec(beta);
  coveredUsd = match ? Number(match[1]) : null;
} catch { /* falls back to a positive-number check below */ }
console.log(`      lifetime allowance per visitor $${info.lifetimeVisitorBudgetUsd}${coveredUsd === null ? '' : `; the app says $${coveredUsd} is covered`}`);
check('the Worker\'s lifetime allowance matches the covered amount the app promises',
  typeof info.lifetimeVisitorBudgetUsd === 'number' && info.lifetimeVisitorBudgetUsd > 0
    && (coveredUsd === null || info.lifetimeVisitorBudgetUsd === coveredUsd),
  `Worker ${info.lifetimeVisitorBudgetUsd}, app ${coveredUsd ?? 'unread'}`);
check('one visitor cannot spend the whole day (visitor budget below the daily budget)', info.visitorBudgetUsd > 0 && info.visitorBudgetUsd < info.budgetUsd, String(info.visitorBudgetUsd));

// The dollar meter: a request for a feature it cannot see must be refused before anything is held or sent to Google
// (a Maps tool request; an older Worker would have forwarded it). It spends nothing either way.
if (info.hostedResearch === true) {
  const maps = await get(`${worker}/v1/gemini/gemini-flash-lite-latest:generateContent`, {
    method: 'POST', headers: { Origin: appOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: 'preflight' }] }], tools: [{ googleMaps: {} }] }),
  });
  check('the Worker refuses a request for a billed feature its meter cannot see (it parses and rebuilds requests)', maps.response?.status === 400,
    `got ${maps.response?.status}: deploy the spend-meter hardening (services/stratemark-api) before launch`);
}

const allowed = await get(`${worker}/v1/news`, { method: 'OPTIONS', headers: { Origin: appOrigin, 'Access-Control-Request-Method': 'POST' } });
check('the app\'s address is allowed to call the Worker', allowed.response?.status === 204 && allowed.response.headers.get('access-control-allow-origin') === appOrigin,
  `got ${allowed.response?.status}: add ${appOrigin} to ALLOWED_ORIGINS in services/stratemark-api/wrangler.toml and deploy`);
const stranger = await get(`${worker}/v1/news`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
check('a stranger\'s address is refused', stranger.response?.status === 403, String(stranger.response?.status));
const wildcard = await get(`${worker}/v1/news`, { method: 'OPTIONS', headers: { Origin: 'https://anything-at-all.web.app', 'Access-Control-Request-Method': 'POST' } });
check('no shared-hosting wildcard is allowed (anyone could host a page there)', wildcard.response?.status === 403, String(wildcard.response?.status));

// ---- Share links, end to end ------------------------------------------------------------------
console.log('\nShare links');
const smoke = spawnSync(process.execPath, [fileURLToPath(new URL('../services/stratemark-api/scripts/share-smoke.mjs', import.meta.url)), worker, appOrigin], { encoding: 'utf8' });
const failedChecks = (smoke.stdout.match(/^FAIL .*/gm) ?? []);
check('a real share is made, read back every way, stopped, and the refusals hold (share-smoke)', smoke.status === 0, failedChecks.slice(0, 3).join(' | ') || smoke.stderr.slice(0, 200));

// ---- The app ----------------------------------------------------------------------------------
console.log(`\nApp  ${app}`);
const index = await get(`${app}/`);
check('the app\'s address serves the app', index.response?.status === 200 && /<div id="root"/.test(index.text), index.error ?? String(index.response?.status));
// Headers the hosting is meant to send (firebase.json): warnings, not failures, since the app may be served by something else.
if (index.response) {
  const sent = (name) => index.response.headers.get(name) ?? '';
  if (/nosniff/i.test(sent('x-content-type-options'))) ok('the app is served with X-Content-Type-Options: nosniff');
  else warn('the app is not served with X-Content-Type-Options: nosniff', 'deploy firebase.json (hosting headers), or add it where the app is hosted');
  if (/no-cache|no-store|max-age=0/i.test(sent('cache-control'))) ok('the app page is revalidated on every visit, so a fix reaches people at once');
  else warn('the app page can be cached by a browser, so a fix may take up to an hour to reach people', `cache-control: ${sent('cache-control') || '(none)'}`);
}
const share = await get(`${app}/share.html`);
check('the share viewer is deployed (share.html)', share.response?.status === 200 && /stratemark-share-data/.test(share.text), String(share.response?.status));
check('the share viewer carries its content-security policy and may call this Worker', /http-equiv="Content-Security-Policy"/.test(share.text) && share.text.includes(new URL(worker).origin),
  'rebuild with VITE_STRATEMARK_API_URL=' + worker + ' (the policy is written in at build time)');
const scripts = [...index.text.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => new URL(m[1], `${app}/`).href);
let bundle = '';
for (const src of scripts.slice(0, 6)) bundle += (await get(src)).text;
if (!bundle) {
  warn('could not read the app\'s script files to inspect the build', 'is this a dev server?');
} else {
  check('the build points at this Worker (VITE_STRATEMARK_API_URL was set when it was built)', bundle.includes(worker), 'rebuild with VITE_STRATEMARK_API_URL=' + worker);
  check('the build has no localhost address baked in', !/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/v1/.test(bundle), 'a dev address is in the bundle');
  check('the build carries no Google API key', !/AIza[0-9A-Za-z_-]{35}/.test(bundle), 'a key-shaped string is in the bundle');
  const gated = /mi\.access\.v1/.test(bundle);
  console.log(`      private-preview gate: ${gated ? 'present in the build (visitors need an access code unless VITE_OPEN_ACCESS was set)' : 'not found in the build'}`);
}
const missing = await get(`${app}/this-page-does-not-exist-${Date.now()}`);
check('an unknown address still opens the app (single-page routing), not a server error', missing.response && missing.response.status < 500, String(missing.response?.status));

console.log(`\n${failed === 0 ? 'Ready.' : `${failed} check(s) failed: not ready.`}${warned ? ` ${warned} warning(s).` : ''}`);
process.exit(failed === 0 ? 0 : 1);
