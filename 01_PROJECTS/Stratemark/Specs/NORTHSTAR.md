# Stratemark north star

Plan version: 1.0.0. Written and researched: September 30, 2026.

Status: planning complete; implementation NOT authorized or started by this plan.
Code inspected at baseline `3f18af2` on `feat/claim-level-signal-evidence`.

## 1. Problem and product promise

Market research currently becomes a collection of disconnected answers. Stratemark should turn it into a useful, durable collection of companies, evidence, comparisons, and meaningful changes. Its advantage is not a supposedly smarter model. It is the organized research memory and workflow that different models and assistants can use.

**Understand a market, collect its companies, and keep their research useful over time. Your library stays on your machine; you choose the providers and what external agents may access.**

The app is free and open source. Provider APIs, optional search services, and external assistants may charge separately. No Stratemark account or hosted backend is required for the core desktop product. Local ownership does NOT mean cloud models receive no data: a research request or connector response can transmit selected content. Show that boundary before enabling the connection.

This document cannot make model output infallible or prevent all context loss. It makes unsupported claims rejectable, decisions traceable, and work resumable without chat history. No milestone is finished merely because an agent says it is.

## 2. Authority and how to use this plan

Follow current human instructions and repository `AGENTS.md` first. Within product planning, this north star and its linked contracts supersede conflicting earlier proposals. Earlier documents remain historical input, not concurrent specifications.

- [ACTIONS.md](ACTIONS.md): the shared action contract, permissions, and exact user-facing operations.
- [PHASES.md](PHASES.md): ordered goals, acceptance gates, quality experiments, and production checklist.
- [RESEARCH.md](RESEARCH.md): dated primary sources, reasoning, and code-inspection findings.
- [BUILD-STATE.md](BUILD-STATE.md): cold-start instructions, current status, and work-packet format.
- [build-workflow.md](build-workflow.md): Astra planning, Sol execution, and escalation rules.

Change a decision deliberately: record the old rule, new rule, reason, affected action/story/goal IDs, migration consequences, and new verification. Increment the plan version. Do not silently reinterpret a story or use a historical roadmap to expand scope.

## 3. Chosen defaults

These are researched design decisions, not measured claims about live research performance. Source IDs refer to [RESEARCH.md](RESEARCH.md).

