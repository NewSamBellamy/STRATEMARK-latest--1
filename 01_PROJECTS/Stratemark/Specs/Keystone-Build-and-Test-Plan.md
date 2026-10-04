# Keystone: consolidated build and test plan

Status: ready for bounded implementation; proposed work is not shipped functionality.
Date: 2026-10-03. Planning input checkpoint: `60ca414`.
Workspace: `C:/Users/shann/Documents/Codex/2026-09-28/i-x20/work/stratemark-card-redesign-revival`.
Branch: `revival/initial-card-redesign`. Never merge or push to main.

## 1. What we are building

Stratemark is a free, local-first, bring-your-own-key market-intelligence tool. A market deck is a navigable collection of companies and meaningful findings. A company card opens a trustworthy dossier; a finding card opens an understandable, cited story. Research compounds locally and approved monitoring surfaces useful changes. The product should feel premium, fast and coherent, not like a control panel for agents.

This document owns execution order, checkpoints and test gates. [Research architecture](Keystone-Research-Architecture.md) owns detailed evidence/storage/agent contracts. [Market Position scoring](Keystone-Market-Position-Scoring.md) owns ranking methodology. Treat all three as one plan. The architecture audit and score parameters remain proposals until implemented and evaluated; historical plans are not permission to restore rejected designs.

Success means measurable improvements in first-useful-research latency, source traceability, consistency between screens, data durability, useful repeat visits and fully wired interactions. No guarantee of perfect information, exhaustive market coverage, universal key compatibility or always-on work on a sleeping desktop.

## 2. Product decisions that must survive every session

- Preserve the approved large-logo, one-sided collectible aesthetic, company brand colours, lighting, card proportions and premium light/green design language. No flip interaction or wholesale redesign.
- Company, Infrastructure and Distribution are entity cards. Each has a canonical company identity and a durable numbered Card Scout; reuse the scout across decks within a workspace.
- Keep consistent core business fields: name, location, employees, revenue/ARR with the correct label, users/customers with the correct definition, and valuation/market cap with the correct basis/date. Unknown/undisclosed/not-applicable is acceptable; invented zeroes and silent substitutions are not.
- Card face and initial reader are researched and published together. Deep dashboards can deepen afterward. Show pending discovery separately, not unfinished cards pretending to be complete.
- Sentinel owns market boundaries, discovery, assignments, verification coordination, spending and cohort reranking. Deterministic services enforce decisions; the model never bypasses the evidence gate or sets arbitrary ranks.
- Market Specialist owns Insight, Barrier to Entry, Culture and Vice. They concern a company, several companies or the market. No inherited business metrics or company scores.
- Cards are concise entrances to depth, not miniature reports. A saved shard is one reusable evidence-backed finding, not currency or database sharding.
- Sources start with relevant original evidence and expand for corroboration. Grounded notes, raw source documents and accepted claims are different records.
- Company ranking is deck/cohort-relative Market Position, distinct from business maturity, scout identity and research confidence. Apply the scoring companion's common-basis/unknown/small-set rules.
- Saved research is readable offline without a key. New research needs a configured capable route. Reasoning, search/retrieval and optional image generation are independent capabilities; extra keys improve specific capabilities, not truth by majority vote.
- No generated logos or executive portraits. Official identity-matched assets first, bounded retries and clear fallback/manual correction.
- Shares preserve evidence and snapshot dates without keys/private notes. MCP later wraps the same scoped application actions; no direct unrestricted access to the filesystem.
- Build one reviewed category at a time. No unused scaffolding presented as a finished feature. Spend-conscious implementation, no speculative framework migration.

## 3. Complete journeys and user stories

### Company research

1. Connect a supported key or use saved/demo data without confusing the two.
2. Describe a market and region, optionally require/exclude companies, and review ambiguous identities.
3. See honest discovery/progress immediately; cancel, pause or resume without losing results.
4. Receive the first ready company card and initial reader together, with relevant sourced business figures and honest unknowns.
5. Inspect a figure's source passage, reporting date, definition and attribution without source clutter.
6. Open the deep dossier; explore every existing section, distinguish ready/researching/unavailable states, and avoid duplicate calls.
7. Ask a scoped question, compare compatible entity cards, produce a cited briefing/report, save and share.
8. Add a company and see all affected peer positions recomputed consistently; understand changes caused by cohort membership rather than company performance.
9. Enable a watch policy, return to meaningful sourced changes, and stop monitoring whenever desired.
10. Reopen offline, query historical research, export/restore, or delete data with clear consequences.

