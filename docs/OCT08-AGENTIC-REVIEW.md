# Agentic Architecture Review — Oct 8 nuclear run

Evidence: `stratemark-nuclear-run-oct8.mp4` (owner recording) + live vault inspection of deck
`dck_advanced-nuclear-technologies-ant_ns43x` (28 entity companies, 46 cards, job completed 11:42 AM).
Every claim below is traced to code or to the stored run data — nothing is inferred from vibes.

## The run's actual yield (from the vault, not the UI)

| Measure | Value |
| --- | --- |
| Metric slots (28 companies × 6) | 168 |
| Filled (value ≠ null, ≠ unknown) | **34 (20%)** — every one `estimated`, none `verified` |
| Companies with zero filled figures | 7 of 28 (Holtec, GEV-Hitachi, Radiant, BWXT, Framatome, Urenco, Generation Atomic) |
| Best-filled companies | NuScale / X-Energy / Centrus — 3 of 6 each |
| Original-source attempts (whole vault) | 379 — **0 retrieved**, `status` field never even set |
| Metrics at `verified` confidence | **0** |
| Companies showing the "No source-backed company snapshot" fallback | 6 of 28 in ANT, 14 of 28 in the colocation deck |

A 17-minute run spent roughly one grounding call per company and produced a 20% fill rate
with zero verification. The rest of this document is why.

## Root cause 1 — There are no agents. There is a pipeline with validators.

Every behavior we *call* agentic is a single LLM call followed by a strict post-hoc gate:

- **Hydration** (`company-agent.ts`): 1 grounded pass → 1 structure pass → `reportedCompanyMetrics`
  identity gates. If the single pass's sentences don't survive the gates, the slots stay
  `unknown`. There is no second pass with a different angle, no query reformulation, no
  retry against another source class.
- **Hunting** (`repository.ts huntCompanyMetrics`): 1 grounded call asking for ALL soft
  metrics at once. For a private nuclear company, half those metrics don't exist publicly;
  the model correctly refuses, the gates reject the rest, and the hunt ends.
- **The runtime** (`useLivingDeck.ts`): one automatic hunt **per company per repo lifetime**
  (module-level `WeakMap`), one verification per (company, metric). The cost-protection is
  right; the zero-adaptivity is fatal. A failed hunt is never retried, never escalated, and
  never explains *why* it failed. The video shows the tail of this: X-Energy hunting,
  TerraPower hunted → "nothing met the sourcing bar; gaps remain unknown" → rest.

The desk metaphor promises a persistent investigator. The implementation is a stateless
one-shot with a bouncer. Strict gates + one shot = permanent `unknown`, by construction.

## Root cause 2 — The verification lane cannot succeed in this transport

`applyMetricVerification` requires verification-grade citations to corroborate an
observation. The company's own website — the strongest corroboration we have — is
retrieved by the **original-source reader, which is dead in the browser app**: 379 attempts,
0 retrieved, receipts stored with no `status` at all. The dev-loopback bridge
(`/__stratemark/source`, `local-source-reader.ts`) is the only real path, and it is clearly
not answering in the owner's environment (NuScale: 5 attempts, 0 bytes, no finalUrl).

Consequences, all visible in the video:
- `sourceBackedCompanySummary` can never return → 6 companies show "No source-backed
  company snapshot is ready yet." (the other 22 got `providerCompanySummary` sentences —
  provider-grounded, not site-backed).
- Nothing can ever reach `verified`, so the whole deck sits at Estimated/Unknown and the
  freshness engine has nothing honest to do.
- Quote provenance, original-backed product details, filing-grade corroboration — all built,
  all silently no-op.

**The product's core moat — "source-backed" — is architecturally unavailable in the
transport the owner actually uses, and the UI's only acknowledgment is a misleading
fallback string.**

## Root cause 3 — The app narrates work it does not do

- `pipeline.ts` emits a **hard-coded fabricated status**: "Discovering companies via
  3-vector Google ADK topology mapping…" — no such thing exists in the codebase (the ADK
  naming exists only as observatory contracts in `contracts/adk-trace.ts`, "orchestrated
  in-process today or handed to an ADK runner tomorrow"). In a product whose entire value
  proposition is *every claim is defensible*, fabricated self-description is a P0 trust bug.
