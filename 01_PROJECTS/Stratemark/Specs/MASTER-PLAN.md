# Stratemark: the complete product plan

Version 2.0.0 — October 1, 2026. Authoritative replacement plan. Planning only; implementation has not resumed.

## Authority and reading order

The founder's October 1 direction supersedes all prior product plans, G00–G08 sequencing, continuation prompts and model-role instructions. This plan preserves existing implementation and evidence; it does not imply previous work is discarded. Earlier documents are historical references, not concurrent instructions.

Read MASTER-PLAN.md for decisions; EXPERIENCE-MAP.md for interaction coverage; DELIVERY-PLAN.md for build goals and proof; BUILD-STATE.md for actual code status; LAUNCH.md for fresh-session entry. Existing ACTIONS.md is a compatibility inventory of A01–A62, not proof of implementation. V2 changes and additions are listed in EXPERIENCE-MAP.md.

The present authorization is to plan and update documentation. Do not start the build, spend on product research, migrate live data or resume the old automation during this planning task. A subsequent build instruction activates the ordered goals. Publication/deployment still needs its own authorization. The requested planning/review role is Astra; prior instructions forbidding Astra are superseded. Do not claim a model was used unless the actual session or dispatch establishes that.

## Product promise and audience

**Describe a market. Build a beautiful research deck. Open any card to understand more. Keep it current, share it, and let your agents work with research you own.**

Serve founders exploring opportunities, operators tracking competitors, analysts comparing companies, and people investigating ideas. Optimize the first session for one clear research question and the return session for useful changes. Value comes from organized evidence and decisions, not card counts, agent chatter or long reports.

Stratemark is free, open-source software. Saved research lives on the user's machine and can be read without a key or account. New research uses the user's provider connections or an officially supported plan-usage connection. Provider fees and optional hosted services are distinct from the free app. Published snapshots and approved assistant disclosures are explicit exceptions to local storage.

## Decisions replacing v1

| Topic | V2 decision |
| --- | --- |
| Deck | Seven first-class card types: Company, Infrastructure, Distribution, Vice, Barrier to entry, Insight, Community. |
| Destinations | Entity cards lead to role-specific research workspaces; four finding types share a polished story workspace with type-specific sections. |
| Community | User-facing Community replaces Culture; historical records retain original meaning/provenance until reviewed, not blindly relabeled. |
| Vice | Keep the requested name; show attributed events, risk, responses and resolutions without sensational scoring. |
| Cards | No flip. Collectibility comes from identity, composition, information quality and interaction craft. |
| Order | Explained relevance to the saved question; no universal strength score or prominent T1–T8 hierarchy. |
| Sharing | A short link that works for an uninstalled, anonymous mobile recipient is a launch requirement. Plan a thin optional publication service. |
| OpenAI | Plan official Sign in with ChatGPT separately from the ChatGPT plugin/MCP integration. Verify actual eligibility and capabilities. |
| Delivery | Each milestone connects backend, frontend and a user outcome. Avoid completing every infrastructure abstraction before users see value. |

## The complete user journeys

### Create and explore

1. Open Library; start a deck, import research or explore a clearly labeled sample.
2. Describe the market, question, must-include companies, exclusions and geography.
3. Connect research providers when needed. Saved/demo reading remains available without credentials.
4. Review one concise scope with card categories, depth, provider route and limits. Advanced settings stay optional.
5. Start one durable run. Watch real work and open useful supported cards as they arrive.
6. Filter all seven card types, search locally and inspect the sorting rule.
7. Open an entity quick reader and then its full workspace, or open a finding story.
8. Inspect evidence, ask questions or explicitly research missing information.
9. Save, compare compatible entities, annotate, or create a brief.
10. Share a reviewed deck/card/brief snapshot. Close and reopen with results, conversations and partial work intact.

### Return and monitor

Library shows recent decks, saved research, actual changes and work needing attention. Open a change to compare old/new evidence and why it matters. Dismiss, save, investigate or add it to a brief. Follow a market/entity under an explicit schedule and budget. Distinguish changed, checked/no change, not checked, waiting and failed. Monitoring pauses when the local runtime sleeps/exits; missed ticks coalesce into one eligible check.

