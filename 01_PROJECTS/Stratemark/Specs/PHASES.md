# Phased build goals and verification

Plan version: 1.0.0. Companion to [NORTHSTAR.md](NORTHSTAR.md) and [ACTIONS.md](ACTIONS.md).
The initial plan did not start these goals. Subsequent human authorization started G00; BUILD-STATE is the authoritative execution ledger. Creating this plan alone does not authorize the build, paid evaluation, automation restart, publication, or a main merge.

## 1. Execution order

| Goal | User outcome                                                                         | Dependency                | Main seams / story coverage                                           |
| ---- | ------------------------------------------------------------------------------------ | ------------------------- | --------------------------------------------------------------------- |
| G00  | Every action and existing weakness has a defined contract and reproducible baseline. | Human build authorization | Contracts, current caller inventory; all US stories                   |
| G01  | Saved research becomes a reliable local vault with recoverable migration.            | G00                       | Desktop storage, research persistence, contracts; US01/13/14/16/23/30 |
| G02  | Research is controlled, resumable, secure, and honestly budgeted.                    | G01                       | Runtime, desktop IPC/settings, all call sites; US02/03/06/07/24/28    |
| G03  | One real market run produces useful evidence-backed company dossiers.                | G02                       | Discovery, Scout, providers, evidence; US04/05/08/13/14/16            |
| G04  | Cards and the company journey feel clear, premium, and useful.                       | G03                       | Web surfaces, projections and cached reads; US01/09/10/11/12/27       |
| G05  | Questions, comparisons, briefs, and findings help real decisions.                    | G03 and G04 contracts     | Evidence projections, research outputs, workspace; US15/17/18/19/20   |
| G06  | Following a company produces meaningful, bounded changes.                            | G02/G03/G05               | Scheduler, updates, library activity; US21/22/28                      |
| G07  | External assistants use selected local research safely.                              | G02/G04/G05               | Shared service, MCP adapter, grants; US24/25/26                       |
| G08  | The supported desktop release passes production and recovery gates.                  | G01-G07 release scope     | Packaging, full user journey, docs; US23/27/29/30                     |

Do not parallelize writes to shared contracts, the vault schema, or runtime state machinery. Read-only evaluation and isolated visual exploration can run alongside another packet. G06 and G07 can run in parallel only after shared policies/actions are frozen, with disjoint file ownership. Each goal is a sequence of small integrated slices, not one enormous rewrite.

## 2. Per-goal scope and completion gates

### G00 — Freeze contracts and establish the baseline

Create the full current-action/caller map: renderer hunts, dashboard lazy research, desktop repository replacement, background refresh, import/export, and existing provider adapters. Verify the risks in RESEARCH.md with failing/reproduction fixtures before coding fixes. Capture representative current deck/card/workspace screenshots using synthetic/public test data, not private research or keys.

Define runtime-validated schemas for A01-A62, record versions, state transitions, grant scopes, egress and budget policies. Group implementation packets by dependencies; not every action needs a separate module. Identify legacy/cloud/account routes to retain as explicitly unsupported preview features or retire from the local release.

Completion evidence: baseline `pnpm check` output from the actual branch; every visible research action mapped; reproducible fixtures for cancellation, late writes, import races, cross-market identity, period conflicts, and plaintext-key exposure; no production/provider cost claims without measurement. Record failures honestly rather than baking them into a green baseline.

### G01 — Durable vault and safe data migration

Build a vault adapter with transactions, schema versioning, immutable company IDs, many-to-many memberships, append-only supported observations, source passages/versions, correction history, and lexical search. Select the SQLite binding through a packaged Electron spike: module loads, FTS5 works, crash/reopen/backup works, bundled version is patched, and installer carries the dependency. Default investigation starts with packaged `node:sqlite` to reduce native dependency friction; if runtime/API maturity or performance gates fail, use a maintained packaged SQLite binding behind the same adapter. This is a binding verification condition, not a change to the SQLite architecture [S25]. Record the selected version before schema implementation.

