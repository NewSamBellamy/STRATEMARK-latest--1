# Keystone checkpoint 39 — honor explicit company-only scope

Date: 2026-10-06 local. Branch: `revival/initial-card-redesign`. Parent: `e2e381b`.

## Connected behavior

The scope interpreter now distinguishes a broad market scan from a user request to research only named companies. Exact-scope requests run one focused discovery pass, keep only results matching the requested names, and do not add unrelated competitors or expand to satisfy the market-wide minimum. If a named company cannot be confirmed, it is omitted and the deck reports the unresolved scope instead of substituting another entity. Normal market scans retain their existing minimums, role-coverage fallbacks and expansion behavior.

The original user request is explicitly carried into scope interpretation so a named-company constraint is not lost after grounded market notes are produced. Company names supplied in grounding examples are explicitly not treated as user selections.

## Verification

- Added a regression test that first failed because an unrelated OpenAI result leaked into a Meta/Anthropic-only deck, then passed after the exact-scope filter.
- Research package: 567 tests passed.
- Full `pnpm check` exited 0: workspace typecheck, lint and unit tests passed (contracts 108, mocks 15, research 567, API 278, desktop 44, web 215; 1,227 total).
- Desktop production build exited 0. Browser production build exited 0 when run sequentially. Running both builds concurrently caused a shared-output-directory collision; this was a verification orchestration issue, not a product failure. Existing Firebase chunking and large-bundle warnings remain.
- No new live-provider request was made for this code change. The earlier configured-browser run had produced an 18-company deck for a two-company request; those cards showed unknown key metrics and “Research needed.” This is evidence of the adjacent first-ready gap, not proof that this checkpoint fixes real Gemini interpretation.
- No design changes, new credentials, remote push, main merge, deployment or publication.

## Red team / remaining risks

Exact-only intent and its names are currently extracted by the LLM from free text. The output is constrained by a deterministic filter, but there is not yet a visible explicit scope selector or included/excluded-company field; ambiguous phrasing can still be interpreted as a broad market scan. Name matching accepts canonical-name suffixes such as “Meta” → “Meta Platforms,” but does not cover every alias or subsidiary relationship. The exact-scope path has fixture coverage only; a new live API call was intentionally deferred. A selected-company-only deck does not yet guarantee that its first visible card is fully researched before navigation.

## Next measurable step

Continue with the connected first-ready journey: expose an unambiguous scope choice for exact companies versus full-market discovery, then ensure the deck does not present its lead card as ready until its first evidence-backed company hydration has finished. Validate with one bounded live run and compare requested names, returned names, first-card state, evidence, timing and locally counted request deltas. Continue afterward through dossier and specialist-card outcomes; this checkpoint is not overall product completion.
