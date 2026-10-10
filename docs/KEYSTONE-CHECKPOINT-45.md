# Keystone checkpoint 45 — targeted company-overview source enrichment

Date: 2026-10-06 local. Branch: `revival/initial-card-redesign`. Parent: `a3095c0`.

## Connected behavior

- When existing/retrieved eligible originals produce no accepted overview excerpt, the research path may make one targeted discovery call for a concise company/about/product page. Any additional reads use only the unused part of the existing maximum-two-page budget; there is no retry loop.
- Every proposed passage must still be an exact quote from a retained, eligible original. Figures remain code-projected from typed evidence; the model cannot supply or upgrade them.
- If the fallback read is blocked/unavailable or contributes no new eligible text, source outcomes are retained and synthesis is not repeated over unchanged material.
- If targeted discovery fails, the existing honest overview remains available. If one parallel source adapter throws, its generic sanitized unavailable outcome is saved while successful reads are preserved.
- The opt-in native acceptance now exercises public-source retrieval, persistence, a fresh `GeminiRepository` overview, and cold reopen for Microsoft and Anthropic. Its deterministic client makes no external model calls and proposes no claims, so it verifies honest Unknown/diagnostic behavior—not live Gemini usefulness.

## Verification

- Focused company-overview suite: 27 tests passed.
- Full `pnpm check` exited 0: workspace typecheck, lint, and all unit suites. Research: 578 tests; web: 221; the full workspace gate completed successfully. The optional live Gemini/search benchmark tests were skipped because no test-process key is configured.
- Opt-in `STRATEMARK_LIVE_SOURCE_ACCEPTANCE=1` passed: both public company/about pages retrieved, persisted and reopened; repository overview diagnostics remained available and unsupported employee figures stayed Unknown. No per-company API cost or native Gemini call was measured.
- Desktop production build passed. Browser production build passed. Existing Firebase mixed static/dynamic import warning and >500 kB main-chunk warning remain; no installer build is claimed.
- No key inspection, deployment, main merge, push, or production-readiness claim.

## Red team / remaining risks

- The native reader/repository path is exercised, but the actual Electron UI with the user's configured Gemini key still was not launched in this environment. The browser preview cannot prove that native Gemini journey.
- The deterministic live acceptance shows that retrieval and truthful unknowns survive reopen; it does not prove that the provider can select a useful passage or establish an accurate metric.
- This fallback intentionally adds one optional grounding call in the empty-excerpt case. It is bounded, but can add latency and provider spend; the application does not expose a reliable paid-call cost counter.
- Production bundles still carry known Firebase import and large-main-chunk warnings. Complete dossier coverage, durable Scout jobs, specialist stories, evidence-aware ranking, provider alternatives, local-vault/MCP actions, release packaging, and full visual journey remain open.

## Next measurable steps

1. If a native desktop window and the existing key are available, run one bounded public/private company journey through card, reader, overview, Products & Roadmap, refresh, and reopen. Measure accepted facts, unknown reasons, elapsed time, and calls only when actually observable.
2. If the native window remains unavailable, continue with the next independent high-value company dossier or Scout-resilience slice; do not repeat the known blocked browser-only fetch.
3. Continue through the entire delivery map and save the next coherent verified section locally. Do not stop because this checkpoint is complete.
