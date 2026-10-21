# Keystone checkpoint 25 — current-row writes, stale-result protection and cloud hunt proof

Date: 2026-10-05 (local). Branch: `revival/initial-card-redesign`. Preceding commit: `f88a22f`.

## Connected improvements

Verification, Find more metrics and explicit corrections now select the stored current company/metric revision rather than the first legacy row. The card/dashboard read projection reuses the same pure contracts selector. Human rows take priority; recording/attempt timestamps order revisions, not source dates or factual truth. Conflicting equal-time revisions remain Unknown on reads and automatic verification refuses to choose a winner. Hunts skip ambiguous fields but can research unrelated gaps. Older duplicate rows are not deleted or migrated.

Local verification fingerprints all stored rows for the requested company/field before provider work. A changed field discards the older response without revising the number, badge or support dates. Hunts check each target separately, so a concurrent correction/clear does not get overwritten while unrelated unchanged fields remain eligible. These are within-repository guards, not a new multi-process transaction protocol.

Existing human corrections skip automatic verification calls in local and persisted-cloud paths. Their attempt timestamps do not advance because no check was performed. This intentionally changes the old cloud regression expectation that a human-locked figure incurred research and acquired an attempt date; it does not weaken source acceptance.

Persisted-cloud hunts now retain at most two priority originals before interpretation, return no fills/no synthesis if none are readable, and require matching original support for each proposed figure. Value bounds and shared successful-support freshness apply. A reputable link elsewhere in the search no longer verifies every proposed figure. Writes retain the existing deck revision compare-and-save boundary. The cloud diagnostic source history remains a rolling eight attempts, not an immutable complete evidence vault.

Red-team review found the in-memory cloud store returning shared nested objects. Deck save/get now deep-copy those snapshots: mutating an input or a fetched nested metric cannot bypass acknowledgment or a rejected stale write. This matches isolated document reads more closely; it does not claim every other store method is transactional.

## Reproducible before/after

| Case | Before | After |
| --- | --- | --- |
| Latest duplicate verification | Updated first/older row | Updates current row; old row preserved |
| Human row hidden behind machine row | Machine row researched/changed | Human row selected; zero model calls |
| User clears while verification or hunt runs | Late result refilled the field | Older response discarded |
| Newer verification finishes before older failure | Potential badge downgrade | Newer supported revision retained |
| Ambiguous equal-time duplicates | Array-order choice | No automatic choice or spend on that verification |
| Cloud hunt with link but no exact passage | Figure promoted | No fill |
| Supported cloud hunt | No retained hunt originals | Originals saved before synthesis; supported figure survives a stored reread |
| Memory cloud input/read mutation | Changed nested stored value without save | Isolated snapshots; stale save cannot alter it |

Thirteen regression cases added: eight local research, four cloud research and one storage isolation. Eleven were observed failing before the corresponding implementation; two additional local adversarial cases passed against the new guards. Repeated tests are not live accuracy measurements.

## Verification actually run

- Final `pnpm check`: exit 0; types, lint and contracts 95 / mocks 15 / research 433 / desktop 33 / API 229 / web 194 reported tests passed.
- Focused local verification/hunt and cloud verification/storage suites run during RED/GREEN development.
- Desktop `pnpm build`: exit 0. Browser `pnpm --filter @mi/web build`: exit 0, run after desktop to leave browser-configured preview assets.
- `git diff --check`: exit 0. Shared contracts additive export checked against all consumers.
- Existing Firebase import/large-chunk warnings remain. Desktop compilation is not installer acceptance.
- Credential-dependent search/census/judge audits returned early and are NOT RUN as live audits. No key extracted, no paid research issued this run, no new full journey recording or production-source accuracy claim. The unchanged visual baseline remains checkpoint 24's observed screenshots, not a new visual audit.

## Red-team gaps / next measurable work

1. Successful configured-key original retrieval, accepted figure, card/reader/dashboard agreement and save/reopen still need a real bounded journey. Current browser CORS/redirect coverage and prior native capture failure remain limitations; fixture passage acceptance cannot certify source accuracy.
2. Complete canonical fact/observation history with human lock/release semantics, typed reporting period/definition/entity and durable revision identity. Clearing a field is still legacy Unknown rather than a durable tombstone; older human duplicates, future timestamps, reordered imports and equal-value replacements deserve explicit migration/transaction tests. Do not infer these semantics from prose notes.
3. Raw stored reads, generated narrative/plots, scoring inputs, refresh/merge paths and connector context need the same canonical revision contract. Current UI quantitative reads and the edited mutation paths are covered, not every consumer. Source-weight merge policy is not replaced by the display selector.
4. Local no-original-reader compatibility integrations retain citation-only verification/shortcut behavior. Do not present them as original-passage verified. Semantic support, legal identity and source reporting freshness remain beyond the mechanical gate.
5. Cloud persisted decks retain optimistic revisions; deployed Firestore races, deck/market atomicity and full original-history retention are not newly integration-tested here. Memory isolation is not proof of deployed database behavior.
6. Continue the delivery map: one trustworthy complete dossier, persistent bounded Scout/Sentinel jobs, specialist finding/report journey, deterministic cohort ranking, additional capability-tested keys, scoped local MCP and packaged release. No full milestone is complete. Do not multiply agent fleets over unfinished evidence/action interfaces.

Preserve the approved design and unrelated `.pnpm-store/` and category-baseline file. Checkpoint is local only; no push, publication, deployment or main merge in this run.