### Receive and continue

A recipient opens a texted short link on a phone without installing or signing in. They see a deck title, snapshot date, included cards and actual included research depth. They can inspect citations and share the same snapshot. Save to Stratemark imports an attributed copy into their library; it never imports the sender's authority or billing. Continue research uses the recipient's own connection. Published shares remain readable while the sender's computer is offline.

### Enter through an agent

The connected assistant searches authorized saved research, proposes a scope if needed, and submits approved work through the same local service. It receives a saved run reference, real status, evidence-backed outputs and app links. The desktop shows the same deck and progress. Missing scope/budget permissions lead to a human approval surface. Revocation prevents later disclosure and queued work. Good metadata/examples encourage appropriate use; keyword ownership and automatic host recommendations cannot be guaranteed.

## Card family and research destinations

Every deck item has a stable ID, type, market context, source references, research timestamps and save/share/chat actions. Each enabled category ends with supported results, no supported result, not applicable, incomplete or failed. Never invent entries to fill seven categories.

| Card | Face | Research destination |
| --- | --- | --- |
| Company | Hero logo/name, purpose, market relevance, up to three supported facts | Business, products, customers, positioning, metrics, people/governance, history, updates and evidence. |
| Infrastructure | Resource/provider identity, what it enables, dependency and relevant facts | Capabilities, access/pricing, supported capacity/performance, constraints and ecosystem relationships. |
| Distribution | Channel/entity identity, audience, mechanism and supported reach/access | Audience, routes to market, access/commercial terms, coverage, dependencies and relationships. |
| Vice | Neutral headline, attributed event/subject, event date and status | What happened, allegations versus established facts, response, resolution, market relevance and evidence. |
| Barrier to entry | Named obstacle, affected entrants, why it matters | Mechanism, requirements, affected segments, evidence and clearly labeled strategic analysis. |
| Insight | Specific finding, implication, scope/date | Thesis, supporting observations, counterevidence, uncertainty and next questions. |
| Community | Community/ecosystem identity or development, participants, significance | Public activity, participants, culture/adoption signals, access, significance and limitations. |

One company can play several market roles without duplicate dossiers. Infrastructure/distribution can also refer to non-company resources/channels; use typed entity references rather than fake company records. Finding cards reference their own evidence, never inherited company metrics. Distinct role cards can share a dossier while preserving market context.

### Entity workspace

Reuse one workspace frame with role-specific content. Primary navigation: Overview, Offering, Market position, Evidence, Updates. Offering is labeled Products & business / Capabilities / Channels by role. Metrics remains a prominent overview module with a direct route; promote it to a primary section only when useful data warrants it.

Overview answers what it is, why it matters here, what is known and what is missing. Offering covers products/services, customers/use cases, pricing/access and shipped versus announced changes. Market position covers competitors, dependencies, distribution and supported differentiation. People, History and Governance remain discoverable secondary sections with deep links. Evidence includes exact support, dates, conflicts and corrections. Updates shows actual changes rather than an undated news wall.

Preserve useful content from all existing dashboard tabs; relocate it deliberately. Official-site opening is the default website action. Optional safe preview/site audit must not make arbitrary iframe embedding a required journey. Every section offers specific research actions and saved-context questions, not an automatic provider call on open.

### Story workspace

One shared reader with four editorial variants: headline, orientation, event/publication/research dates, readable sections, inline evidence, affected entities, uncertainty/counterpoints and related cards. Persistent actions: Save, Share, Ask about this, Research further. Desktop can expand a panel to a route; mobile uses a full page. Vice adds response/resolution; Barrier adds entry requirements; Insight separates observation from interpretation; Community centers real participants and public activity.

Store findings as structured supported blocks rather than one untraceable generated blob. Conversations default to the selected story revision. Follow-up research produces a recorded revision; it does not silently rewrite the original.

## Design language and interaction standards

