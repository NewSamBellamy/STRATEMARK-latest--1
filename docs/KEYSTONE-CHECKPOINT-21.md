# Keystone checkpoint 21 — shared bounded source priority

Date: 2026-10-05. Branch: `revival/initial-card-redesign`. No UI, card design, persistence schema or shared-contract changes.

## Diagnosis before implementation

Used the existing shared protected native reader, with no API key/model call, on two grounding links from checkpoint 20. First resolved to `www.staffingindustry.com`, then returned HTTP 403: unavailable, 0 retained characters, 534 ms. Second returned a 302 from Google then retrieval failed: unavailable, 0 retained characters, 608 ms. These are two source-network observations, not deck latency/accuracy benchmarks. No restriction was bypassed. The first proves native redirect resolution already works; adding another resolver would duplicate existing code. The second's downstream failure is not fully diagnosed.

The initial company path, local/browser/native metric path and persisted-cloud metric path all previously read the first two usable citations, regardless of source quality. A regression reproduced Reddit and an unrelated retailer being read while later SEC and Reuters URLs were skipped.

## Implemented, connected change

One pure `selectOriginalSourceCitations` function in the existing original-source module supplies all three callers. It sanitizes/deduplicates links through the existing contract helper, recalculates publisher priority rather than trusting supplied credibility, ranks official-site/filing sources, reputable reporting, industry, unknown and user-generated sources, and returns at most two. Direct pages win ties over opaque grounding links; remaining ties preserve input order. Unknown niche sources remain eligible. No invented URLs, source fetch fallback loop, new cache, extra model step or new research pipeline.

Official company domains and bare publisher metadata are routing hints only, not validated identities. This ranking does NOT establish company/claim relevance. The existing original-text, identity, date, unit, basis and confidence checks still decide whether a figure can publish. Both selected reads may fail; no success is implied by selection.

## Verification

- Five tests failed before implementation: the actual verification selection defect and four source-policy cases. Focused source/verification/initial suites passed (47 tests at that point).
- Added integration coverage for first-card hydration priority and protected Google-to-publisher resolution; the latter checks that acceptance returns the actual final publisher URL, not Google, and rejects an incorrect reporting date.
- Initial full gate caught an unused replaced import; removed it. Final `pnpm check` exited 0: all workspace types, lint and unit suites passed, including 224 API and 182 web tests. Live credential-dependent shell audits still self-skip and remain NOT RUN. Desktop and browser production builds both exited 0, run sequentially; existing Firebase import/large-chunk warnings remain. Builds are not installer or desktop live-journey validation.
- No paid Gemini calls this checkpoint. Existing keys and user data untouched. Diagnostic source script/bundle live outside the repository and are not committed. No browser/native UI or recording in this slice.

## Red-team / next acceptance gate

We improved what the fixed read budget is spent on, not proved real first-ready research quality. Publisher accessibility, unsupported browser redirects/CORS, query relevance, canonical entity/period definitions and a complete accepted-figure journey remain gaps. Next: verify one accessible original through the protected native path and its configured-key company journey, plus an honest unavailable example. Do not scrape around a 403, invent facts to fill cards, or build a source proxy silently. If secure native UI remains unavailable, report it and pursue a supported explicit retrieval capability rather than extracting credentials.

Keep the whole-product delivery map in scope: useful deeper company sections, durable Scouts, brand assets, specialist reports, ranking, independent provider capabilities, queryable local vault/MCP and release are still unfinished. No claim of production readiness, main merge, deployment or verified remote backup.
