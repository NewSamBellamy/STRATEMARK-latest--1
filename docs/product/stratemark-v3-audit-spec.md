# Stratemark v3 — Red-team findings and product/engineering plan

**Status:** living exploration spec
**Branch:** `explore/stratemark-collectible-card-lab`
**Input:** founder walkthrough (`startemark v3 audit.mp4` and its accompanying transcript), current desktop/web implementation, and the open-source BYOK product direction.
**Decision rule:** preserve Stratemark’s restrained green, editorial identity. Cards should feel considered and collectible, not like a game UI pasted over research. No card backs or flip interaction in this direction.

## Product thesis

Stratemark should be a personal, evidence-led market-research library that keeps useful company and market knowledge close at hand. It should make a first pass easy, a useful company deep dive obvious, and later changes discoverable without implying that an AI agent is watching when no check has run.

The core loop is:

1. Start with a market, a company, or companies the user already knows.
2. Discover the rest of the space and explain who/what was included and why.
3. Browse a distinctive deck of company cards; open one company to get a fast, cited orientation.
4. Continue into a focused research workspace, ask a scoped question, save the finding, or compare selected companies against explicit criteria.
5. Refresh the research later, showing what changed, what did not, what is uncertain, and which sources support each assertion.

The desktop app should remain useful without a Stratemark account or hosted Stratemark service. Users bring provider keys. Be precise about privacy: the desktop currently stores the research snapshot as ordinary JSON (with backup/recovery copies), not encrypted at rest; Electron encrypts the provider key with `safeStorage` in a user-data file but exposes the plaintext key to renderer JavaScript through preload; the browser build stores its key in `localStorage`. A research run also sends its prompts/content to the selected model/search provider under that provider's terms. “Local-first” must not be marketed as “encrypted” or “never leaves this device.”

## Red-team findings from the walkthrough

These findings describe the experience shown in the supplied recording, not claims about every current build.

### Deck and card browsing

- “All decks” reads more like a list of large decorative posters than a library of research collections. Cover art competes with the market identity, and users cannot quickly preview the contents before opening a deck.
- Company cards have a promising collectible shape, but their evidence and identity are not yet legible at a glance. Decorative hex serials / “FIELD NOTE” labels read as invented metadata. Stronger company identity should come from a real, large logo or an intentional fallback—not filler artwork.
- Cards need controlled diversity: brand asset and color where verified, but consistent type hierarchy and evidence placement across every market. Do not let generated gradients, arbitrary palettes, or a generic illustration imply company branding.
- A universal “best company” number would be misleading. Existing maturity tiers mean company scale/maturity, not quality, investment merit, or fit. Ranking must be tied to an explicit user objective and comparable evidence.
- Comparison selection should apply only where the objects and criteria are comparable. Reusing company-comparison controls on insight/barrier cards creates the wrong mental model.

### Opening a card and company research

- The card-to-research transition is the key moment: the first click should answer “what is this, why should I care, and how sure are we?” without making the reader learn a tab system first.
- The previous inspector split a small summary across Overview, Evidence, and Company stage tabs. The founder found it hard to read and navigate. A concise single-page orientation should lead to the full research workspace; keep detailed metric methodology and conflicts there.
- Company, market-insight, and barrier/risk cards are different research objects. They need related visual grammar, not one generic company dashboard.
- A single company “snapshot” must not discard important evidence. Show a few high-value citations in the card inspector, then expose the full source trail, methodology, conflicts, and dates in the research workspace.
- The dashboard is too dense / uneven across its sections. Metrics need context and units; Live Intel must say what was checked and when; empty states need a useful next step; products, team, history, mission/governance, and market context should earn their place with evidence rather than filler.

### Research trust and ongoing intelligence

