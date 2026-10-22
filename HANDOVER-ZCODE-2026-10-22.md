# Stratemark: handover to Z Code (2026-10-22)

Written for the Z Code harness so it can pick up the product from where Claude Code left off. Read this whole file first, then `STATE.md` and `BETA-SPRINT-CHECKLIST.md` in the repo root.

**Owner:** Shannon (he/him). He is non-technical and works from the app itself, so verify things in the running app, not only in tests. He is the only one who merges, deploys and sets `user_verified`.

**Standing goal:** beta launch Thursday 2026-10-22 morning. Red-team and stress-test the code, keep it clean and working, map the user journey, make sharing simple and effective, and make sure every tab works.

---

## 1. Where the code is

| Item | Value |
|---|---|
| GitHub repo | `https://github.com/NewSamBellamy/STRATEMARK-latest--1` (public) |
| Integration branch | `beta/night-tip` (this is the candidate the owner audits) |
| Origin tip (as pushed) | `f84834a0` |
| Local tip (3 commits not yet on origin) | `850af52d` |
| `main` | Do not push. PR #2 (beta into main) stays open. |
| Git identity used by the agents | `Codex`. Commits end with a `Co-Authored-By:` trailer. |

Clone and check out the branch:

```bash
git clone https://github.com/NewSamBellamy/STRATEMARK-latest--1.git stratemark
cd stratemark
git checkout beta/night-tip
git log --oneline -8
```

If you want the three local-only commits (`53825a16`, `9dcb7e26`, `850af52d`), they are in the Claude Code worktree `sm-wt-night` on this machine. Ask the owner whether to push them to `origin/beta/night-tip` before you rely on them. A bundle of the local tip is also available (see section 9).

### Monorepo layout

| Path | What it is |
|---|---|
| `apps/web` | The product UI: Vite, React, HashRouter, Tailwind. Most of the work lives here. |
| `apps/desktop` | Electron desktop app (packaging is Morgan's area; security surface is Blackbeard's). |
| `apps/api` | Node API. |
| `packages/research` | The research pipeline: sources, figure extraction, confidence, freshness (`recency-rank.ts`), CRAAP. |
| `packages/contracts` | `@mi/contracts`: shared types, imported by web, desktop and research. Changes here have a large blast radius. |
| `packages/mocks` | Test fixtures. |
| `services/stratemark-api` | Cloudflare Worker: share endpoints, hosted links, the viewer backend. |
| `graphify-out/` | Knowledge graph of the repo (untracked). See section 8. |

---

## 2. Rules that never change (from `AGENTS.md` and `STATE.md`)

These are binding for every agent and every change.

1. **Never push to `main` or `integration/*`.** Never force-push. **Never merge a PR.** The owner merges, through `merge-stack.sh`.
2. **Never deploy.** The Worker, Pages, logins and the domain (getstratemark.com) are the owner's.
3. **Gate before any PR:** `pnpm check` from the repo root (typecheck, then lint, then tests). If it can't run, the PR body says `VERIFICATION NOT RUN`, in plain words.
4. **Rule 9, data integrity:**
   - `verified` confidence needs a usable citation; unsourced figures are downgraded.
   - An unknown figure is `null`, never zero, never a guessed number.
   - Unsourced vice or controversy claims are dropped, not shown.
   - Charts never impute or zero-fill.
   - Only a human sets `user_verified`.
   - Signal cards (`culture`, `vice`, `insight`) never inherit an entity's metrics.
5. **Design:** the dashboard tabs (Overview, Metrics, Team & Org Chart) were redesigned on purpose. Company **card** visuals are frozen, and the `.card-grid` CSS rule must not change. No sparkle or magic-wand icons. Settings stays pricing-free. Do not remove any AI entry point.
6. **Secrets:** the Anthropic API key lives only in `C:\Users\shann\.stratemark-factory\anthropic.env`. Never print it, never put it in a repo, commit, PR body or brief, and never run `env`. The owner pasted keys into chat during the sprint, so they must be rotated after the project.
7. **Permissions:** an agent does not change its own permission mode and does not work around a classifier denial. It stops and notes the denial.
8. **Pronouns:** use they/them for anyone whose pronouns are not stated. Shannon is he/him.

