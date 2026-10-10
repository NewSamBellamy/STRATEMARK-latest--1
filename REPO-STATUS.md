# Stratemark Production Hardening — Status

Updated: 2026-10-09 (speed architecture — third autonomous session)
Branch: `fix/zcode-identity-gate-recovery` — local commits only, never pushed.

## Speed architecture — WS0 baseline (measured, before any lane changes)

Harness: `packages/research/src/bench/` — runs the repo's REAL pipeline,
repository and acceptance gates headlessly on two fixed markets with a
scripted provider. Structural counts are the pipeline's call pattern;
wall-clock is a pacing floor projected from the free-tier limiter (10 grounded
/ 15 structured RPM, serial issue). Reports in `bench-out/`.

```
cd packages/research
BENCH_MODE=mock BENCH_MARKET="venture capital fund management" BENCH_OUT=../../bench-out npx vitest run src/bench/bench.run.test.ts
```

| Metric | VC fund management (financial) | Battery storage (operating) |
|---|---|---|
| Provider calls / deck (creation) | 19 (9 ground + 10 structure) | 19 (9g + 10s) |
| Provider calls / deck (hunt pass, 1 attempt per gapped entity) | 12 (6g + 6s) | 12 (6g + 6s) |
| Provider calls / deck (verify pass) | 12 (6g + 6s) | 0 (nothing left estimated) |
| Total calls to filled+hydrated deck | **43** | **31** |
| Time-to-first-card (projected) | ~12s | ~12s |
| Time-to-first-verified-figure (projected) | ~56s (first hunt fill) | ~56s |
| Time-to-filled-deck (projected, creation only) | ~0.9 min | ~0.9 min |
| Verified / estimated / unknown | 18 / 12 / 12 of 42 | 24 / 0 / 12 of 36 |

Live baseline (real key, real wall-clock): pending — will be recorded from the
running app before WS1/WS2 changes and appended per workstream below.

## Speed architecture — after WS0-WS6 (measured)

Structural counts are unchanged BY DESIGN: the pipeline still runs the same
creation → hunt → verify phases, and the bench's scripted provider drives every
phase regardless of which lane fills first. The speed delta is WHERE figures
come from: structured lanes fill them with **zero provider calls**, so in the
live app each lane fill is a provider call that never happens.

**Live-verified lanes (2026-10-09, `LIVE_LANES=1`, no key needed — these lanes
are plain HTTPS against official endpoints):**

| Lane | Live result | Provider calls |
|---|---|---|
| SEC Form ADV | Andreessen Horowitz CRD 160489 — 738 employees, AUM $106,476,153,956 as of 2025-12-31, straight from the official PDF | **0** (was: a grounded hunt ladder per figure) |
| Market cap quote | Apple (AAPL) $4.9T estimated market cap = $336.64/share × 14,594,180,000 SEC-reported shares, honestly labeled a computation | **0** |
| SearXNG discovery | Absent container reported honestly, grounded fallback intact | 0 extra |

The live run caught and fixed three reader bugs the mock bench could never see
(`0813e1f`): JSON API responses were rejected at the content gate (IAPD search,
XBRL shares, Yahoo chart all dead), the ticker-map slice never fired because the
production flow appends `?lookup=`, and the ADV PDF arrives as
`application/octet-stream`. All three would have made the lanes dead-on-arrival
in production; each is locked by a regression test in
`src/original-source.node.test.ts`.

Per-deck savings at 6 financial entities (live arithmetic, not projection):
ADV lane replaces up to 2 grounded hunt ladders per firm (aum + employees) and
the quote lane replaces the market-cap ladder for any public company; the
market-batch fill caps cold-start at ONE grounded call per 8 companies before
any per-company hunt. Full pipeline live measurements (real wall-clock, real
key) are recorded in the WS7 section below as they are taken.

| Commit | What it does |
|---|---|
| `7476cb1` | WS0 — bench harness: real pipeline + gates headlessly, both markets, call counts by phase, pacing floor |
| `826c08f` | WS2 — research-speed presets (free 10/15 or paid 60/120 RPM) as a user knob in Settings |
| `0a4d1be` | WS1/WS3/WS4 — structured-first lanes (SEC ADV PDF, Yahoo×SEC quote), SearXNG discovery lane, node-reader fetch memoization |
| `9ecc988` | WS5/WS6 — market-batch estimated fill (1 call / 8 companies) + cross-run evidence reuse between twin companies |
| `0813e1f` | WS7 — live-verified lane fixes: JSON evidence accepted, ticker-map lookup param, octet-stream ADV PDF |

