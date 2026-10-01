# Stratemark v2 — journey, interaction and component coverage

Authority: [MASTER-PLAN.md](MASTER-PLAN.md), October 1, 2026. Planning inventory, not completed implementation. Inspected baseline: `2f45ed6`. Existing feature IDs F01–F66 refer to the historical journey inventory and are retained for traceability.

## Interaction contract

Every visible control must have a destination, defined result, persistence rule and failure/permission state. Pure navigation/search/filter never triggers paid research. Model assistance over local evidence can be billable even when web access is off. A saved run survives navigation; a view disappearing is not cancellation.

Notation: R = saved read/local compute, W = persisted user change, J = potentially billable job, P = explicit publication/disclosure. A-numbers reference existing schemas; X-numbers below identify required additions, not implemented APIs. At build time a new contract is justified by a consuming flow, not built speculatively.

## First session, shell and Library

| ID | Interaction | Result and data/action | Required failure/return behavior | Existing surface |
| --- | --- | --- | --- | --- |
| U01 | Launch/relaunch | Library with real recent decks, saved items, updates and resumable runs; R A01/A02/A27/A33 | No key still reads; crash recovery visible; sample distinct from personal data | AppShell, MarketsListPage; F01/F05/F06/F32 |
| U02 | Explore sample | Open isolated labeled sample; R | No provider calls, no mixing with user research; clear return | NewDeckPage, repository selection |
| U03 | New deck | Draft scope retained while navigating setup; W draft | Back/cancel retains draft or offers discard; no run starts yet | NewDeckPage; F08/F09 |
| U04 | Global/local search | Bounded instant results across entities, stories, briefs and conversations; R A01 | No results differs from unavailable storage; search does not send text externally | Sidebar/TopBar/library |
| U05 | Recent deck / back / deep link | Open exact item, preserve view context; R A03/A04/A23 | Deleted/missing item offers Library; legacy routes redirect; no /markets 404 | routes.tsx, Sidebar, card-return |
| U06 | Saved cards/collections | Save/remove entity or story; organize without copying dossier; W A13/X01 | Cross-deck context retained; unsave never deletes research; undo | SavedCardsPage; F26 |
| U07 | Rename/archive/trash/restore deck | Local change with impact preview, recoverable tombstone; W A09/A49/A50/X01 | Shared dossiers remain; stop affected schedules; permanent deletion explicit | MarketsListPage/MarketSettingsPage; F32 |
| U08 | Theme/sidebar/window navigation | Retained display settings; W A60 | Keyboard focus, zoom, narrow window and dark contrast work | ThemeToggle, Sidebar, TopBar; F07 |
| U09 | Activity indicator/notifications | Open actual runs and changes; R A27/A28/A33 | No fake agent presence; failed work remains discoverable after toast | TaskNotificationPanel, AgentPresence; F13/F31 |

## Setup and scope

| ID | Interaction | Result and data/action | Required failure/return behavior | Existing surface |
| --- | --- | --- | --- | --- |
| U10 | Choose research provider | Connection metadata, model and retrieval capabilities; W A52/A53 | Explain unsupported combination; return to preserved scope | SettingsModal; F02/F04/B01–B03 |
| U11 | Test / disconnect / change model | Bounded capability test or revocation; J A54 / W A55 | Bad key/rate limit/offline clearly separated; no silent paid fallback | SettingsModal; F03/F12 |
| U12 | Continue with ChatGPT | Official connection and inference permission; W/J X06 | Denied/expired/ineligible/limited states; BYOK remains; no token in renderer | New connection section |
| U13 | Market/question/region | Scope draft; R A06 then W A08 | Ambiguous query gets editable scope; empty input prevented | NewDeckPage; F08–F10 |
| U14 | Add seeds / resolve identity | Must-include names/domains with match decisions; R A10, W scope | Every seed included, ambiguous or excluded with reason; no silent drop | Scope form, entity resolver |
| U15 | Choose categories/depth/exclusions | Seven categories, Quick/Standard/Deep and scope boundaries; R A06 | Category availability explicit; no guarantee of filling all types | Scope review |
| U16 | Dictation | Text inserted into draft only | Hide if unsupported; permission denied leaves keyboard input; never auto-submit | MicButton; F11 |
| U17 | Review cost/limits/start | Confirm selected routes and scope; W A57 then J A14 | Unknown dollar pricing explained; sufficient valid allowances required; duplicate click one run | ResearchControls, NewDeckPage |
| U18 | Edit scope after research | New scope revision and impact summary; W A09 | Earlier research retained and marked against prior scope; new work separately approved | MarketSettingsPage |