- Progress and “live” language should describe actual work. A recent timestamp is not proof of continuous monitoring. Show the last completed check, its scope, sources attempted, and whether anything changed.
- A source count is not a quality score. Display usable, de-duplicated source receipts and distinguish a cited fact from an estimate or an unsupported lead.
- The vault should accumulate observations rather than silently replace old research. Conflicts, stale facts, and user corrections need an audit trail.
- Empty insight decks are valid outcomes when no supported insight exists; do not manufacture insight cards merely to fill the deck.
- Logo lookup is a separate enrichment task. Missing/broken logos need a neutral fallback and a retry path; they should not block or restart market research.

## Experience requirements

### A. Start, scope, and progress

- Accept a natural-language market description, one or more seed companies, or a request to expand an existing market.
- Before expensive research, show a compact scope summary: geography, included entity types, time horizon, known seed companies, and exclusions when applicable. Let the user correct it.
- Stream truthful stages such as “searching”, “extracting source-backed facts”, “reviewing evidence”, “saving cards”, and “complete/partial/failed”. Every stage must be backed by a real task state; do not display synthetic agent activity.
- Persist partial results and resumable checkpoints. A failed provider call must not erase completed source work.

### B. Library and deck

- Treat the library as a set of named research collections. A collection preview should show its market, last successful refresh, company count, and a small real preview of its contents before entering it.
- The default deck is a company browser. Company cards have a large verified logo/identity area, concise one-liner, at most two high-value comparable facts, visible evidence/freshness, and a restrained stage label only when the stage meets the evidence rules.
- Do not render made-up serial numbers, rarity, growth arrows, rankings, counts, or brand colors. Missing values remain missing; fallback identity is clearly generic.
- Use separate card templates/labels for company profiles, market insights, barriers, and risk/controversy. Never attach company metrics to a signal card.
- Cards open with ordinary click/tap and remain one-sided. Save, share, and keyboard navigation must not accidentally open or select another card.

### C. Card inspector: orientation, not the whole dashboard

- Present the company/finding name, one useful summary, up to four carefully chosen key points, a small number of clickable source links, freshness, and an evidence status.
- For companies, say explicitly that stage describes scale/maturity and is not quality or investment advice. Show it only when at least two distinct usable company signals are recorded and at least one has a usable citation; otherwise say why in plain language and do not show an unsupported tier.
- Actions are specific: “Explore research”, “Ask about this company/finding”, “Save”, and “Share”. Each action preserves selected market/card context.
- The reader fits a single short orientation at common desktop and laptop heights. If content overflows, it scrolls as one coherent surface; no nested, competing scroll areas.
- Insight cards open an insight-focused report/question context. Barriers and risks open their own evidence-focused view. Do not route every signal to a generic market page.

### D. Company research workspace

Retain the existing navigation only where each section gives a distinct, sourced answer. Reorder or merge tabs based on task tests rather than preserving tabs for completeness.

- **Overview:** what the company does, where it sits in the market, notable current developments, and a concise evidence/freshness summary.
- **Live Intel:** sourced event feed with publisher, publication date, capture/check date, company relation, and why the event matters. “No change found” is distinct from “not checked”.
- **Metrics:** only metrics with clear definitions, periods, units, scope, and source. Separate reported, estimated, and human-confirmed values. Show disagreement and method; never chart-impute, zero-fill, or imply a trend from one observation.
- **Team & organization:** named people/roles only when source-backed and dated; label incomplete coverage.
- **Products & roadmap:** public products and explicitly announced roadmap only. Do not infer roadmap items or order products by speculative revenue.
- **History:** dated, linked events with explicit unknown periods rather than fabricated chronology.
- **Mission & governance:** primary-source language where possible; clearly label company statements versus independent reporting.
- **Market context:** relevant peers, infrastructure, barriers, and market signals, with scope and criteria exposed.

### E. Signals and insights

- An insight is a synthesized, falsifiable market observation—not a company profile. Its card should use a short headline, a one-sentence explanation, its time window, and a clear evidence-depth indicator (not “rarity”).
- Opening it should show the evidence behind the pattern, relevant companies, counterexamples, uncertainty, and a question scoped to that insight.
- Barriers and controversies must stay distinct. Controversy claims require citations and careful language; unsubstantiated claims are dropped, not softened into insinuation.
- An empty result explains what was searched and offers “broaden scope”, “add a source/provider”, or “check again” without making a fake card.

