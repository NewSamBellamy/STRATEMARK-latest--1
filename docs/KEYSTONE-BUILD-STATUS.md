# Keystone build status / next-session handoff

Updated: 2026-10-03 (local date). Implementation started; no full milestone is complete.

## Read first

1. [Consolidated build and test plan](../01_PROJECTS/Stratemark/Specs/Keystone-Build-and-Test-Plan.md)
2. [Research architecture and audited gaps](../01_PROJECTS/Stratemark/Specs/Keystone-Research-Architecture.md)
3. [Sentinel Market Position scoring](../01_PROJECTS/Stratemark/Specs/Keystone-Market-Position-Scoring.md)

Repository: `C:/Users/shann/Documents/Codex/2026-09-28/i-x20/work/stratemark-card-redesign-revival`.
Branch: `revival/initial-card-redesign`. Preserve main and unrelated local work.

## Actually completed

- `a8f0d15`: source-priority prompts, hostname-based classification hardening, local scoped grounded notes and Ask reuse. Not independent claim verification or a raw-document vault.
- `a3f2216`: architecture audit and phased specification.
- `60ca414`: proposed 1-99 deck-relative scoring methodology, common-basis/reranking rules. Not implemented.
- Current planning slice: consolidated company/finding journeys, four finding-card requirements, execution order, acceptance gates, performance/cost measurements and continuity notes. No application code changed.
- First K1 implementation slice: verification rejects inconclusive/inconsistent verdict-value pairs and invalid negative/non-finite shortcut values. Completed attempts have a separate additive `lastVerificationAttemptAt`; only supported outcomes advance `lastVerifiedAt`, and inconclusive downgrades preserve the original capture date. Scheduling respects attempt cooldown without claiming renewed support. Scoped verification notes persist before structuring, including structuring failure. Valid cited corrections retain the zero-additional-call shortcut. Original-document validation is NOT implemented by this slice.

## Known verification / blockers

The previous Back-to-card failure did not reproduce: isolated journey and the complete 133-test web suite passed. Do not claim it was fixed; cause remains unconfirmed. First implementation regressions were observed failing before the fix: unsupported number mutation, false successful-verification timestamps, retry backoff, invalid shortcut values and loss of notes on structuring failure. Focused verification suite now passes 20 tests; freshness suite passes 17. Full-project gate results are recorded in the checkpoint document. Live provider audits without credentials self-skip and are NOT RUN, not accuracy evidence.

[Checkpoint 01](KEYSTONE-CHECKPOINT-01.md): final `pnpm check` exited 0 (types, lint and all unit suites). No measured live latency gain or independent factual-accuracy claim. No installer run or full browser recording yet.

Preview `http://127.0.0.1:4174/` was already served from this worktree; no process was killed/replaced. Homepage/sidebar render in the in-app browser. Shared-module hot reload emitted RepositoryProvider context errors during edits; a clean reload rendered correctly, with no newer errors observed. Keep this development limitation on the K0 investigation list. No paid deck/dashboard journey was triggered in the browser; card visual baselines, recording and latency benchmarks remain pending.

GitHub push was blocked by Windows/Git authentication. Local checkpoint is not a remote backup. Existing untracked `.pnpm-store/` and `docs/KEYSTONE-CATEGORY-BASELINE.md` must not be swept into commits or deleted casually.

## Next bounded task

K0 remaining: capture approved card/reader baseline and affected-journey recording using isolated no-key fixture state; measure labelled timings/call counts; investigate hot-reload context identity. Keep trying to reproduce prior navigation failure without weakening its assertion.

K1 next: original-source retrieval and typed evidence receipts with entity/value/period/definition checks -> accepted fact -> matching card/reader. Current citation-grade filtering still does not prove an original page supports a figure. Audit other ingestion/verification paths before calling this shared or complete. No scoring UI/provider fleet/connector scaffolding yet.

Live tests need explicit scope/spend approval before invoking user research credits. Never expose keys. Source count is not confidence; an unrated private company is not a weak company. Save full evidence while compacting session notes well before the context boundary.

## Milestones

| Milestone | State |
| --- | --- |
| K0 Baseline and navigation | In progress: tests/homepage checked; visual journey and timings pending |
| K1 Evidence correctness, card+reader | In progress: verdict/freshness integrity slice implemented |
| K2 Durable queryable dossiers | Not started |
| K3 Sentinel/Scouts, first-ready latency, branding | Not started |
| K4 Complete coherent company dashboards | Not started |
| K5 Specialist stories/reports/shards | Not started |
| K6 Deterministic cohort scoring | Not started |
| K7 Tested single/mixed-provider routes | Not started |
| K8 Meaningful opt-in monitoring | Not started |
| K9 Connector and release hardening | Not started |

At handoff update only with verified facts: last commit, files changed, implemented behavior, tests/run type, measurements, spend if known, blocker and next action. Record founder-approved design decisions; never call planned work completed.
