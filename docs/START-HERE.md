# START HERE — latest Stratemark beta

**Latest branch: `release/beta-final-2026-10-24`** (same commit as `beta/night-tip`). Written 2026-10-24.
Everything older is history. If two branches disagree, this one wins.

Clone and run:

```bash
git clone https://github.com/NewSamBellamy/STRATEMARK-latest--1.git
cd STRATEMARK-latest--1
git checkout release/beta-final-2026-10-24
pnpm install
cd apps/web && VITE_OPEN_ACCESS=true pnpm exec vite --port 4500 --strictPort --host 127.0.0.1
```

`main` is NOT the latest. Do not push to `main`. Open a pull request, as `AGENTS.md` says.

## State on this date

- Gate: `pnpm check` green, and the full browser suite (`E2E_PORT=42xx pnpm exec playwright test` from `apps/web`) passed 78, 0 failed, with the card work in. Never use port 4173. Do not run `pnpm -r test` on Windows.
- Card skins, chosen by the owner: dual-tone split in market decks, foil bevel in Saved, acrylic slab in Today (label strip with logo, name, type and edition mark). Hover tilt and light follow the frame options preview. Source of truth for the designs: `apps/web/src/features/card/collectible.css` and `card-skin.ts`.
- Today opens with a grid of followed companies as cards, with unread counts; opening one shows its daily updates.
- Audit 2 work (living company report, products as a report, evidence-based website audit, PDF branding, image fallbacks, research that compounds) is merged. Plan and status: `docs/NEXT-SPRINT-AUDIT-2-2026-10-22.md`.

## Still open, owner decisions

- Three commits on this branch are labelled work-in-progress and were never checked on their own: `e0d0e65f` (images, and it also committed debug images and image-audit dumps, which breaks Rule 10), `ced7a8cf` (products), `3ae76618` (report). Finish and gate them, or drop them.
- The long-title fit on the new acrylic label strip is untested in a real browser (unit tests only).
- Story-row publisher-icon fallback for images is not built. Six big publishers refuse server reads, so a 90% story-picture hit rate is not reachable from the page alone.
- The Worker changes (browser-style image fetches, referer, shorter no-picture caching) are written and tested but not deployed. The owner deploys.
- Quality of the AI-written report, product news and videos, and the website audit needs a live key to judge. None has been tried against a real key.
- Re-hunt is on (figures older than 180 days, 8 companies per refresh, 30-day cooldown); the valuation "current" horizon is 18 months (6 recommended); `CompanyCandidate` has no citation field, so cited discovery figures cannot stay `verified`. See `FOR-YOUR-AUDIT.md` if present.
- Launch steps are the owner's: deploy the Worker and site, connect getstratemark.com, set `VITE_FEEDBACK_URL`, rotate the keys that were pasted into chats, decide whether the repo goes private.

## Rules that bind everyone (full text in `AGENTS.md`)

- Rule 8: the design is frozen without the owner's go-ahead. Rule 9: no figure is invented; `verified` needs a usable citation; unknown is null; charts never impute. Rule 10: no tooling artifacts committed. Rule 11: no secrets, ever.
- Never print or commit an API key. Do not run `env`.
- Spend: the org has about $868 of API credit left (2026-10-23) and the owner asked not to spend more. No parallel large-context agents. Keep sessions short and read only what is needed.
- Windows: no bare `git stash`; never kill processes by image name; strip ANSI codes before grepping logs.
