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
- Second K1 slice: shared provenance recalculates credibility from URLs rather than trusting supplied labels, rejects malformed/credential-bearing citation URLs and removes machine verification from prose-only or unrecognized-source claims. Unknown niche citations remain inspectable. Reconciliation preserves human checks and stronger support/history when weaker automated observations repeat a value. Card/reader projections reject forged authority without rewriting legacy stored data. See [checkpoint 02](KEYSTONE-CHECKPOINT-02.md).
- Third K1 slice: local and cloud verification (including correction shortcuts) now use one pure shared transition. Invalid/inconsistent observations cannot revise numbers or refresh support dates; every completed attempt persists cooldown, human-reviewed fields remain locked, and real zero is not automatically a changed figure. Confirming an existing estimate now attaches evidence and updates confidence so views can reconcile, rather than only changing a timestamp. See [checkpoint 03](KEYSTONE-CHECKPOINT-03.md). Checkpoint 02 commit: `1b8c920`.

## Known verification / blockers

The previous Back-to-card failure did not reproduce: isolated journey and the complete 133-test web suite passed. Do not claim it was fixed; cause remains unconfirmed. First implementation regressions were observed failing before the fix: unsupported number mutation, false successful-verification timestamps, retry backoff, invalid shortcut values and loss of notes on structuring failure. Focused verification suite now passes 20 tests; freshness suite passes 17. Full-project gate results are recorded in the checkpoint document. Live provider audits without credentials self-skip and are NOT RUN, not accuracy evidence.

[Checkpoint 01](KEYSTONE-CHECKPOINT-01.md): final `pnpm check` exited 0 (types, lint and all unit suites). No measured live latency gain or independent factual-accuracy claim. No installer run or full browser recording yet.

[Checkpoint 02](KEYSTONE-CHECKPOINT-02.md): final `pnpm check` exited 0 after the source-authority changes and fixture corrections. Types and lint passed; contracts 92, mocks 15, research 296, desktop 27, API 158 and web 134 tests reported passing. Three credential-dependent research audits returned early and remain NOT RUN as live audits. No additional paid application research or visual redesign. Last preceding commit: `00ffad6`; checkpoint 02 is the subsequent local integrity slice.

[Checkpoint 03](KEYSTONE-CHECKPOINT-03.md): final `pnpm check` exited 0. Types and lint passed; contracts 92, mocks 15, research 296, desktop 27, API 172 and web 134 tests reported passing. Live credential-dependent audits returned early and remain NOT RUN. No paid research or UI redesign; fourteen API regression cases cover the shared transition and correction shortcut.

Preview `http://127.0.0.1:4174/` was already served from this worktree; no process was killed/replaced. Homepage/sidebar render in the in-app browser. Shared-module hot reload emitted RepositoryProvider context errors during edits; a clean reload rendered correctly, with no newer errors observed. Keep this development limitation on the K0 investigation list. No paid deck/dashboard journey was triggered in the browser; card visual baselines, recording and latency benchmarks remain pending.

GitHub push was blocked by Windows/Git authentication. Local checkpoint is not a remote backup. Existing untracked `.pnpm-store/` and `docs/KEYSTONE-CATEGORY-BASELINE.md` must not be swept into commits or deleted casually.

## Next bounded task

K0 remaining: capture approved card/reader baseline and affected-journey recording using isolated no-key fixture state; measure labelled timings/call counts; investigate hot-reload context identity. Keep trying to reproduce prior navigation failure without weakening its assertion.

K1 next: original-source retrieval and typed evidence receipts with entity/value/period/definition checks -> accepted fact -> matching card/reader. Local/cloud verification now share verdict/value/date rules, but current citation-grade filtering still does not prove an original page supports a figure. Official small-company sites not in the publisher list need identity-bound source validation, not blanket rejection or a model-supplied primary label. Matching-value observations also need explicit period/definition checks and immutable evidence history. Cloud scoped notes/cached-dashboard invalidation and other ingestion routes still need auditing; sharing the metric transition does not mean every research route is covered. No scoring UI/provider fleet/connector scaffolding yet.

The founder authorized use of the configured Gemini key for needed testing on checkpoint 03. Keep live tests bounded and explicitly distinguish them from mocks; do not run the entire live census or judge suite just because a key is available. No Gemini/Google key was present in the shell environment during checkpoint 03; browser/desktop credentials were not extracted or copied. Never expose keys. Source count is not confidence; an unrated private company is not a weak company. Save full evidence while compacting session notes well before the context boundary.

## Milestones

| Milestone | State |
| --- | --- |
| K0 Baseline and navigation | In progress: tests/homepage checked; visual journey and timings pending |
| K1 Evidence correctness, card+reader | In progress: shared local/cloud verdict/freshness and attribution/reconciliation protections; original-passage proof pending |
| K2 Durable queryable dossiers | Not started |
| K3 Sentinel/Scouts, first-ready latency, branding | Not started |
| K4 Complete coherent company dashboards | Not started |
| K5 Specialist stories/reports/shards | Not started |
| K6 Deterministic cohort scoring | Not started |
| K7 Tested single/mixed-provider routes | Not started |
| K8 Meaningful opt-in monitoring | Not started |
| K9 Connector and release hardening | Not started |

At handoff update only with verified facts: last commit, files changed, implemented behavior, tests/run type, measurements, spend if known, blocker and next action. Record founder-approved design decisions; never call planned work completed.
