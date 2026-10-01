# R1 native saved collection — checkpoint evidence

October 1, 2026. Stratemark v2 exploration, branch `feat/stratemark-spinoff-local-agents`. Integrated acceptance is pending until the final gate, clean-commit actual desktop recording and verified GitHub backup are recorded below. No R-goal is complete.

## User outcome

Save an exact card from its native reader, browse a local collection across markets, open its retained sources, remove only the saved reference and explicitly undo removal. Keep role/deck identity and return focus. Reopen the collection without a provider key. Provenance-preserving synthetic reopen remains read-only; a normal writable native service can save without initializing a provider.

## Implementation

- Reuse existing saveCard/unsaveCard/listSavedCards IPC and shared reader; no new dependency or parallel collection framework.
- SQLite schema 8 adds only saved references and timestamps. Schema 7 upgrade preserves generated research/run identity and vault revision in isolated tests. Readers refuse old schemas rather than silently upgrading them.
- Owner-fenced transactions are idempotent. Removal does not delete cards, source text, events or runs. Reader handles expose no bookmark writes; old writers cannot mutate after close/reopen.
- Validate required table, sole card primary key, foreign key and strictness. Reject malformed identities, unknown cards and mismatched save receipts.
- Native collection does not use legacy heuristic identity merging or unsupported dashboard calls. It retains exact cards, original market links and local evidence.
- Mutations show pending/error/confirmed states. Failed writes retain membership; removal keeps the reader open, including direct-link entry, so Undo remains available. Read-only changes have an explanation.

## Verification so far

Targeted regressions observed failing before repairs, then passing. Service42, original deck/collection42 and repaired collection7 passed. Parent bookmark/work36 and trusted-host3 passed; malformed/composite-key guards passed targeted checks. Initial broader vault83 passed before later guard additions. These are focused evidence, not final acceptance.

First full gate failed one backup/restore test at its five-second timeout while build and suites competed. Isolated unchanged regression passed in about 0.6 seconds. Second gate passed desktop509 but picked up the worker's newly added intentionally RED direct-entry test before its repair (web286/287). Do not report either gate as green. All owners subsequently returned; final stable gate26904 exited0: all six typechecks/lint, contracts374/mocks16/research391/API158/desktop509/web287 =1735 reported tests. Optional live/LLM paths remain no-key skipped, not live-quality proof.

Full desktop build handle39507 passed before the final review repairs; it is not final-build proof. Known main web chunk remains about 1.6MB. No paid product calls; development dollars and cache hits are unobserved.

## Red team

Astra identified composite saved identity keys and loss of a directly resolved reader after removal. Both repaired with specific RED→GREEN regressions; final bounded static disposition found neither issue remaining. Running app acceptance still pending. No scope reduction follows from this review.

## Remaining full-product work

Native remains an isolated developer preview; normal desktop still uses legacy storage. Normal native action parity, explicit disposable migration/cutover, exact claim/period/definition support, canonical entity dossiers, seven real role/story destinations, broad providers, deeper research/questions/comparison/briefs, sharing, monitoring, MCP/actual hosts and signed packaged release remain open. Owner visual approval and separately authorized live quality evaluation are not proved by fixtures. Large-collection pagination/performance also remains a release gate.

## Final acceptance

Pending: stable full gate, final build, clean application commit, actual available-journey recording including direct-link remove/undo and keyless collection reopen, artifact hashes, verified authorized GitHub fast-forward and main-tip check.