## Ranking: do not turn stage into a quality score

### Current safe behavior

For browsing, order company cards by an evidence-supported maturity stage, then sourced-figure count, then company name. A stage is browseable only when at least two distinct usable non-market-share company signals are recorded and at least one has a usable citation. Market share stays out of stage eligibility until its market scope is captured. This is a navigation order only. It is not “best first”, an investment ranking, or evidence that the first company is more attractive. An unsubstantiated tier is treated as unranked for this ordering.

### Product decision for a real ranking

There is no useful universal ranking across arbitrary markets. Before ranking, ask or infer transparently what “best” means for this user: e.g. fastest-growing, strongest distribution, direct competitor, best fit for a stated buyer, most exposed to a risk, or most relevant to a defined investment thesis. The app must show the criteria and weights, date window, missing inputs, and evidence coverage.

Ranking acceptance requirements:

- No scalar company-quality score without user-selected criteria and a validated comparison set.
- Compare only like-for-like measures with the same definition, unit, time period, and scope; normalize only with an explicit, testable method.
- Missing/unknown is not zero and is not silently penalized as poor company performance. Show “not enough comparable evidence” when necessary.
- Expose per-criterion values, citations, confidence, and the effect of each weight. The result must be reproducible from saved evidence and criteria.
- Keep company maturity, research coverage, source quality, and objective-fit as separate concepts and labels.
- Test ordering under ties, missing values, stale values, conflicting sources, and user-edited weights.

## Evidence and storage model

Move toward an append-only-while-retained evidence ledger and derived current view. Provide a deliberate, verifiable erasure path; history is not a reason to retain a user's data forever:

- **Source record:** canonical URL, publisher, title, source kind, source date when known, retrieved-at, content fingerprint, and retrieval status.
- **Observation/claim:** subject/entity, normalized predicate, value/text, unit/scope/time period, observed-at, validity interval when known, confidence/status, method, and provenance to one or more source records.
- **Research run:** requested scope, provider/source adapters, model identifiers, start/end/status, budget usage, checkpoints, and errors—never API secret material.
- **Projection:** current card/dashboard summary derived from observations, with references back to the evidence. Updating a projection must not delete prior observations.
- **Contradiction:** preserve both source-backed observations, identify the disagreement, and show dates/methods; do not average or select silently.
- **Human correction:** append a user-verified observation with actor/time/reason. Model output cannot set `user_verified`.
- **Retention/erasure:** define per-vault retention and deletion behavior for sources, extracted text, observations, projections, indexes, logs, backups, crash-recovery copies, and separately stored provider keys. Document whether source text is retained or only fingerprints/short evidence spans. Retries need stable observation IDs/idempotency; source updates need explicit version semantics.
- **Privacy boundary:** research and user-specific notes are scoped to a local vault; this does not protect them from other processes running as the same OS user. Provider requests send the submitted prompt/source content to that provider. Export or sharing is deliberate and visibly reviewed. Vault deletion and provider-key deletion are separate choices because an app-level key may be shared by multiple vaults.

Integrity invariants from repository policy remain hard constraints: verified figures require usable citations; unknown values are `null`; unsupported vice claims are dropped; charts do not impute; company metrics never leak into signal cards; model/provider responses are untrusted input. Red-team inspection found enforcement gaps: the shared metric normalizer accepts non-empty prose in the legacy `source` field as evidence, and a clickable citation is not proof that the cited page supports that exact figure. The card presentation currently downgrades some citationless `verified` values, but other consumers can still misread stored confidence. Until claim-to-source support is checked, label the state as “source cited/attributed” rather than implying “verified”. Promotion to `verified` needs a retrieved source excerpt or precise evidence span, source date, and a validation result that links the specific claim to that evidence; add tests for prose-only attribution and unrelated URLs.

## Provider and research architecture