Migrate current snapshot formats through an explicit version chain, retaining reports, jobs, findings, and source provenance. Do not reset unknown/future formats to current. Use an untouched original backup and a staged new vault, validate counts/content/relationships, then switch. Do not dual-write two authoritative stores. Keep the old read adapter only for fixture/migration verification until cutover is proven. Preview mode is not production data authority.

Add consistent backup, restore, validated portable export/import, trash/restore, and local-disk relocation. Imports are untrusted inputs, not files that can execute code or select arbitrary output paths. Read-only migration inspection cannot change job statuses in exported data. Quota errors must be explicit, never solved by silently dropping reports.

G01 owns the minimum exclusive process lock, writer-generation fence, and legacy-worker shutdown contract required for safe migration. Initial cutover is offline/quiescent until this foundation passes; G02 extends it to the durable scheduler. Pin/checksum referenced assets in backup/restore; publish assets before database references; retain report support during GC or explicitly mark outputs incomplete after approved purge. External imports cannot forge local verification. Imports/restores disable operational authority: no revived grants/schedules/queues/budgets, no reset spend allowance. Add corresponding adversarial fixtures now, not after monitoring/MCP ships.

Completion evidence: fixture round-trips for every known schema; too-new/corrupt/oversized formats fail safely; crash during migration preserves original; concurrent/late workers cannot write during cutover; company in two markets resolves to one dossier; same-period conflicts and different-period observations stay distinct; FTS sees only accessible records; restore drill from a live consistent backup. US01 works with no key and network denied.

### G02 — Shared action service, jobs, security, and budgets

Build transactional action acceptance, dedupe, optimistic revisions, lease/checkpoint tasks, event replay, scope propagation, cost reservations, and one scheduler. Remove renderer-owned dispatch/refresh as authority. UI timers can display status, not launch unmanaged provider work. Route the existing full research flow through this runtime before adding more roles. Drain/fence provider replacement, cancelled tasks, detached warm-up, import, and restore.

Change stored-key APIs to status-only; trusted desktop provider boundary owns secrets and egress. Preserve/strengthen Electron sandbox, isolation, sender validation, safe navigation, URL policy, redaction, and protected storage. No arbitrary localhost/private-network fetch from retrieved pages; user-approved local model endpoints are a separately scoped exception. Test DNS redirects/rebinding and source prompt injection as access-control problems, not just prompt wording.

Completion evidence: same command from UI and test adapter produces one receipt/job; simultaneous replay creates no duplicate task; paused/cancelled/expired-grant workers cannot dispatch or commit late results; force-close/restart recovers checkpoints and retrievable outputs; active jobs never age out of history retention; stored keys never return in renderer payloads or appear in logs/export (fresh trusted key input is transient and cleared); budget limits hold across concurrent workers/retries/search calls; restore cannot reset an allowance; unknown pricing routes cannot claim a strict money cap; provider removal and failure keep partial evidence. Human-only challenges reject forged client identity, changed input, and replay.

### G03 — Sentinel and Scout, measured research quality

Implement progressive market discovery and company research as task dependencies over the established runtime. Confirm scope/seeds first. Canonicalize entities using evidence and domain relationships. Persist ambiguity instead of fuzzy merging. Scout first fills the highest-value gaps, selects useful sources, extracts typed observations, checks passages/definitions/periods, preserves conflicts, and produces cached projections. Sentinel never claims every player was found.

Normalize current Gemini, OpenRouter-compatible, Firecrawl, Perplexity, Serper, and custom/local capability paths; keep adapters with proven value. Pin recorded provider-response fixtures to documentation/version dates. Test native-search citation mapping and explicit external retrieval. Do not equate a provider's search snippet or model wording with passage-supported evidence.

Use the experiment ladder below. Prefer a smaller task with useful support over an elaborate multi-agent debate. Cheap discovery and focused extraction can use different models; route only where tests show benefit. Refinement stops at limits or sufficient useful evidence, not a fabricated quality percentage.

