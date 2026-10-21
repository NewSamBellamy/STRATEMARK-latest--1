# Design cohesion spec

Why this exists: the owner clicked through the app and said the tabs "seemed off":
weird formatting, blank space, unnecessary spacing, ratios that were off, nothing
that felt intentional. This file is the rule set every polish pass follows. It is
built from screenshots of every surface (1440 light, 390 mobile, dark for the
dashboard tabs) plus a read of the shared kit and tokens. Evidence is cited as
`file:line` as of this branch. Nothing here changes company CARD visuals
(`.mi-card`), adds sparkle or wand icons, or puts pricing in Settings.

Not done: the layout-audit README and its baseline could not be located from this
worktree, so nothing below leans on it. Re-check the audit numbers when it is found.

Scope note: this is a spec, not a refactor. Part 1 is what to build toward, Part 2
is what is wrong now, Part 3 is the order to fix it.

---

## Part 1. Rules that hold everywhere

The root cause is that there is no named spacing scale. `TabKit.SectionHeader`
(`mb-3`, `text-base`) and `dashboardKit.Section` (`mb-2.5`, 11px uppercase) are two
different header systems; tabs pick `space-y-4`, `-5`, `-6` or `-8` at random. The
rules below name the few values to use and ban the rest.

### 1.1 Width and left edge
- Dashboard tabs live inside one container: `mx-auto max-w-6xl` (already
  `DashboardPage.tsx:472`). No tab sets its own narrower `max-w-*` on its root.
- Reading-prose blocks may cap at `max-w-3xl` or `72ch` for line length, but only the
  text inside a full-width card, never the card itself. A card narrower than its
  siblings reads as a gap on the right.
- Standalone pages pick one of three widths and say which: **narrow** `max-w-2xl`
  (forms: Beta, Market settings), **reading** `max-w-3xl` (briefing, Today feed),
  **wide** `max-w-6xl` (anything with a grid: Decks, Saved, Reports, deck page,
  dashboard). `max-w-4xl` and `max-w-5xl` are retired.
- All pages share the shell padding (`AppShell.tsx:171`, `px-4 py-4 md:px-6 md:py-6`).
  Pages add no extra horizontal padding.

### 1.2 Vertical rhythm (named steps)
| Token | Value | Use |
|---|---|---|
| `gap-section` | `space-y-8` (2rem) | between top-level sections of a tab or page |
| `gap-block` | `space-y-4` (1rem) | between cards/blocks inside one section |
| `gap-tight` | `space-y-2` | rows inside a list, label to value |
| header gap | `mb-3` | section header to its first block |
| strip gap | `mb-4` | freshness strip / filter row to content |

`space-y-5`, `space-y-6`, `mb-2.5` and one-off `mt-*` between siblings are removed.
Implement as a shared class or a tiny `Stack` component in the kit, not as comments.

### 1.3 Section headers: one pattern
Use `TabKit.SectionHeader` everywhere (including inside `OverviewSnapshot`):
- Title: `font-display text-base font-semibold text-ink`.
- Count: `text-xs text-muted` on the same baseline, e.g. `Stories 12`. Count only
  when it is a real number from data; never `0` for unknown.
- Helper: one line, `text-xs text-muted`, `max-w-2xl`, under the title. Optional,
  never two sentences.
- Action (export, org report): right-aligned in the header row, `btn` small, wraps
  below the title at 390 rather than squeezing it.
- `dashboardKit.Section` (11px uppercase tracked) is for dense side-rail labels only,
  not for top-level section titles. A page never mixes both at the same level.

### 1.4 Card padding and radius
- `panel` radius 1rem (`rounded-xl2`) for every card. `rounded-xl` and `rounded-lg`
  cards are retired, except inner chips/inputs.
- Padding: `p-5` default, `p-4` for dense (tile, list row group), `px-4 py-3` for
  strips. Never mix paddings among cards in the same row.
- Nested surface inside a panel uses `panel-2`, no second shadow, no second border
  colour.

### 1.5 Two-column ratios
- One ratio on desktop: main : rail = **2 : 1**, written
  `lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]`. Retire `1.35fr/1fr`, `1.5fr/1fr`,
  `1.15fr/1fr`, `1fr_300px`, `1fr_320px`, `1fr_340px`. A fixed-pixel rail is allowed
  only for a list of known-width items and must be one value (320px).
- Below `lg` the grid is a single column, rail below main. The main column comes
  first in DOM order.
