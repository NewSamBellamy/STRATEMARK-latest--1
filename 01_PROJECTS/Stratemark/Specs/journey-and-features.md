# Stratemark: journey and feature review

This is a code-backed inventory of the exploration branch as of September 30, 2026. It describes intended behavior present in the code; it is not a new end-to-end test or a claim that every feature is production ready. The target product is the free, open-source desktop app using the user's own provider keys. Browser previews and older cloud/account paths differ.

## The current user journey

| ID | Simple sentence | Current limitation or decision to review |
| --- | --- | --- |
| J01 | You open Stratemark and see the place to start a new market research deck. | The community desktop build does not require an account. |
| J02 | You add and test your Gemini key in Settings. | Other provider adapters exist, but their setup is not available here yet. |
| J03 | You describe the market you want to understand and optionally pick a region. | There is no dedicated goal, seed-company, exclusion, budget, or scope approval form yet. |
| J04 | You start research and watch the app discover companies and gather information. | The progress view offers a live log and a brief built from received events. |
| J05 | You can browse other parts of the app while the research session continues. | Navigation continuity is different from guaranteed recovery after closing the app. |
| J06 | You open the resulting deck and scan its company cards. | Cards are currently ordered by available size signals, not by which company is best for your goal. |
| J07 | You switch between companies, infrastructure, distribution, insights, and barriers. | Culture and vice categories are hidden from the current deck interface. |
| J08 | You click a card to read a short summary, useful facts, and source links. | There is no flip-card action. |
| J09 | You choose Explore research to open the company's deeper workspace. | The company workspace currently has eight sections, with five under More. |
| J10 | You inspect evidence, ask follow-up questions, or research a missing fact. | Sources can support attribution without independently proving every claim. |
| J11 | You select companies to ask comparative questions or hunt for more companies. | Comparison currently opens research chat rather than a dedicated comparison table. |
| J12 | You save interesting cards and return to past decks, conversations, and reports. | These are separate libraries; there is no single searchable vault experience yet. |
| J13 | You make a report, share a research snapshot, or export your findings. | Sharing is a snapshot, and recipient access depends on a usable app origin. |
| J14 | You refresh a deck or generate a briefing about recent changes. | Local scheduled checks run while the app is open. Desktop spending caps are not enforced yet. |
| J15 | You come back later and continue building your research collection. | A coherent return experience showing changes, unresolved questions, and next actions still needs design. |

## Features with a current interface

Some actions are shown only when the selected backend exposes the capability. These are marked conditional. The individual descriptions below are deliberately short so each feature can receive a separate comment.

### Setup and navigation

- **F01 — Account-free desktop:** You can use the community desktop app without signing into Stratemark.
- **F02 — Gemini key:** You can save or remove your own Gemini API key.
- **F03 — Connection test:** You can test whether your Gemini key and selected model respond.
- **F04 — Model override:** You can enter a Gemini model name manually.
- **F05 — Main navigation:** You can move between New Deck, past decks, Saved Cards, Reports, and Settings.
- **F06 — Recent decks:** You can reopen recent markets from the sidebar.
- **F07 — Responsive layout:** The interface adapts to smaller windows and provides a collapsible navigation area.

### Starting and following research

- **F08 — Market prompt:** You can describe a market in ordinary language.
- **F09 — Prompt suggestions:** You can choose an example market to help get started.
- **F10 — Region:** You can narrow research to a selected geography.
- **F11 — Voice input:** You can dictate a prompt when the browser or desktop runtime supports speech input.
- **F12 — Missing-key guidance:** The app asks for a key instead of pretending to research your prompt.
- **F13 — Live research log:** You can follow research steps, discoveries, and warnings as they arrive.
- **F14 — Waiting brief:** You can view a short market brief built from actual research events while waiting.
- **F15 — Session continuity:** A running research session survives navigation between screens.
- **F16 — Research status:** The deck has states for active work, partial results, failure, readiness, and stale results; the clarity of those states still needs review.

### Decks and cards