| Decision | Chosen solution                                                                                                                                                | Reason / constraint                                                                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| NS01     | Local-first Windows desktop release; other OS releases only after their own packaged tests.                                                                    | Ship one honest production target before claiming universal readiness.                                                                                                         |
| NS02     | SQLite is the authoritative vault; content assets live beside it.                                                                                              | Transactions, indexed relationships, and recovery suit accumulated research [S01-S04].                                                                                         |
| NS03     | One local service owns writes, jobs, policies, and provider access.                                                                                            | UI, timers, and MCP must not each invent research behavior or budgets.                                                                                                         |
| NS04     | One canonical company dossier, many market memberships.                                                                                                        | Reuse evidence across decks without mixing market-specific relevance or roles.                                                                                                 |
| NS05     | Sentinel, Scout, and specialists are bounded responsibilities over durable tasks.                                                                              | Saved memory is persistent; a model need not run forever for each company [S08].                                                                                               |
| NS06     | First-session outcome: a useful market deck with resolved seed companies and at least one company dossier worth opening.                                       | Early value beats waiting for an exhaustive-looking report. Missing coverage stays visible.                                                                                    |
| NS07     | Default discovery target: up to 12 relevant companies, including requested seeds; two consecutive search batches without a new relevant entity stop expansion. | This is a configurable operating limit, not proof of complete market coverage. Depth and budget can stop earlier.                                                              |
| NS08     | Start with two concurrent company workers; one discovery task; total provider concurrency capped per connection.                                               | Simple conservative scheduling, tunable only after measurement. Shared limits include specialist work.                                                                         |
| NS09     | Library -> market deck -> quick company reader -> full company workspace.                                                                                      | The reader is a lightweight panel, not another dashboard or required intermediate route. Direct deep links bypass it.                                                          |
| NS10     | No card flips. Hero company identity, a plain-language purpose, and at most three useful facts.                                                                | Premium collectibility through identity and craft, not decorative game statistics.                                                                                             |
| NS11     | No universal company strength score. Default order is explained goal relevance with deterministic tie-breaking.                                                | Relevance, business size, evidence support, and research coverage are different concepts.                                                                                      |
| NS12     | Market roles: Companies, Infrastructure, Distribution; entities may have multiple roles.                                                                       | One dossier, no confusing duplicated company identities.                                                                                                                       |
| NS13     | Market findings: Trends, Culture, Barriers to entry, Risks.                                                                                                    | Culture covers evidenced workplace/community developments; positive PR alone is insufficient. Risks distinguish allegations from established events.                           |
| NS14     | Reports mean evidence-linked written briefs, not speculative white papers.                                                                                     | A useful default resolves the unclear handwritten phrase without inventing another feature.                                                                                    |
| NS15     | Monitoring is opt-in, daily by default, with explicit cost/request limits.                                                                                     | Monitoring pauses when the desktop session exits or sleeps; headless MCP jobs require a separately approved execution mode. Missed monitoring ticks coalesce.                  |
| NS16     | Gemini with native search is the simplest existing entry path; OpenRouter model + explicit search/retrieval is the flexible path.                              | Broad access without assuming a chat model can browse. Model choice remains benchmark-dependent [S09-S12].                                                                     |
| NS17     | First-class retrieval choices: Firecrawl, Perplexity Search, Serper, and explicit native grounding where supported.                                            | Keep existing adapters; normalize and test capabilities rather than rewrite everything. Firecrawl selective search-then-retrieve is the richer candidate, not a proven winner. |
| NS18     | Allow custom OpenAI-compatible endpoints and local models; distinguish Chat Completions from Responses.                                                        | Capability tests and user-approved endpoints, not compatibility by marketing label [S07].                                                                                      |
| NS19     | MCP reads first, then narrowly approved job submission through the same action service.                                                                        | Selected local data, scoped connection grants, and inspectable receipts; no second agent backend [S16-S20].                                                                    |
| NS20     | Local stdio bridge first; authenticated loopback HTTP when a host needs it. Hosted bridges are separate opt-in compatibility work.                             | A cloud host cannot reach the user's localhost directly. OpenAI's private tunnel is not public plugin distribution [S21-S23].                                                  |
| NS21     | Research is plaintext on disk in v1; API secrets use OS-backed protected storage.                                                                              | Be honest about at-rest protection. Optional encrypted research vaults are deferred; do not claim OS secret storage encrypts the library [S14].                                |
| NS22     | Existing evidence and partial results survive migration, failure, cancellation, and restart.                                                                   | No silent report loss, fabricated recovery success, or discarded active jobs.                                                                                                  |

Numbers above are v1 operating defaults to evaluate, not external facts. If a must-include seed falls outside the proposed market, explain and ask for a scope adjustment; never quietly drop or force-fit it.

## 4. Full user journey in simple sentences

1. You open your saved research library; no key is needed to read it.
2. For new research, you connect a provider and choose a spending limit.
3. You describe a market, your question, and companies that must be included.
4. You review one short scope summary with inclusions, exclusions, geography, and depth.
5. You start research; the app gives you a saved run with a visible activity trail.
6. The Sentinel discovers companies while Scouts begin their dossiers.
7. Useful supported cards appear as they are ready, before the whole run finishes.
8. You filter market roles, scan company identity and key facts, and inspect the stated sorting rule.
9. You open a quick reader or go straight into a company's deeper research.
10. You inspect sources, compare relevant companies, or explicitly request missing research.
11. You read market findings without confusing them with company financial metrics.
12. You save companies, write a brief, or export a portable snapshot.
13. You optionally follow selected companies under a schedule and budget you approve.
14. On your next visit, you see meaningful changes, gaps, and work you can resume.
15. You may grant an external assistant access to selected research, then inspect or revoke that connection.