### Finding research

11. Browse dedicated Insight/Barrier/Culture/Vice tabs and understand each finding from its front headline and short takeaway.
12. Click into a concise reader explaining what it is, who is affected, why it matters and what supports it.
13. Read a full cited story/report, save its shard, export a readable PDF or share its dated snapshot.
14. Discuss that finding with AI using its evidence and caveats, not a forced company-comparison workflow.
15. See disagreement, allegations, limitations and changed evidence honestly. Lack of support yields no published finding, not filler to satisfy a card count.

### Reliability and connectivity

16. Correct a number/identity/asset without automation silently overriding it.
17. Switch providers or combine keys without losing research or silently changing privacy/billing boundaries.
18. Encounter quota, network, disk, unsupported-provider and invalid-import failures with actionable explanations and resumable work.
19. Grant/revoke connector access to selected research; approve paid actions separately.
20. Use the same coherent navigation, terminology, facts and save/share behavior on browser preview and packaged desktop.

## 4. Working model and implementation boundaries

Build around the existing `MarketIntelRepository`, research agents and TypeScript contracts. Six internal services earn their complexity: identity catalog, provider gateway, evidence vault, research runner, publication service, intelligence service. Extract them only as a working slice needs them; no six empty modules upfront.

Shared records: identity, scout assignment, source document, exact passage, typed observation, canonical accepted fact, job, finding/shard, ranking snapshot, change event and asset. Scope every record to a workspace. Extend contracts additively where possible. Preserve old imports and backups; legacy verified flags do not gain new receipt-verified status automatically.

The publication service projects accepted evidence into all surfaces. UI components do not independently generate financial truth. Separate source publication date/reporting period, collection time, last attempt and last successful support. A failed refresh cannot make a fact look freshly verified.

Minimal action contracts are defined during early slices: researchMarket, researchCompany, refreshCompany, researchFinding, queryKnowledge, getEvidence, getChanges, setWatchPolicy, exportSnapshot. Job actions have permission scope, idempotency, usage allowance, cancellation and observable states. The final connector reuses them; it must not require a second research engine.

Main seams to reuse:

| Area | Existing seams |
| --- | --- |
| Evidence, facts, scoring contracts | `packages/contracts/src/provenance.ts`, `schemas.ts`, `repository.ts`, `scoring.ts`, `tiers.ts`, `freshness.ts` |
| Enrichment, orchestration, queries | `packages/research/src/company-agent.ts`, `repository.ts`, `pipeline.ts`, `dashboard.ts`, `signal-agents.ts`, `research-evidence.ts`, `adk/*` |
| Current Google transports | `packages/research/src/gemini.ts`, `genai.ts`, `types.ts` |
| Local durability and transport | `apps/desktop/src/storage.ts`, `main.ts`, `ipc-schemas.ts`; web repository `localStore.ts`, `vault.ts`, `RepositoryProvider.tsx`, `SentinelRepository.ts` |
| Card/reader presentation | `apps/web/src/features/card/CollectibleCard.tsx`, `CardReader.tsx`, `card-view.ts`, `Logo.tsx`, `collectible.css` |
| Deck, dossiers, reporting | `apps/web/src/features/deck/*`, `dashboard/*`, `reports/*`, `briefing/*`, `saved/*`, `lib/share/*`, `lib/living/*` |

Future module/test names in this plan are proposed, not existing code. Inspect exact paths before editing. Shared-contract changes must be checked against web, desktop, local research and cloud paths; a weaker alternate path cannot keep the old Verified badge.

## 5. Delivery order: ten bounded milestones

Every milestone below must end in a usable vertical slice, tests and founder review before broadening the category. Small subcommits are allowed; do not wait until the entire milestone to preserve work.

For continuity with the architecture companion: its phase A maps to K1, B to K2, C to K3/K4/K6, D to K5, E to K7, F to K8 and G to K9. K0 adds the current baseline. Use K0-K9 for execution tracking; do not maintain two competing completion lists.

