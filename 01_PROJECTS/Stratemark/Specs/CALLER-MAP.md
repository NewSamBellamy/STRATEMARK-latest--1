# Current caller migration map

G00-P03 inspection, September 30, 2026; entry HEAD `44bfeb8`. Paths below
identify actual current seams, not a claim that any new action is wired.
Repository interface calls, desktop IPC and renderer timers still bypass the
new action contracts. This register complements ACTIONS; BUILD-STATE owns status.

## User journey and operations

| Current entry / method                                        | Inspected implementation                                                | Required action / disposition                                                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Library / `listMarkets`, `getMarket`                          | `apps/web/src/hooks/data.ts`, MarketsListPage                           | A01-A03; cached reads                                                                                                              |
| Deck / `getDeckByMarket`, `listCards`, `getCard`              | data.ts, DeckPage, CardGrid                                             | A03/A04; local filters/sort/reader must never dispatch                                                                             |
| Saved cards / `listSavedCards`, `saveCard`, `unsaveCard`      | data.ts, SavedCardsPage                                                 | A01/A13; saved state separate from deletion                                                                                        |
| New market / `createMarket`                                   | data.ts, NewDeckPage                                                    | A06/A08; scope preview/confirmation, no paid work                                                                                  |
| Research new deck / `createResearchedDeck`                    | NewDeckPage, research-session.ts, `packages/research/src/repository.ts` | A14; durable acceptance/activity; scope first                                                                                      |
| Research more / `expandDeck`                                  | data.ts, `lib/agentic/useHuntRunner.ts`                                 | A15 or A17 by entity/finding focus; renderer queue must lose authority                                                             |
| Refresh deck / `refreshDeck`                                  | data.ts, useAutoRefresh                                                 | A34; explicit bounded check, schedule only with A36 approval                                                                       |
| Company / `getCompany`, `getCompanyMetrics`, `getViceClaims`  | data.ts, CardReader, DashboardPage                                      | A04/A05; findings keep separate support                                                                                            |
| Open company tab / `getDashboardTab(..., force absent)`       | data.ts:172; repository.ts:1258                                         | A04; currently a cache miss researches, reproduced RED                                                                             |
| Research this section / `getDashboardTab(..., true)`          | data.ts:447                                                             | A16; explicit command, no boolean read/write ambiguity                                                                             |
| Ask / `deepDive`, `askResearch`                               | DeepDive.tsx, desktop main/preload                                      | A18 saved evidence default; A19 explicit web mode; existing web behavior not cached-safe                                           |
| Research threads / `listResearchThreads`, `getResearchThread` | ResearchControls, DeepDive, desktop IPC                                 | A01/A27 output reads; keep conversation inputs/revisions                                                                           |
| Save thread / `saveThreadAsReport`                            | DeepDive.tsx:460                                                        | A22 when model synthesis needed; never hide billing behind Save                                                                    |
| Reports / `listReports`, `getReport`, `generateReport`        | data.ts, reports pages, desktop IPC                                     | A01/A23 reads, A22 generation; immutable retained inputs                                                                           |
| Briefing / `listDeckBriefings`, `generateDeckBriefing`        | BriefingPage, data.ts, useSentinel                                      | A33 cached updates, A34 explicit check; no cadence inferred from prior brief                                                       |
| Opportunity / `getMarketOpportunity` with absent/true force   | data.ts:432/459, OpportunityPage                                        | Cached A03 findings vs explicit A17; consolidate into market findings                                                              |
| Fact check / `factCheck`, `verifyMetric`                      | data.ts, FactCheck, living deck, share preflight                        | A24 support check; A26 human confirmation is a different operation                                                                 |
| Metrics hunt / `huntCompanyMetrics`                           | data.ts:379, repository.ts                                              | A16 scoped metrics fill; same budgets and runtime                                                                                  |
| Manual metric override / `overrideMetric`                     | data.ts:419                                                             | A25/A26; trusted confirmation, append-only correction                                                                              |
| Site audit / `auditSite`                                      | data.ts:299, SiteAuditView                                              | Explicit A16 products/business task only if covered by approved scope; otherwise unsupported legacy preview, not general URL fetch |
| Market cadence / `updateMarketCadence`                        | data.ts:218, MarketSettingsPage                                         | A35-A38 schedule workflow, explicit opt-in; cadence alone is not authority                                                         |
| Delete deck/market / `deleteDeck`, `deleteMarket`             | data.ts:197                                                             | A49 impact preview/trash; shared company evidence retained                                                                         |
| Cancel/resume/list job                                        | main.ts, preload.ts, ResearchStage                                      | A27-A32; no terminal acknowledgement before fencing                                                                                |
| Share/export/PPTX                                             | share components, SharePage, reports/pptx.ts                            | A42/A43 selected snapshot; any support recheck is separate explicit A24                                                            |
| Settings import/export                                        | SettingsModal desktop flow, `lib/repository/vault.ts` preview flow      | A42-A45; no parallel authority; import drains/fences old workers                                                                   |
| Settings backup restore                                       | SettingsModal browser localStorage `.backup` flow                       | A46/A47; actual consistent backup+assets required, old snapshot isn't production backup proof                                      |
| Provider settings/key hydration                               | `lib/settings/apiKey.ts:107`, main.ts:369, preload.ts                   | A52-A55; stored-key retrieval must be removed; synthetic bridge reproduction RED                                                   |
| Display/model/usage settings                                  | SettingsModal, settings stores, `lib/usage`                             | A60 only display; provider selection A53; user-approved budget A56-A59; renderer estimates aren't authoritative spend              |
| Local research folder/source                                  | SettingsModal, card/evidence links                                      | A62 trusted local navigation; public source opening is explicit external navigation                                                |
| Google auth, cloud-deck cache, account/access gates           | AuthContext, NewDeckPage cloud branch, legacy SentinelRepository        | Explicitly unsupported in account-free local release until retired; not core onboarding or hidden prerequisite                     |