## 5. Screens and interaction rules

### Library

Primary action: New market. Show saved markets, saved companies, and a compact What's changed section. A small activity indicator opens Research activity. No fictional always-on agent presence. Offline reads work normally; overdue monitoring says when it last actually ran.

### Market deck

The deck is the main exploration surface. Market roles are filters on company cards. Findings are a separate section with Trends, Culture, Barriers to entry, and Risks filters; do not present seven equally prominent competing navigation tabs. Show scope, last meaningful research time, count, coverage gaps, and the current sort. Search/filter/sort are local, instant, and never billable.

Cards use a larger company logo/identity area with accessible fallback, restrained brand accents, company name, clear purpose, market role, and two or three evidence-backed facts relevant to that market. Brand accents must retain contrast. No artificial rarity, generic gradient wallpaper, fake growth arrows, unexplained percentages, filler text, or a Flip action. A sparse company gets a good identity card and an explicit research gap, not invented statistics.

Card facts are selected by a market metric profile: definition, unit, period, priority, and required support. For software it may be price and customer segment; for labs, deployment/model access and reported financing; for a manufacturer, capacity and distribution. These are candidates, never guaranteed fields. ARR, revenue, funding, valuation, users, and market share are not interchangeable. Dates/units travel with displayed numbers.

Relevance uses the saved user goal, inclusion rules, and evidenced role with a short explanation. Do not expose a pseudo-precise 0-100 rating. Quantitative sorts enable only comparable observations with clear definitions/periods; unknowns group separately. A weighted comparison, when explicitly requested, shows user-chosen criteria and unresolved evidence rather than claiming an objective winner.

### Quick reader and company workspace

The quick reader gives orientation, the best supported facts, evidence links, and Explore company. It preserves deck position, filters, and keyboard focus. The company workspace has five primary sections: Overview, Products & business, Metrics, Updates, Evidence. Reports sit in a compact saved-output area. Team, pricing, distribution, competitors, and roadmap are subsections only when useful evidence exists. Planned roadmap and shipped products must be distinguished. Remove dead/duplicate navigation, not researched content.

Opening a card, tab, or cached report MUST NOT silently start paid research. Missing data gets an honest state and an explicit Research this section action. Ask defaults to saved evidence; an explicit web-research mode previews the provider and permitted spend. Compare defaults to a deterministic comparison of saved facts, with an optional billed narrative action.

### Research activity and settings

Activity shows actual discovery, retrieval, evidence checking, synthesis, waiting, failures, spend estimates, and completed work. It is a control panel, not simulated agent chat. Pause/resume/cancel meanings follow [ACTIONS.md](ACTIONS.md). Settings contains provider connections, budgets, local storage/backups, monitoring, and external connections. Advanced options are progressive disclosure, not required onboarding.

Use the original restrained green/editorial design language. Typography, spacing, keyboard navigation, focus, loading, empty/error states, long names, small widths, and reduced motion are acceptance work, not polish after release. Animations communicate real changes and must never obstruct reading [S24].

## 6. Exhaustive v1 user stories

These stories define the planned release scope, not current shipped behavior. Each is covered by a goal in [PHASES.md](PHASES.md).

