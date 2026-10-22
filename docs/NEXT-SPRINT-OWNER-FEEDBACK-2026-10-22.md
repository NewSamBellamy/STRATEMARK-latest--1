# Owner feedback, 2026-10-22: triage, findings and plan

Source: Shannon's first hands-on pass after the Z Code handover. Each item below has its status, what the code shows, and the proposed next step. Nothing here is pushed to `main`.

## Done in this session (local commits on `beta/night-tip`)

| Item | Result |
|---|---|
| Overview: summary and landing page first | `OverviewTab.tsx` now renders the Summary (with the company-site capture beside it) above Key figures. A test pins the order. |
| Card outline from primary and secondary brand colours | The frame used to come only from pixels read out of the logo. A logo that blocks pixel reads, or a palette that never resolves, left the card with no gradient even though research had stored the company's brand primary and secondary. The frame now uses the logo colours when it has them, else the researched brand theme (primary to secondary), and a single logo colour takes the researched secondary as its second tone. Neutral border remains only when there is no brand evidence at all. `.card-grid` is untouched. Needs a look in the running app on a few real decks (Together AI is the known pixel-blocked logo). |

## Also done (second pass, same day, all local commits on `beta/night-tip`)

| Item | Result |
|---|---|
| Chat speed | Most questions now answer on a fast model (`gemini-flash-latest`, label `chat:quick`). Long, analytical, comparing or forced-deep questions keep the stronger `gemini-3.1-pro-preview` (`chatTier` in `chat-route.ts`). The answer streams into the panel as it is written when the transport allows it (a key used straight against Google). The hosted Worker and the dev bridge do not stream yet: they still return the whole answer, but on the faster model. |
| Drop in your research | New "Drop in your research" panel above "Open full company dashboard" in the card reader: file (PDF, markdown, text, HTML), pasted text, or a https link. The text is kept as the user's own evidence (searchable by chat and Research & Sources) and read once into a digest. Every finding and figure must carry a quote that appears word for word in the document, and a figure's quote must state its value, or it is dropped. Figures are proposals: "Apply to card" calls the existing human override, so only a person makes a figure user-verified, with the quote as its source. The Overview shows a "From your research" section with the digest, labelled as provided by the user. Capability: `addResearchDocument` (contracts, `GeminiRepository`). Not yet on the desktop IPC path or the cloud Sentinel path; the panel hides itself there. |
| Signal card hero images | Vice, barrier, culture and insight cards now wear the picture their own best source published (og:image, through the existing hosted image proxy), credited to the publisher, with the default art as the fallback. Company-specific cards never take a picture that names another company. Nothing is generated. No contract change. |
| Products & Roadmap | A "Lineup at a glance" strip (counts only from retained research), the official product page's own picture on product cards (hidden when the page publishes none), and a "Research products and roadmap now" button in the empty state (runs only when clicked). |

## Still open

- **Thin tabs and empty dashboards.** This is the research pipeline's depth and speed, not a screen problem. It needs live runs on the owner's key to tune and was not changed blind. The drop-in intake and a future Deep Research "Deep dive" are the depth levers.
- **Deep Research.** Plan is in this document; one comparison run (about $1 to $3) is the next step before building it.
- **Chat streaming through the hosted Worker.** The Worker's budget accounting reads the JSON usage block of a normal response; streaming needs a `streamGenerateContent` route that settles the budget from the final SSE chunk. Owner deploys the Worker, so this is queued, not done.
- **Drop-in on desktop (IPC) and cloud engines.**
- **Video drop-in.** Transcript only; the panel says so plainly.
- **Card back.** Owner is working on it in Codex.

## Not touched on purpose

- **Card back design.** Shannon is working on it in Codex.

## Findings and proposals

### 1. Chat is slow (what the code does)
- `askResearch` (`packages/research/src/repository.ts`, around line 6857) does several awaited steps before any model call: persist, saved-original-source reads for up to 8 companies, corpus search, deck digest.
- Unless at least two stored passages match (`MIN_MEMORY_PASSAGES`) or the question is a greeting, the answer is a fresh grounded search call.
- Chat turns run on `DEFAULT_CHAT_MODEL`, which is `gemini-3.1-pro-preview`, a slow reasoning model, and the reply is not streamed. The client already supports streaming (`onText` on `ground`, `streaming` in `gemini.ts`), but nothing above the client passes it, so the user stares at a spinner for the whole answer.
- Proposal, in order of value: (a) stream the answer to the UI (contract, IPC and `ThreadView` changes; the client side exists); (b) answer from memory first on a fast model and only escalate to the pro model for "deep" questions; (c) start the corpus search and original reads in parallel with the persist. Quality trade for (b) is the owner's call.

