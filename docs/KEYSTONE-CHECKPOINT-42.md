# Keystone checkpoint 42 — truthful first-card summaries and official-source coverage

Date: 2026-10-06 local. Branch: `revival/initial-card-redesign`. Parent: `47aba27`.

## Connected behavior

- Exact selected-company discovery no longer discards a requested company merely because it is correctly classified as infrastructure rather than the default company role.
- Company snapshots on the first card and in the reader are now literal qualitative sentences from a retained official-domain original. Model paraphrases, third-party copy, numeric claims, and unsupported superlatives cannot become the snapshot. If no eligible sentence exists, the UI says the snapshot is not ready instead of inventing one.
- When grounded search omits the discovered official domain, initial company hydration now reads that domain as one of the existing two original-source reads. It does not increase the source-read or provider-call budget. If search already found an official source, existing source-priority behavior is preserved.
- The card reader no longer labels the explicit “snapshot not ready” state as an absent citation receipt.

## Verification

- Regression tests cover literal official-source summaries, rejection of third-party/model prose, the two-read official-domain fallback, exact selected-company role preservation, and the reader’s explicit not-ready state.
- Focused research tests passed (42 tests); focused card-reader tests passed (8 tests).
- Full `pnpm check` exited 0. Desktop production build and browser production build both exited 0, run sequentially.
- Build still reports the existing Firebase mixed-import warning and oversized main JavaScript chunk. This checkpoint does not claim bundle optimization.
- A bounded live Gemini exact-scope run earlier in this sequence returned both requested entities with the correct entity categories: Anthropic under Company and Microsoft under Infrastructure. The Microsoft card was initially hidden by the default Company tab, and its deeper overview retained no eligible original evidence. That observation predates this official-domain fallback; the fallback itself has not yet been live-validated. Exact paid-call count and dollars were not exposed, so no cost claim is made.
- No deployment, main merge, or credential access.

## Red team / remaining risks

- “Unknown” remains accurate but the live Microsoft dashboard was not useful: it had no accepted figures and no retained overview quote. The fix only reserves a bounded initial company-profile read; a successful HTTP read still may not yield an eligible sentence, and this does not solve overview evidence acquisition.
- The official website/domain itself can be wrong or stale when discovery misidentifies an entity. The domain is a prioritized source lead, never proof; source-origin and entity matching checks remain mandatory.
- The live run showed a discoverability issue: an exact selected entity classified as Infrastructure is not visible while the Company role tab is selected. Current explicit categories are accurate, but a better “all selected companies” entry view is still needed.
- User-owned dirty files were preserved and excluded: `apps/desktop/vitest.config.ts`, `.pnpm-store/`, and `docs/KEYSTONE-CATEGORY-BASELINE.md`.

## Next measurable steps

1. Run one bounded live acceptance for the official-domain fallback; record which source receipts were retained, whether the first card earned a literal snapshot, and whether the exact company is findable in its category. Do not enable background watch.
2. Diagnose the empty dashboard by inspecting persisted attempt outcomes, distinguishing retrieval failure, source eligibility rejection, and extraction rejection. Keep these failure reasons visible to the user without treating failed attempts as citations or proof.
3. Complete one coherent company dossier from the card through overview, core figures, product/roadmap and source-reopen paths. Measure accepted evidence coverage and first useful result, not just a non-empty screen.
4. Then continue the whole-product sequence: specialist reports/cards, Sentinel and durable per-company Scouts, defensible ranking, provider/key coverage, local vault and scoped MCP actions, and release journey. Do not stop at this checkpoint.