## Running research and deck browsing

| ID | Interaction | Result and data/action | Required failure/return behavior | Existing surface |
| --- | --- | --- | --- | --- |
| U19 | Watch/run in background | Persisted events + progressive supported cards; R A27/A28 | Navigate away/back safely; loading shell cannot be mistaken for completed card | ResearchStage, AgentActivityFeed, research-session; F13–F16 |
| U20 | Pause/resume/cancel/retry | Control actual service job; W/J A29–A32 | No new dispatch after pause request; terminal state after quiescence/fence; retry failed subset only | ResearchControls/activity |
| U21 | Filter seven card types/search/sort | Local deck projection; R A03 + view state | Zero results, incomplete category and unsupported result distinct; saved view survives reader | DeckPage, CardGrid; F21/F22 |
| U22 | Open entity card | Quick reader with purpose, facts, relevance, evidence and Explore | Separate save/share targets; preserve scroll/focus; Escape returns | GameCard, CollectibleCard, CardReader; F17–F25 |
| U23 | Open Vice/Barrier/Insight/Community | Shared story route/reader with correct type variant; R X02 | Never navigates to generic company metrics; sparse/unreviewed story honest | InsightReader, CardReader, new story route |
| U24 | Previous/next reader card | Navigate filtered visible order | Disabled bounds or clear wrap rule; same keyboard semantics; no background research | CardReader; F24 |
| U25 | Inspect metric/source badge | Exact evidence/definition/period/conflicts; R A05 | Missing retrieval distinguished from support; offline retained excerpt readable | card-view, metrics, ConfidenceBadge |
| U26 | Save/share card | W A13 / P X04; independent targets | No accidental card-open; persist success/undo; share preview retains selected item | card controls; F26/F56 |
| U27 | Compare selection | Cached comparison of compatible entities; R A20 | Story cards not selectable; incompatible units/periods flagged; selection survives browse | DeckPage, new comparison view; F27 |
| U28 | Expand category / fill gaps / refresh | Explicit scoped job; J A15/A16/A17 | Existing cards stay visible; dedupe entities; preserve deliberate card type | DeckPage, useHuntRunner; F28/F29 |
| U29 | Market landscape/opportunities | Evidence-linked structure and clearly labeled hypotheses | No invented TAM/share chart; click leads to underlying cards/sources | OpportunityPage; F30 |

## Entity workspaces, stories and evidence

| ID | Interaction | Result and data/action | Required failure/return behavior | Existing surface |
| --- | --- | --- | --- | --- |
| U30 | Explore entity/direct link | Role-specific workspace using canonical dossier; R A04 | Missing entity recovers to deck; context/role explicit; cached open free | DashboardPage, DashboardResearchState |
| U31 | Overview and relevant facts | Purpose, market fit, evidence, gaps and next actions; R | No filler; sparse company still useful | OverviewTab; F33 |
| U32 | Offering modules | Products/pricing/customers or capabilities/channels; R | Announced versus shipped; provider fact versus analysis separated | ProductsRoadmapTab; F36 |
| U33 | Metrics/chart/history | Comparable facts with dates/units, evidence and conflicts; R | No zero-fill, incompatible trend, unsupported market share or estimates promoted to facts | MetricsTab, metricViz; F34 |
| U34 | People/history/governance | Supported secondary dossier modules with direct links; R | No fabricated org hierarchy; old content retained; meaningful empty states | TeamOrgTab, LeaderGrid, HistoryTab, MissionGovernanceTab; F37–F39 |
| U35 | Infrastructure/distribution modules | Dependencies/access/capacity or audience/channel terms; R X03 | Non-company entities supported; shared facts remain canonical | Reused workspace frame, role modules |
| U36 | Updates | Date-scoped actual changes, old/new evidence and last check; R A33 | Sample and stale states explicit; no-change ≠ not checked | LiveIntelTab, LiveBadge; F35 |
| U37 | Website / audit | Safe original-site navigation or explicit bounded audit; R A62 / J X03 | Blocked embedding opens external browser; audit retained as attributed brief | LiveLandingTab, SiteAuditView; F40/F41 |
| U38 | Research section/missing facts | J A16, exact sections/depth and allowance | No implicit run on tab open; partial results kept; failed task retryable | ContextRerun, DashboardResearchState; F42/F46 |
| U39 | Read story | Structured narrative, evidence, entities, date and limitations; R X02 | Vice response/resolution; Insight counterevidence; Community genuine public signals | Shared story workspace |
| U40 | Related entity/story | Open correct scoped destination | Back returns to same story position; prevent circular navigation traps | Related cards/links |
| U41 | Inspect/check evidence | R A05 / explicit J A24 | Link alone never implies semantic verification; original and retained versions identified | FactCheck, evidence drawer; F44/F45 |
| U42 | Correct/confirm fact or resolve identity | W A25/A26/A11 with reason/support | Preserve prior values, revisions and scope; only direct human confirmation marks user_verified | Metric correction/identity review; F47 |

