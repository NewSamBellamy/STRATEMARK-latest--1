# Keystone checkpoint 41 — explicit company scope from screen to worker

Date: 2026-10-06 local. Branch: `revival/initial-card-redesign`. Parent: `7be157a`.

## Connected behavior

The New Deck screen now offers a small “Whole market” / “Only these companies” choice. Exact mode reveals a one-company-per-line field (1–30 unique names); the research action stays disabled until both the question and a valid list are present. The chosen mode/list is sent as structured scope rather than relying on the model to infer the user's intent. Both modes override the generated plan in local and queued cloud execution: “Whole market” prevents an accidental exact-only interpretation, and exact mode prevents unwanted market expansion. On a failed start, the entered request is restored for retry. Successful creation returns the form to the whole-market default.

Whole-market behavior remains the default. Company names are not truncated or comma-split: commas may be part of a legal name, so line breaks are the delimiter.

## Verification

- Local research regressions prove both explicit modes override contradictory model plans: exact scope filters an unrelated company, and whole-market mode does not accidentally narrow to named examples.
- Cloud creation-to-worker regressions prove both explicit choices override the submitted plan and arrive at worker execution.
- Browser transport regression proves the selected-company scope is sent in the cloud request body.
- Focused regressions passed; full `pnpm check` exited 0 with 1,230 tests across the workspace.
- Desktop and browser production builds both exited 0, run sequentially. Existing Firebase chunking and >500 kB bundle warnings remain.
- Manual local preview check confirmed the control, one-per-line field, validation, and research action state. No research request was submitted and no provider spend was incurred.
- No design redesign, credentials, deployment, publication or remote push.

## Red team / remaining risks

The UI and deterministic scope contract are now in place, but this does not yet prove a live provider returns only the selected entities. Exact entity aliases, parent/subsidiary matching, partial resolution and a clear report of unresolved names need acceptance tests. Up to 30 exact names are technically allowed, though this may be expensive; explicit request/cost confirmation and smaller useful defaults need review. A live bounded comparison has not been run. Whole-market coverage is unchanged. Cloud still opens its asynchronous deck while the worker is running; this checkpoint does not prove that the cloud user sees a researched lead card before entering.

## Next measurable steps

1. Run one bounded live exact-scope comparison (two named companies), only after confirming the configured local key is available without inspecting its value. Capture requested/returned names, unresolved names, evidence-backed facts, first-card latency and local request deltas; no background watch.
2. Close the entity-resolution edge cases and define what happens when one requested name is unavailable, ambiguous or actually a subsidiary.
3. Make first-ready/researching/unavailable states understandable in the visible card/deck flow; test local and cloud separately.
4. Continue into a useful coherent company dossier: retain accepted evidence and surface sourced figures and products/roadmap consistently across card, reader and deeper dashboard.
5. Keep building the remaining Sentinel/Scouts, specialist reports, scoring, provider stack, local vault/MCP and production journeys from the delivery map; do not stop after this UI slice.