### K0 — Establish the actual baseline

Before changes, inspect branch/worktree, preserve unrelated edits, launch the existing preview and reproduce the known dashboard Back-to-card journey failure. Determine whether it is a real defect or test/setup problem; fix the cause, not weaken the assertion.

Record the approved card/reader appearance at desktop and narrow widths, one existing full journey, current latency/call counts and factual gaps. Saved/generated fixture data is labelled. No paid provider run during baseline unless explicitly approved. Inventory buttons/routes with implemented, incomplete or unavailable states.

Exit: baseline reproducible; test failures recorded honestly and relevant navigation repaired; no unexplained UI changes. A baseline recording/screenshot is evidence, not proof of research accuracy. If rendering or data recovery is broken, resolve that within K0 before layering features.

### K1 — Make one company trustworthy end to end

Implement typed claim observations and source receipts through one company enrichment and verification path. Retrieve permitted originals safely, preserve provider support metadata, match exact passages/values/entity/period, then project accepted facts to card and reader. Use deterministic extraction for suitable statements/tables; bounded semantic review for ambiguity.

Close prose-only and fabricated-credibility verification, verdict/value mismatch, false freshness and equal-weight reconciliation gaps. Preserve superseded observations and human locks. Route other legacy ingestion paths through a fail-closed shared gate before they can show new-style verification. Minimal durable receipt persistence uses the existing store until K2 replaces storage; no evidence is memory-only.

Build original-source retrieval with URL/redirect safety, size/content limits, licence handling, timeout and injection isolation from its first use. Unknown private data ends with a reason, not unlimited search. No generated claim becomes evidence simply because the model supplies a quotation.

What the founder sees: matching facts on the face and initial reader, clear unknowns and a compact expandable evidence receipt.

Exit: wrong company/period/definition, prose-only support and irrelevant URLs cannot pass verification; unsupported zero is not shown; failed checks do not refresh support dates; card/reader share one fact revision. Demonstrate both supported and unavailable figures. Do not hide evidence-quality regressions behind lower latency.

### K2 — Make the local dossier durable and queryable

Introduce an asynchronous evidence-store contract. Migrate desktop to transactional indexed local storage with source/asset files; browser preview uses IndexedDB behind equivalent behavior. Validate migrations, rollback, revision-aware recovery and imports. Keep reports and saved findings; remove destructive quota shedding rather than calling those artifacts disposable.

Persist every scoped research result, permitted source passage and job receipt, including partial results before structuring succeeds. Add scoped indexed search by company, topic, property, period and source version. Keep keys out of evidence/export. No vector infrastructure prerequisite.

What the founder sees: research survives restart, saved questions find the right company's evidence, and backups restore the same dossiers without re-research costs.

Exit: interrupted writes/migrations, disk/quota pressure, stale multi-window writers, corrupt/future imports and deleted subjects behave safely. No success message before persistence acknowledgment. Offline reads make zero provider calls. Deletion/reference-retention rules and backup retention are explicit.

### K3 — Real Sentinel and Scouts; ready cards faster

Resolve canonical identities with domain/jurisdiction/registry evidence where possible. Stop automatic name-only merging; handle non-ASCII names and divisions. Persist one scout assignment and number per canonical company/workspace; attach deck memberships. Sentinel creates bounded, resumable priority jobs with shared provider/key limits, usage reservations and fair scheduling.

Research identity/official branding/core facts/reader as one priority bundle. Reuse safe fetches, extraction, receipts and accepted facts. Stream first-ready cards while leaving discovery placeholders clearly pending; deep work follows. Defaults begin at three company jobs, tuned by measurement rather than disabled throttling.

Resolve official logo/brand assets with identity checks, local caching and retry/manual correction. Preserve hero proportions; never stretch marks. Unknown brand uses neutral chrome. A bounded missing-logo attempt can end in an explicit initials fallback; it cannot hold an otherwise honest dossier forever.

What the founder sees: better first-ready timing, less logo pop-in, no duplicate research per deck membership, honest job progress and working pause/cancel/resume.

