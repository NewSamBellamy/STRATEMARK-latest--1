# Keystone checkpoint 17 — honest connected metric checks

Date: 2026-10-05. Branch: `revival/initial-card-redesign`. Approved card aesthetic unchanged.

## What changed

- Anchored company metric Fact-check now calls the protected repository verification/write-back directly. It no longer first presents a summary-only model verdict or triggers a second hunt through an effect. Narrative checks remain read-only legacy checks, not certified facts.
- Unreadable originals produce an explicit Unverified outcome, with no renewed-evidence claim. Human-reviewed values remain protected. Transport failures offer a manual retry; unsupported transports do not silently fall back to weaker checks.
- Quantitative dashboard tiles and KPIs reuse the card's read-only provenance projection. Unsupported legacy figures cannot regain a Verified badge simply by opening the dashboard. Estimates remain visible and labeled Estimated there; card fronts intentionally reserve their core figures for confirmed evidence. Invalid negative values and unestablished automatic zero users become unknown without rewriting legacy rows.

## Real application observations, not fixture accuracy claims

- Launched the current development desktop after its Electron runtime became available. Two native capture attempts failed (frame/window capture timeout); native key status and accepted-source verification could not be inspected. No credentials were extracted or copied.
- The normal browser preview showed an already connected Gemini key. The existing saved Frontier AI Laboratories deck was used, not a new full census. Its automatic deck research was paused while inspecting it. The dashboard has an independent automatic tab-warming loop, so this was not an isolated provider-spend benchmark. Exact requests/dollars are not measured.
- The existing card/reader marked several OpenAI figures unknown while the old dashboard called them Verified. The old employees check presented Supported based on a generated summary and linked search results, without accepted original-page corroboration. This does not establish the figure's truth.
- After the fix and browser rebuild, a real employees Fact-check returned: "No readable original source was available to verify this figure. The existing value has not been replaced." The UI explicitly said the attempt did not renew its evidence and offered Retry verification. The existing figure remained an estimate, not a newly confirmed fact. Screenshot: [live unavailable result](evidence/checkpoint-17-live-unverified.png).
- Card reader to full dashboard navigation worked in the actual browser. Live supported public-company correction and native original-source coverage remain NOT VALIDATED; do not claim these completed.

## Verification

Tests first reproduced the weaker anchored route and the raw dashboard Verified mismatch. Added eight FactCheck tests and three MetricsTab tests, with existing card projection coverage retained. Final `pnpm check` exited 0: workspace types/lint and contracts 92, mocks 15, research 406, desktop 33, API 221 and web 165 tests reported passing. Three credential-dependent research audits self-skipped: NOT RUN as live audits. Existing warnings remain.

Browser production compilation passed before the live protected check. Final `pnpm build` (desktop main/preload and renderer) and `pnpm --filter @mi/web build` (normal browser bundle restored) both exited 0. Existing Firebase import and large-chunk warnings remain. `git diff --check` passed. The React review kept research initiation in the explicit click handler instead of an effect-driven second hunt; no component aesthetic was redesigned.

## Red-team / next bounded work

1. Improve original-source access and inspect unavailable reasons through the intended native capability. Browser CORS/grounding redirects still prevent useful accepted-source coverage. Do not weaken acceptance to make the cards look complete.
2. Scope extraction/cache identity to the canonical company and metric, with explicit period and definition. A division such as Google DeepMind must not inherit parent workforce figures without a declared basis. This identity risk was observed, not independently adjudicated.
3. Add durable pause and explicit bounded research controls shared across deck runtime and dashboard warming; pause currently does not cover both or survive route remounts. Prevent accidental background BYOK spend before larger live tests.
4. Old accepted records, narrative checking and synchronous API BYOK still need audit. A recognized source URL is not proof of the claim. This checkpoint aligns existing projection rules; it does not independently validate every legacy value, source, tier or chart.

No new provider fleet, ranking algorithm or connector scaffolding. No visual redesign, production readiness claim, broad paid census, deployment or merge to main. This is a local checkpoint until a verified GitHub push exists.