- **F17 — Company cards:** You can scan a company's identity, purpose, selected facts, and research freshness.
- **F18 — Company artwork:** Cards use logos or fallback identity artwork, with sourced brand colors when available.
- **F19 — Glanceable facts:** Cards choose a small set of facts and distinguish sourced, estimated, and unknown values.
- **F20 — Source coverage:** Cards show whether supporting sources are available.
- **F21 — Card categories:** You can browse companies, infrastructure providers, distribution channels, insights, and barriers.
- **F22 — Size grouping:** You can group companies into eight bands based on available size evidence.
- **F23 — Card reader:** Clicking a card opens its summary, facts, evidence notes, and links.
- **F24 — Card navigation:** You can move to the previous or next card inside the reader.
- **F25 — Deeper research:** You can move from a company card into its research workspace and return to the deck context.
- **F26 — Saved cards:** You can bookmark cards into a collection spanning markets; repeat company cards are collapsed there.
- **F27 — Selected-company comparison:** You can select multiple company cards and ask about them together.
- **F28 — Expand research:** You can ask the app to hunt for more entities or fill an empty category or size band.
- **F29 — Refresh deck:** You can rerun market research and keep seeing existing results during a refresh.
- **F30 — Market landscape:** You can view reported market evidence and an opportunity hypothesis; charts depend on available sourced figures.
- **F31 — Agent activity:** You can see verification activity and pause or start the supported living-deck process for the open deck.
- **F32 — Deck library:** You can reopen past decks or delete a deck through the history view.

### Company research workspace

- **F33 — Overview:** You can read a concise view of the company and its available research.
- **F34 — Metrics:** You can inspect financial and scale figures, their dates, their meaning, and their evidence.
- **F35 — Live Intel:** You can read researched news and developments with links and reported dates.
- **F36 — Products and Roadmap:** You can explore products and sourced information about announced future work.
- **F37 — Team and Org Chart:** You can inspect researched leaders, biographies, and available organization information.
- **F38 — History:** You can explore the company's story, milestones, and notable quotes.
- **F39 — Mission and Governance:** You can inspect mission, board information, and sourced positive or negative findings.
- **F40 — Landing page:** You can preview the company's website, open it directly, or try a supported embed.
- **F41 — Website audit:** You can request a messaging and website teardown saved as a report; this depends on backend support.
- **F42 — Section refresh:** You can rerun research for a particular company section.
- **F43 — Follow-up research:** You can ask a question from inside the company's context.
- **F44 — Fact check:** You can ask for a claim check and receive a sourced verdict; this is an AI research check.
- **F45 — Metric verification:** You can research a figure again and write back a supported result when the backend offers this action.
- **F46 — Missing-metric hunt:** You can request a research pass for missing or weak company figures when supported.
- **F47 — Human correction:** You can enter your own correction and source note for a metric.

### Conversations and outputs

- **F48 — Research chat:** You can ask grounded follow-up questions about a deck, company, card, or selection when supported.
- **F49 — Conversation history:** You can reopen saved research threads connected to a company or deck when supported.
- **F50 — Attached context:** You can attach earlier reports or conversations to supported research chat.
- **F51 — Chat placement:** You can dock the research panel or use it as an overlay.
- **F52 — Report creation:** You can generate a market or company report with an optional focus.
- **F53 — Conversation report:** You can turn a supported research conversation into a saved report.
- **F54 — Report library:** You can reopen saved reports and their citations.
- **F55 — Report downloads:** You can download Markdown, print or save a PDF, and export eligible deck reports as PowerPoint.
- **F56 — Snapshot sharing:** You can share cards, decks, briefings, and eligible reports as read-only research snapshots.
- **F57 — Recipient view:** A recipient can read a shared snapshot without gaining access to your keys or live research controls.

### Updates, storage, and settings

- **F58 — Briefings:** You can request a sourced market update for the last 24 hours, 48 hours, or seven days when supported.
- **F59 — Briefing archive:** You can reopen earlier market briefings and share or print them.
- **F60 — Refresh schedule:** You can choose daily, twice-daily, or weekly local refresh checks.
- **F61 — Local update checks:** The app checks due refreshes while open; supported automatic briefings require an earlier manual briefing.
- **F62 — Local research storage:** The desktop saves research on disk with atomic writes and a last-good backup.
- **F63 — Workspace export:** You can export your research workspace without exporting provider keys.
- **F64 — Workspace import:** You can replace the workspace with a valid export after a confirmation and backup.
- **F65 — Recovery information:** Settings shows storage and backup information; browser and desktop recovery controls differ.
- **F66 — Usage explanation:** Desktop Settings warns that its provider usage is not yet fully metered and a hard spending cap is unavailable.

