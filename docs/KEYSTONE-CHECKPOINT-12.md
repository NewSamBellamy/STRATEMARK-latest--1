# Keystone checkpoint 12 — protected persisted cloud company research

Date: 2026-10-04 local. Branch: `revival/initial-card-redesign`. Previous checkpoint: `3648c62`.

## What actually changed

Persisted cloud creation now passes user/deck-scoped original services through the real ADK engine and enrichment pool into company hydration. Engine watcher growth propagates the same option into the delta agent. Scheduled refresh and authenticated `/api/research/expand` also pass those services and the actual deck ID. These routes reuse the existing metric passage gate rather than a new verification policy: save originals before interpretation, preserve supported figures, leave unsupported metrics unknown, and never use headcount/funding proxies for ARR on the protected route. Initial failures remain incomplete; refresh failures retain the existing stale-deck behavior. No card/reader design changes.

The cloud service rechecks deck ownership and active entitlement before fetching or saving originals. Scoped list access returns cloned receipts; source reads coalesce for 30 seconds without changing their recorded dates or publishing claims. No provider key is sent to public source transport. The existing bounded, DNS-pinned native transport is reused.

Company-profile attempts now append to a separate `companySourceAttempts` field, distinct from the eight-attempt metric-verification diagnostic ring. Memory writes clone inputs and preserve that field across ordinary deck replacement; Firestore uses an owner-checked transaction so parallel workers do not overwrite another company's receipt. Repeating the exact attempt is idempotent; changing an existing attempt ID is rejected. Evidence appends do not advance the published deck revision. Deck/account deletion naturally removes these embedded records with the parent.

**Retrospective correction:** previous checkpoint notes described Firestore metric-verification receipt reload as covered. Inspection and a failing serialization regression test found that the actual Firestore write payload omitted `originalSourceAttempts`, although memory verification tests passed. This checkpoint adds it to the real serializer. Do not cite the earlier memory tests as proof that the omitted field was persisted before this fix.

## Verification and red/green evidence

- Five initial API storage cases failed before implementation: missing services and the omitted Firestore field.
- Four real-engine/watcher cases failed before wiring: unsupported numeric publication, proxy ARR, publishing despite failed original writes, and unprotected watcher growth.
- Four real-worker/action cases failed before wiring: initial research, failed storage, scheduled delta refresh and authenticated expansion. All use a fake provider, not a mocked engine.
- Four further storage cases cover Firestore adapter reload/transaction ownership, document capacity failure, deletion without parent recreation and counting preserved receipts during later deck replacements. The last case failed before the additional composed-payload size check: omission from the incoming replacement bypassed the memory limit. Both stores now check the resulting payload, not just the incoming snapshot. Total: seventeen added fixture tests. The supported-engine fixture was corrected to include a real receipt's required HTTP status/hash; the acceptance policy was not weakened. Its TypeScript literal type was corrected before the full gate.
- Final `pnpm check` exited 0: types, lint and all workspace unit suites passed (contracts 92, mocks 15, research 368, desktop 33, API 221, web 139). An earlier full gate passed backend suites but failed the previously recorded "Back to card" journey; the unchanged isolated journey passed, then the final full gate passed. UI code, test assertions/timeouts and runner configuration were not changed. Its root cause remains unresolved. Credential-dependent live tests are NOT RUN when their bodies return early without a key. This checkpoint has no live Gemini accuracy audit, deployed Firestore/emulator test, browser recording, installer test or measured end-to-end latency gain. No new dependency or shared `@mi/contracts` changes.

## Important limits / next work

1. Embedded company originals are an interim persistence boundary, not a scalable evidence vault. Attempts are capped at 64 KiB; append fails closed above an 800,000-byte serialized parent budget, reserving headroom below Firestore's 1 MiB limit. Existing card/dashboard growth can independently hit the parent limit. There is no evidence eviction to disguise successful publication. Move artifacts to separately indexed local/cloud storage with lifecycle/export tests before long-running large decks; do not market this as million-user readiness.
2. Synchronous BYOK cloud compute and browser-only research still do not have this durable acceptance boundary. Do not make BYOK depend on a subscription or silently save free users' research to cloud. Design receipt delivery plus confirmed local persistence before publication for that path. Existing completed decks are not reverified or migrated.
3. The gate is mechanical passage support, not semantic truth. Identity-bound official domains, company/metric-specific source targeting, comparable periods/definitions, claims in narrative/location/branding, executive photos and specialist reports remain unfinished. The first two sources/one bounded window can miss disclosures. More unknowns alone are not proof of better research quality.
4. A real small Gemini audit needs a securely configured key. Never extract encrypted desktop credentials. Compare supported, unavailable and conflicting examples; measure time to first accepted card, source coverage and call/token counts separately.
5. Cross-delivery job leases, cancellation/deletion races after entitlement checks, queued checkpoint error handling, accepted-fact history, and complete delta concurrency are not solved here. Watcher wiring is not an always-on Card Scout scheduler. New deterministic cohort scoring, provider combinations, MCP and complete dossiers are still pending.
6. Previous intermittent "Back to card" navigation failures remain an open root-cause investigation; a later passing gate alone does not fix them.

Next bounded pass: close the free/BYOK receipt-to-local-persistence boundary, then improve canonical source targeting and run a small live evaluation. Avoid additional agent/ranking scaffolding while visible research paths still disagree.

Local exploration checkpoint only. Main and unrelated files preserved; GitHub backup is not confirmed.
