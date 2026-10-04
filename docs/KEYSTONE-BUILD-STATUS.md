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
- Fourth K1 slice: both Gemini adapters preserve provider passage-to-source mappings; scoped local records save them before structuring and return deep copies on retrieval. Original chunk indices survive missing-URL chunks; invalid mappings and text absent from the provider answer are excluded. No independent original-page validation or promotion from mappings alone. See [checkpoint 04](KEYSTONE-CHECKPOINT-04.md). Checkpoint 03 commit: `300008b`.
- Fifth checkpoint, bounded K2 safety detour: browser quota handling no longer discards researched dashboards/reports or acknowledges an unconfirmed vault backup. Full-snapshot writes succeed or throw a readable failure while retaining the prior primary copy. Retry and rejected-replica tests added; transactional storage and higher-level recovery are NOT complete. See [checkpoint 05](KEYSTONE-CHECKPOINT-05.md). Checkpoint 04 commit: `4e45476`.
- Sixth K1 slice: authenticated cloud metric verification retrieves up to two originals through a DNS-pinned, bounded HTTPS transport, saves scoped receipts before interpretation and supplies untrusted extracts to the existing model step. Firestore reload retains receipts; unavailable fetches do not manufacture text. Eight-attempt diagnostic retention only, not a permanent/local vault or exact claim verification. See [checkpoint 06](KEYSTONE-CHECKPOINT-06.md). Checkpoint 05 commit: `452abfa`.
- Seventh K1 slice: the same protected native transport is wired into desktop metric verification. Original extracts save as separately validated, non-overwritten local files before interpretation and are queryable by company/metric after restart. Browser entry stays native-free. Failed artifact saves stop interpretation; exact claim acceptance and artifact export/lifecycle remain unfinished. See [checkpoint 07](KEYSTONE-CHECKPOINT-07.md). Checkpoint 06 commit: `00a6f7c`.

## Known verification / blockers

The previous Back-to-card failure did not reproduce: isolated journey and the complete 133-test web suite passed. Do not claim it was fixed; cause remains unconfirmed. First implementation regressions were observed failing before the fix: unsupported number mutation, false successful-verification timestamps, retry backoff, invalid shortcut values and loss of notes on structuring failure. Focused verification suite now passes 20 tests; freshness suite passes 17. Full-project gate results are recorded in the checkpoint document. Live provider audits without credentials self-skip and are NOT RUN, not accuracy evidence.

[Checkpoint 01](KEYSTONE-CHECKPOINT-01.md): final `pnpm check` exited 0 (types, lint and all unit suites). No measured live latency gain or independent factual-accuracy claim. No installer run or full browser recording yet.

[Checkpoint 02](KEYSTONE-CHECKPOINT-02.md): final `pnpm check` exited 0 after the source-authority changes and fixture corrections. Types and lint passed; contracts 92, mocks 15, research 296, desktop 27, API 158 and web 134 tests reported passing. Three credential-dependent research audits returned early and remain NOT RUN as live audits. No additional paid application research or visual redesign. Last preceding commit: `00ffad6`; checkpoint 02 is the subsequent local integrity slice.

[Checkpoint 03](KEYSTONE-CHECKPOINT-03.md): final `pnpm check` exited 0. Types and lint passed; contracts 92, mocks 15, research 296, desktop 27, API 172 and web 134 tests reported passing. Live credential-dependent audits returned early and remain NOT RUN. No paid research or UI redesign; fourteen API regression cases cover the shared transition and correction shortcut.

[Checkpoint 04](KEYSTONE-CHECKPOINT-04.md): final `pnpm check` exited 0. Types and lint passed; contracts 92, mocks 15, research 305, desktop 27, API 172 and web 134 tests reported passing. Nine provider/persistence regressions cover both adapters; eight failed before implementation. Live audits remain NOT RUN; no paid research or design change.

[Checkpoint 05](KEYSTONE-CHECKPOINT-05.md): multi-angle review prioritized removal of destructive browser quota fallback. Final `pnpm check` exited 0: types/lint and contracts 92, mocks 15, research 305, desktop 27, API 172, web 139 tests reported passing. The eight-case store suite covers failure preservation and retry. Live audits remain NOT RUN. No paid research or visual redesign. Storage capacity and transactional recovery are still unfinished; resume K1 original-source validation next.

