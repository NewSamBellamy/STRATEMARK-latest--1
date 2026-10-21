# Layout audit

`layout-audit.spec.ts` measures layout problems on every surface of the demo build, so polish can be judged by numbers as well as by eye. It is one test (about 2.5 minutes) that walks every surface at 1440, 1024, 768 and 390 px wide.

## Run

From `apps/web` (the config builds and serves the app itself; the port form avoids a busy 4173):

    E2E_PORT=4196 timeout 1200 pnpm exec playwright test e2e/layout-audit.spec.ts

Output: a table on stdout (use `--reporter=line` to see it), and `e2e/layout-audit.results.json` (gitignored) with every number per surface and width. Requests to anything other than localhost (fonts, logos) are blocked, and motion is reduced, so runs are offline and repeatable.

## Surfaces

New deck, All decks, the demo deck page, its four other lanes (Culture, Vice, Insight, Barrier to Entry), the company card reader open (measured inside the dialog), all 9 dashboard tabs for Mistral AI (`cmp_mistral-ai_iubim`) and for a sparse company (Crusoe, `cmp_crusoe-crusoe-energy-systems_tx4jf`, which has no `users` metric), Today, Saved, Reports, About this beta. (The app has 9 dashboard tabs, not 10.)

## HARD failures (the test fails)

- Horizontal overflow: document or main scroller `scrollWidth` over `clientWidth`.
- Any `pageerror`, or console error other than network noise (`Failed to load resource`, `net::ERR`, logo).
- Text clipped by `overflow: hidden` (not ellipsis or line-clamp) with no `title` or `aria-label` on it or an ancestor.
- A surface that does not load.

Truncation by ellipsis or line-clamp is only counted (`truncated`); more than 8 per surface is listed on stdout, not failed.

## SOFT metrics (reported only)

Measured inside the main scroll container (`main`, or the dialog for the reader). The content root is found by descending through single-child wrappers.

| metric | meaning | flag when |
|---|---|---|
| `maxGap` | largest vertical gap (px) between consecutive visible top-level blocks | over 48 |
| `emptyRatio` | share of 24 px grid cells in the content column not covered by any visible text, image, svg, input, background or border (a card with a background counts as covered, padding included) | over 0.35 on a page that has content |
| `colLeft`, `colMaxWidth` | content column left edge and width (px) inside the scroller; compare across tabs of one page | left edge differs between tabs at one width |
| `twoColRatio` | shorter over taller height of the worst side-by-side pair (grid with 2+ tracks, or row flex; children over 120 px wide, group over 120 px tall) | under 0.6 |
| `fontSizes` | distinct computed font sizes (rounded to 0.5 px) with text above the fold | over 10 |
| `truncated` | elements truncated by ellipsis or line-clamp | over 8 |

`-` means not applicable (no two-column group). Known limits: the new deck page varies by about 0.05 in `emptyRatio` between runs (it shows a varying chip set); the card reader's `maxGap` and `colLeft` are 0 because the dialog fills its scroller.

## Baseline

Taken on the demo build; each cell is `1440/1024/768/390`.

HARD: one failure. `dash-sparse-mission_governance@390`: horizontal overflow, scrollWidth 479 over 390.