## Scrape-first goal — judge split, completeness gate, asset lane (2026-10-10)

| Goal item | Landed as | Notes |
|---|---|---|
| Crawl4AI optional lane | `706bf5f` | Probe-gated on 127.0.0.1:11235 like SearXNG, memoized 5-min, second-chance reader for blocked/JS-shell pages; blocked receipts never retry; zero cost when absent. Run guide: docs/OPTIONAL-LANES.md |
| Judge-model split | `e927c78` | `judgeModel` setting (mi.geminiJudgeModel) — verification-class calls (metric verify, batch verify, red-team) route to the judge model when set; unset = byte-identical dispatch. Third call kind 'judge' for metering; server budget prices it as grounded-class. Settings: "Verification model (judge)" |
| Completeness gate | `b36943e` + `4474d0f` | `computeCompanyCompleteness` classifies every core slot (filled/unknown/absent); `ensureReportReadiness` runs evidence reuse → free recovery → one hunt per gapped company BEFORE any deep-dive is served (both call sites); failures never block the answer |
| Asset lane v1 | `706bf5f` + `4474d0f` + `94a209e` | Logos resolved from the company's own site with source URLs (declared icons → og:logo → verified favicon.ico), stored ONLY over guessed favicons during hydration (`fillCompanyAssets`, once per company per session); headshots from public team pages returned with provenance; raw-HTML dev bridge endpoint added |
| Vice-coverage fix | `aa09188` | Root cause: unconditional vice/culture discovery minimums burned free-tier RPM hunting entities that cannot exist in financial markets until the lead-card gate killed the deck. `signalRolesApply(plan)` reads the plan's words — financial/infra/B2B markets skip those roles entirely; consumer markets enforce as before (pinned by test) |
| Live lane verification | `0813e1f` | Three production bugs the mock bench could never see, caught live and locked with regression tests; lanes live-proven zero-provider-calls (table above) |

Suites: research **900** (+4 gated) · contracts **118** · web **271** · desktop **54** — all green, all typechecks clean.

## What changed this session (newest last)

| Commit | What it fixes |
|---|---|
| `9d8b1fc` | **Universal market fit — the ghost-town fix**: `aum` is a first-class MetricType end-to-end (gate, schemas, prompts, formatting, colors, deep-dive topics, USD conversion via the frozen FX table). New market-profile module (`packages/contracts/src/market-profile.ts`): `classifyMarketProfile` reads what the company IS from name + one-liner (never model-asserted; "platform for private equity" vendors excluded), `profileMetricTypes` decides what is worth researching per profile, `PROFILE_CORE_SLOTS` drives the four card slots. AUM rows appear only when sources actually report one — no AUM noise on operating companies. |
| `8247a4a` | **Search quality is metric fit**: hunts lead with the profile's priority metric (financial firm: AUM first); local + cloud hunts and escalation passes point at where regulatory AUM lives (SEC Form ADV / adviserinfo.sec.gov). A VC deck is never billed for an "a16z ARR" search again. |
| `61dede0` | **Cascade hydration UX**: the living deck warms ALL research tabs in open-likelihood order (metrics → overview → live_intel → mission_governance → history → team_org → products_roadmap → live_landing), still one paced action per tick with hunts/verifications first in line. New `HydratingPanel` — every tab's loading state is a named "Actively hydrating" skeleton with an honest clock, never a dead spinner. Tabs reveal with a staggered cascade (prefers-reduced-motion respected). Cards whose dashboards are researching right now carry a "Dashboards hydrating" chip. Latency guard re-verified: only the user-initiated rerun ever passes force. |

## Live verification (2026-10-09, dev server, owner key)

Verified in the running app on two real decks:
- **Venture Capital Fund Management (financial)**: a16z/Sequoia/Insight/Founders Fund/Lightspeed/Accel/NEA/Bessemer cards render the financial profile — AUM slot where Users used to be, employees/valuation/revenue intact. Desks hunt AUM (feed: "hunting missing figures"); gaps stay honestly Unknown until a source clears the gate ("nothing met the sourcing bar; gaps remain unknown"). a16z metrics tab opens in ~1.7s (pure local projection).
- **Utility-Scale BESS (operating)**: Tesla ($94.8B revenue, $1.5T market cap, 134.8K employees), Fluence ($148M ARR) — original four slots, verified figures, **zero AUM mentions anywhere** in the deck.
- **Cascade UX live**: cold-opening a16z Live Intel showed the "Actively hydrating — Live Intel" panel with section skeletons, then filled in; team_org opened instantly from the warm cache; tab nav shows the background order ("Researching Live Intel · Mission & Governance…").
- Gates intact throughout: no figure appeared without a source.