- `NewDeckPage.tsx:734`: `{session.logLines.length} steps completed` → "1 steps completed".
- Deck completion banner, completed branch: "Background verification keeps figures fresh;
  **nothing here is still unfinished**" — hard-coded, and false in this run (134 unknown
  slots, 7 empty companies, hunts that returned nothing).
- Dashboard header shows the fallback oneLiner directly above a metrics grid showing three
  Estimated figures with hatched bars — two surfaces disagreeing about the same reality.

## Root cause 4 — Discovery narration vocabulary debt

`adk-trace.ts` names the system after Google ADK we don't run. That vocabulary leaked into
user-facing narration. Either the trace substrate gets renamed to what it is (an in-process
agent trace), or it gets wired to real phases — but user-facing copy must describe actual
steps: interpreting the brief, searching the web, verifying each candidate is a real company.

## What is actually good (keep)

- The roster: discovery produced a legitimately good 28-company ANT map (NuScale, Oklo,
  TerraPower, X-Energy, Holtec, BWXT, GEV-Hitachi, Centrus, Cameco, Urenco, Orano,
  Westinghouse, Kairos…). The discoverPrompt rewrite works.
- The gates themselves: identity binding, no fabricated verification, unknown=null honesty.
  The problem is never that the gates are too strict; it's that there's no loop that
  responds to rejection.
- SQLite persistence, corpus retrieval, finish-line banner concept, desk-feed transparency.

## Repair plan (ordered)

### Phase 1 — Truth in advertising (mechanical, now)
1. Replace the fabricated discovery narration with real step descriptions.
2. Fix "1 steps completed" pluralization.
3. Completion banner: state open gaps honestly ("figures marked Estimated/Unknown still
   have open gaps — desks keep working them in the background") instead of the blanket
   "nothing here is still unfinished".
4. Dashboard header: when estimated figures exist but no source-backed summary, say
   "Provider-reported figures on file — verification pending" instead of the blanket
   "No source-backed company snapshot is ready yet."

### Phase 2 — Make the source reader real in the owner's transport (the moat)
5. Diagnose the 0/379: is the vite dev bridge mounted? Does the desktop IPC path work?
   Does `retrieveBrowserOriginalSource` (direct browser fetch) even have a route?
6. Route: dev web → loopback bridge; desktop → IPC; plain browser → honest degradation
   (and copy that says so) instead of silent 0-byte receipts.
7. When originals land, summaries / quote provenance / verified corroboration unlock with
   zero new model work — the downstream consumers are already built and tested.

### Phase 3 — Desk agents that iterate (loops, not one-shots)
8. Hunt escalation ladder: per desk, a *plan* of K bounded passes with different angles
   (annual-report query, site-scoped query, per-metric queries for the 2–3 highest-value
   slots instead of all 6 in one call). Each pass records WHY it failed: no candidates /
   identity mismatch / unit mismatch / sources don't exist.
9. Attempt ledger keyed by outcome: transient failures don't consume the lifetime slot; a
   grounded "no public figure exists" verdict closes the slot with an honest per-slot
   explanation ("No public headcount for this private company — searched <date>").
10. Per-company lead cache: URLs discovered by any pass (hunt, hydration, verify) feed the
    original-source reader and the next attempt, so the desk gets smarter, not poorer.

### Phase 4 — Sync the vocabulary
11. Rename or wire `adk-trace` so narration, trace phases, and reality share one
    vocabulary; the feed says what actually happened, the trace records it under the same name.

### Also in the wild (from the vault, not this video)
- Two near-duplicate California-colocation decks exist (created 00:47 and 06:13, different
  market ids) — the refresh-vs-duplicate gap (#19) cost the owner a full second run.
- "26 company decks" pill vs 28 entity companies: count logic is right in the current
  vault; the video showed a stale query cache — worth a cache-invalidation look, low priority.