Completion evidence: three different market types pass offline fixtures; all requested seeds accounted for; one end-to-end packaged live run under an approved cap; sparse private-company case remains useful without false metrics; contradictory sources retain status; useful cards arrive progressively; every displayed numeric observation has usable support and matching definition/period; source prompt injection cannot request secrets or run an action. Record quality, latency, gaps, and actual/estimated cost separately.

### G04 — Card craft and the full frontend journey

Make a small visual prototype on the exploration branch before sweeping all screens. Use original typography/green/editorial cues, hero company identity, restrained per-company accents, and useful market-specific facts. Test logos with no asset, very long name, monochrome logo, low contrast, subsidiaries, narrow layout, and sparse evidence. Founder can review the actual preview before repeated restyling; visual acceptance is subjective and cannot be manufactured by automated scores.

Unify Library, market deck, quick reader, and full company workspace. Primary company sections are Overview, Products & business, Metrics, Updates, Evidence; secondary details unfold where evidence exists. Reader is lightweight and optional; preserve deck route/filter/scroll/focus. Remove the flip action and stale/generated ranking language. Move provider work behind explicit buttons; cached navigation is free of network calls.

Completion evidence: first-run and return journeys, company direct link, refresh/reopen, search/filter/sort, sparse dossier, failed/paused run, and no-key/offline reads pass; visible metric labels carry units/dates; cached navigation causes zero provider calls; keyboard and reduced-motion journeys pass; contrast/readability and desktop/narrow screenshots reviewed. No fabricated metrics, generic filler, or decorative score replaces meaningful data.

### G05 — Useful decision tools and market findings

Implement cached comparison, explicit billed explanations, saved-evidence questions vs explicit web questions, evidence-linked written briefs, and direct human corrections. Reports save their input revisions and support; they do not rewrite earlier reports on refresh. Keep empty sections explicit and compact.

Implement Trends and Barriers to entry first. Add Culture and Risks only behind separate quality gates. Culture needs evidenced workplace/community significance; do not fill it with press-release enthusiasm. Risks distinguish attributed allegation, established event, ongoing development, and resolution. Avoid unsourced reputational scoring. Findings own their evidence, not inherited company metrics. An absent trustworthy finding is better than a full tab of weak content.

Completion evidence: comparison flags incompatible definitions/currencies/periods; saved-evidence answers cannot silently browse; brief citations resolve to retained input evidence; unsupported answer/claim fails closed; model/MCP cannot assert human verification; correction preserves history; repeated/syndicated sources don't count as independent corroboration; risk fixtures cover allegation/resolution/context and rejected unsupported claims. Founder walkthrough determines whether each output actually helps a decision.

### G06 — Honest local continuous intelligence

Add opt-in schedules with selected companies, change focus, daily default, concurrency/request/token/spend limits, and a visible last actual check. Store schedule state in the vault; run only while the local service is alive. On wake/reopen, coalesce missed ticks into at most one eligible bounded check; do not replay an unlimited backlog. Disable/revoke immediately affects dispatch.

Monitoring additionally requires an active desktop session in v1; a supervised MCP-only host cannot dispatch schedule ticks. Explicit connector jobs may continue under their own approved mode while desktop is closed, with clear status and exit disclosure. Test desktop close vs host handoff vs full process exit separately. No hidden background monitoring default.

Update detection compares normalized observations and source versions; identical headlines, syndicated duplicates, or unrelated page changes do not become new intelligence. Changes explain what changed, event vs retrieval time, evidence, relevance to the saved goal, and superseded/resolved status. Findings return to the library without a new dashboard full of notifications.

Completion evidence: fake clock tests for sleep/offline/timezone/restart; missing key/exhausted budget causes a visible wait with no calls; user changes cadence/limits/revokes correctly; new supported observation makes one update; repeated news makes none; cancellation keeps prior evidence; schedule never claims coverage while closed. Monitoring enabled without budget/consent must fail.

### G07 — Scoped local MCP and connector readiness

Start with read tools/resources over the same cached action service: library search, company/market reads, evidence, reports, updates, and status. Add selected job tools only after read scope and disclosure tests pass. Server-side policy remains authoritative regardless of tool hints. Exclude secrets, arbitrary files/HTTP, SQL, shell, human-verification, import/export/merge/purge operations.

