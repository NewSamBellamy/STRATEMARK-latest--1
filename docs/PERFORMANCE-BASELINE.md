# Performance baseline — template + instrumentation guide

Date: 2026-10-07. Purpose: every speed claim after this document is a
before/after against measured numbers. Live numbers require ONE real run with
a funded Gemini key (execute during the release acceptance checklist's core
journey, §2 of OCT07-RELEASE-ACCEPTANCE-CHECKLIST.md).

## What the app now measures (built in, no extra tooling)

| Metric | Where it appears | Source |
|---|---|---|
| Discovery wall time | Run log: "Found N entities · Xs" | `createResearchedDeck` checkpoint |
| Per-company hydration | Run log: "+ Company card: NAME · M metrics · Xs" | `hydrateOne` in the repository |
| Total deck time | Run log: "Deck research completed · Xs total · R retries · Ss rate-limited" | Completion checkpoint + client metrics aggregate |
| Per-call latency decomposition | `LlmClient.metrics?.()` aggregate + `onCallMetrics` hook: `queuedMs` (rate-limiter wait), `requestMs` (dispatch+parse), `retryWaitMs` (429/backoff sleeps), attempts/retries | `packages/research/src/gemini.ts` and `genai.ts` |
| Day-level pacing pain | Usage meter (`retries`, `rateLimitedMs` in `mi.usage.v1`) | `apps/web/src/lib/usage.ts` |

## How to capture the baseline

1. Open the app on a fresh profile, enter the key, note the daily usage
   counters (Settings) before starting.
2. Create one exact-scope 2-company deck and one full minimum-coverage deck.
   Save the complete run logs from the New-Deck screen (copy the text).
3. After each run, record here: time-to-first-card, total time, retries,
   rate-limited seconds, calls by kind (usage meter).
4. Re-run the same two decks on a warm cache; record reopen times.

## BASELINE — FIRST LIVE RUN ON THE IMPROVED PIPELINE (2026-10-08, owner key)

Run: "AI data center infrastructure companies in California", Local Engine, browser preview, targetCompanies=3 (discovery overran to 14).

| Measure | Result |
|---|---|
| Launch → deck open | ~6-7 min for 14 discovered / 10 hydrated |
| First card | ~64 s (Colovore 62s, CoreSite 64s, STACK 52s per-card) |
| Evidence retained | 12 records (1 per hydrated company) |
| Figures landed | Digital Realty $66.07B valuation + $68B market cap (identity repair LIVE), STACK $25B + 1,045 employees, Vantage 1,300 employees, Together AI 350 |
| Signal cards | 11 (barrier + insight sets) |
| Empty hydrations | 5/10: Equinix (Fortune 500 — worst miss), CoreSite, Prime, Lambda, ECL |
| Never hydrated | 4 tail companies (Evocative, California Resources, OpenAI, Anthropic) with cards in deck but 0 evidence |
| Scope misses | OpenAI + Anthropic (not data-center companies), California Resources (oil company) |

RED-TEAM LIST (priority order):
1. Equinix empty: evidence retained but extraction recovered nothing — the identity gate or the model proposal failed on a Fortune-500 company with abundant public data. Trace like the Phase-1 Equinix-style investigation.
2. Tail companies never hydrated (4/14): the last selection batch's stubs did not reach the pool — check the discoveryDone race and the catch-up path's trigger condition.
3. Discovery precision: non-market companies in the census (OpenAI, Anthropic, an oil company). Discovery prompt/structure needs a scope constraint.
4. Colovore "31 employees": suspect extraction (possibly facility count misread). Verify the quote in evidence.
5. "Automatic research deferred — waiting for initial deck research readiness": the living runtime did not self-heal the empty cards after completion; the deferred gate needs to release once creation ends.

## Baseline — 2-company exact-scope run (2026-10-05, pre-instrumentation)

The only pre-instrumentation measurements, from the recorded recovery run:
~64 seconds to first card. Per-stage breakdown was not captured — this is
exactly the gap the instrumentation above closes. Fill the table on the next
live run and delete this note.

| Stage | 2-company exact | Minimum-coverage deck | Warm reopen |
|---|---|---|---|
| Time to first card | TBD | TBD | n/a |
| Total time | TBD | TBD | n/a |
| Retries / rate-limited | TBD | TBD | n/a |
| Calls (ground/structure) | TBD | TBD | 0 |

## Non-goals

- No latency guarantees: at 8 RPM the floor for N entities is N ground calls
  ≈ N/8 minutes of pure pacing, before model latency (~12–35 s per company).
  Claims below that floor are false by construction.

## Second full run — AI data-center colocation, California (2026-10-07/08)

Healthiest run yet: 28 companies discovered, all 28 hydrated (no stranded
desks), 76 evidence records, Equinix ARR independently SEC-verified from the
10-K. Defects the vault audit surfaced, with root causes:

1. **Truncated grounding fragments ate real figures.** The provider's support
   spans are sub-sentence fragments ("holds a public market capitalization of
   $100.98B…" with the subject "Equinix, Inc." outside the span), so
   subject-anchored identity binding failed closed on the company's own
   reported employees (13,716) and market cap ($100.98B). Additionally the
   annual_revenue basis pattern rejected the standard 10-K phrasing "total
   consolidated annual revenues" (modifier-first + plural), and bare date
   integers ("December 31, 2025 (comprising 5,917 employees…)") registered as
   competing employee counts, making recovery ambiguous. Fixed together:
   sentence-bounded expansion of fragments from the retained answer text
   (never crossing paragraphs/lines, anchored on the provider's own
   startIndex), the plural basis pattern, and a digit-bridge rejection in
   hasNumber. Regression fixture: real vault answer + supports
   (packages/research/src/equinix-live-fixture.ts).
2. **Runaway verification loop (cost).** Trace3's ARR ($3B vs $1.65B
   valuation) kept triggering the consistency audit; consistency targets
   bypassed the freshness cooldown, so the living deck re-verified it every
   ~10s tick — 23 identical grounded calls in 15 minutes. Fixed: one
   automatic verification per (company, metric) per repository lifetime; a
   changed figure re-opens the slot once.
3. **Off-brief roster entries** (OpenAI, Anthropic, an oil producer): the
   discovery prompt hard-coded "do not omit obvious leaders such as OpenAI,
   Anthropic, or NVIDIA" into every scan. Prompt rewritten: leaders scoped to
   THIS market with verification against the vertical, plus an explicit
   exclude-buyers/adjacent-giants instruction. A static giant-name denylist
   was prototyped and rejected: pinned tests correctly admit the giants for
   frontier-AI-lab markets, and the live brief itself contains "AI", so token
   matching cannot read intent in either direction.
4. **Conflicting estimates picked stale** (Colovore: PitchBook 31 employees
   chosen over the answer's own dated Revelio/Tracxn 73–78): the shared
   metric contract now instructs preferring the most recent explicitly dated
   estimate, never averaging or defaulting to oldest/smallest.

Residual, unfixed: identity dedupe can still merge cross-pass variants only
via suffix hardening (lp/llp/pbc/gmbh/sas/trust/labs/technologies added);
speculative descriptor-level scope matching remains prompt-enforced.