| ID   | As a user, I can...                                                             | Observable acceptance                                                                                           |
| ---- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| US01 | Open and search saved research without a key or internet.                       | Cached decks, dossiers, sources, and reports remain readable; no outbound request.                              |
| US02 | Connect/test/remove a supported provider securely.                              | UI receives status, never stored plaintext keys; test calls disclose possible cost.                             |
| US03 | Use separate model and retrieval services or a supported native grounding path. | Unsupported combinations fail before research; capability and cost notes are visible.                           |
| US04 | Define a goal, scope, seeds, region, exclusions, and depth.                     | Saved scope revision is shown before a run; off-scope seeds are explained.                                      |
| US05 | See useful cards progressively.                                                 | Partial cards have evidence and state; no placeholder claims promoted as facts.                                 |
| US06 | See what's being researched and what it may cost.                               | Events correspond to persisted tasks and provider calls, with estimated/known usage distinguished.              |
| US07 | Pause, resume, cancel, and recover after a crash.                               | No new calls while paused; cancellation acknowledgement and restart retain completed evidence.                  |
| US08 | Stop research at a bounded useful scope and expand deliberately.                | Stopping reason, unresolved seeds/gaps, and Research more remain visible.                                       |
| US09 | Recognize a company on a clean, distinct card.                                  | Identity, purpose, useful facts, role, freshness, and accessible fallback; no flips.                            |
| US10 | Filter and sort without misleading rankings.                                    | Shared companies are not duplicated; incomparable numbers do not silently sort together.                        |
| US11 | Move between deck, reader, and company without losing my place.                 | Route, filters, scroll, and focus restore; direct company links work.                                           |
| US12 | Read deeper company research without paying just to navigate.                   | Cached-first sections; missing research is a visible explicit action.                                           |
| US13 | Inspect exactly what supports a claim.                                          | Source version, passage, dates, and claim linkage are available; link-only is not verification.                 |
| US14 | Understand conflicting or missing data.                                         | Different periods coexist; same-scope disagreements stay visible; null is not zero.                             |
| US15 | Correct a fact without rewriting evidence.                                      | Human-only correction records actor, reason, prior version; AI/MCP cannot self-verify.                          |
| US16 | Reuse a company's dossier across markets.                                       | One immutable company ID with separately revisioned market role/fit; ambiguous identity can be reviewed.        |
| US17 | Ask a question from my saved evidence or explicitly research more.              | Mode, supporting evidence, uncertainty, and any billable expansion are explicit.                                |
| US18 | Compare companies on criteria that matter to my goal.                           | Units/periods align or differences are called out; unknowns never become negative scores.                       |
| US19 | Read sourced market trends, culture developments, barriers, and risks.          | Findings have their own evidence, status, dates, company links; unsupported adverse claims are rejected.        |
| US20 | Create and reopen an evidence-linked brief.                                     | Fixed input revision, citations, template version, and saved output; updates do not overwrite it.               |
| US21 | Follow companies without unlimited spending.                                    | Disabled by default; preview schedule, bounded requests/spend, off-hours policy, and stop/revoke.               |
| US22 | Understand meaningful changes instead of repeated news.                         | Update links old/new observations, event vs observation dates, relevance, and duplicate suppression.            |
| US23 | Export, import, restore, or relocate my research safely.                        | Validated preview, backup, exclusive write fence, rollback, no secrets; originals survive failure.              |
| US24 | Know what is stored locally and what leaves my machine.                         | Provider/MCP egress disclosure and audit records; no hidden telemetry or cloud sync.                            |
| US25 | Grant an assistant selected read access and revoke it.                          | Scoped, expiring connection; excluded records denied; results record which versions were disclosed.             |
| US26 | Let a permitted assistant start bounded research and follow its status.         | Same jobs/policies as desktop; idempotent receipt; revoked grant blocks later work.                             |
| US27 | Use keyboard access and reduced motion.                                         | Logical focus, readable contrast, full primary journey without pointer, nonessential motion disabled.           |
| US28 | Receive useful partial results when a provider fails.                           | Structured error, preserved progress, retry controls; no success badge for failed work.                         |
| US29 | Install a production-supported build and retain data through upgrades.          | Signed supported artifact, migration/recovery drills, versioned support matrix.                                 |
| US30 | Delete a market or company deliberately.                                        | Impact preview, reversible trash before purge, explicit backup/other-market consequences; no remote purge tool. |

## 7. Architecture and data boundaries

### Small interfaces, deep modules

Keep the existing monorepo and React/Electron product. Do not rewrite the framework or adopt an agent framework merely to appear agentic. Use these responsibilities:

