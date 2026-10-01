# R1 native saved collection — checkpoint evidence

October 1, 2026, 15:59 PDT. Stratemark v2 exploration, branch `feat/stratemark-spinoff-local-agents`. Application checkpoint `330d67b03b1eaa671e034754d467853ded1b7902`, backed up and remote SHA verified in NewSamBellamy/STRATEMARK-latest--1. Main remains c945b31. Documentation follows separately. No R-goal is complete.

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

Final desktop build79935 passed after both review repairs. Known main web chunk remains about 1.6MB. No paid product calls; development dollars and cache hits are unobserved.

## Red team

Astra identified composite saved identity keys and loss of a directly resolved reader after removal. Both repaired with specific RED→GREEN regressions; final bounded static disposition found neither issue remaining. Actual desktop acceptance now also passed, including direct-entry Undo and host-denied mutation. No scope reduction follows from this review. Visual screenshot review found readable green/paper collection and source layout; synthetic initials and sparse data are not owner aesthetic approval or live company identity proof.

## Remaining full-product work

Native remains an isolated developer preview; normal desktop still uses legacy storage. Normal native action parity, explicit disposable migration/cutover, exact claim/period/definition support, canonical entity dossiers, seven real role/story destinations, broad providers, deeper research/questions/comparison/briefs, sharing, monitoring, MCP/actual hosts and signed packaged release remain open. Owner visual approval and separately authorized live quality evaluation are not proved by fixtures. Large-collection pagination/performance also remains a release gate.

## Final acceptance

Actual Electron recorder76289 exited0 at clean application330d67b, October1 22:58:48–22:59:47 UTC. Receipt has dirty=false and failures=[]; isolated SQLite, synthetic provider/source responses, no key/live research. Settings, scope/approval, partial company failure, source reading, retry/filters, exact card saving, collection, direct-link removal/Undo, original deck navigation, return focus, second run/cancel, restart, read-only host rejection, retained text/narrow layout, seven synthetic compositions/available sections and reduced motion were exercised. Research runs/request usage were unchanged by collection work. R2 composition sections remain demonstrations, not wired production portals.

Artifacts outside source:

- [Part1: research, recovery, save/collection/remove/Undo](C:/Users/shann/Documents/Codex/2026-09-28/i-x20/outputs/checkpoints/native-journey-q8rX45/01-native-research-and-recovery.webm)
- [Part2: keyless collection/source reopen and seven compositions](C:/Users/shann/Documents/Codex/2026-09-28/i-x20/outputs/checkpoints/native-journey-q8rX45/02-reopen-and-seven-card-composition.webm)
- [Receipt](C:/Users/shann/Documents/Codex/2026-09-28/i-x20/outputs/checkpoints/native-journey-q8rX45/receipt.json)
- [Final gate](C:/Users/shann/Documents/Codex/2026-09-28/i-x20/outputs/checkpoints/native-collection-verified-gate.log)

SHA256: part1 `8A90D4F44D11A87831ACF30CB81227F2524F8190FC439A063FA14CB0D6315124`; part2 `5C7A83228E2BF9E74690D186F785B93A54B483AD79637A84889FA3701C48B463`; built main `E9B976363446F0074954D6234920254EB96345081D5980A461CA72300CA60AFC`.

Red-team verdict: meaningful return-journey improvement, not scaffolding. Saved research is now a persistent, usable collection with safe removal and no provider work. The primary remaining weakness is research depth and useful native destinations in the normal product. Next inspect native hydration's retained entity-only projection and structured output; connect an actual useful company overview/evidence and role/story destinations without unsupported fact promotion or another disconnected framework. Normal cutover and full R1–R8 acceptance remain open.
