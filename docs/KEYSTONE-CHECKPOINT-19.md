# Keystone checkpoint 19 — target-aware originals and whole-product delivery map

Date: 2026-10-05. Branch: `revival/initial-card-redesign`. Approved visual style unchanged.

## Connected research improvement

- Original-source readers accept optional company ID/name and metric scope. The shared selector prioritizes a contiguous window containing the requested literal company name and relevant metric cues, rather than selecting a richer section about another company. Company-profile hydration uses company-wide scope; individual verification uses metric-specific scope.
- Browser direct-CORS, native desktop and cloud original services pass that scope through to the same selector. GeminiRepository's browser reader wrapper, initial company hydration and persisted-cloud metric verification are wired, not just scaffolded. Native transport options remain separate from application scope; typechecking caught and corrected a cloud interface mismatch.
- Cached excerpts and concurrent reads are keyed by URL plus company ID/name and metric. A successful employee excerpt cannot be reused as another company's or another metric's excerpt merely because the URL is identical. Same-scope short reuse retains the original capture date and copy isolation.
- Existing byte/timeout/redirect/DNS/retention boundaries and claim acceptance rules remain intact. Selection is not verification: acceptedMetricPassage still checks company, figure, definition, unit and literal date. Extracts remain at most 4,000 characters and contiguous in normalized visible page text; no window stitching or hidden script evidence.
- No extra model calls, prompts for new agents, or design changes. Different scope cache misses can require additional HTTP reads; this is not a claim of lower whole-run latency or cost. No durable record schema migration is required; attempts already retain company/metric scope.

## Wider product review

Added [the delivery map](KEYSTONE-DELIVERY-MAP.md), linked from the status handoff. It keeps nine areas visible: evidence/first-ready, Sentinel/Scouts, company dossiers/dashboard sections, branding/cards, finding stories/reports, ranking/monitoring, provider capabilities, vault/sharing/agent actions, and production journeys. Existing UI/screens and passing fixtures are explicitly distinguished from completed capabilities. Next work should deliver connected vertical slices, not extend the integrity-only checkpoint loop indefinitely.

## Test-first and red team

Three source-selection cases and one scope-cache case failed before implementation. They now select the target company/metric, handle literal parentheses in company names, and prevent cross-scope excerpt reuse. A further red-team case caught caller mutation of the scope before an asynchronous read; the cache now snapshots the scope and that regression passes. Browser and native transport fixtures each prove the late target excerpt is selected in one read, with normalization-aware contiguous-text assertions. Cloud tests prove scope forwarding and separated cache entries; repository verification proves scoped retrieval before interpretation. Existing acceptance checks reject the wrong company even after targeted retrieval.

The source scan uses sliding counts for repetitive documents rather than rescanning every hit for every company mention. This has no measured live latency claim. Tests exercise fake source bodies/provider seams; they are not independent validation of real business figures.

Final `pnpm check` exited 0: workspace typechecks, lint and test suites passed, including 412 research and 179 web tests. Desktop and browser production builds both exited 0, run sequentially. Existing Firebase import/chunk-size warnings remain release work. Live key-dependent audit suites remain NOT RUN when they self-skip. No paid live census or Gemini run was launched for this slice.

## Still missing / next acceptance gate

1. Actual original-page coverage: browser CORS and grounding-redirect limitations are unchanged; native live UI inspection was previously blocked by capture timeouts. Targeting readable pages does not make unreadable pages readable.
2. Canonical identity and typed period/definition reconciliation: aliases, parent/subsidiary attribution, annual revenue versus ARR, user/customer definitions and conflicting as-of dates remain. Literal name targeting deliberately does not infer aliases. When the target is absent or lacks recognized numeric cues, the existing generic fallback is retained and the acceptance gate must still reject unsupported claims.
3. A bounded supported/unavailable live company journey with request counts/timings, plus one coherent evidence-backed deeper dashboard section. Do not call fixture success a live accuracy result.
4. Company dashboards, specialist shareable reports, deterministic ranking, any-key capability routing, durable indexed dossiers and MCP/release journeys are not finished; use the delivery map to choose the next slices.

No new provider fleet, hidden proxy, credential extraction, main merge, deployment or production-readiness assertion. Save locally on the exploration branch and distinguish that from verified GitHub backup.
