#!/usr/bin/env node
/**
 * Share links, end to end against a running Worker (local `wrangler dev` or the deployed one).
 *
 *   node scripts/share-smoke.mjs                         # http://localhost:8787, origin http://localhost:5174
 *   node scripts/share-smoke.mjs https://<worker> https://<an allowed app origin>
 *
 * It makes one real share, reads it back every way a visitor or a chat app would, stops it, and
 * checks the refusals. It exits non-zero on the first thing that is not as the design says. The
 * local Worker needs ALLOW_LOCALHOST=true (`wrangler dev --var ALLOW_LOCALHOST:true`).
 */
const API = (process.argv[2] ?? 'http://localhost:8787').replace(/\/+$/, '');
const ORIGIN = process.argv[3] ?? 'http://localhost:5174';
const VIEWER = `${ORIGIN}/share.html`;

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`);
  if (!ok) failed += 1;
}

// A small but real PNG: 1x1.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const DATA = Buffer.from(JSON.stringify({ v: 1, kind: 'deck', note: 'x'.repeat(300) })).toString('base64url');

const post = (body, headers = {}) => fetch(`${API}/v1/share`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
const good = { v: 1, kind: 'deck', title: 'Smoke test deck', description: 'A deck made by share-smoke.', viewer: VIEWER, data: DATA, og: PNG };

const created = await post(good);
check('create answers 201', created.status === 201, String(created.status));
const info = await created.json();
check('create returns an id, a link, a picture link and a stop token', /^[A-Za-z0-9_-]{16}$/.test(info.id) && info.url?.endsWith(`/s/${info.id}`) && info.imageUrl?.endsWith('/og.png') && info.deleteToken?.length >= 16, JSON.stringify(info));

const id = info.id;
const page = await fetch(`${API}/s/${id}`);
const html = await page.text();
check('the pasted link opens without an Origin header', page.status === 200, String(page.status));
check('the page carries the preview tags and the hand-off', html.includes('og:title') && html.includes('Smoke test deck') && html.includes(`${VIEWER}?s=${id}`) && html.includes('og:image'));
check('the page has no script and is not indexable', !/<script/i.test(html) && /noindex/.test(html) && /noindex/.test(page.headers.get('x-robots-tag') ?? ''));
check('the page has a locked-down content policy', /default-src 'none'/.test(page.headers.get('content-security-policy') ?? ''));
const head = await fetch(`${API}/s/${id}`, { method: 'HEAD' });
check('a HEAD request (a link checker) is answered', head.status === 200, String(head.status));

const og = await fetch(`${API}/s/${id}/og.png`);
const png = Buffer.from(await og.arrayBuffer());
check('the preview picture is a PNG', og.status === 200 && og.headers.get('content-type') === 'image/png' && png.subarray(1, 4).toString() === 'PNG', String(og.status));

const read = await fetch(`${API}/v1/share/${id}`, { headers: { origin: 'https://some-other-site.example' } });
const body = await read.json();
check('the snapshot is readable by any origin, once you have the id', read.status === 200 && read.headers.get('access-control-allow-origin') === '*' && body.data === DATA && body.title === 'Smoke test deck', String(read.status));
check('the stop token is never in a read', !JSON.stringify(body).includes(info.deleteToken));

check('a made-up id is a plain 404', (await fetch(`${API}/s/AAAAAAAAAAAAAAAA`)).status === 404 && (await fetch(`${API}/v1/share/AAAAAAAAAAAAAAAA`)).status === 404);
const refusedShapes = [(await fetch(`${API}/v1/share/short`)).status, (await fetch(`${API}/s/..%2F..%2Fx`)).status];
check('an id of the wrong shape is refused before it reaches storage', refusedShapes.every((s) => s === 403 || s === 404), String(refusedShapes));

check('a create from an origin that is not allowed is refused', (await post(good, { origin: 'https://evil.example' })).status === 403);
check('a create with no Origin is refused', (await fetch(`${API}/v1/share`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(good) })).status === 403);
check('a viewer address on another origin is refused', (await post({ ...good, viewer: 'https://evil.example/share.html' })).status === 400);
check('a viewer address with a query is refused', (await post({ ...good, viewer: `${VIEWER}?x=1` })).status === 400);
check('a picture that is not a PNG is refused', (await post({ ...good, og: 'R0lGODlhAQABAAAAACw=' })).status === 400);
check('a body that is not JSON is refused', (await post('not json')).status === 400);
check('an oversized snapshot is refused with 413', (await post({ ...good, data: 'A'.repeat(2_100_000) })).status === 413);

const wrong = await fetch(`${API}/v1/share/${id}`, { method: 'DELETE', headers: { origin: ORIGIN, 'x-share-token': 'wrongtokenwrongtoken12' } });
check('stopping a share with the wrong token is refused', wrong.status === 403, String(wrong.status));
check('the share is still there after that', (await fetch(`${API}/v1/share/${id}`)).status === 200);
const none = await fetch(`${API}/v1/share/${id}`, { method: 'DELETE', headers: { origin: ORIGIN } });
check('stopping a share with no token is refused', none.status === 403, String(none.status));
const right = await fetch(`${API}/v1/share/${id}`, { method: 'DELETE', headers: { origin: ORIGIN, 'x-share-token': info.deleteToken } });
check('stopping a share with its token works', right.status === 200, String(right.status));
check('a stopped share is gone from the page, the data and the picture', (await fetch(`${API}/s/${id}`)).status === 404 && (await fetch(`${API}/v1/share/${id}`)).status === 404 && (await fetch(`${API}/s/${id}/og.png`)).status === 404);
const again = await fetch(`${API}/v1/share/${id}`, { method: 'DELETE', headers: { origin: ORIGIN, 'x-share-token': info.deleteToken } });
check('stopping it twice is a 404, not an error', again.status === 404, String(again.status));

const preflight = await fetch(`${API}/v1/share/${id}`, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'DELETE', 'access-control-request-headers': 'x-share-token' } });
check('the browser preflight for stopping a share is allowed', preflight.status === 204 && /DELETE/.test(preflight.headers.get('access-control-allow-methods') ?? '') && /x-share-token/i.test(preflight.headers.get('access-control-allow-headers') ?? ''), String(preflight.status));

console.log(failed === 0 ? '\nAll share checks passed.' : `\n${failed} share check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