## Questions, comparison and outputs

| ID | Interaction | Result and data/action | Required failure/return behavior | Existing surface |
| --- | --- | --- | --- | --- |
| U43 | Ask about deck/entity/story/selection | Scoped persisted conversation; J A18 | Saved evidence is default; show model cost; missing support leads to gap, not invention | DeepDive, chat-starters; F43/F48 |
| U44 | Switch to web research | Explicit broadened egress/scope and budget; J A19 | User approves before new search; source text cannot authorize action | DeepDive |
| U45 | Attach prior brief/thread | Approved references/revisions in question; W X01/J A18 | Stale/deleted/private attachment state explicit; no hidden entire-vault context | DeepDive; F49/F50 |
| U46 | Dock/overlay/history | Same thread/context across presentation; R/W X01 | Focus restored; scrolling/stream interruption handled; no duplicate request | DeepDive/AppShell; F49/F51 |
| U47 | Compare facts / request explanation | R A20, optional J A21 | Two-to-five entities initially; user criteria; no pseudo-objective winner | Comparison view |
| U48 | Create/save brief from research/chat | J A22 with pinned input/evidence revisions | Preview focus; partial unsupported sections visible; regenerate creates revision | Reports/DeepDive; F52/F53 |
| U49 | Browse/open reports | Cached version with input/source navigation; R A23 | Reading never regenerates; missing source remains a visible gap | ReportsListPage, ReportViewerPage; F54 |
| U50 | Download/print/export | Reviewed Markdown/PDF/portable snapshot; W A42/A43 | Correct citations/titles/units; Unicode/long content; failure preserves report | ReportViewerPage, pptx; F55 |

## Sharing, recipient and import

| ID | Interaction | Result and data/action | Required failure/return behavior | Existing surface |
| --- | --- | --- | --- | --- |
| U51 | Share deck/card/brief | Exact included items/depth, privacy and version preview; R/P X04 | Credentials/private fields excluded; unsupported format disabled with reason | ShareDialog; F56 |
| U52 | Publish/copy/native share | Short hosted snapshot link and optional image; P X04 | Upload progress/retry; duplicate publish deduped; no clipboard-success lie | ShareDialog/codec |
| U53 | Open guest link | Anonymous responsive deck/story/entity snapshot | No account/key wall; no sender billing; included depth only; clear snapshot date | SharePage; F57 |
| U54 | Follow guest evidence/deep links | Read included content or original public source | Missing shared section says omitted; preserve recipient back navigation | Shared reader/router |
| U55 | Save a copy/continue | Validated attributed import, then user's own research; W A44/A45 | App absent gives installation + portable fallback; no loss of share context | SharePage, desktop deep-link handler |
| U56 | Manage version/revoke/delete/report abuse | Authenticated share management; P X04 | Cache purge deadline; offline copies caveat; ownership recovery; abuse response | Publication settings/guest report |
| U57 | Import/export local data | Preview counts/conflicts/rights, explicit apply and receipt; R/W A42–A45 | Oversize/corruption/newer schema/duplicate IDs fail safely; no imported authority | SettingsModal; F63/F64 |

## Monitoring, storage and external connections

| ID | Interaction | Result and data/action | Required failure/return behavior | Existing surface |
| --- | --- | --- | --- | --- |
| U58 | Check updates / create briefing | Bounded check A34, optional brief A22 | Date-window shown; no-change real; archived brief stays immutable | BriefingPage/Report; F58/F59 |
| U59 | Follow/schedule/edit/disable | Persist cadence/focus/limits A35–A38 | Off by default; local availability clear; disable stops future work; no backlog storm | MarketSettingsPage/settings; F60/F61 |
| U60 | Review budget/usage | Limits, reservations, actual/unknown spend A56–A59 | No false zero or strict cap without pricing; reduce/stop acts across clients | Settings/activity; F66 |
| U61 | Storage location/readiness/backup/restore | A46–A48/A61; consistent database+assets | Show authoritative mode; backup first; no late writes; rollback; plaintext disclosure | Storage settings; F62/F65 |
| U62 | Trash/purge/full data removal | A49–A51; impact preview and explicit choice | Shared dossier ownership and backup copies handled; no forensic-erasure promise | Library/storage |
| U63 | Connect local assistant | Per-host target/action/expiry grant A39 | Accurate install instructions, transport checks, least privilege; host not found actionable | New Connections screen |
| U64 | Assistant reads/researches | Same actions/results as desktop | No cross-market linked-data leak, duplicate job, forged human approval or key access | New MCP adapter |
| U65 | Revoke/audit/remote offline | A40/A41; disclosure history and connection state | Immediate denial for later access/dispatch; offline cannot claim success | Connections/optional bridge |
| U66 | Help/about/update/diagnostics | Version, docs, redacted export, signed update flow | Failed update rollback; no research/keys in diagnostic bundle; support path | Desktop menu/settings/new help |