Implement stdio ownership and optional authenticated loopback HTTP; no second competing writer. Freeze compatible SDK/protocol versions and test supported older/current clients. Provide installation/configuration instructions and a connection screen with target allowlist, expiry, redacted audit, egress statement, revoke, and clear device-online behavior. Standardized search/fetch wrappers require the real host schema and citation handling, not invented compatibility.

Validate the exclusive owner/attach/handoff protocol established in G01/G02. Supervised headless mode only executes explicitly approved connector jobs, not monitoring. Check shared-company/private-source boundaries, output retrieval after reconnect, restored disabled grants, and human approval challenges; do not equate transport authentication with a user's attestation.

Completion evidence: protocol/Inspector checks; two supported local clients where available; read-only and cross-market/source/report scope denial; pagination/response-size limits; forged caller identity denied; indirect injection cannot expand access; replay/reconnect cannot duplicate a paid job; expiry/revoke blocks queued work and later disclosures; external research receipt corresponds to desktop activity. Muse/Dots remain unverified until a real host test is recorded. Do not gate core release on an unavailable host.

Hosted ChatGPT connection is a separate optional validation slice using the then-supported private tunnel and actual account permissions. Public plugin/relay deployment is DEFERRED and needs new authority, authentication/security design, operating costs, and a retention statement. No relay deployment or inbound public listener is part of this goal.

### G08 — Production release candidate, not automatic publication

Run the full packaged Windows product, not just web preview. Reconcile every action, loading/empty/error state, onboarding, permission dialogue, routing/deep link, data lifecycle, and unsupported legacy/cloud route. Verify the exported app contains no keys, customer data, private recordings, or generated assistant sessions. Audit dependency licenses, attribution, maintained/patched dependencies, content-provider obligations, and repository license before calling it open-source release-ready.

Completion evidence: `pnpm check`; build/package with publishing explicitly disabled; installation/update/uninstall/reinstall retaining expected user data; restart/recovery/migration/backup/import/export/trash drills; keyboard/contrast/reduced-motion review; offline/no-key flow; approved live research quality run; MCP denial/revoke tests; key/diagnostic leak scan; deterministic versioned artifacts. Windows signing is a release gate that may need human certificate/account setup; an unsigned prototype is not a signed production release. OS claims require actual packaged tests per OS.

Produce a release-readiness report with passed, failed, deferred, and unverified items. Ask separately before pushing, deploying, publishing, or merging. A green suite or ready local installer does not authorize those actions.

## 3. Research experiments: spend credits for evidence, not activity

No paid provider calls have been performed for this planning document. The user's available API balance is not a benchmark result and is not a numeric budget. Do not reuse stored credentials or start live runs just because a key exists.

### Evaluation dataset

Choose three public market archetypes: Frontier AI/model ecosystem, B2B vertical software, and a non-software manufacturing/distribution market. Include a known seed list, excluded entities, subsidiaries/aliases, sparse private firms, comparable and incomparable metrics, time-separated observations, conflicting same-period reports, duplicates, and an adversarial source. Version the dataset, source date, adjudicated reference expectations, and evaluation rubric. No expectation of exhaustive market recall.

Offline fixtures use synthetic/redacted records and minimal legitimately shareable source passages. They validate state/integrity, not prove live model quality. Curated live reference sets are dated and have explicit coverage limits; a source becoming inaccessible is a recorded gap, not automatic falsehood.

### Experiment ladder

