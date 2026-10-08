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
| Original-source receipts (whole vault) | 760 across 380 attempts — **571 retrieved (75%)**; 155 "not a readable public page", 20 timeouts (status lives per receipt, not per attempt) |
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

## Root cause 2 — The last-mile summary gate rejected the evidence we already had

**CORRECTION (same day):** the first version of this section claimed the original-source
reader was dead ("0/379"). That was a schema misread by the review itself — status lives on
each receipt inside an attempt, not on the attempt. The true numbers: **571 of 760 receipts
retrieved (75%)**, including `www.nuscalepower.com` itself, HTTP 200, three separate times.
The reader is NOT the problem.

The actual killer was `providerCompanySummary` (reported-metrics.ts), the gate that turns
retained grounding evidence into a sourced one-liner:

1. **Verb allow-list too narrow.** `builds|provides|develops|operates|offers|makes|sells|is
   a|is an` — NuScale's retained evidence opens with "NuScale Power Corporation **designs
   and commercializes** proprietary small modular reactor (SMR) nuclear technology…", which
   failed on one missing word while weaker sentences passed. Fixed: the list now includes
   designs/manufactures/commercializes/delivers/specializes/focuses/serves and "is
   headquartered".
2. **Sentence-initial alias gate couldn't bridge display→legal→DBA names.** Deck names mix
   forms ("BWX Technologies, Inc. (BWXT)", "Radiant Nuclear (Radiant Industries, Inc.)")
   while grounded answers open with the form the source used ("BWX Technologies, Inc. is a
   nuclear engineering…", "Radiant Industries, Inc. is headquartered…"). Fixed: the
   sentence-initial gate now accepts the legal form and the parenthetical DBA as aliases —
   still sentence-initial, still literal, still cited, so the anti-fabrication anchor holds.

Replayed against the real vault evidence: the fixes give 3 of the 6 fallback companies
(NuScale, Holtec, GEV-Hitachi) a real sourced one-liner, plus Radiant and BWXT once the
alias bridge is counted. Generation Atomic has no retained company_profile evidence at all
(a separate retention question, tracked for Phase 3).

The verification lane still never reached `verified` in this run (0 of 168) — but the
reason is now Phase 3 territory (one-shot verification attempts, no retry after the first
unverified verdict), not a dead source reader. Quote provenance, original-backed product
details and filing-grade corroboration are fed by 571 working receipts and were starved by
the same last-mile gates, not by a dead transport.

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

### Phase 2 — Make the last mile of source-backed output work (DONE, corrected scope)
5. ~~Diagnose the 0/379~~ → **Corrected: the reader works (571/760 retrieved).** The real
   killers were the two `providerCompanySummary` gates above; both fixed with regression
   tests built from the real vault shapes.
6. Transport audit (remaining, low priority): the bridge works in dev; the desktop IPC path
   and plain-browser degradation deserve a verification pass of their own — the vault shows
   155 "not a readable public page" failures that are SPA/JS-shell sites, plus 20 timeouts.
7. Generation Atomic lost its company_profile evidence entirely — check evidence retention
   during hydration (tracked into Phase 3's hunt work, since hunts re-retain evidence).

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
