# Keystone checkpoint 40 — wait for the first researched company card

Date: 2026-10-06 local. Branch: `revival/initial-card-redesign`. Parent: `8da745c`.

## Connected behavior

Creating a researched deck now waits until the first company card finishes its initial hydration, is persisted, and is emitted through the existing progress/event path. That researched company is moved to the first position within its own deck without changing the relative order of other decks or remaining cards. The rest of company research continues in the background, so the user does not wait for the full market census before entering the deck. If every company task fails or persistence/background work fails before that first card is ready, deck creation rejects instead of reporting an empty shell as ready.

This is a first-useful-card gate, not a promise that every requested metric will be available. Missing/unverifiable metrics must remain unknown; the remaining UI work must explain the difference between “research still running,” “source unavailable,” and “no verified figure.”

## Verification

- A gated regression test reproduced the old behavior (deck creation returned before the first company pass completed), then verified the method waits for the lead card while other company work remains pending.
- Research package: 567 tests passed across 40 files.
- Full `pnpm check` exited 0: workspace typecheck, lint and tests passed (contracts 108, mocks 15, research 567, API 278, desktop 44, web 215; 1,227 total).
- Desktop production build exited 0; standalone browser production build exited 0, run sequentially. Both required an elevated shell because the restricted Windows sandbox denied Vite access while resolving the monorepo root. Existing Firebase chunking and >500 kB main-bundle warnings remain.
- No new live-provider request, paid Gemini call, design change, remote push, main merge, deployment or publication.

## Red team / remaining risks

The first company that finishes hydration becomes the lead card; this is completion order, not a ranking of company importance. First-ready can still mean that all headline metrics are honestly unknown, and no explicit UI has yet been added for that state. Exact-company interpretation is still LLM-derived behind deterministic result filtering, with no visible scope control. This repository test validates the local research path; it does not prove cloud first-ready parity, live Gemini quality, logo accuracy, metric acceptance, or production latency. App package build warnings and large initial bundle remain release concerns.

## Next measurable steps

1. Add a visible, explicit “only these companies” versus “discover the whole market” scope control, preserving company selection through review and research.
2. Make the first-ready state legible in the deck/card UI: researched facts versus still running versus specifically unavailable/unknown, without displaying placeholder numbers as facts.
3. Run one bounded configured Gemini acceptance journey for a two-company request; record requested/returned names, first-card useful evidence, evidence provenance, time to first card and local request deltas. Stop if the UI/key cannot be used safely; do not start continuous research.
4. Verify equivalent first-ready behavior in the authorized cloud path or document its current contract and gap.
5. Continue into a coherent company-dossier slice (canonical sourced figures, products/roadmap and a useful detail view) before multiplying Scout agents. Keep the nine-area delivery map active through specialist reports, ranking, providers, local vault/MCP and release.
