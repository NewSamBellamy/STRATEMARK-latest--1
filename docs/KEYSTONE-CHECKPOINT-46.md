# Keystone checkpoint 46 — additive, lossless Team & Org gap fill

Date: 2026-10-06 local. Branch: `revival/initial-card-redesign`. Parent: `0da87c9`.

## Connected behavior

- Team & Org's existing bounded second research pass now acts as a true gap fill: it cannot replace and thereby drop first-pass leaders just because its response contains more rows.
- People are deduplicated by normalized display name. First-pass facts take precedence; the second pass can fill fields that were missing/unknown without overwriting known role, bio, tenure, prior company or project details.
- Reporting-line IDs from the second pass are mapped back to retained people, and unresolved parent links are cleared rather than left dangling. Self-links and multi-person cycles are broken, preventing recursive org-chart layouts from overflowing on malformed model output.
- Cached legacy Team & Org data is schema-checked and sanitized on read too. A saved cyclic chart is repaired for display without starting new research or mutating its stored source artifact.
- This is not a claim that a leader list is complete or that model-generated biographies are independently verified. Existing grounded citations remain attribution, not proof of every field.

## Verification

- Focused `dashboard-evidence.test.ts`: 21 tests passed, including a larger second response that omits a first-pass leader, duplicate-name/reporting-line cases, cycle prevention, and safe cached reopen without research spend.
- Full `pnpm check` passed after cached-data sanitization: workspace typecheck, lint, and unit tests. Research 582; contracts 108; mocks 15; web 221. API and desktop suites also passed as part of the gate. Live provider/Gemini tests without an environment key were skipped; no key was read and no external model call was made.
- No UI redesign, deployment, push or main merge.

## Red team / remaining risks

- Normalized display names do not solve transliteration, aliases, or people who share a name; a stable sourced person identity will be needed before claiming universal deduplication.
- Search attribution is still not a per-person original-page receipt; titles, bios, and reporting lines are not independently verified by this change.
- The existing fixed minimum of five leaders still triggers a second pass for a genuinely small company. Replace that arbitrary completeness proxy with evidence/coverage-aware logic in a separate, measured slice.
- Native UI with the configured Gemini key remains unavailable here. No useful live coverage, latency, or spend was measured.

## Next

Continue with a concrete dossier/Scout vertical slice: remove arbitrary headcount as a completeness signal only after defining an evidence-based completion contract; then retain person-specific source lineage before enriching photos or biographies. Keep working through the nine delivery areas in `KEYSTONE-DELIVERY-MAP.md`; this checkpoint does not complete any whole area.