Exit: company and reader become ready in one revision; no blank finished card; duplicate tabs/runs share work; restart/429/cancellation preserve progress; undisclosed data terminates; scout number remains stable and separate from rank. Closed/sleeping desktop never claims active 24/7 research.

### K4 — Complete and cohesive company dossiers

Extend the verified observation/projection pattern to every existing dashboard section, progressively rather than generating eight tabs for every company upfront. Follow the user's focus; prefetch only within the explicit allowance. Cached/reopened sections render without new searches until genuinely due.

| Section | Required content and truth rule |
| --- | --- |
| Overview | Clear identity, products, customers, business context and current supported figures; no duplicate contradictory mini-reports |
| Metrics | Definitions, periods, evidence, conflicts and real disclosed history; no fabricated trend lines, interpolation or zero-filled gaps |
| Team & Org | Dated leadership/roles and actual sourced portraits; distinguish confirmed reporting lines from unknown relationships |
| Products & Roadmap | Current products/pricing, released vs announced plans, dated claims; no speculative roadmap presented as official |
| History | Sourced dated events and revisions, not current facts rewritten as historical evidence |
| Mission & Governance | Attributed statements, legal ownership/governance and evidence; distinguish marketing from observed practices |
| Live Intel | Relevant attributed developments with event/publication/collection dates and honest monitoring state |
| Live Landing | Actual page capture/allowed preview with timestamp and fallback, not invented screenshots or silent background browsing |

Keep the first reader simpler than the dossier: concise snapshot, compact core facts, collapsible receipts, one clear deeper-dashboard action. Navigation, evidence controls, save/share labels and empty/error states are consistent. Contextual Ask uses bounded relevant evidence and citations actually used.

Exit: every visible action either works or explicitly explains availability; source-backed figures agree across card/reader/dashboard/Ask/report; product and people claims are attributable; cold/open/warm states are clear; keyboard navigation and narrow layouts remain usable. Run the entire company journey, not isolated component snapshots.

### K5 — Specialist cards, reports and reusable shards

Implement the four finding types according to section 6. Market Specialist runs dedicated source plans and retains traceable findings; Scouts contribute relevant company evidence. Do not generate a quota of unsupported dramatic cards.

Ship one full finding journey first: front -> reader -> full report -> contextual discussion -> save -> PDF/share -> reopen. Then apply that proven flow to all four kinds, retaining their different evidence requirements. PDF export includes readable citations, dates and caveats; never silently launches a second paid report-generation job when the report already exists.

What the founder sees: meaningful non-truncated fronts, a polished short explanation, deeper stories rather than empty company dashboards, and useful portable research.

Exit: no inherited metrics/ranks; no company Ask/Compare/Briefing toolbar on these tabs; contextual Discuss finding works. Save/export/share preserve subject scope, source lineage and snapshot age. Sources are unobtrusive but inspectable. Thin/unsupported findings remain unpublished or labelled incomplete research, never inflated into confident stories.

### K6 — Sentinel Market Position ranking

Implement the scoring companion behind a feature flag after identity and accepted observations work. Defaults propose scale/adoption/momentum with 60/25/15 weights; shared cohort basis, small-set behavior and sensitivity checks are mandatory. Test and calibrate before replacing visible CMS tiers.

Sentinel triggers deterministic complete-cohort recomputation on peer or accepted-fact changes. Publish atomic versioned ranking snapshots; no cross-deck inputs, duplicates, model nudges or per-company missing-data reweighting. Empty/undisclosed data yields unrated, not low business quality.

What the founder sees: a restrained 1-99 badge where justified, a clear peer rank/legend, and explanations distinguishing company changes from added-competitor changes. Brand colours remain company-specific, not score rarity colours.

Exit: adversarial fixtures, 1/3/5/10/100-peer scenarios, tie/outlier tests and weight sensitivity; badge does not imply percentile, investment quality or absolute Titan status. Rankings and evidence revisions agree across screens and export. Recalculation makes no LLM request.

### K7 — Provider openness and complementary keys

Keep minimal gateway interfaces from K1; now implement tested adapters/settings. Support Google first, then a native or compatible reasoning route with explicit search/retrieval, OpenRouter, and locally configured compatible endpoints. Prefer existing maintained transport adapters over bespoke integrations. Revalidate current API/model capabilities when implementing.

