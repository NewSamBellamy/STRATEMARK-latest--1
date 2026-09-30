# Stratemark open research roadmap

**Product promise:** Stratemark is a free, open-source desktop research workspace. Users bring their own provider keys and keep their research library locally. Provider usage may still cost money under the selected provider's terms.

The goal is not to imitate a one-shot deep-research report. Stratemark should feel like a small team of research agents that builds a durable, inspectable company-intelligence library: it scopes work, searches broadly, extracts claims, challenges weak evidence, saves partial progress, and shows what changed over time.

## The simple mental model

Stratemark has three independent capability layers:

1. **Intelligence model** — plans, extracts, compares, and writes. Examples: Gemini, an OpenRouter model, or a local OpenAI-compatible model.
2. **Research connector** — discovers or retrieves current web evidence. Examples: Gemini's native Google Search grounding, Firecrawl, Perplexity Search, or Serper.
3. **Tools and integrations** — opt-in access to external systems through MCP. These extend Stratemark; they do not receive blanket access to keys or the local vault.

Gemini can perform grounded research without an additional search key because its native Google Search capability combines the model and search layer. A model selected through OpenRouter or another OpenAI-compatible endpoint does not automatically have a comparable search capability; it needs a compatible research connector unless the selected model endpoint explicitly provides and returns usable citations.

## Connector capability matrix

| Option                         | Role in Stratemark                              | Separate key                      | Useful for                                      | Important limitation                                                                   |
| ------------------------------ | ----------------------------------------------- | --------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| Gemini + Google Search         | Intelligence model and native grounded research | Gemini key only                   | Simplest first-run setup                        | Tied to Gemini's grounding behavior and pricing                                        |
| OpenRouter / OpenAI-compatible | Intelligence model                              | Model-provider key                | Broad model choice and local endpoints          | Model routing is not automatically web research                                        |
| Firecrawl                      | Search plus page extraction                     | BYOK for sustained/production use | Full-page evidence and difficult sites          | Usage, crawl rules, and cost must be visible                                           |
| Perplexity Search              | Ranked web search with extracted result content | Yes                               | Current discovery with structured results       | Search and Sonar answer APIs are different products                                    |
| Serper                         | Google-style search result discovery            | Yes                               | Fast discovery across web/news/images           | Results often need a separate fetch/extract step                                       |
| DuckDuckGo                     | Deferred/experimental                           | Not offered initially             | Possible future discovery option                | No verified official general-purpose production search API; do not scrape result pages |
| MCP tools                      | User-installed integrations                     | Depends on tool                   | Vault access, private sources, custom workflows | Must be permissioned per tool and treat returned content as untrusted                  |

The settings screen should describe these differences in plain language and recommend one working path rather than asking a new user to understand the whole matrix.

## Twenty-five improvements, in priority order

### Research quality and backend

1. **Separate models from research connectors.** A user can combine an intelligence model with a compatible search/retrieval provider without changing the research pipeline.
2. **Make Gemini the zero-extra-connector path.** A Gemini key alone can complete a grounded run; the product explains that an additional web-search key is unnecessary for this configuration.
3. **Add an OpenAI-compatible model adapter.** Support OpenRouter and local endpoints through an explicit base URL and model choice, without promising web access that the endpoint does not provide.
4. **Add connector adapters one at a time.** Start with a generic tested HTTP connector, then ship first-party Firecrawl, Perplexity Search, and Serper mappings.
5. **Bind every synthesized claim to known source IDs.** Never accept URLs invented by the model; citations must come from normalized connector results or retrieved pages.
6. **Retrieve evidence, not only search snippets.** Introduce a fetch/extract phase so important claims can be checked against page text and precise evidence spans.
7. **Use multi-pass research roles.** Separate scope planner, discoverer, company researcher, evidence critic, contradiction checker, and final editor rather than asking one prompt to do everything.
8. **Seed research deliberately.** Preserve user-supplied companies, generate distinct query angles, expand aliases/domains, and measure whether each seed was found and researched.
9. **Create an evidence-quality benchmark.** Maintain representative markets with expected companies, time-sensitive facts, hard-to-find private companies, conflicting metrics, and intentionally unanswerable questions.
10. **Measure coverage, not verbosity.** Score entity recall, claim support, source diversity, freshness, contradiction handling, and unsupported-number rate—not report length.
11. **Persist resumable research runs.** Save completed work after every meaningful stage so provider errors, rate limits, or app restarts do not discard useful research.
12. **Build an append-only evidence ledger.** Store sources, claims, dates, scopes, conflicts, and human corrections separately from the current card projection.
13. **Make budgets enforceable.** Preflight likely calls/cost, count retries and fallbacks, apply persistent provider-level caps, and let the user pause or stop safely.
14. **Keep provider secrets outside renderer code.** Desktop UI can configure, test, and revoke keys but cannot read plaintext keys back from the main process.

### Cards, interface, and visual quality