1. **E01, zero API cost:** deterministic extraction/projection/schema/error/recovery fixtures and saved-response adapter fixtures. Fix integrity defects first.
2. **E02, bounded live pilot:** after human approval of a numeric cap, compare existing Gemini native search with flexible OpenRouter + selective retrieval on two archetypes. Recommended initial envelope: at most USD 20 total, also explicit request/token ceilings; prices and ability to estimate upper bounds must be checked before dispatch. This is a suggested budget, NOT present authorization. Stop when any cap is reached; inconclusive means inconclusive.
3. **E03, controlled alternatives:** change ONE factor per experiment: query/seed expansion, retrieval strategy, extraction prompt/model, support-check method, or task routing. Compare Perplexity/raw search and an approved low-cost/local route where useful. No automatic full Cartesian product of providers and markets.
4. **E04, confirmation:** repeat promising configurations at least three times across the third archetype and initial cases, subject to a separately approved cap. Report variability, errors, latency and cost; do not crown a winner from one polished answer.
5. **E05, release journey:** one real packaged first-session run and one bounded updates cycle on the selected release configurations, with evidence manually inspected. Live keys/recordings stay outside the repository.

### Rubric and gates

| Measure                    | Proposed gate / interpretation                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seed accountability        | Every seed is included, reviewed as ambiguous, or explicitly excluded with scope reason; never silently lost.                                                                                                                      |
| Company relevance/identity | At least 90% precision against the dated curated inclusion rubric; false merges = release-blocking defect. Recall reported against that set, never whole-market completeness.                                                      |
| Evidence integrity         | Zero unsupported numeric or adverse claims promoted to normal visible facts in the evaluated release journey. Any failure blocks that configuration until fixed and re-evaluated. This gate is not a guarantee of universal truth. |
| Support inspection         | Manually inspect every displayed numeric/adverse claim in pilot runs and a declared stratified sample of qualitative claims; record passage/definition/period alignment and errors.                                                |
| Unknown/conflict handling  | No null-to-zero, unearned `user_verified`, silent same-scope contradiction suppression, or incompatible metric sorting.                                                                                                            |
| First useful result        | Track p50/p95; initial target first supported card within 90 seconds on the declared test setup, or honestly revise scope/preset before promising latency. Not currently measured.                                                 |
| Cost efficiency            | Report estimated and known costs, request counts, support quality, and useful dossiers per cost; lower cost without evidence quality is not a win.                                                                                 |
| Recovery/control           | No duplicate committed action or unauthorized late write in fault-injection tests; paid ambiguity explicitly handled.                                                                                                              |
| Meaningful updates         | Duplicate check creates zero duplicate findings; a supported material change creates one attributable update.                                                                                                                      |
| UX                         | Founder review plus complete keyboard/offline/error journeys, not a self-awarded aesthetic score.                                                                                                                                  |

Targets are chosen acceptance thresholds, not results. Rebaseline them only through a documented decision; do not quietly weaken them to turn failures green. Stochastic quality statistics use actual sample size and variability. Security/integrity failures are not averaged away by a good mean score.

## 4. Common verification and packet gates

From the repository root:

```text
pnpm check
pnpm --filter @mi/desktop build
pnpm test:e2e
```

`pnpm check` is the required engineering gate. Desktop build is an artifact check, not installation verification. Confirm the current e2e harness and fixtures before running e2e; unavailable browsers/services are explicit limitations. Unit tests, web preview, and live desktop behavior are different evidence types. Run targeted tests for each slice and the full gate before integrating a milestone; attach exact command, date, branch/commit, exit result, and failure details. Do not repeat a historical test count as current evidence.

Goal start: check usage, git branch/status, relevant instructions, dependencies, file ownership, secret/data boundaries, and phase authorization. Goal finish: review actual diff, scenario results, budget usage, migration implications, and remaining limitations, then commit locally when ready. Do not mark a goal complete with required work remaining. Use the product's goal tool only after human authorization to execute that named goal; goals in this document are the future execution register, not already active tool goals.

## 5. Deferred scope

Public hosted relay/plugin distribution; automatic cloud sync/accounts; encrypted research database; embeddings/vector search unless lexical evaluation shows a gap; autonomous arbitrary plugins; unlimited background agents; user subscription/OAuth credential workarounds; predictive business valuations; a universal strength leaderboard; card backs; general coding terminal; every-OS production support without dedicated validation.

These are deliberate deferrals, not forgotten gaps. Their addition requires new stories/actions, threat and cost analysis, versioned decisions, and human approval.
