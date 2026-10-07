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

## Deliberately NOT done (with reasons)

- **Slice 2c (overlap hydration with discovery)** — deferred with a matured
  design: the streaming refactor collides with the stub-ingest ordering
  (repository.ts ~808-870 would duplicate cards/clobber metrics if hydration
  starts before ingest). Correct design recorded in the handoff memory:
  decompose `discoverDeckStubs` into interpretMarket/discoverMarket/buildStubs
  phases, keep the composition for compatibility, feed a hydration queue-pool
  from streamed stubs. Needs its own session + code audit.
- **Export format upgrade** (zip carrying original-sources + images) — a
  feature with an import-migration blast radius; disclosed in the UI instead.
- **Dark-mode org chart** — a dark-mode toggle EXISTS; hard-coded node colors
  in TeamOrgTab remain broken in dark mode. Queued (small, contained).
- **Auto-update, code signing** — decisions documented in the acceptance
  checklist; owner's call before tagging.

## Ship path from here

1. Owner executes `docs/OCT07-RELEASE-ACCEPTANCE-CHECKLIST.md` on a clean
   machine (includes the signing decision).
2. Merge `fix/zcode-identity-gate-recovery` → main by PR (pnpm check green).
3. Tag `v0.2.0`; confirm the release workflow builds installers.
4. Next build session: Slice 2c (design in handoff memory), dark-mode org
   chart, shared projector for saved-profile.ts/recoverSavedCompanyMetrics.