## Common state acceptance

Every relevant U-row must be reviewed across the following states, with N/A justified rather than silently omitted:

| State | User must see / be able to do |
| --- | --- |
| First run/no key | Read samples/imports, understand connection choice, keep scope draft. |
| Loading/running | Actual stage, retained content, useful partial output, navigation and applicable controls. |
| Empty/sparse | Distinguish no evidence from not researched/not applicable; offer targeted next step. |
| Offline/failed | Cached content available; exact affected operation and bounded retry. |
| Budget/provider limit | Preserved results and allowance state; reconnect/top-up/resume only with valid authority. |
| Cancel/restart | Durable status, no duplicated completed work or stale writes, uncertain provider charge explicit. |
| Changed/revoked | Updated scope/grants honored; old revision preserved; denied data not leaked. |
| Narrow/touch/keyboard | Same essential actions, readable type, visible focus, no hover-only or trapped modal. |
| Untrusted content | Safe markdown/URLs/assets, source instructions cannot change permissions or launch actions. |

## Component disposition and implementation map

Paths below are relative to `apps/web/src` unless specified. This is an observed component inventory plus planned destinations; no new components listed here are claimed to exist.

| Existing group | Disposition |
| --- | --- |
| components/layout: AppShell, Sidebar, TopBar, TaskNotificationPanel | Keep shell; reorganize Library/Decks/Saved/Activity/Connections; notifications backed by real runs. |
| features/deck: NewDeckPage, DeckPage, CardGrid, ResearchStage, AgentActivityFeed, research-session | Rework scope and seven-type deck; connect service-owned progress; remove renderer authority when replacing it. |
| features/card: CollectibleCard, GameCard, CardReader, Logo, card-view, metrics | Reuse shell/logo infrastructure; compose entity/story variants and traceable facts. Keep card opening simple. |
| CardStage, TierBadge, CmsBreakdown, ConfidenceBadge, CardDisclaimer, ViceClaims, MarketCardArt | Remove public rank/tier UI; retain meaningful evidence details in drawer; replace generic art/filler; explicit vice support. |
| components/reader/InsightReader | Expand into shared story workspace; migrate four finding types, avoid four duplicate dashboards. |
| features/dashboard and all tabs | Shared role-aware workspace, relocations U30–U38; preserve valuable secondary research and deep links. |
| features/deepdive, factcheck, research | Scope-aware conversations, support checks, real run controls; unify semantics with MCP. |
| markets, saved, reports, briefing, OpportunityPage | Unified library/search/collection entry; preserve reports, briefings, market analysis as distinct outputs. |
| features/share, lib/share | Reuse bounded snapshot validation; add publication manifest/guest routes/import, not secret-bearing URL payloads. |
| SettingsModal, SettingsLink, lib/settings | Progressive sections: Providers, Usage, Storage, Monitoring, Connections, Appearance, Help. |
| components/states and ui primitives | Consolidate buttons/forms/dialogs/loading/errors/tooltips/toasts; keyboard/focus/reduced-motion pass. |
| components/media EditorialCover/PageShot | Retain useful brand/editorial media; safe assets, rights/alt text, offline fallback. |
| lib/repository, hooks/data, lib/agentic, lib/living | Thin query/command adapters; replace hunt/living dispatch with durable service; remove superseded paths only after parity. |
| routes.tsx, App.tsx, main.tsx | Stable entity/story/run/share routes, legacy redirects, protocol deep links and missing-record recovery. |
| lib/auth and older cloud/engine paths | Preserve publication-owner auth where needed; core desktop has no account/paywall. Quarantine obsolete cloud routes after caller review. |
| apps/desktop/src main/preload/storage/vault modules | Trusted host, native authoritative writes, secret protection, migration and updater integration. |
| packages/research/src repository/pipeline/company/signal/adk/adapters | Reuse engines; extract consumed application service/jobs/evidence projection incrementally. |
| packages/contracts/src | Versioned consumed actions/read models, seven-card discriminated views and migration compatibility. |
| apps/api | Evaluate reusable auth/share/storage modules for publication only; do not make old hosted research a requirement. |