Keep the existing desktop-first, bring-your-own-key promise. **Current state:** the local BYOK research path uses Gemini for grounded search and structuring; OpenRouter model routing and independent Perplexity search/Sonar adapters are not implemented. Split provider capabilities instead of pretending one model endpoint is also a search engine:

1. **Model adapter** — structured extraction, synthesis, classification, and user Q&A. Keep provider/model selection explicit and support model capabilities rather than hard-coding one vendor. Inputs sent for a run leave the device for that provider; disclose the provider and applicable retention policy.
2. **Search/retrieval adapter** — discovers source URLs/snippets and retrieval metadata. Search results are leads; they become evidence only after retrieval, extraction, validation, and citation checks.
3. **Fetch/extract adapter** — downloads allowed public pages/documents, handles robots/terms and content-type limits, extracts text, stores fingerprints, and reports unavailable/blocked pages truthfully.
4. **Orchestrator** — plans bounded work, budgets calls, schedules independent company tasks, checkpoints results, retries transient failures with caps, and records partial completion.
5. **Evidence verifier** — validates source URLs, source/claim alignment, units, time scopes, confidence, and duplicate/contradictory facts before projection.

Provider implications to preserve in implementation:

- OpenRouter can route model requests through a broad catalog using an OpenAI-compatible API surface; it is a model-routing choice, not an independent citation source. Provider BYOK behavior and fallback settings must be explicit.
- Perplexity Search returns structured source results; Perplexity Sonar is a separate answer-with-citations surface. Neither should be hidden behind a generic “OpenRouter search” abstraction.
- Provider choice is configurable per capability. Users can combine one model provider with a different search provider; unsupported combinations are surfaced before a run.
- **Current security gap:** Electron encrypts the key with `safeStorage` and writes an encrypted blob to a user-data file, but preload currently returns the plaintext key to the renderer; browser storage uses `localStorage`. The local research file is JSON, not encryption. Treat renderer compromise and access to the OS user profile as in-scope risks.
- **Target:** keep desktop secrets in the main process and expose only “configured”, save, test, and revoke operations; use an appropriate browser secret-storage warning for web-only BYOK. Never put keys in logs, research records, exports, renderer-visible URLs, or synced data by default. Provide test-connection, revoke, and per-provider delete.
- Separate secret protection from research-data protection. Either encrypt the vault and define backup/key recovery, or clearly disclose that the local JSON and its `.bak`/recovery copies are readable by processes with access to the user profile. Vault erasure must remove those copies as well as indexes and the related provider key when requested.
- Show a preflight estimate/range, user-configured call/credit caps, actual usage, and a stop/resume action. Budget exhaustion leaves completed work intact.
- Use deterministic adapters and replay fixtures in tests; no live provider is required for the default test suite.

Provider evaluation matrix should compare: source discovery, direct page retrieval, citations/provenance, structured output reliability, latency, cost controls, rate limits, data retention, terms, and offline/local options. Select based on observed market research quality, not brand familiarity.

