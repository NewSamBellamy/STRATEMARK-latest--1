# Stratemark — Z Code handoff to Claude Code

**Handoff written:** 2026-10-08, ~00:15 (end of the third overnight autonomous session).
**Built by:** Z Code (GLM 5.3 orchestrator + subagents), 2026-10-06 → 2026-10-08, after migration from Codex.
**Branch:** everything below lives on `fix/zcode-identity-gate-recovery` (local) and is mirrored
to `zcode-handoff-to-claude-code` — pushed to `newsam` (github.com/NewSamBellamy/STRATEMARK-latest--1).
`main` was never touched. Tip at handoff time: `4f46045`.

---

## 1. What Stratemark is (purpose)

Stratemark is a **grounded market-intelligence deck builder**. The user types a market
(e.g. "eVTOL aircraft and urban air mobility", optionally exact company names) and the
product researches a live competitive deck:

- It **discovers the real participants** in that market (operating companies, compute
  infrastructure, distribution channels) via Google-Search-grounded calls.
- Every company gets a **card** whose front-of-card figures (market cap / valuation, ARR or
  revenue, employees, users, HQ, market share) carry **real citations with an honesty ladder**:
  `user_verified` > `verified` (original-source confirmed) > `estimated` (source-reported) >
  `unknown` (honest blank). **No figure is ever invented** — an honest Unknown always beats an
  invented number. This is the product's core promise and is non-negotiable.
- Each card opens into **dashboards** (Overview, Metrics, Team & Org, Products & Roadmap,
  Research & Sources), plus market-level macro signal cards (barriers, insights), deck reports,
  deep-dives, and a red-team verification pass that re-checks figures against originals.
- It is **BYOK** (bring your own Gemini key): the key lives ONLY in the app's browser
  localStorage (`mi.geminiApiKey`) — never in chat, logs, commits, or handoff text.

**Direction the owner has set:** it should feel *fast, accurate, and alive* — metrics and logos
filling while you watch, dashboards hydrated before you click, then polish and a demo.

## 2. User journey (as built today)

1. **Landing / brief** — user enters a market prompt (+ optional exact-company scope) and a
   quota preset (free ≈10/15 RPM, paid ≈60/120 RPM; localStorage `mi.quotaPreset`).
2. **Creation (streamed)** — the pipeline interprets the market, discovers companies, and each
   company **stub streams into the deck immediately** with a stable id. While discovery is still
   running, three things start in parallel:
   - **Batched hydration**: one grounded search pass per ~3–5-company cohort, then per-company
     structured extraction (schema + provenance gates unchanged).
   - **Structured-lane prewarm** (zero provider calls): SEC Form ADV (AUM/headcount for financial
     firms), Yahoo chart × SEC XBRL shares (estimated market cap), starting the moment a stub lands.
   - **Asset prewarm**: real company logo from the company's own site (declared icons SVG →
     largest PNG → og:logo → verified favicon), with source URL, stored only over the gstatic
     favicon guess. Hydration never clobbers a real logo back to a guess.
3. **Deck reveal** — as soon as the first entity card finishes hydrating, the deck opens
   (creation continues in the background). The **lead company's Overview dashboard starts
   researching at that same moment** (Track 3 warm-up), so the first screen the user clicks is
   already warm; the rest of the roster's dashboards warm after core research drains.
4. **Living research** — the in-page living runtime keeps filling: missing-metric hunts
   (recovery → one hunt per gapped company), verification passes on the judge model, re-tiering,
   and completeness-driven research before any report/deep-dive is served.
5. **Depth on click** — dashboards hydrate on first open (cached thereafter; in-flight dedupe),
   deep-dives and reports run the completeness gate first, KB notes accept user facts as
   `user_verified`.

## 3. Architecture map (where things live)

