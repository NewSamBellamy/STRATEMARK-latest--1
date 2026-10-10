# Spec: Keystone evidence-first research architecture

Status: proposed implementation plan, not shipped capabilities.
Reviewed: 2026-10-03. Audited checkpoint: `a8f0d15`, branch `revival/initial-card-redesign`.
Scope: research backend and its user-visible contracts. Preserve the approved card design. This document supersedes conflicting backend recommendations in older Keystone notes, not unrelated frontend work or historical records.

Scoring addendum: [Market Position and Sentinel ranking](Keystone-Market-Position-Scoring.md) defines the proposed 1-99 relative index, cohort-wide reranking and evidence gates. Read both documents before building; ranking is a cohort projection, not absolute company quality or an LLM-assigned tier.

## 1. Problem statement

Stratemark must make a company understandable quickly, then become the local place a researcher returns to for trustworthy depth and meaningful changes. The card is the entrance to a company dossier, not a substitute for it. A deck organizes a market; evidence connects everything.

The present backend has useful parts: injectable research clients, schema validation, grounded enrichment, sourced signal agents, incremental jobs, retry helpers, dashboard request deduplication, freshness planning, human overrides, telemetry, and local recovery. Keep those. However, citation presence currently substitutes for claim verification in important paths. Local grounded notes are a useful new foundation, not an original-document evidence database.

No architecture can promise all information is accurate or discover every company in an open market. The enforceable promise is narrower and stronger: no unsupported claim is presented as verified; every displayed fact states its entity, meaning, period and evidence; unknowns and disputes remain visible; failures do not lose research or cause runaway spending.

Audit method: inspected the actual web/desktop repository selection, Gemini clients, company enrichment, verification/reconciliation, dashboard/signal paths, local persistence, living runtime, agent graph and relevant test contracts. No new paid live research or security penetration test was performed. Findings below distinguish demonstrated code behavior from risks requiring reproduction. Previous checkpoint's full journey test failed; unit-test volume is not evidence of live factual accuracy.

## 2. Red-team findings and priority

Paths below are relative to the repository root; line numbers identify the audited checkpoint and may move.

