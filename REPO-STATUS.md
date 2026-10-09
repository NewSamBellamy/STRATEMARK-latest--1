# Stratemark Production Hardening — Status

Updated: 2026-10-09 (autonomous hardening session)
Branch: `fix/zcode-identity-gate-recovery` — local commits only, never pushed.

## What changed this session (newest last)

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

- research **825** ✅ · contracts **110** ✅ · web **269** ✅ — all green, typecheck clean.
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
2. **FX snapshot is frozen** — correct and auditable, but rates age. If decks
   need current-rate conversions, add a refresh job that rewrites the table +
   source date (never a live lookup inside the acceptance gate).
3. **Redirect publisher names** — table will keep growing from beta traffic;
   "Publisher not recorded" is the tell.
4. **Failed-job auto-resume** needs a product decision (auto-spend on page open?).
5. **Cross-run company evidence cache** — biggest cost/speed lever; not
   competition-blocking.
6. **Dashboard tab overhaul** (owner unhappy with tab value) — product work,
   untouched here; caching verified so tab latency is not the blocker.
