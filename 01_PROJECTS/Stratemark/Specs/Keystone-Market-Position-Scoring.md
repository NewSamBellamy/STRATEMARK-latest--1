# Spec: Keystone Market Position and Sentinel ranking

Status: proposed v1, not implemented or empirically validated.
Date: 2026-10-03. Companion to Keystone-Research-Architecture.md.
Owner: Deck Sentinel coordinates publication; shared deterministic code computes scores. Models propose evidence and explain decisions, never assign or nudge the number.

## 1. Problem statement and recommendation

Give collectible company cards a restrained, useful comparison while preserving evidence integrity. Use **Market Position**, a 1-99 relative index within a defined deck cohort, plus a rank. This is not a universal company-quality rating, investment recommendation, probability of success, research confidence or global percentile.

Company maturity, evidence coverage and market position are different. A leading company in a small market need not be a global Titan. A deeply researched private company can remain unrated because it does not disclose comparable business figures. A large headcount or expensive funding round does not establish business strength.

This specification overrides the old CMS rules for the proposed visible Market Position score. Keep legacy maturity fields readable during migration; do not mechanically convert tiers 1-8 to scores 1-99.

## 2. Current scoring gaps, demonstrated by inspection

- `packages/contracts/src/scoring.ts` averages fixed financial/headcount bands with deck-relative users. Different concepts are mixed into maturity.
- Missing signals are omitted and weights renormalized per company: two companies can be compared using different effective definitions.
- Estimated figures participate; no claim-receipt or measurement-basis gate belongs to the scoring function today.
- The model can nudge a tier by one. Logged reasoning helps explain it but does not make the adjustment reproducible.
- `tiers.ts:mapUsersRelative` ranks distinct values, not the full peer population, and stretches small samples to the endpoints.
- `repository.ts:retierCompany` and other paths collect user metrics across the snapshot instead of just the relevant deck/cohort.
- Refreshing one company does not necessarily recompute every affected peer, although relative rankings depend on the entire cohort.
- `buildCmsInput` prefers a valuation row even when an unknown valuation could hide usable market capitalization. Neither belongs in the default new score anyway.

## 3. Simple user experience and user stories

1. See one small Market Position number, not a game rarity badge or an oversized score panel.
2. Inspect it to see peer rank, cohort name, actual scoring basis, accepted figures and sources.
3. Understand that adding competitors can change my company's relative position without changing its business facts.
4. See the same scoring basis applied to every rated company in the cohort.
5. See insufficient comparable evidence instead of a made-up number or a low score for undisclosed data.
6. Compare small and large markets without asserting that scores in different markets are equivalent.
7. See ties and unstable ordering honestly, not arbitrary precision.
8. Refresh evidence or add/remove a company and receive an atomic recalculation for all affected peers.
9. View Infrastructure and Distribution in explicitly named peer cohorts, not silently mix unlike business models.
10. Open shared research and retain the score's original cohort, methodology and date.
11. Change a filter or sort without accidentally changing the underlying score.
12. Correct identity, scope or accepted evidence and see the reason for the subsequent score change.

Design recommendation: add a discreet `Market position · 82` treatment in existing card chrome/footer; keep the large logo, brand colours, hero proportions and compact core metrics. Reader disclosure: `#2 of 10 rated companies · Company cohort · Updated …`. If the deck has 14 companies, explicitly say four lack comparable data. Score is not the scout number; keep both identities visually and semantically distinct.

No numeric scores for Insight, Culture, Vice or Barrier cards. No competitive rank for finding/shard quality. Their importance can be explained in context without inventing a universal statistic.

## 4. Scoring basis: consistent framework, explicit market profile

Default proposed dimensions:

| Dimension | Nominal weight | Meaning | Permitted example |
| --- | --- | --- | --- |
| Business scale | 60% | Demonstrated commercial activity in the defined market | Comparable annual revenue or explicitly defined ARR |
| Adoption/reach | 25% | Demonstrated customer footprint in the same population | Paying customers, same-definition active users or sourced market share |
| Momentum | 15% | Change in a comparable business measure over a common interval | Year-on-year revenue growth with positive prior base |

These weights express a product decision, not scientific truth. They deliberately emphasize established activity over speculative upside. Test sensitivity before launch; do not call the formula bulletproof or predictive. Revenue scale and growth of the same revenue are related; explicitly inspect their combined influence. Adoption evidence often correlates with revenue too. Do not count users plus market share as two separate adoption signals just to inflate one company's score.

Per cohort, choose one eligible measure for each active dimension and fix its definition, entity scope, currency policy, reporting-window compatibility, source policy and weight. Examples: SaaS ARR is compared with ARR; retail annual revenue with annual revenue; paying customer counts are not compared with free registrations. Banking assets, marketplace GMV and revenue are not interchangeable substitutes. Unsupported business models use a tested market profile or remain metric-specific comparison only.

Sentinel selects from a reviewed profile registry and records the reason. A model cannot invent weights per company or infer business metrics from web traffic. Profiles may vary by market, but all rated peers inside one cohort use the same profile. Prioritize market-relevant entity/division data; parent-company scale is not a substitute for a division's competitive position. If segment evidence is missing, do not borrow the parent's numbers.