Feature paths without a prefix in the table are under `apps/web/src/features/`;
`data.ts` is `apps/web/src/hooks/data.ts`. Mapping is inspection evidence, not
complete adapter parity. Review all visible buttons/routes against this register
before G00 completion; do not assume a grouped row verifies every caller.

## Hidden/automatic provider entry points

- `apps/web/src/hooks/useAutoRefresh.ts`: 8-second boot delay, 15-minute checks,
  `refreshDeck` when market cadence is overdue; no explicit schedule grant.
- `apps/web/src/lib/agentic/useSentinel.ts`: 8-second startup/hourly checks;
  prior manually generated briefing is treated as continuing opt-in. Replace
  this with a durable, explicitly approved schedule, not a second timer.
- `apps/web/src/lib/living/useLivingDeck.ts`: stale/consistency targets call
  `verifyMetric`; renderer low-power estimates are not the shared budget fence.
- `apps/web/src/lib/share/preflight.ts`: preparing a share can call
  `verifyMetric`. Export preview must remain cached; offer a separate check.
- `packages/research/src/repository.ts`: follow-on dashboard warm-up and
  in-flight tab promises have no vault generation fence. Entire declared work
  scope must belong to one durable run; no detached success work.

## Reproduced release blockers

These remain ordinary failing tests. Do not skip, invert, delete or loosen them
to make `pnpm check` green. The earlier green gate predates these checks and
does not contradict the newly established failures.

| Required invariant                      | Synthetic reproduction                                              | Next phase |
| --------------------------------------- | ------------------------------------------------------------------- | ---------- |
| Cached navigation never pays            | research `overhaul-baseline.test.ts`, A04 case: one grounded call   | G02/G04    |
| Migration inspection is pure            | same suite: running job rewritten as failed                         | G01        |
| Future schema cannot be written         | same suite: repository persists schema 3 when supported schema is 2 | G01        |
| Old worker cannot overwrite replacement | same suite: deferred response resurrects old companies/cache        | G01/G02    |
| Reporting period survives storage       | same suite: metric schema strips period                             | G01/G03    |
| Cancellation acknowledgement waits      | same suite: still-pending provider, local status already cancelled  | G02        |
| Stored keys never return to renderer    | desktop `overhaul-security-baseline.test.ts`: getApiKey exposed     | G02        |
| Saved reports survive quota failure     | web `overhaul-storage-baseline.test.ts`: saved reports discarded    | G01        |

Remaining baseline work: cross-market identity and period-conflict fixtures,
transitive disclosure/adapter parity, representative synthetic screenshots and
remaining local/cloud route/button audit. No visual or production claim yet.
