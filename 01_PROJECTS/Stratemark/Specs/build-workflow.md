# Stratemark build workflow

Current human direction, September 30, 2026: continue the G00-G08 overhaul.
GPT-6.1 Sol plans and integrates; GPT-6 Luna implements at high effort.
Astra is disabled, including escalation. Development spending limits are
deferred. The previous $50 campaign and Astra/Sol rules remain in Git history.

## Roles and packets

- Sol (gpt-6.1-sol) plans from the accepted north star and actual code,
  integrates patches, reviews journeys, and verifies phase acceptance.
- Luna (gpt-6-luna, high) implements bounded tasks with exclusive owned files,
  tests, and a compact evidence handoff.
- After three distinct failed technical approaches, Luna returns evidence to
  Sol, never Astra. Repeating a command is not a distinct approach.

Use the existing plan; do not launch broad repeated planning passes. Check
requested models before dispatch; don't silently substitute. A packet names
its user outcome, story/action IDs, owned paths, invariants, acceptance examples,
verification commands and gaps. Immediate critical-path work stays local;
sidecars run on disjoint scopes. Serialize shared contract/vault/runtime writes.
Start with one Luna worker; expand only where there is truly independent work.

## Context and authority

Every agent has the founder's 200k context ceiling. Checkpoint around estimated
100k; finish/handoff before 150k. Exact occupancy and forced compaction aren't
exposed. Cumulative goal usage is not active context. Use short packets/outputs,
not a claim of automatic enforcement. Do not fork the conversation.

Workers receive repository instructions, relevant accepted decisions, exact
scope and tests, not credentials, private research, transcripts or full logs.
Persist branch/HEAD, owned dirty files, decisions, actual checks, known failures
and next task in BUILD-STATE. Revalidate that checkpoint against disk.

Missing API spend telemetry is not a blocker for this development goal. Actual
spend remains unknown, not zero. Don't invent a hard cap or price projection.
This doesn't authorize live product evaluations, new endpoints, user-data
migration or stored-key exposure. Continue independent work around external
blockers; don't burn three paid retries to prove missing authority or secrets.

## Verification and continuity

Use tests first for important rules, then implementation, review and targeted
checks. Run pnpm check before integration; packaged builds and actual journeys
are separate gates. G00 reproductions stay honestly RED while legacy defects
remain; don't skip/invert them to claim production readiness. A worker's final
report is not proof of completion; review diff and rerun proportionate checks.

Commit finished slices on feat/stratemark-spinoff-local-agents, preserving
unrelated work/data. Maintain BUILD-STATE as the single ledger and proceed to
the next unfinished packet without requiring repeated founder approval. Keep
the broad goal active. The latest human instruction authorizes checkpoint
pushes only to remote newsam, NewSamBellamy/STRATEMARK-latest--1, on this new
spin-off branch. Push meaningful verified slices, not unfinished micro-edits.
Check the destination/remote tip first; subsequent pushes must fast-forward.
If it diverges, preserve both histories and report it; no force update, branch
deletion or automatic merge. Origin/Maruf, Tobi and all existing branches remain
untouched. No release, deployment, main merge or other push without authority.
