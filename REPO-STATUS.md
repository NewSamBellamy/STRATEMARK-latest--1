# Stratemark Production Hardening — Status

Updated: 2026-10-09 (universal-deck quality pass — second autonomous session)
Branch: `fix/zcode-identity-gate-recovery` — local commits only, never pushed.

## What changed this session (newest last)

| Commit | What it fixes |
|---|---|
| `9d8b1fc` | **Universal market fit — the ghost-town fix**: `aum` is a first-class MetricType end-to-end (gate, schemas, prompts, formatting, colors, deep-dive topics, USD conversion via the frozen FX table). New market-profile module (`packages/contracts/src/market-profile.ts`): `classifyMarketProfile` reads what the company IS from name + one-liner (never model-asserted; "platform for private equity" vendors excluded), `profileMetricTypes` decides what is worth researching per profile, `PROFILE_CORE_SLOTS` drives the four card slots. AUM rows appear only when sources actually report one — no AUM noise on operating companies. |
| `8247a4a` | **Search quality is metric fit**: hunts lead with the profile's priority metric (financial firm: AUM first); local + cloud hunts and escalation passes point at where regulatory AUM lives (SEC Form ADV / adviserinfo.sec.gov). A VC deck is never billed for an "a16z ARR" search again. |
| `61dede0` | **Cascade hydration UX**: the living deck warms ALL research tabs in open-likelihood order (metrics → overview → live_intel → mission_governance → history → team_org → products_roadmap → live_landing), still one paced action per tick with hunts/verifications first in line. New `HydratingPanel` — every tab's loading state is a named "Actively hydrating" skeleton with an honest clock, never a dead spinner. Tabs reveal with a staggered cascade (prefers-reduced-motion respected). Cards whose dashboards are researching right now carry a "Dashboards hydrating" chip. Latency guard re-verified: only the user-initiated rerun ever passes force. |

## Live verification (2026-10-09, dev server, owner key)

Verified in the running app on two real decks:
- **Venture Capital Fund Management (financial)**: a16z/Sequoia/Insight/Founders Fund/Lightspeed/Accel/NEA/Bessemer cards render the financial profile — AUM slot where Users used to be, employees/valuation/revenue intact. Desks hunt AUM (feed: "hunting missing figures"); gaps stay honestly Unknown until a source clears the gate ("nothing met the sourcing bar; gaps remain unknown"). a16z metrics tab opens in ~1.7s (pure local projection).
- **Utility-Scale BESS (operating)**: Tesla ($94.8B revenue, $1.5T market cap, 134.8K employees), Fluence ($148M ARR) — original four slots, verified figures, **zero AUM mentions anywhere** in the deck.
- **Cascade UX live**: cold-opening a16z Live Intel showed the "Actively hydrating — Live Intel" panel with section skeletons, then filled in; team_org opened instantly from the warm cache; tab nav shows the background order ("Researching Live Intel · Mission & Governance…").
- Gates intact throughout: no figure appeared without a source.

Findings from live testing (documented, not fixed here):
1. **AUM landing is ladder-paced**: hunt attempt 1 on financial firms returns honest nothings until the escalation pass (10-min cooldown, Form ADV targeting) — expect AUM to fill over a session, not instantly. Watch: if escalated attempts still never land, the original-source selection for ADV/firm pages is the next lever.
2. **Multi-tab same-workspace is single-writer**: opening two decks in two tabs trips the IndexedDB revision guard ("Research was updated in another window") and background turns skip gracefully. One window per workspace until a merge layer is worth building.

## Prior session (hardening, 2026-10-09)

| Commit | What it fixes |
|---|---|
| `a63272b` | **P0 — rate pacing**: outbound calls paced at 10 grounded / 15 structured RPM (were 0 = fire-everything → 429 storms → reactive-backoff "flaky" feel). Reactive retry retained. |
| `2b2f4ac` | **P0 — reader timeout**: each original-source read is raced against 20s; a hung page degrades to an unavailable receipt instead of stalling a hunt/verification forever. |
| `01475d1` | **P0 — currency normalization**: non-USD reporters (CNY/EUR/GBP/JPY/…) can finally reach **verified**. The quote stays primary evidence in the source's currency (17 convertible codes on `passageSupport.unit`); metric rows store a USD conversion at a frozen documented snapshot (`packages/research/src/fx.ts`, exchangerate-api.com 2026-10-09) with an honest "Reported X CNY, ≈US$Y at reference rate (source); conversion is approximate" methodNote. All store sites + prompts updated. |
| `4e40597` | **P1 — passage gate reads how sources write**: accepts press verbs (posted/reached/generated/said/serves/counts) and period-end date phrasings (as at / ended / ending). Deliberately NOT loosened: multi-sentence quotes, third-party brand aliases, that-clauses (anti-smuggling rules). |
| `425bc05` | **P1 — redirect name map**: ~30 publisher names Google actually sends (Yahoo Finance, Nikkei, SCMP, Barron's, TrendForce, wires, trade press…). Unresolved redirects still show "Publisher not recorded" — that visible gap is the record for growing the table during beta. |

Earlier this branch (prior session): verified-figure promotion unblocked
(`fa5866c`), hunt retry ladder + verify cooldowns (`9350dab`), worker-timer
background ticking (`01fdaa7`), fallback-ladder reserve fix (`3cc40d6`).

## Test state

- research **827** ✅ · contracts **118** ✅ · web **270** ✅ — all green, typecheck clean.
- Run per package (`cd packages/research && npx vitest run`); do NOT `pnpm -r test` (buffers and stalls on Windows).

## P1-3 verified — no change needed

Dashboard tabs already cache correctly: `getDashboardTab` serves cached tabs
with zero provider calls (metrics tab is a pure local projection from stored
metrics + retained SEC receipts), in-flight dedupe joins concurrent opens, the
90s deadline bounds a hung pass, and only the explicit Refresh button passes
`force=true`. Cache invalidation on metric change is by design (tabs quoting
stale facts must re-research).

## Known remaining gaps (priority order for beta week)

1. **estimated lane is still USD-only** — `reported-metrics.ts` hardcodes USD
   in its claim regexes (`hasNumber`, unit derivation), so provider-reported
   *estimated* figures in native currency stay unknown until the verified lane
   fills them. The verified (protected) lane now covers non-USD. Loosening the
   estimated lane needs the same normalize-at-store treatment plus regex work.
2. **AUM landing rate on financial decks** — mechanism verified live (slots,
   hunts, gates); the open question is yield: how often an escalated hunt finds
   a gate-clearing dated AUM passage. Beta signal to watch; ADV-page original
   selection is the lever if yield stays low.
3. **FX snapshot is frozen** — correct and auditable, but rates age. If decks
   need current-rate conversions, add a refresh job that rewrites the table +
   source date (never a live lookup inside the acceptance gate).
4. **Redirect publisher names** — table will keep growing from beta traffic;
   "Publisher not recorded" is the tell.
5. **Failed-job auto-resume** needs a product decision (auto-spend on page open?).
6. **Cross-run company evidence cache** — biggest cost/speed lever; not
   competition-blocking.
7. **Multi-tab single-writer** — two tabs on one workspace conflict on the
   IndexedDB vault revision (graceful skip + honest banner). Fine for beta
   single-window use.
8. **Dashboard tab overhaul** (owner unhappy with tab value) — product work,
   untouched here; caching verified so tab latency is not the blocker.