Preserve the existing warm editorial canvas, white/pale mint surfaces, teal/emerald accents, charcoal text, soft shadows, rounded panels and pill controls. Code-observed anchors: canvas #F7F6F1, surface #FFFFFF, secondary #F4F7F3, teal #087D6B, ink #0F2B26. Keep the existing display/body font families; unify inconsistent scale/spacing. These are design anchors, not a new visual acceptance or contrast certification.

Current font configuration is Parkinsans for display, Google Sans Flex for body, JetBrains Mono for code/data where justified. Keep these families with local/system fallbacks. Use a consistent 4/8-based spacing system, readable line lengths and restrained heading hierarchy. R0 chooses one card proportion using real content; it does not force every type into identical text density. Review a full deck, an entity workspace and a story together before freezing the component recipe.

Cards share a family silhouette but vary meaningfully by purpose. Entity faces prioritize generous real identity. Stories use editorial composition and type-specific information. Logo fallbacks look intentional. Images may decorate but must not fabricate events or imply unsupported data. Avoid generic AI art, random gradient wallpaper, foil/rarity stamps, giant badges and filler.

Card click opens research; save/share/compare are separate accessible targets. Preserve deck filters, sorting, selection, scroll and focus on return. Direct links bypass unnecessary intermediate panels. Touch must not depend on hover. Keyboard users can open, navigate, dismiss and return reliably.

Motion communicates selection, expansion, actual arrivals and status. Suggested range is 120–220 ms; reduced motion removes transforms/loops. Reuse CSS and existing primitives first. No forced unboxing, endless shimmer or delays before reading. Every clickable surface gets loading, empty, sparse, partial, stale, offline, denied and error handling where applicable. Errors state retained work and the next action.

Show at most three useful supported face facts chosen by a market/role metric profile. Keep definitions, units, periods and source status attached. Funding/valuation/revenue/ARR/users/customers are not interchangeable. Market share requires a compatible denominator and period; growth requires comparable history. Unknown stays unknown. Estimates never masquerade as sourced observations. Clicking a fact opens its evidence/conflicts.

## Backend and research design

Reuse the current monorepo, Electron, SQLite work and provider adapters. No framework rewrite or general agent platform.

```text
Desktop / local MCP / approved remote connector
                       |
          single local application service
       queries, commands, policies, durable jobs
          /             |             \
   SQLite vault    provider gateway    asset store
          |
  selected publication snapshot -> optional web sharing
```

The trusted service owns writes, jobs, policies and credentials. UI state is presentation only. Saved reads cause no provider work. AI answers over saved evidence may still cost model usage and disclose it. No external integration creates an independent research backend.

| Data domain | Records |
| --- | --- |
| Inventory | Scopes, canonical entities, aliases/domains, memberships/roles, seeds and derived card views. |
| Evidence | Source versions/passages, definitions, observations, claims, conflicts, corrections, rights/visibility. |
| Stories | Typed findings, supported blocks, related entities, counterevidence, lifecycle and revisions. |
| Work | Runs, child tasks, attempts, ordered events, leases, checkpoints, output manifests, dedupe records, cancellation fences. |
| Authority | Connection metadata without secret bytes, grants, egress policies, budgets, reservations, known/uncertain usage. |
| User work | Saved items, collections, conversations, annotations, briefs, preferences, schedules. |
| Publication | Selected revisions, redaction manifest, assets, hash/version, owner, share state and revocation receipt. |

Existing SQLite records, append-only evidence and ownership fences are reused. Add operational tables as actual journeys consume them. Keep indexed relationships plus validated content bodies where appropriate; do not over-normalize every paragraph.

Normal desktop currently writes through GeminiRepository to repo.json. SQLite is staged/read-only. A15 durable discovery exists in the legacy repository but is absent from IPC. The transition starts with one complete native create/research/read/reopen flow in a disposable workspace. Add only consumed commands, then verified migration/backup/cutover. No indefinite dual writes. Passive legacy data retains its unreviewed status. Conflicting identities require review rather than automatic merging.

