# Keystone checkpoint 13 — acknowledged browser research storage

Date: 2026-10-05. Branch: `revival/initial-card-redesign`. Local checkpoint only; not a production-readiness claim.

## Why this slice

The preceding live game-studio attempt reached market discovery, then failed at a roughly 5 MB browser working copy. The failure was a storage limitation, not evidence of research quality. Existing paid research, reports, dashboards and credentials must not be deleted to get another run through.

## Implemented and connected

- Browser BYOK research opens an asynchronous IndexedDB store before constructing its repository. Research snapshots no longer require a successful localStorage write. Existing legacy localStorage and vault copies are retained; the new committed record is authoritative after its first save. Existing generated-image storage is preserved.
- A transaction writes the new revision and previous-version backup together. A save resolves only on transaction completion. Aborts retain prior committed records. Queued writes capture immutable JSON; readers receive detached committed snapshots.
- Revision comparison rejects a stale writer rather than overwriting another window's saved research. Imports invalidate already-open writers in the same way.
- Repository mutations, scoped grounded-note retention and pipeline event checkpoints await saves. Company refresh events and narrative-card progress follow persistence. Startup migration errors are observed and block browser initialization; storage errors show a retry message rather than silently opening an empty workspace.
- Settings counts, export, import and restore use the authoritative research store. Replacement requires confirmation, retains the prior snapshot as backup, rejects active-workspace jobs and unsupported future versions, and validates basic snapshot structure before installation.
- Background failure cleanup runs even when saving the failure status itself fails; an attached rejection observer prevents an unattended promise rejection from masquerading as a clean completion.
- No card styling changes, no provider calls, no credential extraction, no deletion of user research, no main-branch merge or deployment.

## Verification and red team

- Test-first reproduction demonstrated premature asynchronous mutation completion, swallowed asynchronous save failure, and grounding returning before retention. These now pass.
- Browser storage fixture tests cover a 6,000,000-character report, migration with credentials excluded, reopen, detached reads, captured queued revisions, stale-window rejection, unavailable storage, corrupt legacy data, future-version refusal, actual repository mutation/reopen, transaction abort/retry, large import/backup, invalid import preservation and active-job import refusal.
- Research tests cover acknowledgment ordering, failed save propagation, pre-synthesis grounded-note retention and failed startup migration.
- Targeted browser tests: 13 passing. Targeted research pipeline/migration/persistence tests: 32 passing before the additional startup failure test; the final gate includes that additional test.
- First full gate: typecheck and lint passed; contracts, mocks, research, API and desktop suites passed. Web suite hit the previously documented `Back to card` journey failure. The unchanged journey test subsequently passed in isolation. Final `pnpm check` passed every workspace typecheck, lint and unit suite, including 152 web tests and the added startup migration failure test. No assertion was weakened. The intermittent navigation failure remains a tracked risk, not diagnosed away by a green rerun.
- Production web bundle built successfully. Existing large-chunk and Firebase static/dynamic import warnings remain.
- All research correctness tests in this slice use fixtures. Live Gemini census/judge checks self-skipped without a shell key. This does NOT prove current-company accuracy, real-browser quota behavior, lower research latency, or a completed live game-studio run.

## Remaining boundaries

- This is transactional snapshot persistence, not the final per-company indexed evidence/document store. Full JSON serialization, backup copying, browser eviction limits and large-deck write amplification remain. Preserve images and move artifacts into indexed records in a measured follow-up.
- Persisting a mutation is acknowledged, but repository readers can still observe in-flight in-memory state. A full transactional repository/session ownership model and interrupted-job restart reconciliation remain needed.
- Validation checks container shapes/version, not every nested contract, reference, job, company identity or cross-record relationship. Exhaustive import validation and a recovery/download UI for corrupt startup records remain open.
- Existing legacy copies are retained as rollback material, but an older build will not see newer committed research. Do not silently downgrade or restore the legacy copy over the new record.
- Native-original files are still not packaged in browser JSON exports. Cross-platform artifact export/recovery, cloud receipt delivery to free/BYOK local storage, browser source verification and semantic/period acceptance remain unfinished.
- No live latency/cost improvement benchmark was measured. UI polish, coherent dashboards, specialist reports, provider combinations, scoring, opted-in monitoring and connectors remain on the consolidated plan.

## Next high-value step

Exercise the connected store in an isolated real browser with preserved fixture research larger than the prior limit, including reload/export and competing windows. Then run one bounded authorized Gemini example and report call counts, first-ready timing, metric support and failures honestly. Continue K1 receipt delivery before numbers are published; do not spend on a full census until a small end-to-end run is reliable.