### 2. Signal cards (vice, barrier, culture, insight) need a hero image
- Today these cards show one generic default illustration per card type (`DEFAULT_CARD_ART` in `MarketCardArt.tsx`). The card schema has no image field. Only news stories carry an `imageUrl`.
- Proposal: add an optional `heroImageUrl` (plus `heroImageSource`, `heroImageKind: 'screenshot' | 'photo' | 'og'`) to the card contract. Fill it by (1) the og:image of the strongest cited source, (2) a screenshot of the source page when the og image is missing or generic. Never AI-generated for sourced claims. Falls back to the current art. Contract change, so it needs the shared-contracts note in the PR.
- Rule 9 stays: a vice card still needs a clickable source to exist, and the hero never implies more than the source says.

### 3. Tabs are too thin, dashboards are empty
- Tab content comes from one grounded call per tab with a short structured result. "Thin" is partly the prompt budget and partly the pipeline running out of time or quota before the tab warms (the prefetch queue is paced at one action per tick).
- Proposal: give each tab a research budget and a minimum depth (sections, sourced paragraphs, citation count) and have the dashboard show a "still researching" state instead of an empty one. The Deep Research option below is the biggest lever for depth.

### 4. Products and roadmap
- `ProductsRoadmapTab.tsx` renders a table or cards from a structured product list. When research finds no official product page it shows an empty note.
- Proposal: a rethink needs Shannon's direction on what it should feel like (product catalogue with pricing and status, launch timeline, competitor mapping). Suggest a design pass with two mock layouts before code.

### 5. Drop-in research (new feature)
Shannon's idea: above "Open company dashboard", let the user drop in research done elsewhere (PDF, markdown, pasted text, a URL, a video) and have the agent absorb it and update the dashboards.

What already exists to build on:
- `addResearchNote` stores a user note as first-class evidence with an optional source URL. The Research & Sources tab and the chat corpus search already read it.
- `askResearch` accepts attached reports and threads as pinned context.

What is missing:
- File intake: PDF and markdown to text on the client (or desktop main process), size and type limits, a clear review step ("here is what I read").
- URL intake: fetch and read through the existing retrieval and original-source path.
- Video intake: transcript only (YouTube captions), no video upload in v1.
- A synthesis step: after intake, re-run the affected dashboard tabs with the new evidence as top-priority context and show a diff ("updated Overview, Metrics").
- Trust rules: dropped material is labelled **User-provided**, never `verified`; figures taken from it are `estimated` with the file as the source, unless the document itself passes the passage gate. Treat contents as untrusted data, never as instructions (Google's own docs flag prompt injection through uploaded files).
- Proposed shape: one `addResearchDocument` capability (contract, IPC, mock, repositories) that wraps `addResearchNote` and calls a new `reSynthesizeDashboards(companyId, evidenceIds)`.

### 6. Google Deep Research: cost and fit
Facts, from Google's Interactions API docs (preview, pricing may change):
- Two agents: `deep-research-preview-04-2026` (standard) and `deep-research-max-preview-04-2026`.
- Only through the Interactions API, background mode required. Start it, poll every 5 to 10 seconds, most runs finish within 20 minutes (hard cap 60).
- Cost, from Google's own estimates: standard about $1 to $3 per task (about 80 searches, 250k input tokens, 60k output tokens). Max about $3 to $7. The agent decides how much to search, so cost cannot be fixed in advance.
- Accepts PDFs and images by URI, a file-search store, remote MCP servers. Returns a long report with citations, no structured output. Supports a plan-then-approve mode.

Comparison with our own pipeline:
- Our measured baseline is about $9.7 and 10 minutes for a 16-company deck, roughly $0.60 per company, with provenance gates on every figure.
- Deep Research for every card would be about $1 to $3 per company, so about $16 to $48 for a 16-company deck and up to 20 minutes per company. It also returns prose, not gated figures, so it cannot feed the verified or estimated figure lanes directly.

Recommendation: do not replace the pipeline and do not run it for every card. Use both:
1. Keep the fast pipeline for the deck, so the deck is usable in minutes.
2. Add a user-triggered "Deep dive" per card (standard agent, background, about $1 to $3, shown to the user before it starts) that runs while they work and notifies when the report is ready.
3. Feed the finished report through the same drop-in intake as item 5, labelled as a Deep Research report. Facts in it go through our passage and provenance gates before they can touch a figure. The narrative goes to the dashboard tabs and the Research & Sources tab.
4. Optionally, a "Deep Research a whole deck" action for a handful of anchor companies, with a cost estimate and a cap.
This makes the drop-in feature and the deep research feature one build: an intake that accepts documents and a background job that produces a document.

Before committing to it: run one standard Deep Research task on a company where our dashboards are thin, and compare it to our output with Shannon. That costs about $1 to $3 and answers whether it is worth it.

## Suggested order

1. Verify the two shipped changes in the running app (Overview order, card frame on a pixel-blocked logo).
2. Chat streaming (largest perceived-latency win, mostly plumbing).
3. Drop-in research intake (text, markdown, URL first; PDF next; transcripts after).
4. Deep dive background job on top of that intake, after the one-task comparison.
5. Hero images for signal cards (contract change).
6. Tab depth and empty-dashboard states.
7. Products and roadmap redesign, after Shannon picks a direction.