| ID / priority | Evidence and gap | Required correction |
| --- | --- | --- |
| R01 / P0 | `packages/contracts/src/provenance.ts:140,169`: unknown publishers can qualify; nonempty prose attribution can preserve verified status. Supplied credibility can also bypass hostname classification. | Central claim/evidence gate. Model credibility and prose are proposals, never verification authority. |
| R02 / P0 | `packages/research/src/company-agent.ts:219` links a model-selected source index to a metric; clients retain citation lists but not claim-support mappings. | Preserve provider support metadata where available; retrieve the original and match the exact passage, entity, metric and period. A cited article may not contain the figure. |
| R03 / P0 | `repository.ts:1370` verification can accept a concrete currentValue plus acceptable citation without requiring a supported verdict; `markVerified` also runs after unverified outcomes. | Validate verdict/value consistency. Separate lastAttemptedAt, lastSupportedAt and sourcePublishedAt. Failed checks never refresh a support timestamp. |
| R04 / P0 | `packages/contracts/src/schemas.ts:133`: metric row has no required reporting period, currency, population definition or legal-entity scope. | Typed observations prevent ARR/revenue, users/customers and parent/division substitution. No metric conversion hidden in prose. |
| R05 / P0 | `provenance.ts:298`: equal evidence weights prefer existing value, regardless of reporting period; same value takes incoming fields. | Compare equivalent observations only. New periods are history, not necessarily conflicts. Equal numbers never silently downgrade a stronger receipt. Preserve correction lineage. |
| R06 / P0 | `repository.ts:218,366`: normalized names strip legal suffixes and non-ASCII characters and drive reuse. | Resolve canonical identity with validated domain, jurisdiction and registry IDs where available. Name-only merging needs confirmation; multilingual and subsidiary identities stay distinct. |
| R07 / P0 | `repository.ts:700` ingests stubs immediately; enrichment and dashboard research finish later. | Discovered placeholders may show as research in progress, but cannot masquerade as finished collectible cards. One readiness gate covers card face AND initial reader. |
| R08 / P0 | `research-evidence.ts:26` stores company-scoped grounded notes; refresh verification, hunts, market findings and briefings are not all scoped receipts. | Every paid research action writes a durable job result and evidence receipt, including partial/error outcomes; sourced findings retain evidence even when structuring fails. |
| R09 / P0 | `localStore.ts:58,75,83`: asynchronous vault writes and quota shedding of dashboards/reports. `vault.ts:126` restores only catastrophic market loss, not newer same-market notes. | Durable acknowledged transactions; reports are user artifacts, not disposable caches. Revision-aware recovery and explicit durability errors. This is a failure risk, not a reproduced loss in this audit. |
| R10 / P1 | `research-evidence.ts` scans an ever-growing snapshot and uses keyword matching; desktop export passthrough does not deeply validate the new evidence collection. | Indexed local evidence storage, validated import, deletion lineage, workspace scoping and bounded search. Never trust imported receipts as previously verified. |
| R11 / P1 | `gemini.ts:36` and `adk/engine.ts:84,91`: disabled default pacing, graph concurrency 32. Browser repository supplies concurrency 3, so blast radius differs by execution path. | Shared provider/key limiter, explicit task budgets, bounded queues, fair scheduling and retries. Do not assume every current run uses 32 workers. |
| R12 / P1 | `apps/api/src/lib/budget.ts`: fixed per-call estimates, per-instance counter, BYOK excluded. Browser meters call count; SDK can report token usage. | Durable per-workspace usage ledger and reservations across retries/search/image fees. Provider hard limits remain the billing backstop; app estimates are not guaranteed invoice caps. |
| R13 / P1 | `apps/web/src/lib/living/runtime.ts:191`: open-session timer and action count; no demonstrated durable per-company scout scheduler here. | Persistent scout records and resumable jobs. App-closed/sleeping desktop is not around-the-clock service. Display the actual execution state. |
| R14 / P1 | `RepositoryProvider.tsx:26`, desktop `main.ts`, raw/SDK Gemini clients, cloud service: multiple execution paths and Google-oriented contracts. | Same evidence/readiness rules for local/cloud/desktop. Introduce capability adapters incrementally; do not maintain competing definitions of truth. |
| R15 / P1 | `logos.ts:144`: Wikidata selection uses normalized label equality; curated aliases and favicons help but do not prove identity or current official assets. | Match registry/domain/entity before selecting assets; store source and validation status. Resolve official press kits first, cache locally, permit retry/manual correction. |
| R16 / P1 | Signal agents have source indices and drop unsourced claims, but a citation alone does not establish the claim or independent corroboration. | Attributed, contextualized findings; allegations vs findings, subject response, relevance, counterevidence and source independence. No unsourced defamatory inference. |
| R17 / release blocker | Prior `pnpm check`: dashboard journey test could not find Back to card; live audit tests self-skipped without keys. | Reproduce the journey failure; resolve it and run an approved small real-provider benchmark. Do not call the current app production-ready. |

Cross-cutting risks to test rather than assume solved: hostile source/import instructions, SSRF and redirects, SVG/script payloads, stale multi-window writes, cancellation after a provider charges, cross-workspace leakage, interrupted backup/migration, deleted-deck job revival and source licensing.

## 3. Solution overview

One local research engine, three agent roles, one evidence standard:

```text
User question / market scope
  -> Sentinel: plan, budget, discover, resolve identities
  -> Card Scouts + Market Specialist: acquire and extract evidence
  -> Shared evidence gate: support, meaning, period, conflicts
  -> Local company dossiers + findings/shards + revision history
  -> Card / reader / dashboard / report / Ask / MCP
  -> User-enabled monitors: detect changes, verify, publish meaningful deltas
```

Use the current TypeScript package and repository interfaces. No new orchestration framework, vector database, cloud fleet or graph database is a prerequisite. Refactor only while delivering a working vertical slice. Avoid a big-bang rewrite of the repository.

### Sentinel

Own market boundaries, included/excluded companies, discovery coverage, source plans, task assignment, readiness checks and budgets. The model can propose research tasks; deterministic code enforces permissions and limits. Report coverage as discovered/checked/unresolved, not "every company found." Stop discovery on marginal yield and explicit coverage limits; expand on request.

### Card Scout