### Branch and PR conventions (`AGENTS.md`)
- Branch names: `<type>/<agent>-<slug>`, with `feat/`, `fix/`, `chore/`, `hardening/`, `docs/`. Agent segment: `morgan-`, `blackbeard-`, or none for Shannon.
- One concern per branch.
- Shared contracts (`packages/contracts`): announce in the PR body.
- Handoffs between agents: a GitHub issue labelled `handoff:morgan` or `handoff:blackbeard`, with exact paths, the concrete problem, and checkable acceptance criteria.

### Team (`AGENTS.md`)
- **Shannon** (`@NewSamBellamy`): product direction, design, merge authority on anything ambiguous.
- **Morgan**: lead development, feature work, UI wiring, packaging and release.
- **Blackbeard**: backend architecture, the agent/ADK layer, data integrity, security hardening.

---

## 3. Commands you will use

Run from the repo root unless it says otherwise.

```bash
pnpm install
pnpm check                          # typecheck -> lint -> tests (all packages)
cd apps/web
E2E_PORT=4250 timeout 2400 pnpm exec playwright test   # the full e2e gate
pnpm exec vitest run <files>        # targeted unit tests
pnpm exec tsc --noEmit
pnpm exec eslint <files> --max-warnings=0
```

Notes:
- **e2e needs `E2E_PORT`.** Pick any free port in the 42xx range. Never use **4173**: another app runs there.
- On Windows, do not run `pnpm -r test`. CI and the gate already run the packages correctly.
- The `layout-audit.spec.ts` run prints truncation warnings. They are reported, not failures. The test is the last line of the run and must say `passed`.
- Dev server for the app: `VITE_OPEN_ACCESS=true pnpm exec vite --port 4232 --strictPort --host 127.0.0.1` (from `apps/web`). `VITE_OPEN_ACCESS` skips sign-in for local review only.
- Push of the integration branch: `GIT_TERMINAL_PROMPT=0 timeout 100 git -c credential.helper= -c "credential.helper=!gh auth git-credential" push origin beta/night-tip`. Pushing `beta/night-tip` is allowed. Pushing `main` or `integration/*` is not.

---

## 4. What was done (this sprint, in order)

### 4a. Dashboard redesign (owner's video audit)
The owner asked for the first three dashboard tabs to be fixed, and the cards to feel less "vibe coded".

**Overview**
- Compact header with an "Ask about X…" box.
- Key-figures strip with rank dots (replaces the purple and yellow look).
- A summary paragraph built by `overviewSummary.ts`.
- Story thumbnails, leader photos, comparison bars with ranks, a Watch scroller, and a milestones timeline.

**Metrics**
- New `deckComparison.ts`, `DeckCompare.tsx`, and the `useChartAccent` hook in `metricViz.tsx`.
- Animated comparison against the market.
- `barScale()` with an outlier axis break at a 5x threshold.

**Team & Org Chart**
- Leadership first, then a Board section.
- Calm sectioned cards. Red dots and "Not reported" removed. The "Starting five" strip removed.
- Profile modal with a large header.
- A segmented filter. The reporting-lines view only appears when reporting lines exist.

### 4b. Collectible cards
- Fish animation every 30 seconds.
- Long deck titles fit (`b539a20d`). Covered by unit tests only.
- Logo quality gate: blurry, wrong-size, missing or generic logos are rejected. Verdicts are cached in localStorage.
- Brand frame colour taken from the logo.
- Footer reads "Founded YYYY · Updated DD Mon" (replaces "3/4 figures sourced").
- Physical card feel.
- Stratemark card back, with spin and flip in the reader.

### 4c. Freshness (stale figures such as OpenAI showing $130B)
- `packages/research/src/recency-rank.ts`, with tests.
- Only newsroom sources (Reuters, Bloomberg, FT and similar) win on date.
- A dated claim beats an undated one only at equal or higher credibility. Future dates count as undated.
- Re-hunts cover only valuation, last_round, funding_total and ARR, with a 30-day cooldown, oldest first.
- `businessDates` reads dates in UTC.
- `apps/desktop/src/sqlite.ts` saves re-hunt timestamps.