Valuation, market capitalization, employees and funding remain useful dossier/card context but are excluded from the default position index. They can support named user-selected comparison views, not a silent replacement for missing revenue. Moat/product quality/risk belong in sourced research explanations, not uncalibrated LLM scores.

### Profile selection and missing data

Select the initial profile after identity and essential evidence assembly. Prefer all three dimensions when full compatible observations cover at least 60% of eligible cohort companies. Otherwise try scale+adoption, then scale+momentum using the same coverage rule. Require at least two active dimensions, including business scale. Normalize weights ONCE for the whole selected profile, never separately per company: scale+adoption uses 60/85 and 25/85 for everyone; scale+momentum uses 60/75 and 15/75.

This 60% coverage threshold is a proposed starting rule to benchmark, not a guarantee against disclosure bias. Publish rated/eligible counts and reasons for exclusions. If fewer than 60% qualify, offer a explicitly named metric comparison and evidence coverage, not a broadly labelled position index. Users can intentionally choose a scoped disclosed-data cohort, with that limitation made prominent and a new scope revision.

Each scored company must have accepted, current, compatible evidence for EVERY active dimension. Missing values are neither zero nor average; no per-company reweighting or hidden imputation. Uncertain intervals can support range/partial-order views but cannot be turned into invented point estimates. Unreviewed estimates or legacy verified flags are excluded from default scoring until the evidence gate accepts their basis. Human assertions retain attribution; an asserted number alone is not independently verified evidence.

One scored peer: no comparative score or peer rank. Two to four: offer supported relative rank with `Small comparison set`; withhold the 1-99 badge. Five or more: publish the index if the above gates pass. This is how the product handles small markets honestly rather than awarding a two-company winner 99. Market size and the user's discovered sample are not the same.

Profile remains fixed as peers arrive. A missing metric in a new company makes it pending/unrated, not grounds to change everybody's formula. Profile changes require a new method revision with a visible basis-change explanation and cannot be hidden inside routine reranking.

If additions reduce qualifying coverage below 60%, suspend the current broad-position badge and explain limited coverage; retain the previous snapshot as dated history. Do not change weights to keep badges populated. The company dossiers and explicit metric comparison remain available.

## 5. Proposed deterministic method

For each active dimension, compare accepted values within the SAME fully eligible peer set. Values with overlapping disclosed precision are ties; interval-overlap ambiguity must be surfaced rather than resolved from arbitrary midpoints. Handle lower-is-better dimensions explicitly in profiles; the default measures above are higher-is-better.

Let n be rated peers, L the number of strictly lower peer values, and E the number of equal values INCLUDING the company. Proposed smoothed midrank:

```
dimensionPosition = (L + 0.5 * E + 2) / (n + 4)
compositePosition = sum(profileWeight * dimensionPosition)
positionScore = round(1 + 98 * compositePosition), bounded to 1..99
```

The `+2 / +4` convention draws tiny-cohort extremes toward the centre. It is a transparent product regularization choice, NOT a statistically calibrated confidence estimate. Benchmark it and freeze it in methodology v1 only after reviewing behavior. No score is automatically 99 because a company happens to top its deck. Outlier revenue magnitudes cannot dominate the index solely through currency scale; magnitude differences still remain visible in the actual card figures. Relative ranks deliberately discard magnitude, so this is position among observed peers, not economic distance between companies.

Sanity examples computed with one dimension for illustration of normalization (production composite requires two): five distinct ordered values map to 28,39,50,61,72; five equal values map to 50 each; ten distinct values have endpoints 19 and 82. These are synthetic arithmetic checks, not live company ratings. Scores from different-sized cohorts must not be compared as absolute strength or percentages.

Rank uses the published score and conservatively treats equal published scores as ties (1,1,3). Alphabetical display order may break a layout tie but not a rank tie. Close or unstable positions show an explanation or rank range, not a model nudge. Never label 82 as the 82nd percentile: this index includes smoothing and weighted dimensions.

Optional legend: `Higher = stronger observed position among the rated peers in this deck. Not investment quality. Missing comparable data = unrated.` Do not derive "Titan" from a local score. Keep any absolute maturity designation separately defined and evidenced; old tier labels cannot imply global dominance in a niche market. Initial release need not add new score bands or rarity grades.

## 6. Sentinel lifecycle and architecture

Sentinel owns a `RankingSnapshot`, not a conversation's opinion. Proposed pure interface: `computeMarketPosition({profile, cohort, acceptedObservations, policyVersion}) -> RankingSnapshot`. The repository publication service validates and saves it atomically. No LLM call is needed for reranking.

Persist: deck/cohort ID and scope revision; profile/method/evidence-policy version; accepted observation IDs; eligible/rated/unrated company IDs with reasons; effective weights; per-dimension results; score/rank/ties; time and change reason. Card score is a DECK/COHORT PROJECTION, not a field globally attached to CompanyIdentity. A company may correctly occupy different positions in different decks.