Settings separate reasoning, search and optional imagery, with simple defaults and advanced options. Capability checks, usage/pricing metadata, credential references, timeout/cancel and approved fallback share one contract. Data cannot silently cross providers. Image generation is labelled editorial and never gates factual readiness or generates official logos/people.

What the founder sees: clear setup and useful single-key/mixed-key modes, optional enhancement without configuring an agent fleet, and no lost dossiers when providers change.

Exit: identical evidence/readiness rules on all supported routes; missing search/new-model incompatibility yields explanation, not training-data guessing. Token/search/image usage is recorded; unknown price is not a fabricated dollar guarantee. Keys never appear in logs/files/share payloads. No automatic use of a different paid route without approval. Advertise tested compatibility, not every possible key.

### K8 — Useful ongoing intelligence

Enable durable, opt-in scout/specialist watch policies with budgets, cadence, quiet hours and pause. Source-version/new-filing checks and topic-specific freshness precede expensive full re-research. Back off undisclosed fields; separate short-lived market prices from periodic financial disclosures.

Create deduplicated before/after ChangeEvents: what changed, why relevant, evidence and dates. No-change is quiet. Existing human locks remain intact while the agent can flag stale/conflicting evidence. A removed/archived deck cannot restart a cancelled scout silently.

What the founder sees: a concise relevant change feed and a research vault worth revisiting, not fake agent activity, repetitive summaries or uncontrolled spend.

Exit: schedules resume safely, budget survives app reopening, no duplicate alerts, revoked permission stops jobs, sleep/offline states are honest. Research changes and membership-driven rank changes are not misrepresented as company performance changes.

### K9 — Connector, sharing and release hardening

Expose scoped read/query/evidence/change operations over local MCP first; wrap approved research/refresh/export jobs next. Checkpoints from earlier phases already provide shareable snapshots, so MCP is integration rather than a new backend. Muse/Dots/OpenAI/Codex compatibility requires actual client testing, not just naming them in docs. Remote connectors/auth are separate opt-in work; no assumption that a chat subscription grants API credits.

Finish desktop packaged journeys, licensing/privacy/accessibility, credential isolation, safe update/signing/distribution setup and useful diagnostics. Audit every advertised click path, report, import/export, recovery and share. Account/cloud infrastructure is not required for local BYOK release.

Exit: complete release gates in section 10, known limitations documented, every supported connector has permission/revocation/hostile-input tests. Local read access cannot mutate research or invoke paid jobs. No main merge/deployment/publication without explicit approval.

## 6. Specialist-card specification

| Kind | Plain meaning | Research must establish | Avoid |
| --- | --- | --- | --- |
| Insight | A meaningful shift, opportunity or overlooked connection | What changed/pattern observed, evidence, affected market and why it matters; label interpretation | Generic AI trends or a hunch presented as a fact |
| Barrier to Entry | What makes entering/competing difficult | Mechanism, who faces it, strength/limits, relevant regulation/capital/distribution/network effects and possible routes around it | Calling any advantage an insurmountable moat |
| Culture | What people value and how they behave | Attributed customer/employee/community practices, context, time and sampling limitations | Treating anecdotes as representative statistics or entire-company truth |
| Vice | The uncomfortable side worth investigating | Documented practices/controversies, allegation vs established finding, timeline, source independence, response and unresolved points | Sensationalism, fabricated accusations, inferred guilt, silence interpreted as admission |

Each finding record carries market context, zero/one/multiple company links, claim/evidence links, headline, concise front takeaway, overview, why-it-matters, full report, caveats/counterevidence, source lineage and publication/revision dates. Type-specific fields hold barrier mechanisms or allegation status without forcing all types into company profiles.

Front target: one meaningful headline plus one or two short sentences, authored specifically as a card summary rather than clipping a long report. Avoid visible ellipses by revising concise front copy; never remove necessary qualifications just to fit. Use a single type label, not duplicate labels over the artwork. Stable card dimensions, brand-consistent artwork and existing shading; no auto-generated dramatic imagery prerequisite.