One durable assignment per canonical company per workspace, reused across decks. Deck memberships attach to that assignment; a deleted deck does not recreate a second company scout. Store scoutId and a stable human-readable number; the number identifies the assignment, not company rank, source count or an always-running model instance. Existing card identifiers are not scout numbers.

The scout owns legal identity, logo/brand assets, core figures, products, pricing, leadership/org chart, positioning, financial disclosures, dated history and change monitoring. Every field has supported / undisclosed / not-applicable / disputed / pending status. The scout remains assigned while enabled, but computes only on user request or approved schedules. Bounded attempts end with a reason; undisclosed private metrics cannot trigger endless hunts.

### Market Specialist

Find and research Insight, Culture, Vice and Barrier cards with dedicated source plans. Produce a concise meaningful front, an evidence-backed reader, and a full cited report. These are findings, not entities: no borrowed company metrics, maturity ranking, company comparison or company briefing controls. Chat remains contextual to the finding.

The evidence verifier is a shared service, not a fourth permanently running agent. Deterministic checks first; bounded semantic review for difficult evidence, independent review for sensitive or materially consequential claims. More models do not create independent sources.

## 4. Exhaustive implementation user stories

1. Define a market, geography, purpose and must-include companies without configuring internal agents.
2. Review resolved companies and exclusions; correct ambiguous identities before research combines them.
3. See discovery and pending work immediately, but no unsupported finished card.
4. Open the first ready card with its logo, summary, core figures and reader already consistent.
5. See explicit unknown/undisclosed/not-applicable fields instead of fake zeroes or unrelated replacement metrics.
6. Open a figure's receipt with original source, exact support, definition, period and attribution status.
7. Read progressively deeper company sections without repeating the same research call.
8. Inspect incompatible or disputed observations without losing the prior value or my correction.
9. Correct a fact/asset myself; automation proposes changes but never overwrites my lock silently.
10. Research a company already in another deck and reuse its authorized local dossier and scout.
11. Ask a company/market question and receive scoped evidence, uncertainty and only actually used citations.
12. Ask about a past period and obtain the corresponding version, not today's value disguised as history.
13. Save a shard: one reusable, cited finding linked to its companies, deck and report.
14. Read Culture/Vice/Insight/Barrier as a story with counterevidence and optional full report.
15. Share a card/deck/report snapshot without keys, private annotations or accidentally bundled local files.
16. Import a shared deck safely; inspect its original research date and recheck it before treating it as current.
17. Enable a scout schedule, preview estimated cost, pause it and choose meaningful alert topics.
18. Return to a short "what changed / why it matters / evidence" feed, not repetitive agent chatter.
19. Configure one key or complementary keys; see which capabilities are ready, limited or unavailable.
20. Switch a provider/model without losing data, weakening verification or silently sending it elsewhere.
21. View research cost, unfinished coverage and errors; resume after quota resets or connectivity returns.
22. Cancel a job, close/reopen the app, or restart after a crash without duplicate accepted changes.
23. Read/search saved research offline with no key; a fresh research request explains why a key is needed.
24. Export, back up, restore or delete my research and credentials separately, with clear deletion behavior.
25. Grant an MCP client limited access to chosen research; approve paid actions and revoke access.
26. Research small/private/non-US/public companies without US-only assumptions or different credibility standards.

## 5. Data and module decisions

### Six deep modules, small interfaces

1. **Identity catalog:** resolve identity, aliases, parent/division relations, domain and registry associations. Merge decisions reversible with lineage.
2. **Provider gateway:** validated capability routes, secret references, endpoint policy, deadlines, cancellation, usage, rate limits and allowed fallback.
3. **Evidence vault:** acquire/store/search original documents, passages and observations; local indexed transactions and asset files. Grounded notes stored as notes, never transformed into raw evidence by relabelling.
4. **Research runner:** Sentinel/Scout/Specialist jobs, checkpoints, task state, budgets and fair scheduling. Existing agents call this incrementally.
5. **Publication service:** verification policy, reconciliation, readiness and consistent versioned card/reader/dashboard/report projections.
6. **Intelligence service:** relevant change detection, watchlists, scoped Ask/shards, exports and connector operations.

