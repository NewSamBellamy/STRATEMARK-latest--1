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
| `GET /health` | status, budget and keys (shape only, never the key); the day's spend and visitor count are read at most once every 10 seconds per isolate |

Everything except `GET /health`, `GET /s/...` and `GET /v1/share/<id>` requires a browser `Origin` on the
allow-list (`ALLOWED_ORIGINS`); a picture shown by an `<img>` tag sends none, so for `GET /v1/image` the page's
`Referer` stands in. Origin is a courtesy, not authentication: the daily caps are what bound cost.

### What the budget meters

A hosted Gemini call is parsed, not read as text (`src/gemini-request.ts`). Only what the research client sends is
accepted: text turns, a system instruction, the Google Search tool, and a few generation settings. Media by address
(`fileData`), other tools (`googleMaps`, retrieval variants, code execution, URL context), cached content, more than
one candidate and any unknown field are refused with 400 before a cent is held. What Google receives is rebuilt from
what was accepted, with the answer capped (32,768 tokens) and thinking capped (16,384). The hold taken before the call
is one token per UTF-8 byte of the rebuilt request (no tokenizer emits more tokens than bytes; for ASCII that is one per character), plus the most the rebuilt request can answer, plus twelve searches if it
is grounded; the call settles to what Google reports (a reply with no usage report is charged at the hold, and a reply
that searched is charged the grounding rate whether or not it was asked to). A visitor is an IPv4 address or an IPv6
/64. `DAILY_BUDGET_USD = "0"` is a kill switch: every hosted call is refused. A budget setting that is set but is not a
number from 0 to 10,000 (a typo, a negative, `1e308`) fails closed the same way, and the 402 and `/health` (`budgetMisconfigured`)
say which setting; an unset one is the default. A call that crosses UTC midnight adds
its cost to the new day and wipes nothing. The ledger tracks at most 5,000 visitors a day.

The readers (`/v1/source`, `/v1/asset-source`, `/v1/image`, `/v1/preview`, `/v1/news`, `/v1/search`) spend no Gemini
money, so they are limited per visitor instead: 240 reads a minute and 6,000 a day (`src/reader-quota.ts`, one
Durable Object per visitor). A deck of 18 companies makes a few hundred reads in three minutes. Reading a share link
(`GET /s/<id>`, `/s/<id>/og.png`, `GET /v1/share/<id>`) counts against the same limit, so a loop over made-up ids makes at most
240 Durable Objects a minute from one visitor (an honest viewer makes two reads; a chat app's crawlers arrive from many addresses).

## Share links

A share is a card or a deck, read-only, with its research. The browser packs it (deflated JSON, so the
Worker never parses research), draws the preview picture, and `POST`s both. The Worker keeps it in one
Durable Object per share (named by a random 96-bit id) for `SHARE_TTL_DAYS` (default 90), then the object
deletes itself. People open `https://<worker>/s/<id>`: chat apps read the preview tags from it, a browser is
sent on to the viewer (`share.html?s=<id>` on the app's own address), and the viewer fetches the research by
id. The owner can stop a share at any time from the Share dialog (the token stays in that browser).

Limits, all in `src/share-policy.ts`: 2 MB of compressed research (a real 18-company deck is about 180 KB), a
500 KB picture (it must be a real PNG with a sane size), 20 shares and 40 MB per visitor per UTC day, 3,000
shares per day in all. A visitor is an IPv4 address or an IPv6 /64 (`src/visitor.ts`), for these limits and for
the dollar budget alike, because one machine on IPv6 can rotate through a whole /64 at will. Nothing a stopped
share left behind is cached: the research and the link page are `no-store`/`no-cache`, the picture lives one
minute. Text a sender types is stripped of control, invisible (every default-ignorable and format character, tag characters included) and direction-changing characters. The viewer address
must be a `share.html` on the same allowed origin that made the request, so a share cannot send a visitor
somewhere else. Every sender-typed string is stripped of control characters and escaped in the one HTML page
the Worker writes, which has no script and a locked-down content policy.

What a visitor sees is not what the sender sent. The viewer holds a share to the same rules as the app's own research
(`apps/web/src/lib/share/receive.ts`): a figure is only as verified as its sources make it, "user verified" is never
honoured (no person on that machine checked it), an allegation with no clickable source is dropped, every link must be
a plain web address, and the live-site embed is never offered. The share page also carries its own content-security
policy (`features/share/viewer/csp.ts`): it may call only itself, the public reference sources and this Worker.

Privacy: this is the one thing the Worker stores. It is created only when a person presses "Create link", the
dialog says so, and the beta page says so. Everything else passes through and is never stored or logged.

## Deploy

```bash
cd services/stratemark-api
npx wrangler login                       # once, with the owner's Cloudflare account
npx wrangler secret put GEMINI_API_KEY   # the hosted research key
npx wrangler secret put SERPER_API_KEY   # optional: hosted web search
```

1. In `wrangler.toml`, set `ALLOWED_ORIGINS` to the address the beta app is served from (the default is `getstratemark.com` and its subdomains only; a shared-host name such as `stratemark.pages.dev` is left out on purpose until you own it) (for example
   `https://stratemark.web.app`). Share links are created from that origin and the viewer must be on it.
   Never add a shared-hosting wildcard such as `*.pages.dev` or `*.web.app`: anyone could host a page there.
2. `npx wrangler deploy`. The first deploy applies migrations `v2` (the two share classes) and `v3` (the reader
   limits); no other resource needs creating first.
3. Build the app against the Worker and deploy it (`firebase.json` serves `apps/web/dist`, which holds
   `index.html` and `share.html`):

   ```bash
   VITE_STRATEMARK_API_URL=https://stratemark-api.<account>.workers.dev pnpm --filter @mi/web build
   firebase deploy --only hosting
   ```
4. Check the whole beta from the outside (the Worker, its key and budget, who may call it, a real share made and
   stopped, the app and its share viewer, and what the build was built against). It spends nothing and exits
   non-zero if something that must be true is not:

   ```bash
   node scripts/launch-preflight.mjs https://stratemark-api.<account>.workers.dev https://<the app address>
   ```

   (`node services/stratemark-api/scripts/share-smoke.mjs <worker> <app origin>` runs just the share checks.)

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