- When the shorter column leaves a hole, choose in this order:
  1. **Stack**: if the rail is short, move it under main and make main full width.
  2. **Stretch**: if both are cards of the same kind (two panels side by side), use
     the grid default `items-stretch` and let the card body fill (`flex flex-col`,
     content top-aligned, no centred void).
  3. **Sticky**: only for a rail that is a navigator or summary beside a long list
     (`lg:sticky lg:top-4 self-start`), and only if main is taller than two screens.
  Never use `items-start` and leave a bare half-column of page background.
- Equal-count card grids use 1 / 2 / 3 / 4 columns that divide the item count. For
  5 items use 5 in one row on `lg` or stack; never a 3+2 grid with an empty slot.

### 1.6 Empty states
- Inside a card or tab: `EmptyNote` compact (`px-4 py-5`): one line saying what is
  missing and why, plus at most one action (e.g. Re-run). Centred horizontally,
  top of the card, height under ~96px. No illustration, no second paragraph.
- `EmptyState` (`px-6 py-16`) is for a whole page with no content (no decks, no
  saved cards). It never appears inside a tab.
- An empty section that has nothing to act on is **hidden** or collapsed to its
  header with a muted "None found" line, not a tall bordered box.
- Empty means unknown, not zero. Never render `0`, `0%` or `-` as a figure.

### 1.7 Figure tiles
- One component: `dashboardKit.KpiTile` (`p-4`, value 26px, label 10.5px). Label
  above value, source/confidence mark below, same height across a row.
- Grid: `grid-cols-2` at 390, `sm:grid-cols-3`, `lg:grid-cols-4`; render only tiles
  that have a value. If a tile is `unknown` it shows the label and "Not found" in
  muted text at the same size, so row heights stay equal; do not drop to a
  different tile style.
- Tiles never carry their own `max-w`; they fill the grid cell.

### 1.8 Tables and lists
- Row height about 40px (`py-2`); header row `text-xs uppercase text-muted`.
- One line per row by default. Long cells truncate (1.11), they do not wrap to
  three lines.
- No per-row boilerplate: a repeated phrase (`Source: ...`, `Unverified`) moves to
  the column header or a legend once.
- Numeric columns right-aligned, tabular figures. Source column fixed at one width
  (the 190px in Metrics is the reference) and used by every table.
- Below `md` tables become stacked rows, not horizontal scroll, except the
  Metrics comparison which may scroll inside its card.

### 1.9 Chip and filter rows
- `flex flex-wrap gap-2`. Chips wrap to a second line; they never truncate or
  horizontally clip, and never push the layout wider than the container.
- Filter row sits `mb-4` above content, search box on the left at `min-w-[12rem]`
  growing to fill, chips after it, count of results right-aligned.
- Selected chip uses the accent fill; unselected `chip` neutral. One chip height.
- The dashboard tab strip is the only horizontally scrolling chip row (it already
  hides its scrollbar below `lg`, `DashboardPage.tsx:323`).

### 1.10 Modal widths
Map to `Modal` sizes (`Modal.tsx:37`) and pick by content, not by taste:
- `md` (`max-w-lg`): confirm, single field, share link.
- `lg` (`max-w-2xl`): forms, settings, Ask.
- `xl` (`max-w-3xl`): reports, long reading.
- `2xl` (`max-w-6xl`): side-by-side compare or reader only.
Body padding `p-5`, footer actions right-aligned. A modal never has an inner card
with its own max-width narrower than the modal.

### 1.11 Truncation
- Single-line truncation: `truncate` plus a `title` attribute with the full text.
- Multi-line: `line-clamp-2` for card summaries, `line-clamp-3` max. Never clamp
  prose the reader came to read (briefing, story body).
- Deck and company titles are never truncated when the row has room; check at
  1440 and 390 before adding `truncate`.
- Flex children that should truncate need `min-w-0`.
- Never cut a URL host in the middle; show the host and truncate the path.

### 1.12 Page headers
One H1 style: `font-display text-2xl font-semibold`, subtitle `text-sm text-muted`,
`mb-6` to the first section. Retire `text-[28px] font-bold` and `text-[22px]`.

---

## Part 2. What is inconsistent today

### 2.1 Cross-cutting
- **Two header systems.** `TabKit.SectionHeader` (`TabKit.tsx`, `mb-3`, 16px
  semibold) vs `dashboardKit.Section` (`mb-2.5`, 11px uppercase). Both are used on
  Overview (`OverviewSnapshot.tsx:59`, `:75`, `:172`, `:207`).