Proposed application actions: researchMarket, researchCompany, refreshCompany, researchFinding, queryKnowledge, getEvidence, getChanges, setWatchPolicy and exportSnapshot. Each accepts workspace/subject scope, explicit options, idempotency key and cancellation where applicable; returns jobId or versioned typed data. MCP wraps these actions rather than manipulating storage directly.

### Durable records

- **CompanyIdentity:** workspace ID, stable ID, aliases, jurisdiction, registry identifiers when available, validated domains, entity/division relationship and resolution evidence.
- **ScoutAssignment:** scout ID/display number, company ID, enabled memberships, coverage, watch policy and last job. Do not persist giant conversation context as its identity.
- **SourceDocument:** requested/resolved URL, publisher, content hash/version, retrievedAt, publishedAt if established, MIME, licence/access status and local locator. Preserve fetched originals only when allowed; otherwise retain allowed metadata/excerpts. Strip active content, never execute downloaded pages.
- **EvidencePassage:** document ID, exact excerpt and locator/page/offset, extraction method, quote hash and content-version link. Model-written passages never qualify as fetched quotes.
- **ClaimObservation:** entity, property, value/unit/currency, measurement basis, period/asOf, source passage IDs, attribution, extraction method and review result. Distinguish first-party disclosure, independent report, supported estimate, user assertion and disputed claim.
- **CanonicalFact:** accepted observation(s), policy version, decision reason, freshness and revision. A human correction has actor/time and lock status, not invented model sign-off.
- **ResearchJob:** persisted task graph, inputs, status, attempt log, lease, checkpoint, permission/provider routes, usage reservations and output revisions.
- **Finding/shard:** stable ID, kind, concise headline, summary, evidence-linked body, affected company IDs, market context, caveats/counterevidence, importance and revision. "Shard" means a reusable finding, not storage partitioning or game currency.
- **ChangeEvent:** previous/current observation, business significance, source receipt, event date/detected date, watch relevance and delivered state.
- **AssetRecord:** official/retrieved source, company/person identity, local hash, validation, rights and brand usage. Image generation only for clearly labelled illustration, never factual logos, executive portraits or proof.

### One truth policy

Publication checks: valid entity -> accessible supporting evidence -> exact value/definition/unit -> compatible reporting period -> attribution and source independence -> conflicts -> readiness. Invalid or unsupported facts remain out of verified projections.

For numerical disclosures, deterministic table/XBRL extraction and unit/period checks outrank model arithmetic. Semantic entailment review can assist; it is fallible and must not be marketed as guaranteed fact-checking. State "company-reported" when that is what we know. Evidence quality, business maturity and research coverage are separate dimensions; no universal investment-quality score.

Legacy "verified" does not automatically become receipt-verified. Migrate to legacy/unreviewed provenance until rechecked. Preserve history and human input; refuse malformed imports. Reconcile by equivalent entity + metric basis + unit/currency + period, not number alone. Retraction and corrected filings supersede prior support with an audit trail. Review stale human-locked values without overwriting them.

### Local storage

Desktop target: SQLite for indexed records/jobs/transactions plus content-addressed local files for permitted source documents/assets. Browser preview: IndexedDB stores behind the same asynchronous contract; do not promise browser storage is an unevictable backup. Migrate the current file/snapshot with verification, backup and rollback, one store at a time. Keep historical exports readable. Do not delete reports to make room.

Use scoped full-text search first; filtered semantic retrieval is optional after measurable misses. Answers retrieve relevant passages by company, period, property and document version, not concatenate every report. No full-library uploads. Embeddings, if later added, are rebuildable derived indexes with an explicitly approved local/remote route.

## 6. Source acquisition and provider combinations

Source plans execute in code: identity/jurisdiction -> relevant original sources -> independent corroboration -> specialist data -> attributed community evidence. A whitelist alone is insufficient: an old earnings release is trustworthy but stale; an official allegation response is not independent proof. Syndicated articles and mirrors share an origin and count as one evidence lineage.

Start with accessible original company sites, press kits, investor relations and SEC submissions/companyfacts for applicable entities. Other jurisdictions use appropriate registries and filings, with entitlement/rate rules per connector. News/search supply discovery and corroboration, not invented originals. SEC APIs do not support browser CORS: use desktop/main-process acquisition or an explicitly chosen service, not an untrusted public proxy. [SEC documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)