| Boundary               | Owns                                                                            | Must not own                                        |
| ---------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------- |
| Shared contracts       | Runtime-validated actions, results, evidence identities, versions               | Providers, UI state, persistence side effects       |
| Vault                  | Transactions, IDs, revisions, migrations, backups, FTS search                   | Model prompts, hidden network calls                 |
| Action service         | Validation, authorization, durable receipts, budget reservation, job submission | Transport-specific permission bypasses              |
| Research runtime       | Leased tasks, dependency DAG, checkpoints, cancellation, events                 | Renderer timers as authoritative scheduler          |
| Provider adapters      | Capability negotiation, retrieval/model normalization, redacted usage           | Storing canonical business facts directly           |
| Evidence projection    | Observations, conflicts, card/workspace/report projections                      | Making a citation equal truth or human verification |
| Desktop / MCP adapters | Caller authentication, scoped IPC/tools, navigation or response rendering       | Separate business rules or raw vault credentials    |

Use dependency injection for clock, storage, provider, policy, and task dispatcher so behavior can be tested offline. Extend existing research adapters and contracts behind these boundaries; migrate call sites incrementally. Assign concrete files in packets after G00 inventory, not speculative filename promises.

### Vault layout and logical records

Default root: Electron's local `userData` location, with a visible Open research folder action. Inside a vault directory: `vault.sqlite`, managed content/assets, and a manifest containing vault ID and schema version. Backups are separate, consistent snapshots with manifests/checksums. Markdown/JSON exports are derived portable outputs, not a second source of truth. SQLite WAL requires a same-machine local disk [S02]. Do not run a live vault on a network share or suggest syncing its open files through OneDrive. Relocation requires quiescence, copy/verify, reopen, and rollback.

Logical records: vault; company; domain/alias; market; scope revision; market-company membership and roles; source/version/passage; claim/observation; correction; finding; update; report/input revision; saved item; action receipt; run/task/attempt/event; usage reservation; schedule; connection grant; disclosure log. Use foreign keys and versioned schemas. No arbitrary filename supplied by a model becomes a vault path.

Assets are content-addressed and staged, flushed, and atomically published before a transaction references them. Minimum supporting passages are stored transactionally with their source versions; a hash alone is not support. Backups pin a database revision and all referenced asset hashes, retain those assets during copying, verify a complete manifest, and only then publish the backup. Restore verifies every required asset. Garbage collection never removes content referenced by a live dossier, report, or retained backup. Purge previews dependent outputs: preserve required evidence or explicitly invalidate affected outputs with a missing-evidence state; do not claim an intact cited report after deleting its passages.

External imports never mint local authority. Retain imported attestations as attributed origin claims, not local `user_verified`. Accept local attestations from authenticated same-installation recovery only when their integrity/origin is established; otherwise require fresh human confirmation. Imports and restores disable grants, runnable queues, schedules, and budget approvals by default. Old revoked grants never reactivate; a new grant is a new explicit approval in the new generation.

Restore does not restore unspent money. Historical usage is evidence, not a credit balance. All restored budget references are invalid until reconciliation and fresh approval; uncertain paid calls retain conservative liabilities where known. If a recovered snapshot cannot establish later spend, mark it unknown and block resuming the old allowance. A user may approve a clearly separate new capped budget after acknowledging historical charges, but never silently reset an old aggregate limit. This fail-closed restore rule avoids claiming a rewind-proof ledger on a user-controlled disk.

Company IDs never change during alias resolution. Names alone are not identity proof; store domains, aliases, parent/subsidiary relationships, and evidence for merges. Ambiguous matches require review. Human merges are reversible with an alias/redirect history, preserving references and jobs. Removing a market removes its membership, not shared company evidence by accident.

Numeric observations identify company, metric definition, scope, unit/currency, period, value, and support. Retain reported observations and corrections; derive current views. Conflict means disagreement about the same scope/definition/period, not merely two revenues from different years. Zero is a supported value; unknown is null. Market findings never inherit company metrics.

Sources store canonical/original URL, retrieved timestamp, claimed publication/event dates separately, content hash/version, short supporting passages, retrieval status, and relation to observations. Preserve selected evidence; avoid a default archive of every full webpage. Retain cached material only under a declared retention policy and applicable service/content permissions. A URL may later change; the retained passage/hash documents what was actually used.