Reader: concise overview, who is affected, why it matters, date/status, compact sources control and Read full report. Full report: clear narrative sections and claim-linked citations, context, supporting evidence, counterevidence, limits and practical implications labelled as analysis. A source drawer can stay quiet visually without hiding original receipts.

Contextual chat is distinct from company Ask/Compare/Briefing. Scope includes finding ID and linked evidence; do not quietly expand to unrelated companies or change the report as a side effect of a chat answer. Save findings as local shards with provenance; duplicate saves reuse identity, later revisions do not overwrite shared historical snapshots.

Sensitive Vice claims need conservative gating and human review until the benchmark demonstrates a safe process. Culture needs attribution and sampling caveats. No numeric score for these findings and no company metrics inherited from their subjects. If a claim is retracted, preserve history and update the current finding visibly; shared copies remain dated snapshots with a revision status where available.

## 7. Latency and cost engineering

Measure stages separately: click acknowledgment, discovery, first-ready card+reader, all card essentials, requested deep tab, scoped query, cache hit, queue/provider wait, extraction/review, persistence and rendering. Count requests, tokens, search/image fees when available, retries, duplicates and cache hits. Report latency and evidence quality together.

Targets inherited from the architecture are hypotheses: action feedback under 1 s; warm local reads p95 under 250 ms on the benchmark machine; indexed query under 1 s on a documented 100,000-observation fixture; first-ready card+reader p50 under 60 s/p95 under 120 s on a specified live benchmark. Never claim these targets are met from mock latency. Small paid samples are exploratory and cannot establish reliable p95.

K3 performance improvement target: at least 20% lower median first-ready time on a repeatable paired workload, OR demonstrably fewer outbound calls for equivalent accepted coverage when provider variance prevents a speed conclusion. That is an acceptance target, not a promised result. If the evidence-receipt requirement increases cold work, report the tradeoff, optimize reuse and warm latency, and do not lower quality to achieve a percentage. Cache hits should avoid outbound requests entirely unless an explicit freshness check is due.

Highest-leverage optimizations: cache versioned original documents and accepted observations; deduplicate requests in flight; card+reader from the same research bundle; bounded parallel jobs under a shared limiter; parse deterministic data without another model call; prioritize user's current task over speculative prefetch; invalidate dependent sections only; no duplicate PDF generation; rerank locally; query compact evidence instead of whole-library prompts.

Stable prompt prefixes and provider-supported caching reduce repeated context costs. Agents retain compact persisted tasks/evidence IDs, not endless transcripts. Keep sessions comfortably below the user's 200k context boundary, with a planned handoff before 120k where usage is measurable; never deliberately work to the limit. Preserve full evidence on disk while compacting summaries. User monitors spend; the app must still prevent accidental runaway loops and disclose pricing uncertainty.

## 8. Verification ladder and live tests

1. Pure unit/contract tests for evidence validation, definitions, ranking, dates, scope and human overrides.
2. Recorded permitted fixtures for source acquisition and extraction, hostile pages, wrong identity/period, copied sources, unsupported figures and retractions. Do not commit secrets, personal research or unlicensed full documents.
3. Integration against actual repository/storage implementations: research -> receipt -> accepted fact -> card/reader/dashboard/report/Ask; crash, import, quota, concurrent writes, cancel/resume.
4. Browser and packaged-desktop journeys, responsive/keyboard checks, real save/share/report actions and actual rollback/recovery. A screenshot of a good card is not a full journey test.
5. User-approved live Gemini smoke: one public and one private company, one finding, capped scope. Manually inspect every displayed business figure and reader claim against originals. No key copied from an unrelated preview without permission.
6. After the small smoke passes and a separate spend allowance is approved: representative ten-company market with non-US/small-business/parent-division cases and four specialist findings; mixed-provider benchmark in K7. Repeated runs for statistical latency claims need their own allowance; do not automatically launch a 30-company paid benchmark.

Developer commands: `pnpm --filter @mi/contracts test:run`, `pnpm --filter @mi/research test:run`, `pnpm --filter @mi/web test:run`, `pnpm --filter @mi/desktop test:run`, `pnpm check`, `pnpm --filter @mi/web test:e2e`, `pnpm --filter @mi/web build`, and `pnpm build` for desktop compilation. Inspect current scripts/environment before relying on any command. Self-skipped live tests count as NOT RUN.

