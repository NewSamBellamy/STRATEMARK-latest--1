# Backend Architecture Brief — handoff pack for the architecture pass

Read this first, then `docs/OCT08-AGENTIC-REVIEW.md` (diagnosis + evidence), then use
`graphify query "<question>"` for code navigation. This brief exists so an architect with
no prior context can make good decisions without re-deriving why the system is shaped
the way it is.

## What Stratemark is

A local-first, bring-your-own-key market-intelligence app built as a "collectible card
deck": you describe a market, the system rosters the real companies in it, interviews each
one, and produces a deck of sourced company cards with figures, tiers, and dashboards.
Product thesis: **every figure is a quoted, source-attributed sentence — or it is honestly
Unknown.** Unknown=null is a feature, not a gap. The trust experience is the moat; speed
and cost matter exactly insofar as they don't compromise it.

Users: pnpm monorepo — `packages/research` (engine), `packages/contracts` (shared types +
schemas; blast radius: everything), `packages/mocks`, `apps/web` (React+Vite), `apps/desktop`
(Electron, production target), `apps/api` (cloud path, secondary).

## Hard constraints (non-negotiable — proposals must respect all of them)

1. **BYOK Gemini.** The user's API key is typed into the app and used client-side; it never
   passes through a server we run, a log, or a commit. Proposals must not require a
   server-side key proxy for the core flow.
2. **Local-first.** All research persists on the user's machine: IndexedDB vault (browser)
   or SQLite via node:sqlite (desktop). No cloud copy is required for the product to work.
3. **No fabrication, ever.** Figures without surviving identity+source gates stay Unknown.
   The strict gates are the moat — do not propose loosening them into "trusting the model."
   The correct lever is *more, better-aimed attempts*, not lower standards.
4. **User-authored data is law.** Human-entered figures are never overwritten by the AI.
5. **Shared contracts are blast radius.** Changes to `packages/contracts` ripple everywhere;
   type the data model carefully before growing it.
6. **Tests stay green.** research 784 / web 267 / desktop 54 at time of writing; suites run
   individually (`npx vitest run` per package). `graphify update .` after code changes.
7. **Never push/merge main.** Work lives on `fix/zcode-identity-gate-recovery` (local, unpushed).

## Current architecture in one pass

Pipeline stations (packages/research/src/pipeline.ts):

```
interpret (1 reasoning call, gemini-3.1-pro-preview)
  → discover (1–4 grounded calls, gemini-3.7-flash; streams stub cards live)
  → hydrate per company × concurrency 3 (ground + structure on gemini-3.5-flash-lite)
      └─ gates: reportedCompanyMetrics — sentence-level identity binding (sentenceAround,
         rivalMatcher, roster guards), reportedClaim selectors, usableCitations
  → reconcile → market signal cards (barrier/insight/culture/vice agents)
  → tier review (degrades gracefully on 504) → CMS scoring → persist
```

Living deck runtime (apps/web/src/lib/living/): per-deck background loop, one action per
tick — recovery hunts (ONE per company per repo lifetime, WeakMap ledger), consistency
audit → per-metric verification (2 calls/metric), freshness decay ranking, dashboard-tab
prefetch (8 companies × 3 tabs). Budget: maxActions 60/session.

Storage seam: `ResearchStore {read, write}` — browser IndexedDB, desktop SQLite (WAL,
incremental upserts), mock, cloud. Original-source reader: fetches company websites/SEC
filings via dev loopback bridge / desktop IPC — **75% retrieval success (571/760 receipts)**.

## Measured reality (Oct 8 nuclear run, 28 companies, 17 min)

| Measure | Value |
| --- | --- |
| Metric slots | 168; filled 34 (20%), all `estimated`, **0 `verified`** |
| Original-source receipts | 571/760 retrieved (75%) |
| Companies with zero figures | 7/28 |
| Call map | ~1 interpret + 1–4 discovery + 56 hydration + ~4–8 signals + 1–2 tiers |
| Background spend | up to ~60 actions/session: hunts, per-metric verifies, prefetch ~50–70 calls |
| Known waste | duplicate decks re-pay every company; hunts ask 6 metrics in one shotgun call; prefetch warms the least-clicked tab |