### Research execution

Every accepted paid command persists its receipt, policy reference, and queued task before acknowledging it. Tasks have stable IDs, parent dependencies, idempotency identity, attempt history, lease expiry, checkpoints, and cost reservations. A single scheduler owns dispatch. A desktop close may end execution, but must not erase memory or queued work.

Execution mode is explicit. In v1, closing the desktop window ends its desktop session: stop monitoring dispatch, checkpoint/abort its jobs, and show possible in-flight cost before exit. No hidden tray/background monitoring default. A separately enabled supervised MCP host may run explicitly approved connector jobs without the desktop window; it does NOT run monitoring schedules. Opening desktop attaches to an existing authenticated host instead of starting a second writer. Closing that UI pauses monitoring but does not claim to cancel independently approved MCP jobs; the exit flow explains what remains active.

Service ownership uses an exclusive local process lock and monotonically changing writer generation. A dead owner can be replaced only after ownership checks; old attempts cannot commit in the new generation. Handoff drains/fences the old owner before the new owner dispatches. Mode/availability and owner are visible in settings/activity. Machine sleep/shutdown means no execution; no cloud-always-on promise.

Sentinel: bounded discovery batches, resolve identities, assign Scouts, evaluate stopping rules, and synthesize supported market context. Scout: research known company gaps, retrieve sources, extract observations, check support/conflicts, update projections. Specialists: bounded market findings jobs with independent evidence. A worker role is not an authority to approve costs, modify policy, or trust webpage instructions.

State semantics and cancellation fences are normative in [ACTIONS.md](ACTIONS.md). Run completion means its declared task scope is complete or explicitly partial/failed; do not hide dashboard warm-up in detached work after success. Imported/restored vaults receive a new writer generation so old workers cannot write into new state.

### Evidence integrity

Separate attribution, support checking, independent corroboration, and human verification. LLM-based support checking is fallible. A displayed number needs a retained supporting passage with compatible definition/unit/period. Model-generated confidence is not evidence. Unsupported output remains a rejected candidate or explicit gap, never a normal card fact.

Only direct human confirmation can set `user_verified`. Preserve uncertainty and contradictory supported reports. Negative/reputational allegations require usable primary reporting or attributable established reporting, date, status, and context; absent usable support, drop the claim. Repeated syndicated pages are not independent corroboration. Research pages, uploaded data, and MCP client content are untrusted data, not instructions that can grant access or run tools.

### Provider access, spend, and secrets

Separate model, search, extraction, and optional embedding capabilities. Default library search uses SQLite FTS, not paid embeddings [S04]. Provider profiles specify endpoint/protocol, available tools, schema support, limits, pricing metadata date, and test status. Unknown pricing cannot support an exact money-cap promise: require request/token caps and label the monetary estimate, or block that configuration when a strict currency cap is requested.

Before dispatch, atomically reserve conservative upper-bound usage including retrieval, reasoning/output tokens where applicable, retries, and parallel requests. Reconcile known usage afterwards. Never automatically retry an uncertain paid response after a network break as if it cost nothing. A provider may still bill an in-flight request after cancellation; show that possibility. Explicit endpoint changes, fallback providers, or sending private library passages require approved connection policy. Do not silently substitute providers or reuse cloud subscription credentials.

Keys are accepted only in a dedicated trusted desktop settings flow, stored via OS-protected storage, used by the trusted provider boundary, and excluded from renderer hydration, MCP, logs, exports, fixtures, and repository history. Renderer methods return configured/test status, not plaintext stored keys. Fail closed for insecure secret-storage backends unless a clearly labeled session-only mode is chosen [S13-S14]. API response bodies and user content must be redacted from diagnostic bundles by default.

A freshly typed key necessarily exists briefly in the trusted input flow; clear that transient field after submission and never persist it in browser storage. The protection requirement is that stored secrets cannot be retrieved by ordinary renderer/MCP APIs, not an impossible promise that text entry never handles text.