The current root `pnpm build` compiles the desktop application; it does not prove an installer works. K9 also runs `pnpm --filter @mi/desktop dist` (currently configured with `--publish never`) and tests the resulting installed application. Review legacy repository/publisher metadata before distribution; do not automatically publish to its historical owner.

Never weaken a failing test to match incorrect output, substitute a mock for a claimed live run, or claim exact billing accuracy from estimates. Do not log key values. Research/API test failures are triaged by layer, not met with indefinite retries.

## 9. Checkpoint scorecard and red-team routine

Every checkpoint includes a small before/after table with measurements actually collected:

| Dimension | Measure | Evidence |
| --- | --- | --- |
| Speed | First-ready/cold/warm timing, duplicates and queue/provider wait | Same fixture/environment; sample count and cache state |
| Factual quality | Unsupported-as-verified errors; entity/period/definition correctness | Original-receipt audit, not a model's self-score |
| Useful coverage | Available disclosures captured; unknowns explained; report relevance | Subject-specific checklist, not raw source count |
| Cohesion | Card/reader/dossier/report agree; action paths work | Full-journey test/recording and revision IDs |
| Durability/privacy | Restart, recovery, scopes, secrets and share safety | Fault/permission tests |
| Efficiency | Requests/tokens/provider spend if known; reused evidence | Ledger/trace with no secrets |

At checkpoint, ask: Is this visible and useful? Are we earning complexity? Can a source URL falsely imply verification? Are we punishing nondisclosure? Are membership changes called business changes? Did we accidentally send data to another provider? Did we preserve the original card appeal? Can the user finish the journey after a failure? If the answer is weak, correct this slice rather than moving on.

Record a concise full affected-journey screen recording at material checkpoints, plus narrow-layout screenshots as appropriate. Use permitted real or clearly labelled fixture data; redact credentials/private content. Do not call a simulated recording a live research run. Capture/render tools are selected at execution time; if recording is unavailable, report that and supply verified screenshots plus steps, not an invented video link.

Commit coherent tested slices locally on the exploration branch. Push checkpoints only to the authorized remote/branch when authentication works; report failures and do not confuse local commits with GitHub backups. No public deployment or main merge by default. A checkpoint has exact commit, implemented vs planned list, tests actually run, before/after, remaining risks and the next bounded task.

## 10. Release gates and exclusions

Release is gated on the actual complete advertised journeys: onboarding/key setup -> market creation -> ready company/finding -> reader -> deep report/dossier -> chat/save/share -> reopen/watch -> scoped connector. All visible actions work or explicitly state capability limits. No fake charts, misleading verification, unsupported sensitive findings, silent quota deletions, leaked keys or cross-workspace notes. Required evidence can be inspected where legally available, including definitions/dates/attribution.

Recovery/import/export, safe migrations, cancellation/rate limits, provider compatibility, licence/privacy constraints, accessibility, desktop build/update/signing and supported connector permissions must pass. Known limitations belong in the product/release notes. A useful local BYOK release does not require a hosted service scaled for a million accounts.

Not in this build by default: brand redesign, flip-card mechanics, guaranteed exhaustive coverage/zero hallucinations, universal investment ratings, persistent free-running model fleets, forced scores for every private firm, paywall bypass, automatic access to paid data, synthetic factual portraits/logos, silent cloud sync, always-on hosted monitoring or automatic public publishing. Voice/image expansion beyond factual branding remains optional and cannot displace evidence/card-quality milestones.

## 11. First build session and continuity

Start K0, then the first K1 slice. Reproduce the current navigation issue, establish appearance/data baselines, add failing fixtures for weak verification and false freshness, and implement one complete company card+reader evidence path. Do not simultaneously start scoring, connector scaffolding, broad provider UI or a storage rewrite. End with an inspectable result and a truthful checkpoint even if the whole milestone is unfinished.

Active status is maintained in [Build status](../../../docs/KEYSTONE-BUILD-STATUS.md). Read it before the plan; it names completed work, current blockers and the next task. Update it on every checkpoint/handoff. Future sessions need not reread the conversation. Never create scheduled goals or switch the user's model/account merely because this plan mentions agents.