### 4d. Bug hunts
- **Sharing (`b24ef660`):** a `shortError` alert when a short link fails; a 429 shows a "busy" message; a 413 says "too large"; the Worker's `readTextCapped` returns 413 for oversize streamed bodies; JSON 500s carry CORS headers.
- **User journey (`f84834a0`):** unknown company or report addresses now have an `<h1>` (was only an `<h3>`). Fixed with the opt-in `notFoundIsPage` prop.
- **Redesign (three local commits, not yet on origin):**
  - `53825a16`: malformed remembered logo verdicts in localStorage are ignored instead of crashing a card.
  - `9dcb7e26`: product names were wrongly dropped from the Overview paragraph (substring matching, and non-Latin names). Whole-word matching now; unmatched names are listed.
  - `850af52d`: negative figures no longer plotted outside the zero-based scatter axes; the company is listed under "not placed".

### 4e. Gate status
- Last full gate on `f84834a0`: `pnpm check` exit 0. The e2e run passed (78 passed, 1 skipped, 0 failed) on a clean rerun. One earlier run had one failure: `robustness.spec.ts:161` ("a reload on every route brings the same screen back, deep links included"). It passed alone and on the rerun. The first run's error text was not captured, so the cause is **unknown**. Treat it as a possible flake and keep an eye on it.
- Gate on the local tip `850af52d`: **in progress at the time of writing. See section 10 for the result.**

---

## 5. The factory (cheap, Sonnet-only worker)

`C:\Users\shann\Documents\Codex\2026-09-28\i-x20\work\stratemark-factory` runs packaged briefs through the API key, using Sonnet or Haiku only.

- Status: `node factory.mjs status`
- Watch: `node factory.mjs watch` (a long-running background process; it dies with the session that started it, so restart it under Z Code if you want it)
- Queue: `queue/*.json`. Briefs: `briefs/*.md`. Results: `runs/<id>/final.md` and `summary.json`.
- To re-run a finished task, delete its `runs/<id>` folder.
- **Ledger:** $61.67 of $100 spent. New work stops at **$88**. The owner set the $100 cap.
- Queued at handover: `audit-research-rule9` (read-only Rule 9 audit of `packages/research/src`, $4 cap, branch `audit/research-rule9`). It writes one findings file and commits only that file. Review its output before acting on it.

Factory task that finished this session: `bughunt-redesign` (3 fixes, listed in 4d). Its report says the e2e suite was not run and nothing was checked in a browser. The gate on the local tip (section 10) covers that.

---

## 6. Demo, preview and background processes

These were run by Claude Code and **die with that session**. Z Code will need to restart any it wants.

| What | Where | State |
|---|---|---|
| Owner demo (password-protected, public quick tunnel) | `https://moscow-flood-gateway-float.trycloudflare.com`, password `omniveo`, any user name | Serves `b24ef660`, **not** the latest tip. Quick tunnels change URL when restarted. |
| Demo static server | port 4600, serving `dist-demo` | Shell `bbqrnnyba`. Restart with `serve-demo.mjs`. |
| Demo tunnel | cloudflared to port 4600 | Shell `bgqjw3rr7`. |
| Audit preview (owner clicks through this) | `http://127.0.0.1:4500`, from worktree `sm-wt-audit` | Shell `b0n3ntvve`. Refresh it with `git -C sm-wt-audit checkout --detach beta/night-tip`, then restart. |

To refresh the demo: build with `VITE_OPEN_ACCESS=true pnpm exec vite build --outDir <dir> --emptyOutDir`, then copy into `dist-demo`.

Shut the demo down when the owner says so.

---

## 7. Open decisions for the owner

These need Shannon's answer. Do not decide them yourself.

1. **Re-hunt on (reverses D6).** Figures older than 180 days are re-checked, 8 companies per refresh, with a 30-day cooldown. This is live in the research code.
2. **Valuation "current" horizon.** It is 18 months in `@mi/contracts`. The recommendation is 6 months. Unchanged so far.
3. **FOR-YOUR-AUDIT.md decisions 14 to 16** (privacy wording, the investors rule, runbook).
4. **`DeckCompare.tsx:92`.** A zero or negative bar is drawn as a 0.6% sliver. This is a visibility floor, and arguably fine, but it shows a negative as a small positive. Left unchanged because it is a design call.
5. **Whether the repo goes private.**
6. **What to do with PR #2** (beta into main). It stays open.

