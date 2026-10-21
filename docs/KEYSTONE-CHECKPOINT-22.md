# Keystone checkpoint 22 — stop wasting bounded original reads

Date: 2026-10-05. Branch: `revival/initial-card-redesign`.

## Implemented

The shared original-source selector excludes HTTP and nonstandard TLS-port URLs before allocating its two read slots. Both existing readers already reject those URLs. It also treats fragment variants and explicit default-port variants as one page, while keeping distinct query strings distinct. Original citation URLs and input data are preserved; no HTTPS URL is invented. This applies through the existing initial-company, local/native/browser verification and persisted-cloud verification callers.

Two regression tests failed for the exact wasted-slot cases before their respective fixes. The change lives in the existing module: no new service, provider, schema, cache, UI or model call. Security checks and numeric acceptance remain unchanged.

## Native journey / honest blocker

The desktop production build passed before this fix and the built Electron app was launched. Window discovery subsequently found `Stratemark — Card Lab`. Native text inspection returned only shell/menu nodes, not the application controls. Screenshot capture timed out; window discovery was refreshed and one capture retry also timed out. Stopped native UI automation at that point. This is a capture/inspection blocker, not proof that the app is blank or broken. The earlier startup concern was resolved by finding the window; no startup fix was made.

No configured key was inspected, extracted, copied or used for a research request in this checkpoint. No real accepted figure, native save/reopen journey, full-deck accuracy, latency improvement or recording was verified. Existing user data and unrelated work remain untouched.

## Verification

- Final `pnpm check` exited 0: types, lint and all workspace unit suites passed (contracts 92, mocks 15, research 421, desktop 33, API 224, web 182). The first gate caught missing required titles in the new query-string test fixture; corrected those fixture types and reran the full gate. Both new regression cases and existing connected verification/initial-hydration cases pass. Credential-dependent live shell audits self-skip and are NOT RUN as live evidence.
- Desktop and browser production builds both exited 0 after the fix, run sequentially. Existing Firebase import and large-bundle warnings remain. Browser build ran last to restore browser-mode preview output. Builds do not establish installer or live research correctness.

## Red-team / next priority

This is a small correction to research efficiency, not a completed product milestone. Public accessibility, query relevance, company identity, reporting periods and semantic support remain gaps. Do not spend the next pass on another speculative source-selector refinement. The immediate acceptance gate is still one real supported figure through retrieval, interpretation, persistence, reopen and the existing card/reader/dashboard, with an unavailable example staying honest. Secure native inspection needs to be available for that journey; do not extract credentials or silently introduce a proxy to get around the blocker.

Once that gate is demonstrated, prioritize coherent useful company dashboards and first-ready orchestration from `KEYSTONE-DELIVERY-MAP.md`. Keep the approved card design intact. No production-readiness, remote-backup, push, deployment or main-merge claim.
