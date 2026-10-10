# Keystone checkpoint 10 — original-backed initial native metrics

Date: 2026-10-04 local. Branch: `revival/initial-card-redesign`. Previous checkpoint: `9a89e00`.

## Delivered and wired

Initial company hydration now accepts the existing host-owned OriginalSourceServices. Native repository deck creation supplies it; saved-catalog resume supplies it through runDeckResearch and hydrateDeckCards. Before the existing interpretation call, retrieve at most two usable original citation URLs, persist a company-scoped `company_profile` artifact, and include the extracts explicitly as untrusted data. Save failure stops interpretation/publication; cancellation is checked before saving/structuring and after interpretation.

The additive model-facing metric schema accepts optional passageSupport with the same URL/quote/as-of/basis/unit shape used by single-metric verification. On the protected path, each proposed business metric must pass that same deterministic original-passage gate before publication. Unsupported/missing/wrong-company/mismatched figures become null/unknown rather than merely receiving a weaker confidence label. Successful support records the actual final citation and literal reported date in its method note. Default missing core metric rows are explicit unknowns; usable market cap does not gain an extra unknown valuation row.

The protected path bypasses proxy estimation entirely. It does not manufacture ARR from headcount/funding/prices or treat a footprint proxy as users. Supported zero is not replaced by a proxy calculation. Cards, company metric queries and the company memory's card receive the same accepted rows; legacy CMS sees those rows, not unsupported proposals. This is not the new Market Position scoring system.

Original artifacts use the existing `src_<UUID>` identity contract. An actual filesystem test reproduced and corrected an initial ID mismatch that mocked storage did not catch. Artifacts reload after service restart. Existing source retention/export limits remain; initial artifacts are queried under company_profile, not independently linked accepted-fact IDs for every metric.

No @mi/contracts change, new dependency, key migration, UI redesign or additional model invocation. Protected company hydration still uses one grounding and one interpretation call. Up to two bounded original network reads and additional excerpt input tokens are introduced; cache reuse can avoid duplicate fetches, but whole-run latency/cost improvement is not yet demonstrated.

## Verification

Eleven tests added: nine initial evidence cases, one repository creation/card-reader query case and one native filesystem persistence case. Six initial failures reproduced unsafe publication/missing persistence before implementation. The real artifact store then rejected the first implementation's ID; fixed to its required UUID format. Discovery-stub regression confirmed current discovery does not expose proposed headline metrics; that behavior already existed and is not claimed as a new fix.

Covered: supported headcount, missing ARR without invented proxy, literal date/citation, missing/wrong-company original, citation-only promotion rejection, pre-interpretation persistence, failed disk write, initial discovery, saved-catalog pipeline resume, actual repository creation and consistent listCards/getCard/getCompanyMetrics results. The unavailable-source repository fixture finishes with honest unknowns and null tiers; it is not proof of a useful live deck or rendered UI quality.

Final `pnpm check` exited 0 after the supported-zero case: types, lint and all workspace unit suites passed; web reports 139 tests. No Gemini/Google API key was present in the process environment (checked names only); no encrypted desktop credentials were accessed. Three credential-dependent live audits are NOT RUN, not accuracy evidence. No paid application research, live whole-market run, screen recording or factual-accuracy benchmark.

## Red-team scope and remaining work

- Protected initial metrics apply when native OriginalSourceServices are configured, including desktop creation and the pipeline resume seam. Browser-only hydration, cloud ADK/CloudDeckWorker creation, delta expansion/hunts/red-team updates and separately generated dashboards remain legacy paths. Existing completed cards/older records are not retrospectively reverified. Never claim all ingestion is protected.
- Company identity, location, one-liner, brand/logo and narrative research are still model/source proposals, not independently accepted original claims. Card/reader numeric consistency is covered at repository queries; there was no new live or visual UI journey. The complete first-research milestone remains unfinished.
- Only two selected citations and one 4,000-character window per source are available. Useful figures can remain unknown because their source was not selected, dates/names differ, tables need richer extraction or the official domain lacks identity-bound authority. Do not weaken acceptance to fill the card.
- The shared passage gate is mechanical, not semantic proof. Parent/division scope, active/registered/paying definitions, currencies/periods, context, stale/retracted sources and conflicting publications still need typed claims and review. The provisional 366-day ceiling is not calibrated per metric.
- Original files are still absent from ordinary JSON-only exports; immutable accepted-fact history and semantic reconciliation remain unfinished. Existing human decisions/strong legacy records can survive reconciliation; this is not a migration that certifies old data.
- No complete Sentinel/Scout scheduler, provider fleet, new scoring method or MCP implementation was added. More unknowns are an honest safety outcome, not yet evidence of better research coverage.

## Next bounded checkpoint

Finish the same publication boundary for native delta expansion and cloud initial hydration, using scoped durable original services rather than Node transport in a browser bundle. Add identity-bound source targeting and typed observations so available legitimate disclosures pass without arbitrary relaxation. Run a small authorized Gemini card-to-reader audit once a key is securely configured through supported settings/process configuration: inspect originals for every displayed figure, record unknown reasons, source coverage, calls, tokens/charges when provided and first-ready timings. Do not run the large census/judge suite to substitute for this bounded audit.

Local exploration checkpoint only. Main/design/unrelated files preserved. GitHub backup requires separate confirmation.