Technical references reviewed: [OpenRouter Quickstart](https://openrouter.ai/docs/quickstart), [OpenRouter Chat Completions API](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request), [Perplexity Search API](https://docs.perplexity.ai/api-reference/search-post), and [Perplexity Sonar Quickstart](https://docs.perplexity.ai/docs/sonar/quickstart). Recheck the current provider contracts, pricing, data policies, and key controls when each adapter is implemented.

## “Alive” without pretending to be always-on

- **Current behavior/risk:** opening a deck with a key mounts an automatic living research loop. It can perform up to 60 actions during one mount and may start over when the deck is reopened. In Electron, the repository does not currently pass the usage-counting callback; the app-level spend cap defaults to unlimited; Gemini retries are not counted individually. Therefore the present loop is not safely budget-bounded and is not an around-the-clock service.
- **Target behavior:** background spending is explicitly opted into per deck, with a persistent app/provider-level budget and a visible pause/stop control. Manual refresh remains available. An offline desktop cannot promise around-the-clock polling.
- Each market has an explicit refresh cadence, next check time (if scheduled), last successful check, last attempted check, coverage, and provider health. Cadence, pause/resume, missed-check handling, and budget state survive app restarts; count every actual provider attempt including retries and fallback providers.
- A check compares new source-backed observations with the prior ledger and emits a change event only when a defined fact/event differs. Repeated unchanged sources are collapsed.
- Notify only on user-chosen event categories/thresholds. “No meaningful change found” is a real result; “not checked” is never represented as “nothing changed”.
- If later adding an optional hosted worker, make it opt-in and separate from the open-source local core. Explain where research and keys travel before enabling it.

## Future MCP / assistant integrations

Treat MCP as a later, separate adapter over the same local research application layer—not a rewrite of the research core. Initial read tools could search/list the user's vault, fetch a company/market research bundle, and return claims with citation URLs and freshness. Those results leave Stratemark and enter the host application's context (for example, ChatGPT/Codex/Muse); “local transport” does not mean “content remains on this device”. Write tools could start a bounded market/company research run or expand a deck from supplied seed companies, but must require explicit scope and obey the same budgets, privacy, and confirmation rules.

- MCP responses include provenance, freshness, completeness, and uncertainty; assistant-facing tools do not return bare unsupported summaries. Treat fetched page text as untrusted prompt-injection input. As a target permission rule, tools may perform only explicitly granted, bounded research mutations; they cannot arbitrarily edit/delete the vault, import/export data, manage provider keys, or mark facts user-verified.
- Local MCP transport should not expose the vault to the network by default, but still requires per-client grants and a clear disclosure of what content is sent to each host. Remote transport/auth is a separate security review.
- Provider keys remain in the Stratemark desktop's OS-backed secret store; they are never included in tool results or forwarded to ChatGPT/Codex/Muse.
- Add protocol conformance, permission-boundary, cancellation, timeout, and prompt-injection tests before exposing write tools.

## Sharing and export

Portable HTML deck sharing is a later product surface, not a shortcut around the local vault. Keep it distinct from the existing share-by-URL feature: current links carry a compressed/base64 payload (not encryption), and recipients can read the embedded report/deck contents. The current decoder lacks bounds on incoming URL/hash length, encoded payload size, decompressed size, card count, and field/string lengths, plus strict deep validation; impose limits on both encoder output and every decode stage before encouraging wider sharing. HTML exports are immutable snapshots with a visible “captured on” date, methodology/disclaimer, working citation links, and no embedded API keys, private notes, or hidden provider transcripts. Preview the exact package and let the user choose companies, signal cards, and private fields before export. Avoid scripts and auto-loaded remote assets by default (remote images/fonts can leak a viewer's visit); validate imported files and treat embedded text as untrusted data.

## Delivery phases and gates

### Phase 0 — Card and transition cleanup (current exploration pass)

- Remove decorative fake serials/foil and keep the brand/logo as the card's hero.
- Show real unique clickable-source count and freshness; never label metric rows as sources.
- Keep the inspector one-sided and one-page, show concise orientation and citations, and make the deep-research action explicit.
- Keep compare controls out of non-company card types.
- Show/order a maturity stage only when at least two distinct usable non-market-share signals are recorded and at least one has a usable citation; this is not a company-quality ranking.
- Keep company compare selection functional in both flat and stage-grouped company browsing; never offer it for non-company types.
- Make source previews honest when only the first four links are shown, give the scrollable reader panel an accessible region name, count sourced risk claims as provenance, and route company-linked signals to a finding action.
- Tests cover evidence provenance, card order, source rendering/truncation, no flip/back, company-linked signal routing, compare selection, and screen-reader region semantics.

### Phase 1 — Deck library and task flow

- Research the full create → scope → progress → deck → open card → research → return journey at laptop and small desktop sizes.
- Rework collection covers and allow preview/browse before opening the market workspace.
- Add strong recovery for missing markets, zero insights, partial runs, broken logos, and stale/failed refresh.
- Acceptance: a first-time user can find a specific company, understand why it appears, inspect its evidence, and return to the same deck without losing context.

### Phase 2 — Company research quality

- Audit every dashboard section against the evidence contract; simplify, reorder, or remove sections with no distinct user value.
- Make metrics comparable and dated; clarify verified/estimated/user-confirmed states; remove any implied trend without history.
- Make Live Intel scope, dates, source attempts, and freshness explicit.
- Close the verification gap: distinguish citation-present from claim-supported; do not emit “verified” until the retrieved evidence supports the exact claim and its scope/date.
- Acceptance: each displayed fact can be traced to one or more usable source receipts; empty states distinguish no result from not checked; keyboard and screen-reader routes work.

### Phase 3 — Durable evidence ledger and safe refresh

- Implement observation/source/run entities and migrations; derive current views without overwriting history.
- Add conflict, duplicate, stale, correction, resume, retention, and deletion/privacy semantics. Account for backups and crash-recovery copies, not only the live snapshot.
- Acceptance: replaying the same run is idempotent; a changed source creates a new observation; conflicting evidence remains visible; deleting a vault removes its local data and secrets with clear confirmation.

### Phase 4 — Multi-provider BYOK

- Define model/search/fetch capability contracts; implement provider adapters one at a time with fixture tests.
- Add OS-backed key storage, test/revoke, budget preview/caps, and partial-run recovery.
- Evaluate OpenRouter, Perplexity Search/Sonar, and at least one direct provider against the same benchmark before selecting defaults.
- Acceptance: desktop renderer cannot retrieve plaintext provider keys; browser key persistence is clearly scoped; no keys in logs, research records, URLs, screenshots, tests, or exports; provider failure does not erase research; a complete run works with the selected user key and without a Stratemark account. Vault-at-rest encryption (or an explicit, accurate plaintext disclosure) is decided separately from key protection.

### Phase 5 — Continuous intelligence

- First remove unsafe auto-on-open/unbounded spend behavior. Add explicit opt-in, a persistent main/provider-layer cap, accurate retry/fallback accounting, pause/resume across restarts, configurable local schedules, deltas, deduplication, review queues, and notifications. Document that local polling only occurs while its configured runtime is available.
- Acceptance: user can inspect what was checked; no-change, not-checked, and failed are distinct; user controls cadence and alert categories; no background cost can exceed configured limits.

### Phase 6 — MCP and assistant workflows

- Expose read-only library tools/resources first, then opt-in bounded research tools.
- Acceptance: exact citations/freshness accompany results; each host has explicit read/write grants and the user is told what content leaves Stratemark; untrusted source text cannot authorize tools; permissions and local transport are tested; no provider secret or vault-management action crosses the model-tool boundary.

### Phase 7 — Portable sharing

- Add reviewed, self-contained exports after ledger and privacy fields are stable.
- Acceptance: offline rendering, citation links, redaction preview, bounded decompression/size, strict import validation, no auto-loaded remote assets, and no secrets/private notes are tested. URL-share content disclosure is explicit and separate from HTML export.

## Measurement and quality bar

Track funnel and trust separately: time to first useful company; percentage of card opens that reach evidence/deep research; successful return-to-deck rate; source-link clickability; share/export review completion; proportion of displayed metrics with usable citations; stale-data visibility; partial-run recovery; provider failure recovery; zero unsupported numeric values; and user-reported clarity of what is verified versus estimated.

Do not optimize card opens, number of generated cards, or “insights per run” alone. Those incentives produce sensational copy and filler rather than a useful research product.

## Immediate implementation record

This pass is intentionally a small, reversible first slice. It removes fake serial/foil dressing; counts unique usable citations including risk-claim sources; only surfaces a stage when two distinct usable non-market-share signals and at least one cited signal exist; orders company browsing by that stage, never as a quality ranking; preserves compare selection in stage groups while hiding it from other types; and simplifies the card inspector with source previews, an accessible reading region, risk evidence, and a path to deeper research. Independent red-team findings now identify budget, evidence-verification, key-boundary, plaintext-vault, MCP disclosure, and share-link hardening as release blockers. Those backend/security items remain planned and must not be represented as fixed or production-ready.
