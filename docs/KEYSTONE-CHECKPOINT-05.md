# Keystone checkpoint 05 — protect the growing local research library

Date: 2026-10-03 local. Branch: `revival/initial-card-redesign`.
Preceding checkpoint: `4e45476`. [Build plan](../01_PROJECTS/Stratemark/Specs/Keystone-Build-and-Test-Plan.md).

## Why this pass is aligned with the vision

Correctness: original-source proof remains unfinished; do not call provider attribution fact verification. User journey: cards must stay concise while dossiers retain depth, not disappear after restart. Cost: automatically throwing away researched dashboards causes repeat paid research. Durability: saved reports and findings are part of the user's knowledge base. Maintainability: a synchronous store cannot acknowledge an asynchronous replica that has not committed. Design: preserve the approved collectible card style; no new agent-control panels or visual redesign.

This review uncovered an immediate violation: browser quota fallback deliberately removed researched dashboards, then reports, and could log that an IndexedDB backup succeeded without checking its result. Before adding larger original receipts, stop deleting the library under pressure. This is a bounded K2 safety detour, not abandonment of K1.

## Implemented

- Local writes now save the full snapshot or fail explicitly. No dashboard/report shedding and no success claim based on a pending vault call.
- Failed atomic localStorage writes preserve the previous saved copy; the full newer snapshot is attempted as a secondary replica, without durability acknowledgment.
- Save failure throws a readable error: keep the window open, free space and retry; do not assume changes are saved.
- Successful writes retain reports, researched dashboards and evidence metadata. Retrying the complete snapshot after storage is available succeeds.
- Rejected asynchronous replica writes are handled without claiming backup success or invalidating an acknowledged primary save.

## Tests / red team

Two added regression cases failed against the old implementation, reproducing destructive compaction and false-success behavior. The eight-test local store suite now passes, including prior deck-loss backup tests, full snapshot round-trip, retry and rejected-replica handling. Tests use isolated test keys and mocked vault writes; no user's stored data or key was accessed. Final `pnpm check` exited 0: workspace types/lint passed; contracts 92, mocks 15, research 305, desktop 27, API 172 and web 139 tests reported passing. Three credential-dependent research audits returned early and remain NOT RUN as live audits. No paid research or UI styling changes.

Remaining gaps: localStorage capacity is still limited. IndexedDB mirroring is best-effort, not a transactional primary store or unlimited storage. A failed repository mutation can remain in memory and requires retry/recovery; this change does not roll back every higher-level operation or guarantee every background job surfaces a toast. Current export reads the saved copy, not necessarily unsaved memory. Multi-window revisions, import/corruption recovery, full retention-aware backup and genuine asynchronous durable acknowledgment remain K2 work. No browser recording or live latency measurement; do not call this production-ready persistence.

## Next

Resume K1 safe original retrieval and identity/metric/period checking, followed by bounded configured-key testing. Then implement asynchronous transactional local storage and recovery before scaling Scouts or unattended updates. Keep K0 visual baseline and card/reader readiness gates visible. Retain the local-first, BYOK, company-card-to-dossier vision; specialist finding cards remain narrative research, not company-score copies.

Local checkpoint only; GitHub backup remains unconfirmed. Main and unrelated untracked files are untouched.
