# Keystone: empty-card repair checkpoint

Date: 2026-10-06. Branch: `revival/initial-card-redesign`.
Status: **verified partial repair, NOT launch-ready**. Keep the approved card design.

## What was actually reproduced

The latest saved enterprise-software deck contained 26 entities (company,
infrastructure and distribution), with most card figures unknown. Microsoft had
no accepted figures or source-backed description. The preview was running live
Vite code, not a stale build. The public original-source bridge was working.

A real Gemini hunt using the key already configured in the app initially returned
no accepted figures despite successful public-page reads. This was a failure,
not a successful research run. No key was extracted, copied or committed.

## Root causes repaired

1. Background activity verified existing figures and warmed dashboards, but did
   not hunt missing core figures. Added a bounded recovery action for company,
   infrastructure and distribution entities. It invalidates the existing card,
   overview and metric query surfaces after publication.
2. Background work competed with deck creation. Automatic actions now defer
   while the deck's creation job is queued/running. Speculative dashboard warming
   starts after company hydration; specialist research waits for the lead card.
3. Two original-read slots could not cover separate company disclosures. Shared
   coverage now uses at most four slots, two concurrent reads and two receipts
   per durable write. Evidence is saved before interpretation. Ordinary initial
   profiles still use two slots; profiles with complementary SEC evidence use three.
4. Search discovery supplied explicit SEC issuer browse URLs, which the router
   read as navigation rather than company-concept records. Numeric CIK routing
   now reaches actual records. Discovery identifiers are leads, NOT proof:
   retained records must still match company identity, CIK, metric and period.
5. A revenue record identifies its actual annual filing accession. Missing
   workforce research now uses that filing rather than another investor menu,
   within the existing source-slot budget. This also works when revenue is
   already populated/protected.
6. SEC filing index pages were not actual reports. The native reader can follow
   one 10-K/10-K-A document link within the same SEC accession directory. It
   rejects outside hosts, other issuers/accessions and ambiguous document links;
   DNS, HTTPS, redirect, time and retention protections remain in place.
7. Current inline-XBRL filings exceeded the 2 MB page limit. Direct SEC filings
   have a bounded 12 MB allowance; other pages remain limited to 2 MB. Text
   retained for a filing is still at most 4 KB, with raw-document hashing.
8. Nested formatting hid the issuer identity, and numeric HTML spaces prevented
   workforce matching. Text decoding and issuer extraction now handle those
   formats. Employee excerpts prioritize numbered workforce disclosures over
   incidental numbers near employee/product/benefits text.
9. Workforce parsing only recognized "we had ... full-time employees". It also
   recognizes the observed "we employed ... people on a full-time basis" form,
   without treating regional breakdown counts as total headcount.
10. Some real originals failed unnecessarily strict wording requirements. Annual
    revenue accepts an explicit fiscal-year-ended date with a valid annual
    interval. An official issuer page may use its exact brand without a terminal
    legal suffix. Third-party aliases, fabricated dates and segment totals remain
    rejected. Prompts now agree with those acceptance rules.
11. Gemini requests/body reads could hang beyond the retry wait budget. One
    120-second deadline now covers pacing, requests, body reads, retries and JSON
    repair per ground/structure operation. External cancellation is preserved;
    errors are sanitized and retain safe HTTP status; retries count as actual calls.

## Live proof, and its limits

Used the existing saved Microsoft company via the actual app UI with automatic
research left paused. The repaired source-routing hunt published filing-reported
annual revenue within approximately 31 seconds (upper bound observed at the next
UI check). It survived reload. A later intermediate workforce attempt still
failed, exposing routing that stopped prioritizing filings once revenue was known.

After that correction, the next real hunt published 223K full-time employees
within approximately 26 seconds (observed upper bound). The original filing says
"As of June 30, 2026, we employed approximately 223,000 people on a full-time basis".

Confirmed in the actual card preview and its core-figure panel:

- Employees: 223K, linked to the retained annual filing.
- Annual revenue: $331.8B, linked to the retained SEC company-concept record.
- Users/customers: still unknown; no unduplicated company-wide population accepted.
- Valuation/company value: still unknown; live market-cap sourcing remains unfinished.
- Company description: still unavailable in this saved card.

These figures are **source-reported**, not independently audited truth. Annual
revenue is NOT ARR. The two live recovery timings are NOT a fresh-deck latency
benchmark. No broad live deck regeneration or paid test suite was run. Existing
decks have not all been repaired.

Local inspection URL (requires the existing local preview and saved browser data):
`http://127.0.0.1:4174/#/markets/mkt_enterprise-software-hyperscale-cloud-platforms-a_ltizt/deck?card=crd_microsoft-corporation-company_t9vsb`

## Verification

- Regression checks were observed failing before the routing, current workforce
  wording, excerpt selection, nested issuer formatting and deadline repairs.
- Final `pnpm check` passed: all workspace type checks, lint and unit suites.
- Paid live tests embedded in the automated suites do not run without a test key;
  their skip messages are not evidence of live success. The UI runs above are the
  separate actual live verification.
- Existing unrelated desktop configuration, local package store and category
  baseline document are excluded from this checkpoint.

## Next work, in order

1. Run a small fresh-deck benchmark through the actual UI with the configured
   key. Record discovery, first usable card, full core-card completion, reads,
   calls, field coverage and reopened persistence. Include both public and private
   companies before calling latency or coverage solved.
2. Improve source-backed company summaries and their retained qualitative
   evidence. Avoid recruitment/marketing boilerplate, empty replacements of
   useful supported summaries and SEC financial text masquerading as a description.
3. Cover disclosed market cap, private-company valuation and customer/user
   measurements with correct identity, reporting period, currency and population.
   Real tables require context-aware evidence, not weaker acceptance of model prose.
4. Distinguish research in progress, failed retrieval, not yet found and genuinely
   undisclosed values. Do not present an empty stub as completed quality research.
   Allow a bounded retry, not unlimited agent/key spending.
5. Audit actual populated dashboard journeys (overview, products, live intel,
   people/org, source history) and their refresh behavior. The card repair alone
   does not certify these sections. Compare data coverage, not just test counts.
6. Finish accurate/high-resolution logo discovery and fallback diagnostics in a
   separate focused slice; this checkpoint does not change logo/brand styling.

## Non-negotiable handoff rules

Preserve original evidence, revisions, human corrections, credentials, local
research and approved design. Never fabricate figures to fill four boxes. Never
combine product user totals into a whole-company population. Respect pause and
low-power settings. No automatic hunt loop for unresolved gaps: one recovery per
company per repository lifetime, including failed attempts; manual retries remain
available. Do not push/merge main or call the product production-ready based on
mocked tests or one repaired company. Save measured checkpoints, not promises.