| surface | maxGap | emptyRatio | colLeft | colMaxW | twoColRatio | fontSizes | truncated |
|---|---|---|---|---|---|---|---|
| new-deck | 24/24/24/24 | 0.41/0.38/0.35/0.38 | 272/64/48/40 | 672/672/448/310 | -/-/-/- | 5/5/5/5 | 0/0/0/0 |
| all-decks | 24/24/24/24 | 0.55/0.32/0.04/0.03 | 32/24/24/16 | 1152/752/496/358 | 1/1/1/- | 8/8/8/8 | 2/2/2/1 |
| deck | 24/24/24/24 | 0.13/0.24/0.26/0.04 | 24/24/24/16 | 1168/752/496/358 | 1/1/-/- | 11/11/9/9 | 3/3/3/3 |
| deck-lane-culture | 24/24/24/24 | 0.36/0.08/0.27/0.04 | 24/24/24/16 | 1168/752/496/358 | 1/1/-/- | 9/9/9/9 | 0/0/0/0 |
| deck-lane-vice | 24/24/24/24 | 0.12/0.06/0.29/0.04 | 24/24/24/16 | 1168/752/496/358 | 1/1/-/- | 9/9/9/8 | 0/0/0/0 |
| deck-lane-insight | 24/24/24/24 | 0.14/0.25/0.26/0.04 | 24/24/24/16 | 1168/752/496/358 | 1/1/-/- | 9/9/8/8 | 0/0/0/0 |
| deck-lane-barrier | 24/24/24/24 | 0.14/0.25/0.26/0.04 | 24/24/24/16 | 1168/752/496/358 | 1/1/-/- | 9/9/8/8 | 0/0/0/0 |
| card-reader | 0/0/0/0 | 0.57/0.57/0.57/0.61 | 0/0/0/0 | 400/400/400/390 | -/-/-/- | 3/3/3/3 | 0/0/0/0 |
| dash-mistral-overview | 24/24/24/24 | 0.15/0.19/0.08/0.07 | 32/24/24/16 | 1152/752/496/358 | 1/0.6/1/1 | 11/9/9/9 | 0/5/5/3 |
| dash-mistral-metrics | 24/24/24/24 | 0.21/0.23/0.1/0.11 | 32/24/24/16 | 1152/752/496/358 | 0.65/0.5/-/- | 13/12/10/10 | 0/0/0/0 |
| dash-mistral-team_org | 24/24/24/24 | 0.1/0.13/0.07/0.09 | 32/24/24/16 | 1152/752/496/358 | 0.97/0.97/1/1 | 13/9/9/9 | 0/0/0/0 |
| dash-mistral-history | 24/24/24/24 | 0.19/0.27/0.06/0.04 | 32/24/24/16 | 1152/752/496/358 | 0.28/0.25/-/- | 7/6/6/6 | 0/0/0/0 |
| dash-mistral-products_roadmap | 24/24/24/24 | 0.16/0.16/0.11/0.09 | 32/24/24/16 | 1152/752/496/358 | 1/1/1/- | 8/8/8/8 | 10/25/25/3 |
| dash-mistral-live_intel | 24/24/24/24 | 0.12/0.12/0.07/0.07 | 32/24/24/16 | 1152/752/496/358 | 1/1/-/- | 9/9/8/8 | 0/4/11/13 |
| dash-mistral-mission_governance | 24/24/24/24 | 0.19/0.2/0.08/0.08 | 32/24/24/16 | 1152/752/496/358 | 1/1/1/- | 8/7/7/7 | 0/0/0/0 |
| dash-mistral-live_landing | 24/24/24/24 | 0.16/0.2/0.15/0.15 | 32/24/24/16 | 1152/752/496/358 | -/-/-/- | 6/6/6/6 | 0/0/0/0 |
| dash-mistral-research | 24/24/24/24 | 0.29/0.36/0.26/0.27 | 32/24/24/16 | 1152/752/496/358 | -/-/-/- | 5/5/5/5 | 0/0/0/0 |
| dash-sparse-overview | 24/24/24/24 | 0.12/0.16/0.05/0.05 | 32/24/24/16 | 1152/752/496/358 | 1/0.45/1/1 | 11/11/9/9 | 0/6/9/4 |
| dash-sparse-metrics | 24/24/24/24 | 0.22/0.23/0.12/0.1 | 32/24/24/16 | 1152/752/496/358 | 0.72/0.65/-/- | 13/13/10/10 | 0/0/0/0 |
| dash-sparse-team_org | 24/24/24/24 | 0.1/0.12/0.08/0.06 | 32/24/24/16 | 1152/752/496/358 | 0.65/0.65/1/1 | 13/9/9/8 | 0/0/0/0 |
| dash-sparse-history | 24/24/24/24 | 0.19/0.28/0.05/0.03 | 32/24/24/16 | 1152/752/496/358 | 0.29/0.22/-/- | 7/6/6/6 | 0/0/0/0 |
| dash-sparse-products_roadmap | 24/24/24/24 | 0.24/0.2/0.16/0.09 | 32/24/24/16 | 1152/752/496/358 | 1/1/1/- | 7/7/7/7 | 3/6/9/7 |
| dash-sparse-live_intel | 24/24/24/24 | 0.11/0.12/0.07/0.06 | 32/24/24/16 | 1152/752/496/358 | 1/1/-/- | 9/9/7/6 | 0/6/12/14 |
| dash-sparse-mission_governance | 24/24/24/24 | 0.14/0.16/0.06/0.05 | 32/24/24/16 | 1152/752/496/358 | 1/1/1/- | 8/7/7/7 | 2/2/0/0 |
| dash-sparse-live_landing | 24/24/24/24 | 0.16/0.2/0.14/0.14 | 32/24/24/16 | 1152/752/496/358 | -/-/-/- | 6/6/6/6 | 0/0/0/0 |
| dash-sparse-research | 24/24/24/24 | 0.26/0.33/0.23/0.24 | 32/24/24/16 | 1152/752/496/358 | -/-/-/- | 5/5/5/5 | 0/0/0/0 |
| today | 20/20/20/20 | 0.06/0.06/0.02/0 | 224/24/24/16 | 768/752/496/358 | -/-/-/- | 3/3/3/3 | 0/0/0/0 |
| saved | 24/24/24/24 | 0/0/0/0 | 96/24/24/16 | 1024/752/496/358 | -/-/-/- | 4/4/4/4 | 0/0/0/0 |
| reports | 24/24/24/24 | 0.05/0.02/0.03/0.07 | 160/24/24/16 | 896/752/496/358 | -/-/-/- | 5/5/5/5 | 0/0/0/1 |
| beta | 24/24/24/24 | 0.06/0.06/0.05/0.03 | 272/64/24/16 | 672/672/496/358 | -/-/-/- | 4/4/4/4 | 0/0/0/0 |

Worst five per metric (surface@width): `maxGap` is 24 everywhere (0 to 24; Today 20), so there is no outlier. `emptyRatio`: card-reader@390 0.61, card-reader (1440, 1024, 768) 0.57, all-decks@1440 0.55. `twoColRatio` (lowest): dash-sparse-history@1024 0.22, dash-mistral-history@1024 0.25, dash-mistral-history@1440 0.28, dash-sparse-history@1440 0.29, dash-sparse-overview@1024 0.45; the history pairs are the 1fr / 300px grid. `fontSizes`: Metrics and Team & Org Chart at 1440 (13). `truncated`: dash-mistral-products_roadmap@1024 and @768 (25), dash-sparse-live_intel@390 (14), dash-mistral-live_intel@390 (13), dash-sparse-live_intel@768 (12).