```
packages/contracts   — schemas, provenance engine (acceptedMetricPassage, reconcileMetrics, CMS tiers)
packages/research    — the engine: pipeline, repository (GeminiRepository), company-agent,
                       lanes (sec-adv, market-quote, searxng, crawl4ai), assets, completeness,
                       bench harness (src/bench), original-source readers (node + browser)
apps/web             — React + Vite. In-browser GeminiRepository + IndexedDB vault
                       (stratemark.vault / mi.repo.v1.committed). Local dev plugins serve the
                       source/asset bridges (local-source-plugin.ts, /__stratemark/*).
apps/desktop         — Tauri-style desktop shell, atomic local-file store, ipc-repository.
apps/api             — Cloud Run budget guard (spend ceilings; not on the critical path).
docs/                — OPTIONAL-LANES.md (SearXNG + Crawl4AI containers), design docs.
REPO-STATUS.md       — running engineering status: measured baselines, WS tasks, bench tables.
```

**Model routing (judge split):** dashboards/verifications run on a configurable separate model
(localStorage `mi.geminiJudgeModel`; blank = research model). In-band routing: `verify:` topic
prefix or `RED-TEAM` prompt prefix routes to the judge ladder; a third CallMetrics kind
`judge` exists end-to-end.

## 4. What HAS been done (Z Code era, newest first)

**Speed step-changes (this final session, 2026-10-07/08):**
- `4f46045` **Batched hydration** — `hydrateCompanyCardsBatch`: one grounded pass per cohort
  (configurable `hydrationBatchMax`=5 / `hydrationFirstBatchMax`=3), per-company structure
  extraction over the shared notes; cohort failure requeues solo; duplicate-name guard with
  no-spin fallback. Cuts an 18-company deck from ~18 grounded passes to ~4–6.
- `4f46045` **Lane + logo prewarm at stub time** and **logo preservation** through hydration.
- `4f46045` **Track 3 dashboard warm-up** — lead overview at leadCardReady; rest post-drain;
  deliberately OUTSIDE the job-completion gate (can never re-create the zombie freeze).
- `6ec50c7` **Zombie-job freeze fix (live-caught)** — a hung job record held status 'running'
  forever and the runtime's canAct gate deferred card-filling indefinitely (cards stuck ~25%).
  Three layers: self-heal in `listResearchJobs`, per-job watchdog (`JOB_STALL_MS`=8min),
  staleness bound in the web creation gate (`CREATION_STALL_MS`=6min, NaN defers).

**Scrape-first architecture goal (2026-10-06/07, all live-verified):**
- Structured lanes with receipts: SEC Form ADV (`sec-adv`), Yahoo v8 chart × SEC XBRL shares
  (estimated market cap, "computation from two reported figures" methodNote) — zero provider calls.
- `LIVE_LANES=1` gated harness exercising real endpoints without a key; caught 3 real bugs
  (JSON content-type gate, ticker-map `cik_str`, ADV octet-stream) — each locked with regression tests.
- Asset lane v1: `resolveCompanyLogo` fallback ladder + `findTeamHeadshots` (bounded team-page
  ladder, name matching, chrome rejected); RAW-HTML read contract; honest null when unavailable.
- Crawl4AI optional container lane (probe `/health` on 127.0.0.1:11235, memoized, node-reader
  second-chance only for thin pages, blocked receipts never retried, re-passes safeUrl/DNS policy).
- Judge-model split (see above) + budget/meters extended with the `judge` kind.
- Completeness gate: `computeCompanyCompleteness` + `ensureReportReadiness` (reuse → recover →
  ONE hunt per gapped company) before any report or deep-dive is served.
