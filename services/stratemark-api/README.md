# stratemark-api

The hosted half of the web beta: one Cloudflare Worker. It keeps the Gemini key off the
browser behind daily dollar caps, reads source pages and logos for the app, and stores the
share links people create.

## Routes

| Route | What it does |
|---|---|
| `POST /v1/gemini/<model>:generateContent` | Gemini on the server-held key, behind the daily budget |
| `POST /v1/search`, `POST /v1/news` | web-search and news discovery (the visitor's own key, or the hosted one on the budget) |
| `POST /v1/source`, `POST /v1/asset-source`, `GET /v1/image`, `GET /v1/preview` | page, logo and picture readers (public https only, no private addresses) |
| `POST /v1/share` | store a read-only share the browser made; answers its link and the token that stops it |
| `GET /v1/share/<id>` | a share's compressed research, readable by any origin once you hold the id |
| `DELETE /v1/share/<id>` | stop sharing (needs the token from creation) |
| `GET /s/<id>` and `GET /s/<id>/og.png` | the link people paste: preview tags and a hand-off to the viewer, and the preview picture |
| `GET /health` | status, budget and keys (shape only, never the key) |

Everything except `GET /health`, `GET /s/...` and `GET /v1/share/<id>` requires a browser `Origin` on the
allow-list (`ALLOWED_ORIGINS`). Origin is a courtesy, not authentication: the daily caps are what bound cost.

## Share links

A share is a card or a deck, read-only, with its research. The browser packs it (deflated JSON, so the
Worker never parses research), draws the preview picture, and `POST`s both. The Worker keeps it in one
Durable Object per share (named by a random 96-bit id) for `SHARE_TTL_DAYS` (default 90), then the object
deletes itself. People open `https://<worker>/s/<id>`: chat apps read the preview tags from it, a browser is
sent on to the viewer (`share.html?s=<id>` on the app's own address), and the viewer fetches the research by
id. The owner can stop a share at any time from the Share dialog (the token stays in that browser).

Limits, all in `src/share-policy.ts`: 2 MB of compressed research (a real 18-company deck is about 180 KB), a
500 KB picture, 20 shares and 40 MB per visitor per UTC day, 3,000 shares per day in all. The viewer address
must be a `share.html` on the same allowed origin that made the request, so a share cannot send a visitor
somewhere else. Every sender-typed string is stripped of control characters and escaped in the one HTML page
the Worker writes, which has no script and a locked-down content policy.

Privacy: this is the one thing the Worker stores. It is created only when a person presses "Create link", the
dialog says so, and the beta page says so. Everything else passes through and is never stored or logged.

## Deploy

```bash
cd services/stratemark-api
npx wrangler login                       # once, with the owner's Cloudflare account
npx wrangler secret put GEMINI_API_KEY   # the hosted research key
npx wrangler secret put SERPER_API_KEY   # optional: hosted web search
```

1. In `wrangler.toml`, set `ALLOWED_ORIGINS` to the address the beta app is served from (for example
   `https://stratemark.web.app`). Share links are created from that origin and the viewer must be on it.
   Never add a shared-hosting wildcard such as `*.pages.dev` or `*.web.app`: anyone could host a page there.
2. `npx wrangler deploy`. The first deploy after this change applies migration `v2` (the two share classes);
   no other resource needs creating first.
3. Build the app against the Worker and deploy it (`firebase.json` serves `apps/web/dist`, which holds
   `index.html` and `share.html`):

   ```bash
   VITE_STRATEMARK_API_URL=https://stratemark-api.<account>.workers.dev pnpm --filter @mi/web build
   firebase deploy --only hosting
   ```
4. Check it end to end, with a real share made and read back and stopped:

   ```bash
   node scripts/share-smoke.mjs https://stratemark-api.<account>.workers.dev https://<the app origin>
   ```

Optional: serve share links from your own domain (for example `share.getstratemark.com`) by adding a route
to the Worker in the Cloudflare dashboard and setting `SHARE_PUBLIC_BASE = "https://share.getstratemark.com"`.

## Develop

```bash
npx wrangler dev --local --port 8787 --var ALLOW_LOCALHOST:true
VITE_STRATEMARK_API_URL=http://127.0.0.1:8787 pnpm --filter @mi/web dev
node scripts/share-smoke.mjs        # against the local Worker (real Durable Objects)
pnpm --filter @mi/stratemark-api test:run
```

A free Workers plan allows 10 ms of CPU per request; the share routes avoid parsing research and keep bodies
small for that reason.
