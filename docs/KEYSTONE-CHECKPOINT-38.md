# Keystone checkpoint 38 — source-backed products and roadmap

Date: 2026-10-06 local. Branch: `revival/initial-card-redesign`. Parent: `98bc04c`.

## Connected behavior

Products & Roadmap now has a dedicated official-source lane. Research reuses company/topic-scoped originals and otherwise uses one bounded grounding search followed by at most two sequential original-page reads. Each completed read is saved before synthesis; cancellation, a later read failure or persistence failure does not silently erase the first result. Explicit refresh bypasses the completed short-lived read cache and does not republish stale product availability if the new read fails.

The model selects candidate names and literal quotes from retained originals. Deterministic checks require an eligible HTTPS URL on the company's exact official host or a subdomain, a successful retrieved original with a content hash, and the quoted words to occur in that original. Product status must match an explicit lifecycle phrase tied to that product; missing status, unrelated product status and negated availability are dropped. Roadmap titles need an announcement/planning sentence; displayed dates must be valid literal dates in that sentence. Overdue plans are not presented as delivered. Unknown timing stays unknown. Displayed descriptions quote what the company reported and identify retrieval date; model-written product copy, revenue contribution, inferred links and revenue ranking are excluded.

Stored selections are rechecked against retained originals on reopen. Legacy ungrounded product cache is left intact for recovery but is not surfaced as current evidence or silently replaced with paid research. Original receipts are retained through the authorized cloud source path under its existing ownership, entitlement and spend checks. This is a narrow product/roadmap lane, not a full company dossier or continuous Scout.

The existing page received wording corrections only: it no longer claims products are revenue-ranked, calls an announcement page a product page, or treats an empty retained horizon as proof that nothing was announced. Card proportions and the approved design were not changed.

## Verification

- Focused research tests: 59 passed across products, dashboard evidence, excerpt handling and source coalescing.
- Focused API tests: 9 passed for dashboard source retention and cloud route behavior.
- Focused web tests: 4 passed for the products/roadmap reader and repository refresh behavior.
- Full `pnpm check` exited 0: workspace type checks, lint and all package test suites passed. API-key-dependent live Gemini tests explicitly skipped because no key was available in the test environment.
- Desktop production build and browser production build both exited 0. Existing Firebase chunking and large-bundle warnings remain.
- No live Gemini company research or measured paid-call run was completed in this checkpoint. Automated tests use controlled provider behavior and do not prove source accuracy in a real provider journey.

## Red team / remaining risks

The lane trusts the domain already associated with the company record; wrong company-to-domain resolution still needs a real journey test. A quote proves what the company said, not that a product remains available today. Retrieval date is not the statement's publication date. Lifecycle wording is deliberately conservative and English-pattern-based, so it can miss accurate disclosures. Product selections are reinterpreted from originals on reopen rather than persisted as independently versioned dossier records. Cloud product-selection caching and the full native/browser/app journey are not proved here.

No credentials were read, copied or committed. No paid calls, remote push, main merge, deployment or publication occurred. This checkpoint does not mark any whole delivery area or the product production-ready.

## Next measurable step

Run the bounded real configured-Gemini public/private first-ready journey through the actual app, then use observed coverage, unknown reasons, agreement across card/reader/dashboard, timing and source counts to choose the next connected dossier section. If the app key is not available through its normal UI, do not extract encrypted credentials; keep advancing on the actual app journey and document the blocker.