- Vice-coverage fix: DEFAULT_COVERAGE vice/culture minimums no longer apply to financial markets
  (`signalRolesApply(plan)` reads the plan's own words) — this was burning the free-tier RPM on
  entities that cannot exist, which is what used to kill financial decks.

**Earlier Z Code sprints (owner's 23-item audit mostly closed):** security cleanup branch, SQLite
store, corpus retrieval, Overview redesign, SEC revenue charts, KB search, finish-line banner,
coverage explanations, users-asOf gate, deep-dives persisting as Reports.

**Test state at handoff (all green, run per package — NEVER `pnpm -r test` on Windows):**
- `packages/research`: **906 passed**, 4 skipped (the LIVE_LANES-gated live tests), +typecheck clean.
- `packages/contracts`: **118 passed**. `apps/web`: **273 passed**, typecheck clean. `apps/desktop`: **54 passed**.

## 5. What has NOT been done (honest list)

1. **Live wall-clock number for the batched creation path.** The batching, prewarm, and warm-up
   are implemented and unit/live-lane verified, but the headline before/after table for a FULL
   fresh deck on the owner's key has not been re-measured since `4f46045`. Previous live run
   (pre-batching): creation ≈10 min / 38 calls for 18 companies; batching should land ~3–4 min
   creation with cards visibly filling from lanes within the first minute. **First thing Claude
   Code should do: run one fresh deck with paid pacing and record the numbers.**
2. **Discovery is now the latency floor.** interpret + census are 2–3 slow grounded calls
   (~2–3.5 min). Next lever if the owner wants sub-minute-to-first-card: prefetch lanes during
   discovery (already possible — stubs stream early) and/or a faster discovery model.
3. **Headshots UI** — `findTeamHeadshots` exists and is tested; needs a Company schema field
   (v2) and a UI slot. Logos are live.
4. **factCheck still runs on filler models** — one-line follow-up to add `factCheckOutSchema`
   to the verification-schema set if the owner wants it judged.
5. **Crawl4AI / SearXNG containers** are optional feature-detected lanes; none is deployed
   anywhere yet (docs/OPTIONAL-LANES.md has the run commands).
6. **Owner calls still open:** site imagery, nav, push decision for the landing, generative-UI
   phase, quote provenance (from the audit).
7. **Desktop asset lane** — `assetSourceReader` is wired in the web app only; desktop passes
   nothing yet (favicon fallback stands there).

## 6. Rules Claude Code must keep (these are load-bearing)

- **No fabrication, ever.** `acceptedMetricPassage`, provenance enforcement, and
  "verified = citation-earned" stay intact. Fill decks by discovering the RIGHT figures, never
  by loosening gates. An honest Unknown beats an invented number.
- **API key** (`mi.geminiApiKey`) lives only in browser localStorage. Never in chat, logs,
  commits, or this doc.
- **Git:** do not push/merge/touch `main`. `.pnpm-store/` must NEVER be `git add`ed — always
  add explicit paths. (Both remotes `origin`/`tobi` belong to other people; `newsam` is the owner's.)
- **Tests:** run per package (`cd packages/research && npx vitest run` etc.). NEVER `pnpm -r test`
  (buffers and stalls on Windows).
- **Spending:** owner approved live runs on their key ("not worried about spending on that API key").

## 7. How to run

```bash
pnpm install
cd apps/web && pnpm dev          # http://localhost:5173 — paste a Gemini key in Settings
# optional lanes (feature-detected, never required): docs/OPTIONAL-LANES.md
# benchmarks (no key needed): BENCH_MODE=mock BENCH_MARKET="..." npx vitest run src/bench/bench.run.test.ts   (from packages/research)
```

Seeded demos: in-page vault (`stratemark.vault`), quota preset `mi.quotaPreset` ('free'|'paid'),
target companies `mi.targetCompanies` (2–30), judge model `mi.geminiJudgeModel`.

## 8. Suggested first week for Claude Code

1. Live-benchmark one fresh deck post-`4f46045`; record the before/after table into REPO-STATUS.
2. If creation still feels slow, attack discovery latency (fast model for interpret/census or
   lane prefetch during discovery).
3. Headshots v2 (Company schema field + card UI).
4. Quote provenance (owner-called).
5. Then polish for the demo (the owner's stated next milestone).