Search-provider filters matter: Exa supports includeDomains and Tavily supports restrictive/preferred include_domains. Use explicit adapter filters when supported, not pretend prompt site: hints are enforced restrictions. [Exa](https://exa.ai/docs/reference/search), [Tavily](https://docs.tavily.com/documentation/api-reference/endpoint/search)

Capability routes: reason/structure, search/ground, fetch/extract, optional vision/image and optional embeddings/transcription. One credential may cover several, but no credential is universally capable. Preserve the current Gemini path behind an adapter. Probe configured capabilities with user consent; advertise tested compatibility, not "every key works."

| Stack | Benefit | Limitation to display |
| --- | --- | --- |
| Gemini only + permitted public sources | Simple grounded research and structuring | Native grounding does not replace original claim receipts |
| Supported reasoning provider + Exa or Tavily | Separate reasoning from targeted search/extraction | Separate billing and permission to send evidence to that model |
| OpenRouter with supported search tools | Broad model choice behind one routing endpoint | Tool/model/schema features must be tested; no legacy :online assumptions |
| Local model + public retrieval | Local synthesis and offline querying | Weaker/untested models may need retries; public fetch availability varies |
| Existing stack + licensed financial data | Better coverage for entitled datasets | Respect redistribution and caching licences; no fabricated access |
| Existing stack + optional image provider | Editorial visuals | Never improves factual confidence and never blocks card readiness |

OpenCode documents native provider adapters, model catalogues and custom compatible endpoints; reuse that compatibility approach rather than write 75 bespoke integrations. Distinguish chat-completions, responses and provider-native protocols. A new endpoint adds transport, not automatically grounding/vision/structured-output support. [OpenCode providers](https://opencode.ai/docs/providers/)

OpenRouter now recommends its web-search server tool over deprecated :online variants; validate the current API at implementation time. [OpenRouter documentation](https://openrouter.ai/docs/guides/routing/model-variants/online)

Missing search capability: saved research remains readable; new research explains the missing route. Additional keys boost measured coverage/latency or difficult review, not run every source/model every time. Escalate only when disagreement, poor coverage or consequential ambiguity justifies it. Cache and deduplicate before escalation. Never fail over to a different paid provider or privacy boundary without prior approval.

Provider-specific grounding annotations/support mappings are retained where available; they describe support within the generated answer, not proof that the original page says the exact claim. [Google grounding](https://ai.google.dev/gemini-api/docs/google-search)

## 7. Speed, readiness, spending and continuity

Visible states: discovered -> identity-resolved -> collecting -> evidence-reviewed -> card-and-reader-ready -> deepening -> watching. A field can finish as explicitly undisclosed, not-applicable or unresolved after bounded attempts. No minimum metric count that pressures fabrication. Ready means honest supported content and explicit unavailable fields, not all companies having revenue.

Research card essentials and the first reader as one priority task. Deep dashboards follow, beginning with what the user opens or asks. Fairly rotate across scouts so one large company cannot starve a deck. First company ready streams immediately; no need to hold it until all deep tabs finish. Pending deck members remain clearly separate. Never say every tab is filled when only a topology exists.

Reuse original fetches, extraction results and accepted observations across cards/decks within a workspace. Cache keyed by identity/document revision/policy, not display name. In-flight dedupe extends to expensive searches/refreshes. Changed facts invalidate only dependent views; a logo fix should not delete the financial dashboard.

Persist queued/running/paused/quota-blocked/partial/complete/failed/cancelled jobs. Leases and idempotency prevent duplicate accepted results after restarts. Exactly-once external billing cannot be promised: ambiguous network responses may already have incurred charges. Record that uncertainty and avoid blind retries. Timeout, abort, 429/backoff and authentication failure have distinct recovery states.

Default proposed concurrency: three company jobs, with per-key/provider request/token limits underneath, tuned by measured results. Fair shared limits apply across decks, tabs, retries and background tasks. Use conservative usage reservations and expose actual provider usage when returned, including search/image charges. Unknown pricing requires an explicit allowance instead of a false dollar guarantee. Scheduled work is opt-in with ceilings and quiet hours. No work should resume simply because the deck reopened and reset a session counter.

Initial performance targets are hypotheses, not claims: acknowledge actions under one second; warm local reads p95 under 250 ms on the benchmark machine; return scoped local search under one second for 100,000 observations; first usable company+reader target p50 under 60 s, p95 under 120 s on the specified 10-company live benchmark. Measure provider waits separately. Evidence requirements do not weaken to hit a timing target; slow providers yield transparent partial progress.

Persist compact agent state with evidence references and outstanding tasks. Keep stable prompt prefixes, bounded retrieved passages and provider-supported prompt caching. Do not resend giant deck histories. Compaction never deletes original evidence or unresolved decisions; every checkpoint records active task, accepted decisions, failures, tests and next action.

## 8. Returning-user value and security

Retention loop: question -> useful card -> deep evidence -> saved finding/watch -> meaningful change -> updated understanding. Surface material funding/product/pricing/leadership/regulatory changes with before/after, evidence, date and why they matter to the user's purpose. Allow no-change outcomes; never fabricate activity to make scouts feel alive.

Feed filters reflect investor/founder/researcher purpose, not manipulative streaks. Source count measures unique qualifying original documents, separates coverage and last supported date, and is never a quality/rank score. A saved shard retains provenance and context; exporting it preserves references and indicates snapshot age. Shares are immutable snapshots by default, not implicit remote access to a continuously updated private library.

Desktop schedules run only while the app/approved background process can execute; machine sleep/closure must be honest in the UI. Always-on hosted watching is a separate opt-in later service, not required for local BYOK release.

Secrets remain in secure OS storage for desktop. Browser keys have XSS exposure; document that boundary rather than promise identical protection. Credential refs never enter evidence, logs, shares or MCP. Custom endpoints are explicit trust decisions: no silent forwarding of another provider's key.

Treat external text/imports as data; tools are allowlisted and permission-scoped. Fetches block private/reserved addresses and revalidate redirects/DNS; deliberate local-model endpoints get a separate narrowly configured exception, not a global SSRF bypass. File imports have size/type/schema limits; local paths are normalized under the workspace; sanitize assets and HTML. Defend against source prompt injection and model-generated URLs/actions. Licence-aware caching and share rights are mandatory.

MCP first exposes selected-workspace read/query/evidence/changes. Paid research/refresh and export are explicit writes with consent and job receipts; deletion has separate confirmation. Local stdio is first target; remotely hosted MCP requires its own auth/audience checks, not passing provider tokens through. Test hostile requests and revoke access. [MCP security guidance](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices)

## 9. Phased delivery: one category at a time

| Phase | Working outcome | Implementation seams | Exit gate |
| --- | --- | --- | --- |
| A: stop false certainty | One company has trustworthy card/reader facts | contracts provenance/schema; company-agent; repository verify/hunt/red-team; API equivalents | Unsupported/prose-only/wrong-period/wrong-entity facts cannot become verified; failed check cannot reset freshness; revision preserves prior support |
| B: durable dossier | Original evidence and research survive restarts | evidence-vault contract; desktop storage; browser localStore/vault; import/export | Transaction crash/quota/multi-window/recovery tests; no report shedding; valid migration+rollback and scoped search |
| C: genuine Scouts/Sentinel | Market produces ready cards first, then deep research | identity catalog; pipeline/adk/company-agent; jobs/readiness; dashboards | Ambiguous identities isolated; first reader consistent with face; unknown/private company terminates honestly; cancel/resume and dedupe work |
| D: useful findings/shards | Specialist cards open into cited, readable reports | signal-agents; finding/report contracts; Ask retrieval; share snapshots | No borrowed metrics, unsupported allegations or source bloat; saved/shared finding retains citations, caveats and scope |
| E: provider openness | Verified research through single and mixed stacks | gateway; types; gemini/genai; settings; desktop secrets | Same contract test suite on Gemini, compatible reasoner+search, and local saved-query mode; failures/privacy/fallbacks visible |
| F: living intelligence | Watchlists surface meaningful source-backed changes | freshness; living runtime; durable scheduler; event projections | No-change is quiet; quotas respected; no duplicate alerts; offline/sleep and undisclosed-field backoff honest |
| G: connector and release | Same dossiers safely accessible through MCP | common action layer; MCP adapters; shared exports; desktop packaging | End-to-end permission/revocation tests; no secrets in outputs; release quality/security/backup gates below |

A and B are highest leverage. Deliver A through one small end-to-end Gemini slice before expanding schemas across every dashboard. Introduce minimal capability contracts while doing C; broad provider UI/testing waits for E. Do not postpone durable writes until background agents amplify the data volume. No phase ends with unused scaffolding: it needs a visible complete journey and founder review.

## 10. Testing and verification seams

Unit/contract adversarial fixtures: URL attached to a number absent from page; forged primary credibility; prose-only source; same URL across copied articles; wrong subsidiary; non-ASCII name collisions; run-rate labelled ARR; monthly users labelled paying customers; currency/unit conversion; stale repeat of old report; restatement; future publication dates; source changed/retracted; null vs zero; unverifiable private data; sensitive culture allegation without response; imported forged human sign-off.

Integration: fetch -> allowed original storage -> exact passage -> observation -> accepted fact -> consistent card/reader/dashboard/report/Ask. Repeated job input has no duplicated accepted records; receipt creation survives structuring failure; every research path records scope; another company's notes never leak; data deletion cancels dependent jobs and respects backup retention policy.

Reliability: crash at each transactional boundary; multi-window concurrent updates; corrupted and future-version import; disk full/browser eviction; cancellation during provider wait; retries after 429/401/5xx; billing-uncertain timeout; missing price catalogue; multiple decks sharing limits; archived scout cannot restart itself; unsupported route degrades rather than guesses.

Security: malicious page instructions, private-IP redirect/DNS rebinding, local file traversal, SVG/HTML payloads, oversized imports, malicious model tool requests, connector scope escalation, secret-bearing export/log. Use a maintained URL/network guard, not regex-only SSRF protection.

Commands: `pnpm check`; focused `pnpm --filter @mi/contracts test:run` and `pnpm --filter @mi/research test:run`; then packaged desktop and browser full journeys. Mock tests do not establish source accuracy. Reproduce/fix the current app-flow failure before claiming a clean release gate.

Live benchmark, only with user-approved spend: ten deliberately chosen public/private/small-business/non-US/parent-division companies, plus four diverse specialist findings. Human audit every displayed card metric and reader claim against original evidence; test one mixed-provider stack. Measure unsupported-as-verified errors, entity/definition/period errors, coverage of available disclosures, honest unknowns, source traceability, cost/company, first-ready latency, warm latency and duplicate calls. Zero unsupported-as-verified observations in this release fixture is mandatory, not a universal accuracy promise. Sensitive claims require manual review until a demonstrated safe process exists.

Release gate: all visible research statements have attributable evidence or are labelled interpretation/unknown; originals/passages can be inspected where permitted; no secret or cross-scope leaks; reliable backups/recovery; no destructive quota shedding; resumable bounded jobs; transparent provider spend; all advertised buttons work; basic accessibility and approved design survive; dependency/build/update/signing/license checks completed. Million-user ambitions do not justify a million-user cloud design before local research is reliable.

## 11. Out of scope and decisions that must not drift

No guaranteed exhaustive market coverage, guaranteed zero hallucinations, opaque universal investment rating, 24/7 execution on a sleeping desktop, automatic access to licensed databases, generated factual logos/portraits, silent remote sync, or assumption that a chat subscription grants API spending credits. No blockchain/gamification backend, fleet of permanently running models, cloud-required account, or vector-first rewrite.

Changes to privacy boundary, paid provider fallback, hosted monitoring or publication require explicit user decisions. Tune thresholds/cadence on benchmark evidence, not intuition. Keep the approved front aesthetic; backend quality must support it, not enlarge or clutter the cards.

## 12. Checkpoint protocol

Each slice records: exact commit/branch; implemented vs planned; user-visible improvement; adversarial tests; live tests actually run; spend if known; remaining risks; next bounded slice. Commit only coherent work, never main; GitHub backup failure is reported rather than called saved remotely. Keep an active handoff with document path and phase; do not re-derive the architecture from chat after compaction.

Next implementation slice: Phase A, one company profile and verification path with typed evidence receipts and a single publication gate, plus fixtures for R01-R05. Preserve old rows as legacy/unreviewed; do not turn every unknown into an expensive research loop. Pause for founder review after the first tangible card+reader improvement.
