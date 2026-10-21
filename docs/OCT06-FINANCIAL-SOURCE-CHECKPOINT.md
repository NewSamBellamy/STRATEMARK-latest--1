# Financial-source selection checkpoint — October 6

Branch: revival/initial-card-redesign. Preserve the approved card design.

## Delivered

Confirmed with failing tests that homepage and product news could consume both original-source reads and discard a discovered SEC filing. When financial research is requested, source routing now favors a discovered SEC revenue document, then official investor/financial pages, then official company-profile pages. Source credibility remains the outer priority; fake official hosts and misleading titles do not gain priority. Existing protocol/capability filtering, duplicate handling, two-read budget and evidence acceptance gates remain unchanged. No new provider calls or invented source URLs are introduced by this change; the existing cited SEC-filing transformation remains.

Added an orchestration regression that supplies a discovered filing behind homepage/news citations, retrieves retained SEC evidence, hydrates annual revenue and projects it again from saved originals. It verifies a literal source-backed snapshot, annual-revenue definition and reporting interval, and leaves unsupported headcount unknown. This is a deterministic fixture, not new live verification of its numeric value.

## Verification and red team

- Two new routing tests failed before implementation for the expected missing-financial-source behavior.
- Source priority, SEC revenue, company hydration and ADK original-evidence tests passed together (50 tests before the additional orchestration regression).
- Source priority and SEC orchestration tests subsequently passed (28 tests).
- Full pnpm check passed: typechecks, lint and workspace test suites. First attempt caught two unnecessary regex escapes; those were corrected before the successful rerun. Environment-gated live tests do not count as live acceptance.
- One live Find more metrics action used the existing preview configuration. Afterwards the Microsoft dashboard still showed unknowns, and its visible retained originals were homepage/news material plus an unavailable grounding redirect. Hot reload occurred during this check; it is not a clean fresh-run acceptance result. Do not label company hydration solved.
- No card design, shared contract, credential, release endpoint or existing user metric was rewritten by this implementation.

## Next work, not optional

1. Stabilize a bounded live run without hot reload, and retain the grounded source locators plus rejection reasons. Fix retrieval/discovery when financial originals are not in the selectable candidate set; ranking cannot create missing evidence.
2. Add tested document-context extraction for real official filings where company identity, dates, units and table values occur in different passages. Preserve wrong-issuer/period/currency/population rejection and annual-revenue versus ARR distinctions.
3. Make first-card readiness depend on useful accepted information rather than a completed hydration attempt. Keep private-company undisclosed figures explicitly unknown.
4. Repeat fresh research, card, preview, dashboard and reopen acceptance. Capture real results, not only seeded fixtures. Do not start another broad redesign or framework migration.

Scope: one source-routing defect fixed. This checkpoint is not launch approval; all other priorities in OCT06-LAUNCH-READINESS-AUDIT.md remain open.