Exactly-once provider billing cannot be guaranteed after interruption. Persist accepted work before dispatch, dedupe requests, retain completed stages and expose ambiguous attempts for bounded retry. Pause stops new dispatch; cancel aborts/fences children, retains committed evidence and rejects stale writes. Restore/import drains workers and disables recovered grants, schedules and budgets until reapproved.

Append-only history applies to ordinary research writes, not an assertion that users cannot delete their data. Explicit privileged purge must traverse dependencies and state what happens to backups, assets and published copies. Deleting a market does not delete a canonical company used by another deck. File relocation uses a verified staged copy and atomic switch, not a raw move of a live SQLite/WAL file. Generated previews and cached assets have bounded retention; source rights and private visibility survive exports/imports.

Source retrieval must restrict schemes/redirects, block unintended private-network targets, bound size/time/decompression and treat fetched instructions as data. User-approved local model endpoints are a separate connection policy, not a reason to let untrusted research URLs reach localhost. Sanitize HTML/markdown, open public links safely, and keep remote pages outside trusted Electron IPC. No arbitrary plugin code execution is part of research connectors.

### Sentinel, Scouts and specialists

Sentinel owns scope, seed accountability, discovery coverage and allocation. Scouts own entity dossiers and requested sections. Specialists create the four story types. These are bounded durable jobs with saved memory, not an always-running model per company.

Pipeline: resolve scope -> discover identities -> retrieve sources -> extract supported records -> check important claims -> persist -> project useful cards -> deepen selected gaps. Scouts start as entities resolve. Initial defaults: 12 entities including seeds, two company workers and one discovery task under shared provider limits. Stop at budget/depth limits or two discovery batches without a relevant new entity. Never claim exhaustive coverage.

Quick map, Standard and Deep presets describe covered sections and limits. Deep adds independent sources, counterevidence and focused follow-ups rather than longer prose. Cache retrieved versions; reuse relevant existing dossiers. Treat snippets as leads; distinguish unavailable retrieval, self-reported numbers, syndicated repetition, date scope and actual semantic support. Deterministic identity/units/period checks and model support review complement a sampled human audit; none guarantees universal truth.

## Provider connections and sign-in

Separate models from retrieval. Planned release routes: Gemini native grounding; OpenRouter plus selected retrieval; direct OpenAI through the supported protocol; validated custom OpenAI-compatible/local endpoints. Existing Firecrawl, Perplexity Search and Serper adapters require desktop wiring and live certification. Sonar and Perplexity Search are distinct. Do not promise every model supports every capability.

Settings shows provider, model, capabilities, test state, billing source and disconnect. A bounded connection test is explicit. Permit model entry when catalog discovery is unavailable. Secrets stay in the trusted process. Fallback routes require consent because destination/cost changes. Unsupported combinations fail preflight. Research stays plaintext on disk in v1; OS secret encryption is not vault encryption.

