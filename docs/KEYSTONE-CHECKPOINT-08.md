# Keystone checkpoint 08 — passage-gated metrics and bounded read reuse

Date: 2026-10-04 local (checkpoint finalized). Branch: `revival/initial-card-redesign`. Previous checkpoint: `932b70a`.

## Moving the needle

Quality: desktop/native and cloud single-metric verification now pass candidate support through the same deterministic original-passage gate before the existing metric transition. A reputable URL alone no longer qualifies on these paths. The interpretation step returns a short original quote, source URL, metric basis, native unit and reported date. The gate requires the quote to occur in a successful saved extract, checks canonical company-name boundaries, parses the matching number/scale, requires metric/unit/date consistency and grades the actual final URL. Missing/mismatched/invented, unavailable, explicitly projected/estimated/negated and ambiguous multi-number support is rejected. Failed checks preserve values and successful-support dates; human-verified fields stay locked under the existing transition.

Calendar dates can be literal ISO or explicit English month-name forms; the quote is never rewritten to manufacture support. Invalid/future dates and reported dates more than 366 days before retrieval cannot renew current support. This is an initial conservative ceiling, not a validated per-metric freshness policy. Reported date/basis is included in the stored method note when the transition attaches new support. An unchanged already-verified value can retain prior citation/method-note metadata under the existing shared transition; complete accepted-fact revision history is still pending.

Bypass closed: citation-only correction hints no longer skip original checking on native desktop or cloud verification. Cloud ignores the proposed number and performs its normal check; native desktop falls through to that same check. That corrects the reproduced failure where an unavailable page still allowed a correction to revise a number. Normal checks still use one grounding and one interpretation call; no third/judge model call was added. Corrections that formerly skipped both calls can now cost two calls. Do not describe this safety tradeoff as a universal latency reduction.

Latency: cloud-app/native-service instances coalesce identical in-flight public-page reads and cache successful receipts for 30 seconds, at most 32 entries. Returned copies are isolated, retrieval dates are unchanged, failed/rejected reads retry and cache expiry fetches anew. Tests show two identical concurrent reads become one network operation, and repeated reads reuse a successful result. The cache never creates authority or bypasses passage validation.

## Measurements and verification

Small LIVE transport/cache smoke against `https://www.example.com/`, no model or API key: first fetch HTTP 200, 171 readable characters, 88 ms; immediate repeat HTTP 200, rounded 0 ms, still one total network read. This establishes live HTTPS/cache behavior on one simple public page only. It is not a Gemini accuracy test, a representative publisher extraction test or an end-to-end research latency benchmark.

Final `pnpm check` exited 0: types and lint passed; contracts 92, mocks 15, research 337, desktop 32, API 205 and web 139 tests reported passing. This checkpoint adds 31 cases: 24 passage cases, four cache cases, two native repository cases and one cloud bypass case. Tests include supported native write-back with original URL/report date, unavailable correction rejection, unrelated publisher page, invented quote, wrong company/name prefix, figure/units, annual revenue vs ARR, projections/negation, extra conflicting number, calendar dates, stale reporting, genuine zero, headcount, market cap and percentages. A prior queued mock response was reset correctly so one shortcut test cannot contaminate the next test. The cloud engine fixture now intercepts provider/network work after removing its old shortcut; no paid test request was introduced.

No design changes, framework migrations or runtime dependencies. No Gemini accuracy/call-latency audit, installer journey or recording. Credential-dependent audits without keys remain NOT RUN as live audits.

## Red-team reality / release blockers

- This is mechanical passage support, NOT semantic truth, perfect entity resolution or a hallucination-free guarantee. Co-occurring company/metric/value/date can still be semantically unrelated; subsidiary scope, fiscal periods, metric definitions (active vs registered users), currency context, conflicting sources and public-source reporting errors need richer typed claims and evaluation. A successful hash only identifies the received body.
- Browser-only GeminiRepository without native original services retains legacy citation-only verification and its shortcut. Other ingestion paths (first deck enrichment, metric hunt, fact-check/red-team corrections, dashboards and specialists) are not covered by this new gate. Never claim all visible figures are independently checked.
- Exact canonical names, literal date/currency and short prefix extracts can reject legitimate evidence. Unknown small-company websites still need identity-bound authority; the publisher registry is not universal. Some cards may have less machine-verified data. Missing evidence is not a weak business.
- Do not inflate verified rates by weakening these checks. Next improve relevant-passage extraction and canonical identities, then run a small authorized Gemini evaluation with supported/unavailable/contradictory examples, recording accepted/rejected reasons, actual call count and p50/p95 timings. A live configured key is still needed; never extract encrypted keys or paste credentials into chat.
- Separate artifact export/import/lifecycle, corruption recovery, immutable accepted-fact records and period-aware unchanged-value reconciliation remain unfinished. The native evidence files are not included in JSON-only exports. Legacy tier changes must not be presented as a research-confidence/business-quality conflation.
- Cache measurements do not prove lower whole-run latency. Source retrieval/interpretation are still bounded but model calls may dominate. Cache duration and the 366-day reporting ceiling need calibration before production monitoring.

## Next checkpoint, not another unused scaffold

Target the extraction/query seam that currently keeps only the first 4,000 characters. Find useful company/metric/date passages without paid re-research, retain their source identity/context, and evaluate actual supported/unavailable figures once a configured key is available. Extend accepted-fact semantics and the gate to other ingestion routes before Scout scheduling or ranking. Preserve the approved collectible design.

Local save only. Main and unrelated work preserved; GitHub backup unconfirmed.
