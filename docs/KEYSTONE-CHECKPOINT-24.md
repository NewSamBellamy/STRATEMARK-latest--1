# Keystone checkpoint 24 — consistent current figures and complete card refresh

Date: 2026-10-05. Branch: `revival/initial-card-redesign`. Preceding commit: `e7f4049`.

## Proven failures, not a blanket reliability claim

The prior live audit showed a dashboard at 900M Estimated while its card presented 1B as sourced. The research-export download was attempted once this run through normal UI; no download event was observed in ten seconds. No credentials or browser storage were extracted. Therefore the exact raw rows in that user's vault were not inspected.

Code tracing and failing regressions demonstrated three independent hazards:

- Cards selected the first confirmed duplicate while quantitative dashboards selected the first row. Older verified observations could override a newer failed check on the face. Contradictory equal-time rows depended on array order.
- Verification, metric hunts and human corrections invalidated deck-card queries, but not individual-card or saved-card caches. Background verification skipped every invalidation when `changed` was false. Scheduled deck refresh events left those surfaces and company-metric caches stale.
- Backend reconciliation built its starting map using last-row-wins semantics. A duplicated stored machine row could silently discard an earlier human correction and its contradictory observations. The map also merged different companies if given mixed-company inputs.

## Small shared fixes

`buildMetricViews` now presents one current revision per company/type. Human rows outrank automated rows; recording, verification and attempt timestamps order revisions within that group. A newer failed check or Unknown is not replaced with an older verified badge. Conflicting equally recent rows become Unknown instead of arbitrarily picking a figure. This is an ordering of stored revisions, not proof that the most recently recorded source reports the latest business fact. Raw history and persisted research are not rewritten.

The existing data hooks apply that read-only projection to deck lists, individual cards, saved cards and company metrics. Overview, comparison/report tables and exports consuming these hooks inherit the same ordering/provenance boundary. Cards still intentionally hide estimates as Unknown; research dashboards may show them with an Estimated label. Source presence alone does not independently establish a true figure. No card restyle or new dependencies.

One invalidation policy refreshes all those card surfaces after foreground and background metric checks. Dashboard research is invalidated only when a result changes, preserving the existing paid-research behavior. Deck events invalidate local/repository metric and card reads without indiscriminately rerunning paid dashboard research. Events do not include company IDs, so their metric-read invalidation is broad.

The existing `reconcileMetrics` merge folds both stored and incoming observations through the existing human-lock/conflict policy. It groups by company and type and retains conflicting values rather than silently dropping stored duplicates. Shared contracts implementation changed, but no public field/type/API shape changed. Its source-weight policy is unchanged; this is not a new scoring or fact-checking method.

## Verification

Final `pnpm check` exited 0: types, lint and all workspace suites passed (contracts 95, research 425, mocks 15, desktop 33, API 224, web 194). Credential-dependent shell audit/census checks self-skip; they are NOT live validation. Final desktop and browser production builds exited 0. Final browser reload retained the five metric fields and paused research state. Existing large-bundle/Firebase import warnings remain; native installer/startup/accepted-source testing was not repeated.

New regressions cover both duplicate input orders, ambiguous conflicts, human precedence/company isolation, all four read surfaces/raw-cache preservation, three manual update actions, inconclusive foreground/background checks, scheduled deck events, and backend duplicate merge preservation. Duplicate/caching/background/merge failures were observed before their respective fixes. Two test-fixture errors (a missing required override note and a user-count fixture accidentally typed as market share) were corrected, not production validation weakened.

Rebuilt configured-browser checks used existing saved research with background work paused. No explicit paid model request was issued this run. The dashboard retained 900M Estimated; the card/reader now showed Unknown rather than resurrecting the old sourced 1B. No underlying count is newly confirmed. At 390×844 the KPI strip measured 350px wide, each cell about 174px, with no cell overflow and controls below the strip. Default viewport restored. Screenshot evidence remains outside Git in workspace artifacts: `checkpoint-24-card-evidence.jpg`, `checkpoint-24-mobile-metrics.jpg`.

## Red-team boundaries / next priorities

1. Prove successful original retrieval and per-figure acceptance on a real configured-key run, then save/reopen/card/dashboard. Reader restrictions still leave useful figures unconfirmed. Do not fill blanks with guesses or claim complete-market coverage.
2. Backend mutation paths still locate existing metrics by the first company/type row. This checkpoint fixes merge loss and UI selection, not every legacy duplicate mutation/scheduler path; a faithful exported-data reproduction is still required before a data migration. Do not erase the vault or normalize it destructively.
3. No-reader legacy integrations retain citation-only verification behavior. Historical generated prose/charts and previously shared links are not retroactively rebuilt by these guards. Newly computed raw backend/MCP results and agent context require their own duplicate/provenance audit.
4. Continue the whole-product delivery map: source coverage, first-ready research, useful dashboards, provider support, native security and packaging. No claim of bulletproof software, complete production readiness, independent metric accuracy, or cost/latency benchmark.

Local checkpoint only; no publication, push, main merge, key copying or user-data deletion.