- **Six root spacings.** Overview `space-y-8` (`OverviewTab.tsx:304`), Metrics
  `space-y-6` (`MetricsTab.tsx:669`), History `space-y-5` (`HistoryTab.tsx:95`),
  Mission/Products `space-y-8`, Research `space-y-4` (`ResearchTab.tsx:234`).
- **Seven column ratios.** `1.35fr/1fr` (Overview `:195`, Live Intel `:294`),
  `1.5fr/1fr` (Overview `:356`), `1.15fr/1fr` (Metrics `:700`), `1fr_300px`
  (History `:116`), `1fr_320px` (Mission `:83`), `1fr_340px` (Mission `:133`).
- **Page widths drift.** `max-w-2xl` Beta and Market settings, `3xl`
  Today/briefing, `4xl` Reports and Share, `5xl` Saved and Opportunity, `6xl`
  Decks, dashboard. Same app, five left/right edges.
- **H1 drift.** `text-2xl` (dashboard `:511`, Reports, Decks) vs `text-[28px]
  font-bold` (Saved, Today) vs `text-[22px] sm:text-[28px] font-bold` (Deck page).
- **Empty states.** `EmptyNote` default `px-6 py-9` vs compact `px-4 py-5` chosen
  per call site; page `EmptyState` `px-6 py-16`; Deck page builds its own
  teal/amber panels (`max-w-xl p-8`, `DeckPage.tsx` ~435-475).
- **Freshness strip.** `TabFreshness.tsx` renders a right-aligned 11.5px line at
  `mb-3` with a lone pause icon at its right end. On wide screens it floats
  above the content with a large empty left side.

### 2.2 Per tab
- **Overview.** The KPI grid switches to `md:grid-cols-3` when there are more than
  four figures (`OverviewTab.tsx:315`), which gives a 3+2 grid with an empty
  slot for typical five-figure companies. Stories and summary use two different
  ratios (`:195`, `:356`) one under the other, so column edges do not line up.
  A `max-w-[72ch]` panel (`:401`) is narrower than its siblings. Snapshot
  sections mix header styles (see 2.1).
- **Metrics.** `1.15fr/1fr` grid (`:700`) beside a sticky panel (`:333`): when the
  table is short the rail floats with blank space beneath. Source column capped
  at `max-w-[190px]` truncates and repeats boilerplate per row.
- **Team & Org.** The header title carries a long compound count "N people · N with
  a source" plus the org-report button (`TeamOrgTab.tsx:356`), which crowds at
  390. Filters (`:428`) sit apart from the header with a different gap than the
  other tabs.
- **History.** `space-y-5` is the only tab on 5. Story capped `max-w-3xl`
  (`:110`) inside a `1fr_300px` grid (`:116`), leaving a gap right of the story
  on wide screens. The quotes header (`:293`) is a different style from the
  timeline header above it.
- **Products & Roadmap.** Roadmap `md:grid-cols-3` (`:379`, `:446`) with uneven
  item counts leaves one short column; empty columns render as tall boxes.
- **Live Intel.** `1.35fr/1fr` (`:294`) then a "more coverage" header (`:386`)
  at a different weight to what precedes it.
- **Mission & Governance.** Two different rails in one tab (320px and 340px,
  `:83`, `:133`); signals `md:grid-cols-2` (`:232`) leaves an orphan last card
  when odd.
- **Research / Live Landing.** Research uses `space-y-4` (tightest in the app);
  Landing header at `LiveLandingTab.tsx:190` is the kit header but the content
  under it uses bespoke padding.
- **Deck page, Saved, Reports, Today, Beta, Settings.** See widths and H1 in 2.1;
  Deck page empty/state panels are one-offs not using `EmptyState`.

---

## Part 3. Per-surface punch list (ranked by gain in "feels intentional")

Each list: most impactful first. Items marked **(global)** are done once in the kit
and fix several surfaces; do those before any per-tab pass.

### 0. Global first
1. **(global)** Add the named spacing steps (1.2) and a `Stack`/section wrapper; make
   every tab root use `gap-section`.
2. **(global)** One `SectionHeader`; make `dashboardKit.Section` a rail-label only
   and replace its top-level uses.
3. **(global)** One `TwoCol` component implementing 1.5 with `main`/`rail` slots.
4. **(global)** `TabFreshness`: left-align with the tab content, drop the orphan
   icon or fold it into the strip, `mb-4`.
