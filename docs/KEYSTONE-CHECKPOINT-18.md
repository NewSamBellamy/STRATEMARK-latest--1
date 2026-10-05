# Keystone checkpoint 18 — durable shared background pause

Date: 2026-10-05. Branch: `revival/initial-card-redesign`. Card aesthetic unchanged.

## Implemented behavior

- The deck's existing pause/resume buttons now control a shared, versioned local scheduling preference. Pausing persists across route remounts and subsequent app sessions. Updated windows on the same origin listen for setting changes. This setting contains no key or researched content.
- The same preference gates the dashboard warm queue, open-deck verification/prefetch runtime, scheduled deck refresh and scheduled briefings in the current client. Dashboard warming remains one bounded sequential pass through its tabs, prioritizing the active tab; it checks permission again at dispatch and after each awaited turn. It has no automatic failed-request retry.
- A finishing or failing in-flight deck turn cannot schedule another timer after pause or stop. Pause/resume within a mounted deck preserves that runtime's action budget. Paused remounts do not start an automatic first turn.
- A small dashboard pause/resume control exposes the same switch. Both dashboard and deck explain that opening tabs and manual checks may still use the key and already-sent work may finish. Existing card proportions, branding, hero artwork and metric layout are unchanged.
- Invalid/unreadable saved controls fail paused. Failed writes also stay paused locally and visibly warn that persistence was not achieved; a failed resume save never authorizes resumed spending. Low-power checks now also gate dashboard/deck warming and scheduled refreshes, not only verification/briefings.

## Test-first evidence and verification

Before implementation, two in-flight runtime tests reproduced post-pause timer scheduling. A separate scheduled-hooks test reproduced two automatic checks despite a shared paused setting. Those failures are fixed. Added storage reopen/resume/failure/cross-instance tests, deck-remount and keyless behavior checks, dashboard warm queue pause/success/failure/resume cases, scheduled-read pause cases, and visible control wiring/error tests. Tests exercise injected repository seams without paid provider requests.

Initial full `pnpm check` passed with 176 web tests. Final `pnpm check` exited 0 after all additions: workspace typechecks/lint and contracts 92, mocks 15, research 406, desktop 33, API 221 and web 179 tests reported passing. `git diff --check` passed. Final `pnpm build` (desktop main/preload/renderer) and `pnpm --filter @mi/web build` (normal browser bundle restored) exited 0, with existing Firebase/large-chunk warnings. The existing localhost preview responded HTTP 200; this is availability, not visual or live-provider validation. Three environment-key-dependent research audits self-skip and are NOT RUN as live audits. No paid Gemini benchmark was launched for this scheduling-only slice.

## Red team and limits

- This is a **background scheduling pause**, not an API spending cap or a research kill switch. Explicit foreground tab requests, manual research and already-submitted generation can consume credits. Independently running server/cloud schedules are outside this client preference. Browser and desktop origins have separate local settings, and older running builds do not acquire this control retroactively.
- Cross-window changes are propagated via browser storage events, not an atomic fleet-wide execution lock. A request dispatched before another window observes pause may finish. Storage failure cannot guarantee pause in another process; the warning makes that limitation visible.
- For backward compatibility an absent preference retains existing background-on behavior. Storage clearing/settings deletion is not a durable pause. This is not new blanket consent for unlimited research.
- A mounted runtime retains its existing session action limit; reopening an unpaused deck still creates a new runtime budget. No measured dollar cap, global provider request ledger or daily-budget guarantee is added here.
- Manual tabs and cached research remain usable while paused. This does not solve original-page access, canonical company attribution, period/definition acceptance or factual completeness. Never relax the original-evidence gate to fill a card.
- React review kept scheduling in a single hook with effect cleanup, fresh dispatch checks and explicit user event controls. No live cross-process desktop/browser pause test or visual review is claimed; unit/integration tests and builds are the evidence for this slice.

## Next priority

Return to source coverage: through the current native source capability, inspect a small supported/unavailable company verification journey without extracting credentials. Improve canonical-company/metric-scoped original extraction and cache identity, with explicit period/definition rules. Inspect evidence attempts and accepted passages rather than performing another broad census. Checkpoint 17 records the native UI capture blocker and real browser unreadable-original result. Keep these spend controls in use during live testing.

Local checkpoint only until a verified GitHub push exists. No deployment, merge to main, new provider fleet, production-readiness assertion or redesign.
