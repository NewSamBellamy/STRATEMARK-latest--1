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