### Owner-only steps (agents must not do these)
- Deploy the Worker and the site.
- Connect getstratemark.com.
- Set `VITE_FEEDBACK_URL`.
- Rotate the pasted API keys.
- Open the PR or merge into integration (`merge-stack.sh` needs `gh auth login` in his terminal).
- Decide whether the repo goes private.

---

## 8. Known gaps and what is not verified

- **Logos that block pixel reads** (e.g. Together AI) keep the standard border. The brand-frame logic cannot read them.
- **Real logos were not checked live.** The logo gate was tested offline.
- **Long-title fitting** is covered by unit tests only, not in a browser.
- **Reduced motion** (fish, spin, flip) was reviewed in code, not in a live browser.
- **Layout at 390, 1280 and 1536** was checked by the layout-audit e2e and by the factory's own screenshot pass. The bug-hunt commits were not walked in a browser.
- **The owner's real decks** are in his browser at the audit preview (`:4500`). They are not on the demo link.
- **Flaky test:** `robustness.spec.ts:161`, see 4e.
- **Stale file in a worktree:** `apps/web/e2e/zz-probe.spec.ts` is an untracked leftover in `sm-wt-f-bugj`. **Do not commit it.** Delete it.
- **Memory:** the Claude Code memory notes live in a folder outside the repo, so Z Code will not see them. The useful ones are summarised below.

### Key lessons from memory (Claude Code)
- **Fix processes, not decks.** Fix the pipeline so every deck is complete. Never hand-patch a demo deck.
- **Verify on real data.** Check fixes in the live app, not only in tests. Mocks hid real bugs twice.
- **Review integrity changes independently.** Gate changes get a separate reviewer before they are called done.
- **Card layout is frozen.** Before changing the grid, diff the CSS against the pre-sprint baseline and test laptop widths.
- **Gemini grounding quota** runs out per day and resets at midnight Pacific. Plan decks around it.
- **Deck cost baseline:** a 16-company deck is about $9.7 estimated and 10 minutes.
- **Source strategy:** free official sources first, then Tavily or Serper plus grounding. The "acquired" label is approved.
- **Beta feature decisions:** Firebase is fine for shares. There is one Share & export path. Keep Compare.

---

## 9. Backups

- Bundles live in `work\backups\`. The latest bundle is `night-tip-cea4ed3c.bundle`. **`b24ef660` and later are not bundled.** Make a fresh one before you change anything:

```bash
git bundle create ../backups/night-tip-$(git rev-parse --short HEAD).bundle beta/night-tip
```

- Redesign worktrees (`sm-wt-r-*`, `sm-wt-r-int`) can be removed when the owner says so.

---

## 10. Gate on the local tip (filled in when it finished)

Gate on `850af52d`, finished:
- `pnpm check`: exit 0. Log: `C:\Users\shann\AppData\Local\Temp\claude\gate-redesign-check.log`
- Full e2e: **78 passed, 1 skipped, 0 failed**, exit 0. Log: `C:\Users\shann\AppData\Local\Temp\claude\gate-redesign-e2e.log`

Result: **green on the local tip `850af52d`**. The three newest commits are not yet on origin (section 1).

---

## 11. First steps for Z Code (verify it has eyes on the codebase)

Before the owner sends his audit, check that Z Code can see and reason about the whole repo. Ask it to do these and check the answers against this file:

1. List the monorepo packages, and say what each is for (section 1).
2. Name the integration branch and the origin tip. It should say `beta/night-tip` and `f84834a0`, and note the three local commits if they are not on origin.
3. Name the five rules that never change (section 2).
4. Run `pnpm check` from the repo root and report the exit code. It should not run `pnpm -r test` on Windows.
5. Run the e2e gate and report the result line (`N passed, N skipped, N failed`).
6. Read `packages/research/src/recency-rank.ts` and say what it does. It should mention newsroom sources and the future-date rule.
7. Read `apps/web/src/features/card/logoQuality.ts` and say how a stored verdict is validated.
8. Say where the Anthropic key is stored. It should give the path only, and never print the key.
9. Say which branch must never be pushed to.
10. Name the owner-only steps (section 7).

When it passes these, it has the codebase. Then send the audit.

If `graphify-out/` exists in the repo, Z Code can query the graph first for codebase questions: `graphify query "<question>"`, `graphify path "<A>" "<B>"`, `graphify explain "<concept>"`. After code changes, run `graphify update .` to keep the graph current.