## Foundations that are not complete user features

- **B01 — Provider composition:** Research code can combine an intelligence model with a separate search connector, but the normal desktop configuration still uses Gemini.
- **B02 — Other model endpoints:** An OpenAI-compatible adapter exists for configurable endpoints, but there is no finished OpenRouter or local-model setup journey.
- **B03 — Search adapters:** Firecrawl, Perplexity Search, and Serper adapters exist with fixture tests, but their settings, real-key benchmarks, and ordinary desktop integration remain unfinished.
- **B04 — Research recovery:** Stored jobs and cancel/resume methods exist, but a complete visible job-management journey and restart-recovery verification remain unfinished.
- **B05 — Evidence safeguards:** The code rejects or downgrades unsupported figures, separates footprint definitions, and restricts external synthesis to known sources; full page-by-page claim verification remains unfinished.
- **B06 — Research agents:** Discovery, company enrichment, signals, delta research, and coordination code exist, but agent traces do not establish research quality by themselves.

## Requested directions that still need a complete feature design

- **P01 — Review the scope:** Confirm the goal, geography, exclusions, and expected work before a research run spends money.
- **P02 — Include known companies:** Give the app seed companies and require their inclusion while it researches the rest of the market.
- **P03 — Broad BYOK setup:** Choose compatible model and search providers through one clear setup flow.
- **P04 — Stronger evidence:** Read full source pages, tie important claims to passages, and preserve disagreements between sources.
- **P05 — Useful ranking:** Compare companies against the user's goal using visible criteria rather than presenting size as quality.
- **P06 — Unified vault:** Search and organize companies, findings, conversations, and reports in one durable research collection.
- **P07 — Continuous intelligence:** Set bounded monitoring that clearly shows what changed, what failed, when checks ran, and what they cost.
- **P08 — Real budget controls:** Meter and limit work centrally across research, retries, refreshes, and providers.
- **P09 — MCP access:** Let approved external assistants search the vault and request bounded research through permissioned tools.
- **P10 — Research evaluation:** Test company coverage, claim support, freshness, and cost across different markets and providers.
- **P11 — Release quality:** Provide a reliable install, restart, upgrade, data recovery, and first-run experience for the desktop release.

## Older or retired paths to review

- **L01 — Account and cloud features:** Older web paths include sign-in, subscription messaging, preview access, and a Sentinel Cloud engine; these are not required by the community desktop product.
- **L02 — Culture and vice cards:** These categories remain in stored data and backend types but are hidden from current deck browsing.
- **L03 — Card back:** Card flipping is excluded from the current product direction.

## Evidence used for this inventory

| Area | Code inspected |
| --- | --- |
| Entry points and navigation | `apps/web/src/routes.tsx`, `components/layout/Sidebar.tsx`, `features/deck/NewDeckPage.tsx` |
| Cards and deck actions | `features/deck/DeckPage.tsx`, `features/card/CollectibleCard.tsx`, `features/card/CardReader.tsx`, `features/saved/SavedCardsPage.tsx` |
| Company sections | `features/dashboard/DashboardPage.tsx`, `features/dashboard/tabs/`, `packages/contracts/src/enums.ts` |
| Questions and verification | `features/deepdive/DeepDive.tsx`, `features/factcheck/FactCheck.tsx`, `features/research/ResearchControls.tsx` |
| Reports and sharing | `features/reports/`, `features/share/`, `features/briefing/`, `features/deck/OpportunityPage.tsx` |
| Scheduling | `hooks/useAutoRefresh.ts`, `lib/agentic/useSentinel.ts`, `lib/living/useLivingDeck.ts` |
| Runtime and configuration | `features/settings/SettingsModal.tsx`, `lib/settings/runtime.ts`, `lib/auth/RequireAuth.desktop.tsx`, `apps/desktop/src/main.ts` |
| Storage and jobs | `apps/desktop/src/storage.ts`, `packages/research/src/repository.ts`, `packages/contracts/src/repository.ts` |
| New provider foundations | `packages/research/src/research-client.ts`, `openai-compatible.ts`, `provider-connectors.ts`, `docs/OPEN-RESEARCH-ROADMAP.md` |

Frontend paths in this table are relative to `apps/web/src/` unless another root is shown. Provider descriptions are implementation inventory, not an assertion of live provider availability.
