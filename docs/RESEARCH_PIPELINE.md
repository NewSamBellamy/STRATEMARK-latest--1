# Research Engine (`@mi/research`)

Turns a plain-language market brief into a deck of sourced cards. The current
production path uses **Gemini + Google Search grounding**. The provider-composition
work described in `OPEN-RESEARCH-ROADMAP.md` is expanding this into separate
intelligence-model and research-connector capabilities without requiring a
Stratemark account or hosted Stratemark service.

A Gemini key can provide both the model and native Google Search grounding; it
does not need a second search-provider key. OpenRouter and other
OpenAI-compatible model endpoints do not automatically provide equivalent web
research, so they need a configured research connector unless the chosen endpoint
explicitly returns supported citations.

## Why an agent graph

The user's framing: _"every card is a search query."_ So the engine is a typed
task graph (LangGraph-style, but dependency-free TS):

```
interpret ─▶ discover ─▶ enrich (fan-out, concurrency-gated) ─▶ score ─▶ assemble
                     └─▶ barriers ───────────────────────────────────────┘
```

| Step        | Grounded?        | What it does                                                                                                                                         |
| ----------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interpret` | ✅               | Normalize the brief + region into a market definition and search angles.                                                                             |
| `discover`  | ✅               | One grounded search enumerating the real companies/entities in the market.                                                                           |
| `enrich`    | ✅ (per company) | For each company, a grounded search fills the card: one-liner, HQ, site, the 6 metrics (each with confidence + citation), plus culture/vice signals. |
| `score`     | ⬜ pure          | The existing `computeCms` scores tiers from the researched metrics; an optional ±1 LLM review nudge (logged).                                        |
| `barriers`  | ✅               | One grounded search for structural barriers to entry.                                                                                                |

## Grounding discipline (the "no hallucination" contract)

1. Grounded steps **always** send `tools:[{google_search:{}}]` — facts come only
   from search results, never training data.
2. **Ground → Structure two-call pattern.** Grounding and JSON-schema output are
   mutually exclusive in one call, so a grounded call gathers facts +
   citations, then a cheap non-grounded call (`gemini-3.5-flash-lite`) structures
   that text into JSON, validated by Zod (`schemas.ts`).
3. Every figure is tagged **verified / estimated / unknown** with a source index
   into the grounding citations. Unsupported figures become Unknown — never
   invented. **Unsourced Vice claims are dropped.**
4. All output is Zod-validated against `@mi/contracts` before it reaches the UI.

## Usage friendliness

- Deck creation ≈ `2 + N` grounded calls (interpret + discover + N companies +
  barriers). Default `targetCompanies` keeps N modest.
- Dashboard tabs are **researched lazily** on first open and cached, so a deck of
  N companies isn't `8N` calls up front.
- Provider free tiers, included grounding allowances, and prices change. The app
  must show the selected provider and current usage terms rather than promising a
  fixed free request allowance.
- Concurrency is gated (default 2) and calls retry 429/5xx with exponential
  backoff + jitter.

## Key handling

The browser build currently stores its Gemini key in `localStorage`. Electron
encrypts the key with OS-backed `safeStorage`, but the current preload path can
return plaintext to renderer JavaScript. The target boundary is stricter:
renderer code can configure, test, and revoke a provider but cannot read a stored
secret back. Keys must never enter research records, logs, exports, URLs, or MCP
responses.

## Swapping in the backend

`GeminiRepository` implements the same `MarketIntelRepository` as the mock, so the
app switches from demo → live simply by having a key present
(`RepositoryProvider.selectRepository`). State persists through a `ResearchStore`
adapter (localStorage in web; SQLite/electron-store later).

## Model migration note

Current defaults (Aug 2026): grounded `gemini-3.7-flash`, structuring
`gemini-3.5-flash-lite`, reasoning `gemini-3.1-pro-preview`, imagery
`gemini-3.1-flash-lite-image` (Nano Banana 2 Lite, with a 2.5 fallback).
Override per-user in Settings → model override.
Standard AI Studio keys are being replaced by "Authorization keys" — regenerate an
old key if calls 403.

## Verification status

- The full orchestration (discover → enrich → citations → CMS → vice sourcing →
  barriers) and `GeminiRepository` (persist + lazy tabs) are unit-tested through a
  fake `LlmClient` (no network).
- The concrete Gemini request/response mapping was built against the live API spec
  (see the scout report) but a live end-to-end run requires a user key.