### Permissions and MCP bridge

Both UI and MCP invoke the same action definitions. Scopes distinguish `research:read`, `research:write`, `research:run`, and `monitor:manage`; a selected workspace/market/company allowlist constrains each. Default external access is read-only, expiring, and explicitly enabled. Existing datasets cannot be enumerated outside the grant. Read results contain IDs, revision, freshness, evidence references, and bounded pagination.

Sources/attachments also carry origin and visibility scope. A company shared by two markets must not leak private passages from an ungranted market through its card, comparison, report, or search result. Reusing internal evidence does not expand external disclosure. Apply scope to the projection and its transitive support, not merely the company ID.

Human-only approvals use a service-issued, short-lived, one-use challenge bound to action/payload hash, target revisions, actor, and expiry. Only the dedicated trusted confirmation surface can consume it; ordinary renderer and MCP requests can propose an operation but cannot approve it. The confirmation surface renders no source HTML and exposes no generic privileged IPC. Replays and altered payloads fail. This separates client authentication from user approval; it is not proof of human presence on an already compromised machine.

Use curated tools/resources, not raw files, SQL, shell, arbitrary HTTP fetch, secrets, or a general-purpose tool executor. Accept job commands only under an explicit grant and budget. Tool annotations aid clients but do not authorize the operation. Revocation denies new requests and rechecks queued/in-flight dispatch and result disclosure. Maintain a local audit of grants, commands, and disclosed record versions, without logging secrets or entire research payloads.

Revocation cannot retract data already delivered to a remote assistant. Its retention is governed by that host/provider, not the local vault; disclose this before connecting. Cached logos/source assets are local reads; any new external retrieval must pass the approved retrieval boundary rather than fire from a card render.

Local bridge process uses stdio and the shared service; do not launch a second competing vault writer. If the desktop service is absent, a supervised local host may own it with exclusive ownership and explicit availability status. Loopback HTTP binds localhost, authenticates requests, and validates Origin [S19]. Freeze a tested SDK/protocol compatibility matrix; current MCP 2026-07-28 and older clients differ, so do not hand-roll a legacy-only handshake [S16-S17]. Jobs use stable IDs and status polling regardless of optional MCP task support.

The supervised host follows the explicit execution-mode and ownership rules above; its existence does not authorize monitoring or revive restored work. Grant scopes and human confirmation remain identical across transports.

For hosted assistants, implement only a verified connection route: an optional supported private tunnel, or a separately secured authenticated relay in a future phase. The local device must be online and the selected content still goes to the remote assistant. Public plugin distribution is a separate security/operational decision, not covered by the private-tunnel path [S21-S23]. Muse and Dots compatibility is a target, NOT a claim of tested integration; inspect their actual host contracts when available.

## 8. Test seams, success, and non-goals

Use real `pnpm check`, offline failure fixtures, packaged desktop manual journeys, and controlled live evaluation, all defined in [PHASES.md](PHASES.md). Track time to first useful card, seeds covered, entity precision, unsupported promotions, source accessibility/support, contradictions, duplicate updates, recovery, and cost per useful dossier. Do not select a default model based only on prose quality or a unit-test count.

No hidden account dependency; no app store/public release this planning turn; no guaranteed exhaustive market coverage; no perpetual execution while the machine is off; no fake certainty or universal leaderboard; no card back; no general coding agent; no automatic cloud synchronization; no public relay by default; no arbitrary third-party plugin execution; no scraping login/paywall bypass; no forced embedding/vector service; no simultaneous production claims for untested OSes.

The first production release includes the library, scope/seed flow, supported BYOK paths, progressive company deck/dossiers, honest evidence/comparison/briefs, controlled local updates, safe data recovery, and scoped local MCP. Advanced finding categories can remain explicitly beta until their quality gate passes; unsupported categories must stay hidden rather than filled with speculative content. Shipping fewer high-quality surfaces is acceptable; dropping trust, recovery, or consent gates is not.