5. **(global)** Page-width and H1 constants (1.1, 1.12).

### 1. Overview
1. Fix the 3+2 KPI grid: use 4/5-up row or `KpiTile` rule 1.7.
2. Align stories and summary on one 2:1 grid.
3. Remove the `max-w-[72ch]` card; cap text inside, card full width.
4. Replace `Section` headers in the snapshot with `SectionHeader`.
5. Collapse empty snapshot sections to header + "None found".

### 2. Metrics
1. 2:1 grid; if the table is shorter than the rail, stack instead of sticky.
2. Move per-row source boilerplate to the column header; keep 190px column.
3. Table density per 1.8, right-align numbers.
4. `space-y-8` root.

### 3. Team & Org
1. Split header: title "People", count "N", helper "N with a source"; button stays
   right and wraps at 390.
2. Filter row per 1.9, `mb-4`.
3. Person rows one line, `truncate` + `title`.
4. Empty filter result: compact `EmptyNote` with "Clear filters".

### 4. History
1. `space-y-8` root.
2. Remove story `max-w-3xl` from the card; 2:1 grid with fixed 320px rail only if
   rail items are fixed width, else 2:1.
3. Quotes header to `SectionHeader`.
4. Timeline row density per 1.8.

### 5. Products & Roadmap
1. Roadmap columns: only render columns that have items; 1/2/3 by count, never a
   hollow column.
2. Compact empties inside columns.
3. Consistent card padding `p-4`/`p-5` across product and roadmap cards.

### 6. Live Intel
1. 2:1 grid; stretch the two cards (1.5.2).
2. "More coverage" header matches the rest.
3. Compact empty when no live items; keep the Re-run action.

### 7. Mission & Governance
1. One rail value (320px) or 2:1 for both blocks.
2. Odd signal count: last card spans the row, or use 1/3 columns that divide.
3. Stack governance rail below main when short.

### 8. Research and Live Landing
1. Research root to `gap-section`.
2. Landing body padding to `p-5`; use the shared header.
3. Empty states compact.

### 9. Deck page
1. H1 to 1.12.
2. Teal/amber one-off panels (`DeckPage.tsx` ~435-475) become `EmptyState` or an
   `EmptyNote` compact with the same tone class; no `max-w-xl p-8` void.
3. Header block `mb-6` and title row `mt-2` onto the section scale.
4. Card grid column count per 1.5 last bullet.

### 10. Card reader
Do not touch `.mi-card` visuals. Only: modal/reader width per 1.10 and `p-5`
padding around the card, not inside it.

### 11. Today
1. H1 to 1.12; width to reading (`3xl`) for the feed, wide only for the grid
   section, with one left edge (the feed and grid currently differ).
2. Section headers via `SectionHeader`.
3. Empty feed: page `EmptyState`.

### 12. New Deck and All Decks
1. New Deck at narrow width; form blocks `gap-block`.
2. All Decks (`#/history`) at wide width, H1 `text-2xl`, filter row 1.9.
3. Deck cards in a 1/2/3 grid; no half-empty last row filler.

### 13. Reports and Saved
1. Both to wide width; Reports from `4xl`, Saved from `5xl`.
2. Saved H1 `text-[28px] font-bold` to the standard.
3. Reports list rows to table density 1.8.
4. Page `EmptyState` only when the list is truly empty.

### 14. Settings, Beta, Share, Ask
1. Beta stays narrow `2xl`, `gap-section`.
2. Settings stays pricing-free; sections via `SectionHeader`, `p-5` panels.
3. Share page: `4xl` vs `6xl` unify to wide; the share modal `md`.
4. Ask modal `lg`; message list scrolls inside, input fixed at the bottom.

---

## Acceptance for every polish pass
- Open the surface at 1440 light, 390, and dark. No blank half-columns, no empty
  slot in a card grid, no tall empty box, one left edge from header to last card.
- Only the named steps in 1.2 appear in the diff for spacing.
- No change to `.mi-card`; no new icon of the sparkle/wand family.
- Unknown values show as not found, never as zero or a guessed number (AGENTS.md
  Rule 9).

## Open items for the owner
- Confirm 2:1 as the one desktop ratio (versus keeping a 1.35:1 for story-led tabs).
- Confirm retiring `max-w-4xl` and `max-w-5xl` pages to `max-w-6xl`.
- Confirm Today may mix reading and wide widths or must use one.
