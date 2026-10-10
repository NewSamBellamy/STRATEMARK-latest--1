# Keystone checkpoint 11 — original-backed native deck expansion

Date: 2026-10-04 local. Branch: `revival/initial-card-redesign`. Previous checkpoint: `bddd1fd`.

## Delivered behavior

Native repository expandDeck now passes its host-owned original services through the standalone delta helper into company hydration. The direct IncrementalDeltaAgent option and expandDeckResearch empty-state wrapper accept and propagate the same services. All three entity roles (Company, Infrastructure, Distribution) use checkpoint 10's initial metric publication gate: save scoped originals before interpretation, accept literal matching passages, leave unsupported metrics null/unknown and bypass proxy-generated ARR. This is an actual user-action path, not a second evidence implementation or unused agent scaffold.

Protected delta hydration no longer runs the extra model tier-nudge pass. It retains the existing rule-based CMS result from accepted rows; this does NOT implement the proposed Market Position system or validate CMS as a universal business ranking. Caller-specified tier review remains legacy behavior when no original services are configured.

The existing save failure now propagates through expansion before card emission or repository ingestion. A failed original write leaves published cards/metrics/deck fields unchanged and emits no deck-refresh event. The repository deliberately preserves generated provider research notes for recovery, so its full snapshot can change without publishing a new fact. Already-present companies are excluded before hydration; expanding again does not duplicate the card or save another artifact for that fixture. Original storage and shared passage acceptance are reused unchanged.

## Verification

Nine new fixture tests: three entity roles, citation-only direct delta calls, empty-state wrapper propagation, failed evidence save before emission, unavailable originals, failed-save published-state preservation/recovery notes and repository add/read/deduplication. All seven initial cases failed before implementation, reproducing invented proxy ARR, missing original saves and unsafe citation-only publication. A mock outcome type needed a const annotation before the full gate could run. The first full test run also exposed an overstrict fixture assertion requiring the entire snapshot unchanged: provider notes correctly survive original-save failure. The assertion now checks every other saved field plus preserved notes, not deletion of useful diagnostic work. Neither fixture correction relaxes evidence acceptance.

In the one-company supported fixture, the protected helper makes two grounding and two structuring calls (discovery and hydration), with no fifth tier-model call. This is a call-count assertion, not measured live token/cost/latency improvement: original retrieval and excerpt input remain additional work. No live Gemini call, factual-accuracy audit, browser recording or design change. No new runtime dependency or @mi/contracts change.

Final full gate: `pnpm check` exited 0: workspace types, lint and all unit suites passed (research 364; web 139). An earlier full run passed backend suites but hit the previously recorded "Back to card" navigation failure; the unchanged isolated journey then passed, followed by the full rerun passing. A sandboxed retry was blocked before tests by bundler filesystem access; the final permitted run completed normally. No assertion, UI code, timeout or test configuration was changed to obtain the pass. The intermittent navigation root cause remains unresolved; a passing rerun is not a fix. Live credential-dependent audits are NOT RUN without keys, not accuracy evidence.

## Red-team limits

- Protection applies when original services are supplied. Native repository additions are wired; cloud worker/ADK creation and expansion still need their own scoped persistence adapter. Browser-only calls remain legacy. Optional helper support must not be represented as protected callers that never pass the option.
- Numeric evidence gating is mechanical, not semantic truth or complete company identity. Narrative, identity/location, logos, executive photos and specialist reports are not independently accepted claims here. The first two cited sources and one bounded window can miss relevant disclosures; more unknowns do not prove better coverage.
- Existing records and previously completed cards are not migrated/reverified. Shared-company identity conflicts, concurrent deck changes, deletion races, cancellation after model/asset work, leases and crash-safe resumable delta jobs still need separate tests and implementation. This slice is not transactional job infrastructure.
- Legacy tier rules are still in use; all-cohort reranking, comparable periods/definitions, immutable accepted-fact history and Market Position remain pending.
- Evidence files still need full export/import/lifecycle integration. Source query scope remains company_profile; per-fact artifact lineage and source UI are unfinished.

## Next bounded work

Implement original services for cloud initial/expanded entity hydration with user/deck-scoped durable receipt writes, fail-closed persistence and the same acceptance policy. Do not expose Node transport to browser bundles or bypass licensing/SSRF rules. Then improve canonical identity/source targeting and run a small real Gemini supported/unavailable/conflicting audit once securely configured. Preserve design; do not start more ranking/monitoring/MCP scaffolding while ingestion paths still disagree.

Local exploration checkpoint only; main/unrelated work preserved. GitHub backup requires separate confirmation.