## Action changes required by v2

Keep A01–A62 stable where semantics fit; do not rename wire fields merely for display terminology. Replace tier-focused discovery with role/category/goal focus using an explicit compatible version adapter. Extend finding inputs to distinguish Community and preserve historical Culture. Canonical entity reads must cover resource/channel entities without fake company data. Bind run events and returned output revisions consistently across transports.

| Planning ID | Needed contract family | Main interactions |
| --- | --- | --- |
| X01 | Local drafts, deck/card presentation, collections, annotations, conversation list/read/context | U03/U06/U07/U45/U46 |
| X02 | Finding get/list/structured story revision and related references | U23/U39/U40 |
| X03 | Typed non-company entity/workspace projection and optional website audit | U35/U37 |
| X04 | Share preview/publish/status/version/list/revoke, guest fetch, abuse report, attributed copy/import | U51–U56 |
| X05 | Host connection health, installation/bridge enrollment and authenticated attach | U63–U65 |
| X06 | Official ChatGPT connection/session/capability/usage/disconnect | U12 |

Each consumed action documents input/output, allowed actor/scope, persistence, billing, idempotency, revision conflict, cancellation, error and UI recovery. Pure presentation does not need a server action. External publication/credential/delete/human verification remains direct-user controlled.

## Historical feature reconciliation

### Proposed route contract

These are target app routes, not existing implemented paths. Desktop may retain HashRouter; public publication routes must resolve when opened directly from a browser/message preview.

| Destination | Canonical route and compatibility |
| --- | --- |
| Library | `/library`; `/history` and `/markets` redirect here. First-run root can offer the new-deck entry without hiding Library. |
| New deck | `/new`; scope draft has a persisted draft reference. |
| Deck | `/markets/:marketId/deck`; query parameters retain type, search, sort and selected card. |
| Entity | `/entities/:entityId/:section`; market/role context optional; legacy `/company/:companyId/dashboard/:tab` maps to an explicit section/subsection. |
| Story | `/markets/:marketId/findings/:findingId`; optional revision identifies an earlier saved story. |
| Comparison | `/compare` with local selected entity IDs/revisions; never embed private report bodies in URL. |
| Activity | `/activity` and `/activity/:runId`; progress can also be viewed from the deck. |
| Saved | `/saved`; optional collection reference. |
| Briefs | `/reports` and `/reports/:reportId`; older names remain navigable. |
| Market analysis/briefing | Existing opportunity/briefing routes preserved or redirected to named deck output views without losing IDs. |
| Settings | `/settings/:section?`; modal entry supported, direct route reproducible. |
| Connections | `/connections`; installation/grant/audit views reachable directly. |
| Hosted snapshot | `/s/:shareId` with optional immutable version and item reference; legacy `/share/:blob` remains bounded read-only compatibility or offers an explicit migration path. |

Internal navigation can update views without a service command. Desktop protocol links resolve validated IDs to these destinations and never execute arbitrary paths. Route failure uses a missing/deleted/permission state with a safe Library return; do not create a generic 404 for known historical destinations.

### Required build-time coverage evidence

Add a compact interaction acceptance record per milestone: U-ID, actual control/route, service action, authoritative persistence, nominal result, failure result, evidence artifact and status. This is populated from real behavior during the build, not prefilled as passed from the plan. Newly discovered controls join the register or are removed deliberately. Compatibility redirects are included in the same record.

F01–F16 -> U01–U20; F17–F32 -> U21–U29 plus U06/U07; F33–F47 -> U30–U42; F48–F55 -> U43–U50; F56–F57 -> U51–U56; F58–F66 -> U57–U62. Individual rows above preserve narrower mappings. F55 PowerPoint export is retained for compatibility if correct; it is secondary to share links/PDF/Markdown and must be labeled unavailable if excluded from an artifact, not silently break. F11 voice remains capability-dependent. F40 embeds are optional with external-open fallback.

The historical inventory is code-backed but not exhaustive runtime proof. Before completing each milestone, inventory its actual links/buttons/menu items against these rows. Any newly discovered interaction gets a row or is deliberately removed with a recorded reason. No 'everything covered' claim based solely on this document.
