# Keystone checkpoint 06 — original-source receipts in cloud verification

Date: 2026-10-03 local. Branch: `revival/initial-card-redesign`.
Preceding checkpoint: `452abfa`. [Build plan](../01_PROJECTS/Stratemark/Specs/Keystone-Build-and-Test-Plan.md).

## Delivered, not just scaffolded

The authenticated cloud metric-verification route now retrieves up to two cited original pages in parallel. It records requested/final URL, retrieval time, HTTP outcome, SHA-256 of the received body, a bounded readable extract and truncation state. Blocked/unavailable outcomes are recorded without invented text. Receipts are scoped to company and metric, saved before model interpretation, passed to interpretation as untrusted data, and returned in the API response. Model failure no longer erases the retrieved evidence. Firestore reload preserves the new field. No visual redesign, scoring changes or new paid model calls; the existing zero-extra-call correction shortcut remains unchanged.

The retrieval module is provider-independent. HTTPS only, public IPv4 only, no URL credentials or nonstandard ports. Every redirect is revalidated, with at most three redirects. DNS answers are checked and the socket connects to the validated address while retaining the original Host/TLS server name and Node certificate validation; it does not resolve the hostname a second time. No provider credentials, cookies, browser JS or proxy are used. Each read is bounded by six seconds, 256 KiB and a 4,000-character extract. Unsupported/compressed formats, non-200 responses and detected noarchive/nosnippet restrictions are not retained as text. URLs are length-bounded. This does not bypass bot gates, paywalls or access controls.

Retention is explicitly an eight-attempt rolling diagnostic history in the existing deck record. It is NOT the permanent original-document vault, immutable fact history or local user knowledge base. Existing document-size/revision guards remain active; a failed evidence save stops interpretation rather than acknowledging false durability. A verification uses two revision-checked writes, so polling may observe the receipt-only intermediate revision.

## Verification and red team

Seventeen retrieval behaviors failed against the initial unavailable-only stub. Two route regressions reproduced discarded originals and missing interpretation input; a production-store regression reproduced loss on reload. Added coverage includes unsafe URLs, mixed public/private DNS, IPv4-mapped IPv6 rejection, private redirects, redirect loops, denied/unsupported/oversized content, stalled DNS, truncation, actual HTTPS configuration and streaming overflow. Route tests cover model failure, unavailable-source preservation and two-source/eight-attempt limits. Fixtures intercept network and model calls; no user research or credentials were accessed.

Final `pnpm check` exited 0: workspace types and lint passed; contracts 92, mocks 15, research 305, desktop 27, API 204 and web 139 tests reported passing. This slice adds 32 API regression cases. No live source, TLS, Gemini accuracy or latency benchmark was run. Three credential-dependent audits return early without a key and remain NOT RUN as live audits. The request/configuration and storage tests are mocks, not deployed-service evidence.

## What this does not prove

- A retrieved page is not independent verification of a figure. The existing verdict/citation transition is still active; exact passage/entity/value/unit/definition/period validation is not implemented. Current `verified` badges must not be interpreted as proof of that stronger gate.
- The old valid cited-correction shortcut bypasses new original retrieval. Other ingestion routes and original-page support gates still need auditing.
- Local GeminiRepository/desktop research does not use this transport yet. This optional cloud slice must not be described as complete local-first evidence coverage.
- Only two provider citations are read; their ordering is not guaranteed to maximize authority. Google redirect destinations are retained but not independently identity-bound for source grading.
- Prefix extracts can miss a relevant passage; HTML cleanup is deliberately basic and not a rendered-page/PDF/table extractor. Noarchive/nosnippet detection is conservative, not a full publisher-policy/licensing parser. IPv6-only sources are unavailable by design.
- Six seconds is an added I/O bound, not a measured speed improvement. Extracts add bounded input tokens; no additional model invocation was introduced.
- Permanent local artifacts, snippet targeting, conflict reconciliation, company identity, prompt-injection-resistant claim validation, retries/caching and a user evidence-reader remain unfinished. The existing screenshot capture path was not hardened by this module.

## Next bounded slice

Expose the same safe retrieval through the local desktop boundary and persist scoped evidence as separate local artifacts, not ever-growing deck JSON. Then enforce typed passage support (entity, metric, units, period, reported-vs-estimated) before promotion, including correction shortcuts. Run one supported and one unavailable figure with the authorized configured Gemini key once accessible without extracting secrets. Only then progress to card/reader readiness and Scout scheduling. Preserve the approved Keystone design and company-to-dossier journey.

Checkpoint saved locally; GitHub backup is unconfirmed. Main, existing user data and unrelated untracked files remain untouched.