Trigger a complete affected-cohort calculation on member addition/removal/merge/scope change, accepted metric correction/new period/retraction, scoring eligibility becoming stale, or explicit profile revision. Deduplicate canonical companies and never count multiple cards as multiple competitors. Distinct company/infrastructure/distribution cohorts are the default; an all-entities comparison requires demonstrated compatible scope and basis.

Discovery addition starts a new cohort revision immediately; if the new company lacks required evidence, include its pending reason while keeping it outside the rated denominator. When its evidence qualifies, recalculate ALL rated peers, not just its card. A company fact change affects every deck/cohort using that accepted observation, but evidence retrieval remains workspace-scoped. View filters/search results do not redefine cohorts.

Debounce arrivals briefly to avoid UI flicker; write the complete score/rank snapshot in one transaction with input revision checks. Publish no mixture of old/new peer scores. Cancel obsolete calculations and resume from persisted accepted inputs. Keep the last snapshot visibly dated when new research is pending; never call it current after its evidence expires. Completed accepted updates invalidate old ranks, not the underlying historical snapshots.

Explain movement: `New competitor added`, `Revenue disclosure updated`, `Evidence became stale`, `Scope changed`, or `Method changed`. Do not show every deck recomputation as business growth/decline. Preserve previous scope/profile alongside history so changes can be interpreted.

## 7. Red-team gates and implementation tests

- Wrong entity/period/unit or unsupported claim never reaches numeric scoring.
- All peer weights/bases are identical; deletion of a field cannot improve a company's score through personal reweighting.
- Private nondisclosure is unrated, never a zero or business weakness claim.
- Changing another deck cannot alter this cohort's snapshot.
- Adding/removing a competitor recalculates every peer; new pending company does not fabricate a score.
- Duplication of a card/company does not change the peer denominator.
- All ties produce equal score/rank; equal displayed scores do not imply different displayed ranks.
- All equal values yield neutral index; large outliers do not force all other companies to 1.
- Increasing an accepted value cannot lower that company's score under a fixed cohort/profile, holding other dimensions fixed.
- One peer suppresses comparison; two/four use small-set rank; five activates the badge only with evidence/coverage gates.
- Negative/NaN/infinite counts are rejected; true zero requires evidence. Growth with zero or negative base is not ordinary percentage growth.
- Changed public market cap does not change the default score; speculation/funding headlines/source count/brand assets never add score points.
- Missing dimension, stale evidence, restatement, ambiguous precision and overlapping intervals yield the documented unrated/range behavior.
- Same accepted inputs/profile produce identical results across providers and local/cloud implementations. LLM nudge cannot enter this score.
- Snapshot persistence/import/export preserves scope, methods, dates, provenance and privacy.

Benchmark sensitivity: vary proposed weights by +/-10 percentage points with renormalization, remove each nonessential dimension, change reporting compatibility rules, and remove/add peers. Disclose how ranks change. If a company's rank spans more than two places under the approved weight variants, mark it method-sensitive and show the range in its explanation; do not claim a confident #1. This threshold is also provisional. Rank ranges from method sensitivity are not statistical confidence intervals. Inspect data disclosure bias, especially across public/private and large/small firms.

Research basis: the OECD/JRC composite-indicator guidance emphasizes normalization, weighting, missing-data decisions, uncertainty and sensitivity. It supports auditing these choices; it does not endorse our weights, formula or company judgments. [OECD handbook](https://www.oecd.org/en/publications/handbook-on-constructing-composite-indicators-methodology-and-user-guide_9789264043466-en.html), [JRC sensitivity guidance](https://knowledge-for-policy.ec.europa.eu/composite-indicators/toolkit_en/navigation-page/10-step-guide_en/step-8-sensitivity-analysis_en).

## 8. Delivery, preservation and out of scope

No application implementation in this planning checkpoint. First build evidence correctness (backend Phase A), then cohort identity/readiness (Phase C), then scoring behind a feature flag using pure fixtures and atomic snapshots. Review synthetic 3/5/10/100-peer examples and an approved real-market audit before replacing visible CMS tiers. Keep original designs; prototype only the small badge and reader legend with founder review.

Tests: `pnpm --filter @mi/contracts test:run` for pure scoring; `pnpm --filter @mi/research test:run` for cohort publication/reranking; `pnpm check` plus card/reader/browser/desktop full journey tests. Do not present these planned tests as already passed.

Preserved requirements: Sentinel coordination/verification, persistent numbered Scouts, specialist reports/shards, local queryable evidence, official branding/team assets, card+reader-first readiness, capability-based mixed keys, bounded spending/jobs, meaningful watching, shareable cited snapshots and permission-scoped MCP. Scoring must depend on these, not replace them.

Out of scope: universal investment score, prediction of future returns, "best company" claims, full-market coverage guarantee, forced ranking of every undisclosed business, arbitrary AI adjustments, game rarity/loot mechanics, grades on signal cards or changing brand colours based on rank. Any new metric/profile or scoring method must be versioned and reviewed.