[Checkpoint 06](KEYSTONE-CHECKPOINT-06.md): final `pnpm check` exited 0: types/lint and contracts 92, mocks 15, research 305, desktop 27, API 204, web 139 tests reported passing. Thirty-two added API cases exercise original retrieval, pinned transport, pre-interpretation persistence, reload and retention limits. Twenty behavioral failures were observed before their implementations/fixes. No live source/TLS/provider validation, extra paid model invocation, browser recording or visual redesign. Exact passage validation, the correction shortcut and local desktop coverage remain gaps.

[Checkpoint 07](KEYSTONE-CHECKPOINT-07.md): final `pnpm check` exited 0: types/lint and contracts 92, mocks 15, research 307, desktop 32, API 204, web 139 tests reported passing. Seven added cases, six observed behavioral failures before implementation; a real-filesystem repository restart test preserves originals through interpretation failure. Browser and desktop main bundles build; native transport markers absent from web/present in main. Existing large-chunk/Firebase import warnings persist. No live provider/source accuracy, installer journey, recording or visual change. Artifacts are not yet in JSON export/import/deletion; exact claim matching remains next.

Preview `http://127.0.0.1:4174/` was already served from this worktree; no process was killed/replaced. Homepage/sidebar render in the in-app browser. Shared-module hot reload emitted RepositoryProvider context errors during edits; a clean reload rendered correctly, with no newer errors observed. Keep this development limitation on the K0 investigation list. No paid deck/dashboard journey was triggered in the browser; card visual baselines, recording and latency benchmarks remain pending.

GitHub push was blocked by Windows/Git authentication. Local checkpoint is not a remote backup. Existing untracked `.pnpm-store/` and `docs/KEYSTONE-CATEGORY-BASELINE.md` must not be swept into commits or deleted casually.

## Next bounded task

K0 remaining: capture approved card/reader baseline and affected-journey recording using isolated no-key fixture state; measure labelled timings/call counts; investigate hot-reload context identity. Keep trying to reproduce prior navigation failure without weakening its assertion.

K1 next: enforce entity/passage/value/period/definition checks -> accepted fact -> matching card/reader, including correction shortcuts. Checkpoint 07 connects protected original retrieval to local desktop verification and separate files, but citation-grade filtering and retrieved extracts still do not prove a page supports a figure. Official small-company sites not in the publisher list need identity-bound source validation, not blanket rejection or a model-supplied primary label. Matching-value observations also need explicit period/definition checks and immutable accepted-fact history. Cloud provider notes/cached-dashboard invalidation and other ingestion routes still need auditing. Add artifact bundle export/import, lifecycle and corruption recovery before scaling unattended research; existing JSON exports do not include native originals. No scoring UI/provider fleet/connector scaffolding yet.

Checkpoint 04 closed the discarded-provider-support prerequisite; checkpoint 06 wires bounded originals into cloud verification; checkpoint 07 adds desktop retrieval and separate artifact persistence. Provider mappings remain generated-answer attribution, not original quotations. Verify one supported and one unavailable figure end-to-end with the authorized configured key once securely available; do not claim live accuracy from fixture tests. Current shell has no configured Gemini/Google key; do not extract encrypted desktop credentials.

The founder authorized use of the configured Gemini key for needed testing on checkpoint 03. Keep live tests bounded and explicitly distinguish them from mocks; do not run the entire live census or judge suite just because a key is available. No Gemini/Google key was present in the shell environment during checkpoint 03; browser/desktop credentials were not extracted or copied. Never expose keys. Source count is not confidence; an unrated private company is not a weak company. Save full evidence while compacting session notes well before the context boundary.

## Milestones

| Milestone | State |
| --- | --- |
| K0 Baseline and navigation | In progress: tests/homepage checked; visual journey and timings pending |
| K1 Evidence correctness, card+reader | In progress: shared transitions/attribution and cloud+desktop original retrieval; exact passage proof and other ingestion routes pending |
| K2 Durable queryable dossiers | In progress: browser quota safety and separate native originals; complete export/lifecycle, indexed transactional store and recovery pending |
| K3 Sentinel/Scouts, first-ready latency, branding | Not started |
| K4 Complete coherent company dashboards | Not started |
| K5 Specialist stories/reports/shards | Not started |
| K6 Deterministic cohort scoring | Not started |
| K7 Tested single/mixed-provider routes | Not started |
| K8 Meaningful opt-in monitoring | Not started |
| K9 Connector and release hardening | Not started |

At handoff update only with verified facts: last commit, files changed, implemented behavior, tests/run type, measurements, spend if known, blocker and next action. Record founder-approved design decisions; never call planned work completed.
