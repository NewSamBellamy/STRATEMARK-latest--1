# Z Code four-slice build — completion record

Date: 2026-10-07. Builder: Z Code / GLM 5.3 Flash. Branch:
`fix/zcode-identity-gate-recovery` (11 commits ahead of the verified migration
checkpoint). This record accompanies `OCT06-ZCODE-PHASE1-METRIC-TRACE.md` and
the handoff's follow-up log.

## What was built, in order

| Commit | Slice | What |
|---|---|---|
| b85bc3a | 1 | Answer-level identity repair; number-parser '+' fix; zero-reject; free `recoverSavedCompanyMetrics`; living-runtime free recovery |
| e86ad2f | 2a+2b | Per-model quota buckets + acquire-per-retry (both Gemini clients); creation warm queue removed → on-demand dashboards |
| 5031f4e | 2d | Stage timings in the run log (discovery, per-company, total) |
| 06dfb3e | 1 audit | Label-anchored anonymous binding + rival alias expansion + name guard + paid-hunt fall-through (audit FIX-FIRST findings) |
| cddff16 | 1 audit | Markdown-decoration tolerance in claim labels |
| 57b08b2 | 3 | Shared ResearchMarkdown everywhere; LiveIntel empty action; "More" tab; honest copy |
| c2f8319 | 3 | One Unknown dialect (UnknownValue.tsx); ConfidenceBadge everywhere; explicit InsightReader deep-dive; SentinelRepository errors ≠ null |
| 0ca8fd7 | 3 gate | Mission & Governance crash fix (omitted model sections) + regression test |
| bcdb142 | 4 | pnpm-pin workflow fix; Electron crash handlers; TinyURL opt-in consent; export disclosure; release acceptance checklist |

## Verification record

- Workspace: **1,483 tests green** (contracts 108, mocks 15, research 758,
  api 293, desktop 44+1 skip, web 265), typecheck clean, lint clean.
- Code audit (Slice 1): FIX-FIRST verdict → every blocker/major fixed with a
  pinning test; yield re-measured (27 high-confidence rows / 42 profiles,
  precision over recall).
- Visual gate (Slice 3): ran the app in a browser, seeded the research vault,
  screenshotted deck + Overview/Metrics/History/Mission. Caught a real crash
  (Mission & Governance with omitted model sections) — fixed with a regression
  test. Screenshots retained at workspace `slice3-gate/` (outside the repo).
- Accuracy yield: replaying 42 retained profiles through the repaired
  validator recovers 27 metric rows with source receipts vs **0 before**.
- Latency claims now measurable (run-log timings); quota pacing is honest
  (every retry spends a slot); hidden warm spend eliminated.

## Slice 2c — implemented (commit 9e98014, after this record's first draft)

`discoverDeckStubs` decomposed into `interpretMarket`, `discoverMarket`
(back-compat alias `discoverWithCoverage` retained) and `buildStubs` phases.
Discovery streams each pass's SELECTED entities as ingestible stub cards via
`onInterpreted`/`onStubs`; the repository's hydration pool starts before
discovery, ingests stubs as they stream, and hydrates against real deck ids.
Pinned by a test: with the fallback discovery pass blocked on a gate, the
first entity's hydration grounds while discovery is still pending.

Hard lesson recorded: the first draft streamed RAW discovery candidates and
hydrated 8 entities the catalogMax cap would drop — pure waste, caught by the
overlap test before commit. The shipped design streams SELECTION deltas
(selectCandidates is monotonic-append on a growing list). Also landed with
this commit: dark-mode org-chart tokens and the shared evidence selector
(`latestSavedCompanyProfile`, newest-wins preserved).

## Deliberately NOT done (with reasons)

- **Export format upgrade** (zip carrying original-sources + images) — a
  feature with an import-migration blast radius; disclosed in the UI instead.
- **Auto-update, code signing** — decisions documented in the acceptance
  checklist; owner's call before tagging.
- **InsightReader deep-dive timeout** — the deep-dive now runs only on
  explicit request; a hang surfaces as a spinning button. A hard client-side
  timeout is queued for the next pass.

## Ship path from here

1. Owner executes `docs/OCT07-RELEASE-ACCEPTANCE-CHECKLIST.md` on a clean
   machine (includes the signing decision).
2. Merge `fix/zcode-identity-gate-recovery` → main by PR (pnpm check green).
3. Tag `v0.2.0`; confirm the release workflow builds installers.
4. Next pass: InsightReader deep-dive timeout, export zip format, auto-update
   wiring if the owner opts in.