Official documentation reviewed October 1 supports **Continue with ChatGPT** and eligible plan usage. Plan account/workspace selection, inference permission, supported-model discovery, limit/error handling, disconnect and usage management. Identity-only sign-in does not grant inference. Verify actual app/account eligibility, registration and preview limits before release; preserve BYOK when unavailable. Do not reuse Codex credentials. Sources: [OpenAI quickstart](https://developers.openai.com/siwc/quickstart), [official Electron example](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt).

Dollar caps require current model/tool pricing and conservative reservation across children/retries. Unknown pricing permits explicitly labeled request/token limits, never a fake dollar guarantee. ChatGPT allowances are distinct from API dollar billing. Provider default selection requires quality measurements, not brand assumptions.

## Sharing and distribution

Launch sharing supports immutable deck/card/brief snapshots through short browser links. Master research remains local. User reviews exact included content/depth before upload. Updating publishes another version; reader shows its date/version. Unlisted is default and means anyone holding the link can read it; public indexing is separate.

Exclude private notes, conversations, raw source bodies, paths, keys and grants by default. Include excerpts only under appropriate rights/retention policy; citations and attributed summaries may suffice. Guest reading has no route into the vault and never spends sender credits. Save a copy imports provenance but no active authority. Printable/Markdown and portable data exports remain available offline.

Publication needs manifest validation, safe rendering/images, upload limits, owner authentication/recovery, revoke/delete, reporting/takedown, rate limits and bounded cache invalidation. Readers need no account; publishers use recoverable passkey or approved federated ownership for hosted management. Never put a management token in the viewer URL. Revocation stops later hosted access after the documented purge window; downloaded copies cannot be recalled. Archived, expired, deleted and unavailable shares have explicit states.

Use immutable objects/CDN plus a small metadata/ownership service. Evaluate existing share codec/route as reusable components, not a production hosting solution. Self-hosting the publication service is supported through documented configuration. Offline use does not require it. Hosted service funding, retention, domain and operators are release decisions, not assumed free infrastructure.

## MCP and plugins

Deliver after the core app journeys are working, while preserving shared action semantics now. Local stdio first; authenticated loopback when necessary. One vault owner; connectors attach rather than create competing writers.

Tool families: search research, get deck/entity/story/evidence, list updates, preview scope, start approved research, expand deck, research section, inspect run, pause/cancel, save item. Reads enforce selected scope through linked evidence and search results. Jobs obey identical budgets and receipts. No arbitrary SQL/files/shell, keys, purge, publication or human-verification tools.

Plugin descriptions/examples cover market research, market intelligence, competitor analysis, ecosystem mapping and existing research. A plugin adds discoverability/onboarding and optional card UI; MCP provides tools. Do not guarantee host selection behavior.

Cloud ChatGPT cannot directly reach localhost. Plan a separate optional authenticated bridge with an outbound desktop connection and scoped, timed requests to the same local service. It is not a hosted vault or second job engine. Require a threat review, cost owner and deployment approval. Relay/host disclosures are visible; body logging is off by default. A development tunnel is not public integration proof.

Maintain a host matrix for local Codex, Muse, Dots and ChatGPT: actual product/version, transport, installation, read/job/revoke tests, offline behavior and evidence. The exact Muse product has not been identified; resolve before claiming support. Full integration completion requires real host tests. A core beta may precede host availability but must label omissions.

OpenAI plugin auth follows current OAuth/resource metadata requirements, with real linking and result navigation checks. This is separate from sign-in for inference. [Official plugin authentication](https://developers.openai.com/plugins/build/auth).

## Production and growth

One million users is a design horizon, not current measured capacity. Local research spreads storage/compute across devices. Central infrastructure handles publication, downloads/updates and optional bridging. Share reads must not invoke inference. Bound payloads, queue costly operations, measure cache/egress and apply abuse limits before scaling topology.

Proposed targets, not measured results: cached interactions p95 <100 ms; cached library/deck open p95 <1 s with 10,000 entities/100 decks on declared hardware; first supported Standard card target <90 s on a declared provider/network; guest mobile LCP <2.5 s and INP <200 ms on the declared profile. Initial share load gate: 1,000 cached reads/s plus 10 uploads/s for 15 minutes, <1% unexpected failures, recovery and cost recorded. This does not certify a million concurrent users.

Production requires signed Windows install/update/rollback, crash/restart recovery, backup/import/export/trash/restore, accessible navigation, safe source rendering, dependency/license review, privacy/help/support, diagnostics without secrets/research, versioned artifacts and incident procedures. Other OS claims require their own packaged tests. Publishing needs abuse/takedown processes and ownership/retention controls. Optional aggregate analytics never include prompts, private research or keys.

No claim of bulletproof or hallucination-free software. Completion means demonstrated journeys, inspectable support, recoverability, disclosed limitations and no known critical defects.

## Anti-drift rules

Every milestone answers: what can the user now do; where is the result; what proves the real path; what remains; is the next step increasing user value? Code, contracts, tests and agent hours alone are not delivery.

Reuse working foundations. Stop broad rewrites, uncoupled abstractions, repeated unchanged test runs, demo-only acceptance and enabled placeholder controls. Connect one useful workflow before extending the platform. Every existing interaction gets a disposition in EXPERIENCE-MAP.md. Every build goal ends with a functioning demonstration and red-team decision in DELIVERY-PLAN.md.