15. **Make the company identity the card hero.** Use a verified logo or restrained typographic fallback, with controlled brand color only when sourced from a real asset.
16. **Limit cards to high-value glanceable facts.** Show the company purpose, at most two comparable facts, freshness, and evidence coverage; remove decorative or invented metadata.
17. **Use honest card diversity.** Company, insight, barrier, and risk cards share a design system but have distinct information structures; avoid generic AI gradients and filler art.
18. **Replace universal ranking with objective-fit comparison.** Ask what “best” means, show criteria and weights, and keep maturity, evidence coverage, and user fit as separate concepts.
19. **Make the first card click a concise orientation.** Answer “what is it, why does it matter, and how sure are we?” on one coherent surface before opening the deeper workspace.
20. **Turn the company view into a research narrative.** Lead with current situation and key changes; progressively reveal metrics, evidence, team, products, history, and market context only when supported.
21. **Use high-value visuals only when the data earns them.** Prefer peer maps, dated event timelines, evidence matrices, market maps, and comparable metric tables. Never chart a single observation as a trend or fill unknowns with zero.
22. **Add polished research motion.** Use restrained transitions for cards arriving, evidence resolving, changes appearing, and saved context returning; animation must communicate state and honor reduced-motion settings.

### User journey and connected product

23. **Add a scope checkpoint before spending.** Show geography, entity types, time horizon, seed companies, exclusions, providers, and estimated usage in a short editable review.
24. **Make continuous intelligence truthful.** Show last attempt, last success, coverage, changes, failures, next scheduled check, and budget state; never imply around-the-clock monitoring when the local app was offline.
25. **Expose the vault through permissioned MCP.** Begin with read-only search/list/fetch tools that return freshness and citations, then add explicit bounded research actions. Make Stratemark useful from Codex, ChatGPT, and other MCP hosts without exposing keys or silent write access.

## Delivery sequence

### Milestone 1 — Provider composition foundation

- Preserve the existing research API while introducing separate intelligence-model, native-research, and search-connector interfaces.
- Gemini continues to work by itself.
- An OpenAI-compatible model plus a generic HTTP search connector can complete an evidence-bound grounded request.
- Partial connector failures are visible; complete evidence failure cannot fall back to model memory.

**Gate:** focused adapter tests and the full repository check pass; no new UI claims or provider secrets are added.

### Milestone 2 — First-party connectors and setup

- Add Firecrawl first for search-plus-extraction, then benchmark Perplexity Search and Serper.
- Add capability-aware settings, connection tests, revoke/delete, cost/privacy language, and configuration preflight.
- Do not offer DuckDuckGo as a production connector without an official supported API.

**Gate:** fixture-based tests cover authentication, rate limits, malformed responses, cancellation, deduplication, and secret redaction.

### Milestone 3 — Agentic research and evidence verification

- Add bounded specialist passes, full-page extraction, claim/evidence alignment, contradiction review, and checkpointed runs.
- Run the benchmark across at least three provider combinations.

**Gate:** materially better entity recall and claim support than the current Gemini baseline, with zero tolerated fabricated citations and an explicit unsupported-number target of zero.

### Milestone 4 — Cards and company workspace

- Iterate every card state using real benchmark data, including unknowns, conflicts, weak logos, sparse companies, and dense companies.
- Redesign the card-to-research transition and simplify the company workspace around decisions and evidence.

**Gate:** first-time users can identify a company, understand why it matters, inspect evidence, and return to the deck without losing context; accessibility and reduced-motion checks pass.

### Milestone 5 — Living vault and MCP

- Add safe refresh schedules, change detection, notification controls, and permissioned read-only MCP access.
- Add bounded MCP research actions only after budgets, cancellation, and provenance are enforced centrally.

**Gate:** no background work can exceed the configured budget; no MCP response contains provider secrets; no source text can authorize a tool action.

## Product quality test

A release is not ready because it generated an attractive deck once. It is ready when the same workflow handles a mainstream market, an obscure market, sparse private-company evidence, contradictory sources, missing values, a provider failure, a cancelled run, and a later refresh—and remains honest, useful, recoverable, and visually coherent in every case.

## Implementation record

- **Provider composition foundation:** implemented. The existing pipeline can now use Gemini's native grounded research or compose an intelligence model with explicit external search connectors. External synthesis is restricted to normalized source IDs, fails closed without evidence, and handles bounded retries, cancellation, partial provider failures, and secret-safe errors.
- **First-party connector factories:** Firecrawl v2 Search, Perplexity Search, and Serper discovery adapters are implemented with fixture tests. Firecrawl requests extracted markdown; Perplexity uses the direct Search API; Serper remains discovery-only. DuckDuckGo remains deliberately unsupported because no official general-purpose production search API was verified.
- **Still required before exposing this in Settings:** main-process secret storage, connection tests, capability-aware setup, provider cost/privacy language, a fetch/extract contract for discovery-only connectors, and benchmark runs using user-authorized provider keys.
