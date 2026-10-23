# Audit 2 — plan and status (2026-10-22)

Owner's second spoken audit after trying the beta preview. This file is the
durable plan: it must survive context resets. Update the status table as work
lands. Branch of record: `beta/night-tip` (integration). Never push `main`,
never force-push, never merge PRs, never deploy, never print keys, never
`git add -A`. Card BACK design belongs to the owner (Codex) — do not touch.
Do not change `.card-grid`.

## The owner's items, verbatim intent

| # | Item | Workstream |
|---|------|-----------|
| 1 | Card outline colours inconsistent; card doesn't read as a *physical card*; goal = elevate the company logo / primary colours. **Show several options as previews in a separate side project before committing**, without changing the card look much. | WS-A |
| 2 | Drop-in research panel is cut off at the bottom; no Send/Add button visible. | WS-0 |
| 3 | Audit how many images actually show where one is expected; reach ~90% hit rate. Real images/screenshots wherever we can; every image surface is a pipeline (fetch real → format → fallback). | WS-D |
| 4 | Stratemark branding on ALL PDFs/reports. | WS-E |
| 5 | Costs: keep cost down while quality + robustness go up. | WS-F |
| 6 | Market research needs commentary and a full breakdown of the company; currently weak. | WS-B/WS-G |
| 7 | "Refresh live intel" shows a border hugging the text — needs spacing. | WS-0 |
| 8 | "Ask" prompts: thin data must never produce `null`/empty prompt text. | WS-0 |
| 9 | Dashboards must be filled enough; chat research must not be wasted — it must hydrate the other tabs/card live, and research should compound. | WS-C |
| 10 | Chat bubble Share/Export sits too low, rubbing the company subtitle; company subtitle must be ONE short line. | WS-0 |
| 11 | Products & Roadmap overhaul: per-product report-grade page (overview, YouTube videos, metrics, news), updated; analyst-grade. | WS-B |
| 12 | Website audit tool: use AI to judge like a designer + business analyst — CRO best practices, clear CTA, etc. | WS-E2 |
| 13 | Overview: "Read full research…" → **"Read company report"**. Remove "Who they are". A **living Company Report**: AI-synthesised from all research, card preview + Stratemark branding, shareable, always current, NotebookLM-like. | WS-G (flagship) |

## Findings that shape the plan (from four read-only maps)

- No PDF library: all PDFs are `window.print()`. Two pipelines. Pipeline A
  (`PrintDocument`, `usePrintJob`) is branded (cover + footer). Pipeline B
  (`printScoped()` in `lib/print.ts`) — ReportViewerPage, BriefingReport,
  SiteAuditView, signal CardReader — has a text-only masthead and no logo/cover.
- No "share a company report" exists as one thing; DashboardPage's ExportMenu has
  no `share=` prop. Share exists for card/deck/report/briefing
  (`features/share/*`, OG image `lib/share/ogImage.ts`).
- "Who they are" is stitched client-side (`overviewSummary.ts`); the overview
  markdown comes from `packages/research/src/company-overview.ts`.
- Ask seeds: `CardReader.tsx:177` interpolates nullable `card.title` →
  `Dig into "null"`; `TeamOrgTab.tsx:449-457` writes `Role: ` / `Unknown` lines;
  `HistoryTab.tsx:299` can write `()`.
- Chat write-back exists (`chat-writeback.ts`, `keepFreshEvidence`) but is narrow
  (one roster company per sentence, no hedges) and nothing reads `chat:` evidence
  into tabs; the refresh emit carries no `companyIds`, so open dashboards don't
  live-update; `PersonProfile.research()` result lives only in React state.
- Header: `DashboardPage.tsx:511-577` grid with `gap-y-0`; subtitle clamps to 1
  line only at `lg`. oneLiner stored up to 240 chars; shorten at display time
  (literal-sentence gate forbids shortening at the producer).
- Website audit never reads the page: one Google-grounded call + one structure
  call; no HTML, no screenshot, no deterministic checks, no rubric, no per-finding
  evidence, bare-mean overall. `readAssetSource(url)` returns raw HTML on dev and
  hosted — the hook to plumb in.
- Products: no launch date/pricing/news/video/images per product; the tab
  re-renders from retained `productSelections`; `ProductBrief` (on demand) has
  metrics/reception/timeline; YouTube machinery exists for company-level only
  (`history-video.ts` oEmbed + red-team judge; `live-intel.videos`).
- Images: no telemetry. Demo snapshot: stored story images 0/148, product URLs
  0/107, person photos 0, ~38% of stories on reddit/x.com. Worker caches
  `{image:null}` 1 day; client caches "none" for the session; og-only parser.
  Cheapest path to 90%: measure → persist covers at research time for all stories
  → resolve vertexai redirect URLs → don't cache null → parser fallbacks
  (JSON-LD, big `<img>`) → per-surface backstops (site screenshot, favicon).

## Workstreams, owners, files

Each parallel stream has its own worktree and branch off `beta/night-tip`.
Merge order: WS-0 first (small), then others; resolve conflicts in
`contracts/repository.ts`, `contracts/schemas.ts`, `research/repository.ts` by
keeping both additions (each stream adds NEW files and only thin hooks there).

- **WS-0 quick UI/prompt fixes** — worktree `sm-wt-night` (me, branch
  `beta/night-tip`). Drop-in panel layout; refresh-border spacing; header
  spacing + one-line subtitle; ask seed builders (no null/Unknown lines).
- **WS-A card frame options** — side project in
  `docs/card-frame-options/` (static HTML, no app code touched).
- **WS-G Company Report** — worktree `sm-wt-n2-report`, branch `n2/report`.
- **WS-B Products & Roadmap** — worktree `sm-wt-n2-products`, branch `n2/products`.
- **WS-D Image hit rate** — worktree `sm-wt-n2-images`, branch `n2/images`.
- **WS-E2 Website audit + WS-E PDF branding** — worktree `sm-wt-n2-audit`,
  branch `n2/audit`.
- **WS-C chat compounding + completeness + cost** — after WS-0/G land (touches
  `repository.ts` heavily), done by me or a follow-up agent.

## Rules every stream follows

1. AGENTS.md Rule 9 — no invented figures; everything sourced; unknown = unknown.
2. New logic goes in NEW files with tests; thin hooks only into the 7k-line
   `repository.ts`.
3. Contract changes are additive + optional (`foo?:`), announced in the commit body.
4. Gate before commit: `pnpm --filter <pkg> typecheck`, relevant vitest files,
   `pnpm lint` on touched files. Full `pnpm check` is run by me at integration.
5. Commit on your own branch only; small commits; no push.
6. Verify UI with Playwright screenshots (browser MCP is not connected) using a
   temporary spec you delete afterwards.

## Status

| Stream | State |
|--------|-------|
| WS-0 | pending |
| WS-A | pending |
| WS-G | pending |
| WS-B | pending |
| WS-D | pending |
| WS-E/E2 | pending |
| WS-C/F | pending |