Fixed this session (already on the branch): truthful narration (no fabricated "ADK
topology" status), gap-honest completion banner, metrics-aware dashboard header, and the
two last-mile summary gates — verb allow-list + legal/DBA sentence-initial alias bridge —
that were rejecting already-paid evidence (commits ba14747, 5d8f2ca).

## Open problems, ranked

1. **No cross-run company memory.** Company IDs are deliberately deck-scoped ("a new deck
   owns a scoped company ID"), so overlapping decks re-interview and re-pay for the same
   Equinix. The free projector (`savedCompanyProfile`) already exists but only repairs reads.
2. **Desks are one-shot.** One hunt per company lifetime; failure is never retried, never
   explained, never escalated. Strict gates + one shot = permanent Unknown by construction.
3. **Verification cannot reach `verified` at scale.** Per-metric verify = 2 calls; nothing
   batch-checks a company's estimates against its citations + original receipts, though
   `verifyCompanyCardOriginals` exists and receipts succeed 75% of the time.
4. **Hunts are shotguns.** One grounded call asks for all 6 soft metrics; for private
   nuclear companies half don't exist publicly → money buys rejections. Slot lists ignore
   market type (asks a fuel supplier for "users").
5. **Prefetch spend** warms Live Intel (a full news research pass) × 8 companies — the most
   expensive background work on the least-clicked tab.
6. Smaller: Generation Atomic lost its profile evidence entirely (retention gap);
   "26 vs 28 desks" stale-cache count; refresh-vs-duplicate deck UX (#19).

## The decisions we want the architect to make (frame proposals around these)

- **D1 — Desk agent loop.** Replace one-shot desks with an iterating agent per company:
  state machine or event-driven? What is the attempt budget, the outcome taxonomy (no
  candidates / identity mismatch / unit mismatch / sources genuinely don't exist), and the
  per-slot honest explanation when a slot closes?
- **D2 — Company identity + evidence cache.** Cross-run, keyed by domain/name, freshness-
  windowed. Data-model change to contracts: identity table vs evidence lookup? How does
  per-deck scoping coexist with shared company memory (the same company legitimately
  belongs to two markets)?
- **D3 — Verification pipeline to `verified`.** Batch verification per company judged
  against citations + original receipts; when does a figure graduate, when does it
  demote, and what does the UI promise once it does?
- **D4 — Hunt escalation ladder.** Per-metric targeted passes for high-value slots,
  market-type-aware slot lists, per-company lead cache feeding the original-source reader.
- **D5 — Model routing & call budget.** Ground=3.7-flash, structure=3.5-flash-lite,
  interpret=tier-review=3.1-pro-preview today. Where else does the cheap/expensive line
  belong? Should RPM pacing default on for free-tier keys?
- **D6 — Pipeline vs agent substrate.** Restructure the stations into an event-driven
  agent graph (ADK-trace observability contracts already exist in
  packages/contracts/src/adk-trace.ts), or keep the pipeline and add loops inside it?
  Bias: smallest structure that fixes D1–D4; no framework adoption without a concrete win.
- **D7 — Error/retry taxonomy.** 504 degradation and 45s hydration backoff exist; unify
  into one retry/budget story across discovery, hydration, hunts, verifies.

## Anti-goals (bloat guard)

No vector database, no agent framework adoption, no second LLM provider, no speculative
research on unopened decks, no server-side state. Every change should be re-aiming,
batching, or reusing calls the system already makes — until a measured wall justifies more.

## Where to look (fast)

- `graphify query "..."` for any code question; `graphify path A B` for relationships.
- Pipeline: `packages/research/src/pipeline.ts`, `company-agent.ts` (hydration +
  verification), `reported-metrics.ts` (the gates — read before proposing anything about
  sourcing), `repository.ts` (hunt/verify/getCompany), `dashboard.ts` (tab research).
- Runtime: `apps/web/src/lib/living/` (runtime.ts, useLivingDeck.ts).
- Storage: `apps/desktop/src/sqlite.ts`, `apps/web/src/lib/repository/`.
- Evidence: `docs/OCT08-AGENTIC-REVIEW.md` (this session's diagnosis), vault numbers above.
- Tests mirror behavior: `packages/research/src/reported-metrics.test.ts` is the gate spec.
