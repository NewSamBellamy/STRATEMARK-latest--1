# Keystone checkpoint 43 — explain source acquisition outcomes

Date: 2026-10-06 local. Branch: `revival/initial-card-redesign`. Parent: `57d229c`.

## Connected behavior

- The company overview now returns a small, sanitized diagnostic envelope alongside its content and citations: original-read host, retrieval outcome, HTTP status when available, eligible-source count, and accepted-excerpt count.
- Diagnostics flow through the shared repository contract, local repository/cache rendering, cloud API response, and cloud web adapter to the existing dashboard source panel.
- The dashboard distinguishes blocked/unavailable reads, pages retrieved but excluded by source policy, and eligible pages that produced no accepted excerpt. A successful page read is explicitly not claim verification.
- Only the hostname and transport outcome are exposed. Raw URL paths/query strings, page text, and adapter error messages are not returned. Failed reads do not become clickable citations or affect source counts.

## Verification

- Focused research, API, web UI, and cloud transport regressions passed.
- Full `pnpm check` exited 0 across typecheck, lint, and workspace tests.
- Desktop production build and browser production build both exited 0, run sequentially.
- Builds retain known Firebase mixed-import and >500 kB main-chunk warnings; no bundle-size improvement is claimed.
- No new live provider call, deployment, main merge, or credential inspection.

## Red team / remaining risks

- Diagnostics explain acquisition and selection, not source truth. Only overview returns this diagnostic envelope so far; other company sections may still show a generic empty-source message.
- Counts describe retained originals available to the overview renderer. They do not measure independent corroboration, source freshness, total web coverage, or claim acceptance across the entire dossier.
- A hidden or cached dashboard will show new diagnostics only when its research result is refreshed or recomputed from retained originals. This slice does not add a background run or spend.
- The exact-scope Gemini result and Microsoft empty-evidence dashboard remain the only live journey evidence; the official-domain first-card fallback from checkpoint 42 has not been exercised in a new live deck.

## Next measurable steps

1. Make one small live exact-scope company run to validate checkpoint 42’s official-domain read and confirm the new overview source checks appear from actual retained outcomes. Record request/call deltas only if the app exposes them; do not estimate dollars.
2. If the first card still lacks a useful sourced snapshot, inspect its retained attempt outcomes and fix the actual source-read, eligibility, or extraction failure before broadening research or loosening evidence gates.
3. Finish one end-to-end company dossier: card → simple reader → source-backed overview/core figures → Products & Roadmap → close/reopen, with meaningful accepted evidence and explicit unknowns.
4. Continue through specialist research, durable Sentinel/Scout lifecycle, universal ranking, provider/key stack, local vault/MCP action boundary, share/export, and production release. Keep checkpointing sections; do not stop after this slice.
