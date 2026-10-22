# Audit: other writers of `confidence: 'verified'` (Rule 9)

Branch `fix/research-provenance-callers`, cut from `beta/night-tip`. Context: `6dccd324` made `buildStubCard` demote uncited seeded figures. This checks the remaining direct writers.

Result: all five sites are compliant. No uncited `verified` can reach storage or the UI from any of them, so no code was changed and no failing test was possible to write.

| # | Site | Reaches storage / UI? | Gate | Verdict |
|---|------|----------------------|------|---------|
| 1 | `packages/research/src/initial-metric-recovery.ts:93` (`verified`, `sourceIndex: null`) | `recoverInitialMetrics` has no caller anywhere in `packages/` or `apps/` (only its own definition). It writes into `enrichment.metrics`, and the only converter of that shape, `metricRows` in `company-agent.ts`, builds citations from `sourceIndex`. A null index gives no citation, and `metricRows` then runs `enforceModelMetricsProvenance`, which demotes it. | `metricRows` -> `enforceModelMetricsProvenance` | compliant (dead code today; gated if wired in). Note: wiring it in would demote every recovered figure, because the `passageSupport` receipt is not turned into citations. That is a functional gap, not a Rule 9 breach. |
| 2 | `company-agent.ts:917` | Reaches the card metrics. Only set when `acceptedMetricPassage` returned a non-empty `citations` list, and those citations are written onto the row with `source: citations[0].url`. | Citations required by the branch condition | compliant (carries accepted-passage citations) |
| 3 | `company-agent.ts:921` | Only set when `observation` is a SEC revenue or headcount observation. It spreads `observation.citations` and sets `source` from `observation.citations[0]`. | SEC filing citations | compliant (carries SEC citations) |
| 4 | `ownership.ts:683` (GLEIF independent) | This is an ownership record, not a metric. It carries `citations: [independent.citation]` (the GLEIF record) and is wrapped in `enforceOwnershipProvenance(..., true)`. | `enforceOwnershipProvenance` plus a registry citation | compliant (cited and gated) |
| 5a | `bench/bench.ts:243` | Bench-only mock LLM output for the offline benchmark, with `sourceIndex: 0` and a `reportedClaim`. It feeds the normal pipeline and is never a repository write path of the app. | Normal pipeline gate; the bench is a dev tool | compliant (cited, bench-only) |
| 5b | `packages/mocks/src/seed.ts:49` (`v()` helper) | Demo and fixture dataset for `@mi/mocks` consumers (web and desktop demo). `build-dataset.ts` converts the `source` URL to a citation and calls `enforceMetricsProvenance(rows)` over every row. Entries whose `source` is free text (not an `http(s)` URL) get no citation and are demoted to `estimated` by that call. | `enforceMetricsProvenance` in `metricRowsFor` | compliant (gated) |

The task listed five sites; bench and seed are counted as items 5a and 5b above, so the table has six rows for the five brief entries plus the two ownership/agent sub-lines.

## Not run / limits
- Verified by reading code and grep only. No new tests were added, because no site needed a fix.
- Other `'verified'` writers in `ownership.ts:655` and `:674` were seen in passing: both are cited and wrapped by `enforceOwnershipProvenance`, but were outside the brief.
