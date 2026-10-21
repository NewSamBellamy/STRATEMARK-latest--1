# Financial disclosure repair — October 6, 2026

Branch: revival/initial-card-redesign. Builds on febeb18. Approved collectible styling preserved.

## Root causes established

- Inspected the app's research-only export locally, rather than extracting hidden browser storage or credentials. The Microsoft retry's SEC receipt was `/edgar/searchedgar/companysearch`, redirected to `/search-filings`: a navigation page, not a filing. Earlier official annual-report and earnings URLs existed, but the next hunt forgot them.
- Official investor hubs and actual financial reports had equal routing priority. A generic investor page could consume the two-read budget before a report.
- Browser repository retention capped a whole attempt at 20,000 serialized characters while the reader permits two SEC documents of up to 32,000 characters each. The previously probed real Microsoft response was 20,920 characters. A full-sized regression reproduced `Invalid original-source attempt`.
- The metrics dashboard and overview sidebar displayed the storage key ARR for annual revenue, and the metric tile placed annual revenue on an ARR gauge. The card already used definition-aware labels.

## Implemented

1. Actual official report/earnings URLs outrank investor navigation hubs. SEC companyconcept remains first priority. Hints only route retrieval; they never verify a claim.
2. A metrics retry reads at most twenty company-scoped saved attempts for prior original URLs, supplies at most two prioritized leads to grounding, and re-fetches selected sources. The existing two-read budget and one grounding/one structuring pass remain unchanged. Prior receipts are not silently relabeled current.
3. Financial search asks for actual current disclosures, permits annual revenue distinctly from ARR, and uses the official-domain search guidance. No hardcoded company identifiers or invented filing URLs.
4. Browser save envelope accommodates bounded formatted receipts and JSON escaping (400,000 serialized characters), with unchanged per-receipt format/text/integrity checks, acknowledgement and immutability protections.
5. Existing definition labels are used on metrics, overview, correction controls, fact-check claims, successful-hunt copy and annual-revenue deep-dive topics. Alternative measurement definitions do not enter the incompatible ARR/user band gauges. No restyling or new research calls in rendering.

## Verification

- Red/green regressions: disclosure priority, full-sized receipt persistence, retry recovery from a prior filing, reopening accepted annual revenue, and definition-aware dashboard/overview labels. Focused backend suite: 45 passed. Focused dashboard suite: 7 passed.
- Actual Gemini preview retry, using the already configured key through the app: Microsoft annual revenue populated as $331.8B, with retained SEC companyconcept evidence for 2025-07-01 through 2026-06-30. It survived a full reload. Card and preview both displayed Annual revenue with a source link; Metrics also displayed Annual revenue after correction. This is filing-reported, not independently audited or a new ARR claim.
- No manual value import, human override, credential extraction or fake source was used to produce that live result. Background research remained paused; only one targeted retry was launched this turn.
- Screenshot saved outside the repository: C:/Users/shann/Documents/Codex/stratemark-oct06-financial-card-repair.jpg. Research-only backup remains local in Downloads; neither artifact is committed.
- Initial full check hit a desktop evidence-test 5-second timeout and subsequent locked-file cleanup under concurrent suites. The isolated desktop source suite then passed 17/17. Final full pnpm check passed: workspace typechecks, lint and tests (web 232 passed). The tightened gauge-tooltip assertion also passed in a separate final focused run. Environment-gated live suites remain distinct from the actual UI retry above.

## Remaining work, in priority order

1. General metric extraction: retain document/table context with explicit issuer, unit, definition and reporting-period bindings. The current short single-statement prose gate rejects many legitimate reports. Do not simply relax it into citation-only trust. Add wrong-issuer, segment/parent, annual/ARR, old-period and conflicting-value regressions before expanding adapters. Public source availability must not be confused with app acceptance failure.
2. Company snapshot: the live Microsoft card still has no accepted business summary. Target original company-profile passages rather than homepage navigation/product marketing; prove useful profile content survives reopen.
3. Useful-first readiness: a finished hydration attempt must not imply a complete card. Persist ready/partial/blocked reasons and surface retryable failures without unbounded paid loops. Re-test fresh creation, not only recovery of an existing deck.
4. Dossiers: products, people/photos, intelligence and other sections need live accepted-content coverage. This pass does not prove they are complete.
5. Sharing/privacy: remove automatic research transmission to URL shorteners, preserve measurement definitions/periods, and prove portable recipient access. Do not open Share with user research before fixing the known leak.
6. Specialist deep reports, provider expansion/MCP and installed-release acceptance remain separate milestones in OCT06-LAUNCH-READINESS-AUDIT.md. Do not advertise production readiness or universal provider support from this checkpoint.

## Boundaries

No contract schema changes, design overhaul, deployment, main merge or GitHub push. Existing desktop test configuration and other unrelated work were preserved. Systematic debugging/TDD determined the failing boundaries before fixes; React review kept label correction derived from existing data, without effects, new subscriptions or additional provider work.
