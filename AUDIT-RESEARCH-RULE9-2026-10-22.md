# Rule 9 audit: packages/research/src (2026-10-22)

Report only. No source or test files were changed. Reading was by grep plus targeted `sed` of the hits; no code was executed, so nothing below is marked CONFIRMED by running it. "Traced" means I followed the code by reading it.

## Findings

### F1. Seed metrics marked `verified` with empty citations (PLAUSIBLE, high)
- `pipeline.ts:898-935` (candidate-to-card builder, `initialMetrics`).
- Rule: `verified` requires a usable citation.
- Input: a discovery candidate with `reportedHeadcount`, `reportedArr` or `reportedValuation` set (these come from model output).
- Output: a `CompanyMetric` with `confidence: 'verified'`, `citations: []`, `source: 'Reported in search grounding results'`. The `source` text is a label, not a URL. It is stored in `metrics: initialMetrics` at line 954.
- Why only PLAUSIBLE: I did not trace whether a later step downgrades these before display. `adk/enrichment-pool.ts:124` and `enforceMetricProvenance` (`packages/contracts/src/provenance.ts`, called from `dashboard.ts:87`) downgrade at read or delta time, so the dashboard path likely hides it. The stored row is still wrong, and any reader that skips those paths shows it as verified. The fix would be to emit `estimated`, or to require a citation.

### F2. `initial-metric-recovery.ts:93` sets `confidence: 'verified'` with `sourceIndex: null` (PLAUSIBLE, low)
- The row is only added after `acceptedMetricPassage(...)` returns citations (lines 87-89), so it is gated. Citations are not attached at this point; they depend on the caller re-running the gate. Worth a check that the consumer does re-run it.

### F3. Proxy estimator builds ARR and valuation from a footprint times a price (PLAUSIBLE, medium)
- `proxy-estimator.ts:425-490` (ARR), `:565` (ARR variant), `:643` (valuation).
- It returns `estimated` with a method note, and returns null for non-positive inputs. That is good.
- Concerns:
  - `citations` and `source` can be empty or null (`source: citations[0]?.url ?? null`), so a plausible number is returned with no evidence. This is the "plausible number without evidence" defect class.
  - The ARR is `footprint × list price`, which is not revenue. The calculation sits in the method note only.
  - The `lowestPrice`/`highestPrice` midpoint at about line 460 is a guess.
- Whether callers drop uncited estimates was not traced.

### F4. `Math.random()` in metric ids (informational)
- `proxy-estimator.ts:482,565,643,723,740`, `pipeline.ts:97`, `signal-agents.ts:172`, and many in `repository.ts`. These are ids only, not figures. Non-deterministic ids can break dedupe and tests, not Rule 9.

### F5. `?? 0` and `|| 0` defaults
- Every hit in non-test code (about 70) is a counter, index, token or cost accumulator, or a sort key. None produces a metric value.
- `call-cost.ts:53-80`: missing token usage is treated as 0 and added to the cost estimate, so cost can be under-reported. It is not a Rule 9 figure.
- `dashboard.ts:91` guards against `users === 0` for non-human rows (good).

## Checked and found compliant
- `user_verified` is set in exactly one place: `repository.ts:7544` (`overrideMetric`, a human API; `null` value gives `unknown`). Every other hit reads or preserves it (`assess-facts.ts:58`, `compare-observations.ts:63`, `revalidate-stored.ts:278`, `repository.ts:2485,2928,5045,5554`). `company-agent.ts:274` strips a forged one at ingest. `schemas.ts:34` excludes it from the model-facing vocabulary.
- `enrichment-pool.ts:124-127` downgrades uncited `verified` to `estimated` and nulls `unknown` values.
- `dashboard.ts:87-91` charts only verified or human, bounded, comparable points and returns null otherwise (no zero-fill).
- `company-agent.ts:915-921` marks `verified` only after `acceptedMetricPassage` returns citations, or from SEC observations that carry citations.
- The proxy estimator emits `value: null, confidence: 'unknown'` for the unknown case.
- `bench/bench.ts:247` is a fixture with reported claims; it is benchmark data.

## Files read
- Fully or in part: `pipeline.ts`, `company-agent.ts`, `initial-metric-recovery.ts`, `proxy-estimator.ts`, `dashboard.ts`, `adk/enrichment-pool.ts`, `bench/bench.ts`, `repository.ts` (7525-7550 only).
- Grep only, not read: the other `src` files.

## Not checked
- Signal cards (`culture`, `vice`, `insight`) never inheriting entity metrics: `signal-agents.ts` was not read.
- Unsourced vice/controversy claims being dropped: not traced.
- `reported-metrics.ts` and `site-reach.ts`: only grep hits seen (`estimated` rows at `reported-metrics.ts:1022,1148`, `site-reach.ts:217`). The estimate-flag drop was not traced.
- `repository.ts` writers at lines 4427, 4510, 5453, 5707 (they set `verified`; I did not confirm each has citations).
- `packages/contracts/src/provenance.ts` internals.
- `adk/` other than the enrichment pool; test files; `scale-plausibility.ts` and `headcount-reach.ts`.
- Nothing was executed.