Findings from live testing (documented, not fixed here):
1. **AUM landing is ladder-paced**: hunt attempt 1 on financial firms returns honest nothings until the escalation pass (10-min cooldown, Form ADV targeting) — expect AUM to fill over a session, not instantly. Watch: if escalated attempts still never land, the original-source selection for ADV/firm pages is the next lever.
2. **Multi-tab same-workspace is single-writer**: opening two decks in two tabs trips the IndexedDB revision guard ("Research was updated in another window") and background turns skip gracefully. One window per workspace until a merge layer is worth building.

## Prior session (hardening, 2026-10-09)

| Commit | What it fixes |
|---|---|
| `a63272b` | **P0 — rate pacing**: outbound calls paced at 10 grounded / 15 structured RPM (were 0 = fire-everything → 429 storms → reactive-backoff "flaky" feel). Reactive retry retained. |
| `2b2f4ac` | **P0 — reader timeout**: each original-source read is raced against 20s; a hung page degrades to an unavailable receipt instead of stalling a hunt/verification forever. |
| `01475d1` | **P0 — currency normalization**: non-USD reporters (CNY/EUR/GBP/JPY/…) can finally reach **verified**. The quote stays primary evidence in the source's currency (17 convertible codes on `passageSupport.unit`); metric rows store a USD conversion at a frozen documented snapshot (`packages/research/src/fx.ts`, exchangerate-api.com 2026-10-09) with an honest "Reported X CNY, ≈US$Y at reference rate (source); conversion is approximate" methodNote. All store sites + prompts updated. |
| `4e40597` | **P1 — passage gate reads how sources write**: accepts press verbs (posted/reached/generated/said/serves/counts) and period-end date phrasings (as at / ended / ending). Deliberately NOT loosened: multi-sentence quotes, third-party brand aliases, that-clauses (anti-smuggling rules). |
| `425bc05` | **P1 — redirect name map**: ~30 publisher names Google actually sends (Yahoo Finance, Nikkei, SCMP, Barron's, TrendForce, wires, trade press…). Unresolved redirects still show "Publisher not recorded" — that visible gap is the record for growing the table during beta. |

Earlier this branch (prior session): verified-figure promotion unblocked
(`fa5866c`), hunt retry ladder + verify cooldowns (`9350dab`), worker-timer
background ticking (`01fdaa7`), fallback-ladder reserve fix (`3cc40d6`).

## Test state

- research **827** ✅ · contracts **118** ✅ · web **270** ✅ — all green, typecheck clean.
- Run per package (`cd packages/research && npx vitest run`); do NOT `pnpm -r test` (buffers and stalls on Windows).

## P1-3 verified — no change needed

Dashboard tabs already cache correctly: `getDashboardTab` serves cached tabs
with zero provider calls (metrics tab is a pure local projection from stored
metrics + retained SEC receipts), in-flight dedupe joins concurrent opens, the
90s deadline bounds a hung pass, and only the explicit Refresh button passes
`force=true`. Cache invalidation on metric change is by design (tabs quoting
stale facts must re-research).

## Known remaining gaps (priority order for beta week)

1. **estimated lane is still USD-only** — `reported-metrics.ts` hardcodes USD
   in its claim regexes (`hasNumber`, unit derivation), so provider-reported
   *estimated* figures in native currency stay unknown until the verified lane
   fills them. The verified (protected) lane now covers non-USD. Loosening the
   estimated lane needs the same normalize-at-store treatment plus regex work.
2. **AUM landing rate on financial decks** — mechanism verified live (slots,
   hunts, gates); the open question is yield: how often an escalated hunt finds
   a gate-clearing dated AUM passage. Beta signal to watch; ADV-page original
   selection is the lever if yield stays low.
3. **FX snapshot is frozen** — correct and auditable, but rates age. If decks
   need current-rate conversions, add a refresh job that rewrites the table +
   source date (never a live lookup inside the acceptance gate).
4. **Redirect publisher names** — table will keep growing from beta traffic;
   "Publisher not recorded" is the tell.
5. **Failed-job auto-resume** needs a product decision (auto-spend on page open?).
6. **Cross-run company evidence cache** — biggest cost/speed lever; not
   competition-blocking.
7. **Multi-tab single-writer** — two tabs on one workspace conflict on the
   IndexedDB vault revision (graceful skip + honest banner). Fine for beta
   single-window use.
8. **Dashboard tab overhaul** (owner unhappy with tab value) — product work,
   untouched here; caching verified so tab latency is not the blocker.

