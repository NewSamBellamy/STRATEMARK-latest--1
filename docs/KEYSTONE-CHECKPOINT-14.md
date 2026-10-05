# Keystone checkpoint 14 — safer publication and save-failure recovery

Date: 2026-10-05. Branch: `revival/initial-card-redesign`. Local checkpoint; not a completed backend or production release.

## Changes that are actually connected

- A failed repository save restores the last acknowledged snapshot, aborts owned job controllers and makes the session refuse subsequent model requests. An unsaved market/dashboard is no longer returned as if saved. Reopen the workspace after resolving the storage failure; already in-flight requests are not guaranteed to be recalled.
- The shared original-passage gate rejects borrowed company attribution, separated statement/date clauses, article publication dates and competing metric bases even when the number is repeated. Direct single-statement attribution and an explicit dated figure are required. This gate is used by protected native/cloud initial enrichment, additions and single-metric verification; browser direct Gemini and synchronous BYOK remain outside that coverage.
- The authoritative plan now has an ordered remaining-backend queue: one trustworthy company; indexed dossier and deep sections; real Scouts/jobs/assets; specialist reports; rankings/watches; provider combinations; connector/release. It preserves K0–K9, the founder's design and the local/key privacy boundary instead of creating another competing plan.

## Verification and red team

- Seven newly added adversarial examples were observed incorrectly accepted before their fixes: partner numbers in another sentence or clause, third-party possessive/reported attribution, detached publication dates and simultaneous metric bases. Another malformed-date case already failed safely. Existing valid abbreviated names, literal dates, units and supported zero examples remain covered.
- Two actual company-hydration integration cases assert honest unknowns on the card and retained company memory, retained source attempts, and no extra model calls. The initial integration run exposed a test-spy setup error; it was corrected, not a production assertion weakened.
- Three save-failure regressions cover rollback of unsaved markets, preventing later paid requests and refusing an unsaved cached dashboard.
- Final `pnpm check` exited 0: workspace typechecks, lint and every unit suite passed, including the new company hydration cases and the 152-test web suite. The Back-to-card journey passed in this run; its prior intermittent failure is not thereby diagnosed. Credential-dependent live research audits self-skipped and remain NOT RUN as live audits.
- An earlier full run hit the known Back-to-card failure; the final full run passed with the journey assertion unchanged. The two runs overlapped briefly while the new integration tests were added; resource contention is a possibility, not an established root cause. Do not erase this failure from release tracking. Production web build passed; existing large-chunk/Firebase import warnings remain.
- Earlier isolated real-browser storage exercise (not a new live research run): a 6,000,000-character fixture saved with 36 ms acknowledgment, reopened intact and rejected a stale second writer handle. Two handles were in one page, not two independent windows. Export preparation returned 6,000,288 characters; the download observer timed out, so actual file delivery remains unverified. The isolated developer harness is retained at `apps/web/e2e/storage-harness.html` and is not part of the production web bundle.
- Earlier configured-key UI test returned “Key works. Grounded search returned 0 sources.” This proves neither complete research nor metric accuracy. No additional paid research was launched for this checkpoint. No key was copied into shell/tests. API credit spend for the coding session is not available here.

## Before / after

| Dimension | Before | After / measured boundary |
| --- | --- | --- |
| Save failure | Unsaved in-memory records could remain visible; later research could spend | Last saved snapshot restored; later model requests rejected in that session |
| Attribution | Matching company/number/date keywords could accept a partner's figure | Seven reproduced ambiguity cases rejected; no semantic accuracy guarantee |
| Cohesion | Accepted numeric rows already shared on protected paths | Added hydration tests ensure rejected claims are unknown on face and retained memory |
| Efficiency | Shared gate and existing model calls | Deterministic extra checks; no added model request; no whole-run latency claim |
| Browser storage | Prior roughly 5 MB localStorage blocker | Earlier real isolated 6 MB save/reopen passed; independent-window/download proof pending |

## Remaining limits and next action

The conservative prose rules can reject genuinely supported but differently written statements. They are not entity resolution, complete semantic verification or financial-period reconciliation; structured disclosure extraction and bounded ambiguity review remain required. Existing stored legacy facts are not retroactively certified or rewritten. Strict source checks can reduce available figures, which is preferable to manufacturing confidence but must be measured alongside recall.

Restore-after-failure is not full isolation during an in-flight mutation, and snapshot storage is not a scalable indexed dossier. Full artifact export, reference validation and restart reconciliation remain open. No visual redesign, full journey recording, installer certification or production-readiness claim.

Next: close original-receipt retrieval/durable local delivery on the actual browser BYOK route with an explicit native/configured-service capability boundary. Do not add an unapproved proxy, relay keys silently or treat request-local memory as evidence storage. Then demonstrate one small live supported/unavailable company journey before spending on a full deck. Continue the execution queue in the consolidated plan; do not start a new agent framework to bypass these gaps.
