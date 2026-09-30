# Stratemark planned build workflow

Status: the human authorized phased implementation; G00's first local contract slice is in progress. Astra previously completed the read-only architecture red team. No additional implementation subagent has been launched. Current planning authority: [NORTHSTAR.md](NORTHSTAR.md), v1.0.0; current execution status: [BUILD-STATE.md](BUILD-STATE.md).

## Roles

Budgeted campaign supplement: [LAUNCH.md](LAUNCH.md) reuses the completed Astra plan and uses one serial Sol executor. Do not launch a new planner for every packet; reserve Astra for the defined three-attempt escalation, subject to verified billing and remaining funds. The latest human goal authorizes phased G00-G08 work, not a promise that production fits in $50. Monetary gates still apply.

- The founder comments on the current journey/features and approves the resulting overhaul direction.
- Astra (`gpt-6-astra`) plans architecture, scope, dependencies, work packets, and acceptance gates from the accepted decisions.
- GPT-6.1 Sol (`gpt-6.1-sol`) executors implement bounded work packets and provide evidence of verification.
- The coordinating agent integrates work, checks cross-cutting behavior, maintains the decision register, and reports meaningful progress.
- An additional Astra instance provides focused help when an executor meets the escalation rule below.

Both requested model IDs are exposed by the current subagent tool. Verify availability again at build time; do not silently substitute a different model if a requested one is unavailable. Using these model names for development does not require Stratemark's users to use those providers.

## Before implementation

The researched north star, actions, and phase gates now exist. Do not re-open already chosen defaults just because older input documents contain pending questions. Astra still prepares concrete code-informed packets for each authorized phase; the plan is not permission to start them.

1. Finish the founder review and map feedback to journey, feature, and decision IDs.
2. Have Astra produce a complete, reviewable plan from the accepted decisions and current code.
3. Set milestones, non-goals, success measures, migration requirements, and verification criteria.
4. Split work into packets with disjoint file ownership when they can run in parallel.
5. Get the founder's authorization to start the build.
6. Recheck branch, working tree, tools, usage, and any relevant repository instructions.
7. Update any resumed automation to follow the approved plan and the same implementation/escalation rules.

## Executor work packet

Every packet needs a specific user outcome, approved story/feature IDs, allowed files, dependencies, contracts to preserve, acceptance examples, verification steps, and completion evidence. Preserve unrelated changes and research data. Coordinate shared contract changes before concurrent edits.

## Context and dispatch policy

Every coordinator and child has the founder's 200k context ceiling. Checkpoint around an estimated 100k; finish or hand off the bounded packet before 150k. Do not wait for 200k, and do not confuse cumulative session/goal usage with active context occupancy. Exact occupancy and forced compaction are not exposed here: use small packets, bounded outputs and clean handoffs, not a claimed automatic limiter.

Cold-start context is only the applicable repository instructions, north-star decisions, current packet, relevant source excerpts and test evidence. Never fork full history or copy customer data, credentials, raw recordings/transcripts or complete logs into a child. At handoff, save the objective, branch/HEAD, owned dirty files, decisions, actual checks, remaining failures, distinct blocker attempts, money known/unknown and next safe command in BUILD-STATE. The next agent verifies that checkpoint against disk.

The human requested continued building after missing billing telemetry was explained. Before EACH child dispatch record requested model, tier if exposed, bounded packet/context, projected USD range and dated rate evidence. Actual spend and remaining funds stay unknown where unobservable; a projection is not a charge or enforceable allocation. Proceed serially, not with an unbounded swarm. The current spawn tool exposes model/reasoning but no enforceable per-child USD limit. If the owner requests a strict enforceable ceiling again, require the controlled billing route instead of promising that prompts enforce it. Live product evaluation remains separately capped.

Default under the human build authorization: one `gpt-6.1-sol` executor, medium effort, with disjoint bounded ownership, no full-history fork and a small projected allocation. Astra help only after three distinct failed technical approaches and a disclosed bounded cost projection. This policy authorizes no additional live research by itself.

## Three-attempt escalation rule

For the same technical blocker, the executor tries independently three times. Each attempt must use a distinct hypothesis or approach and record:

1. What failed and what evidence explains the failure.
2. What changed in the proposed approach.
3. What was tried and what verification showed.

Rerunning the same failing command three times is not three attempts. Repeating billable live research is not required to prove a local code issue; use fixtures or controlled checks when possible.

If three attempts fail, the coordinator starts a focused Astra help instance with the task, acceptance criteria, relevant code/errors, and the three attempt records. Astra diagnoses and recommends a bounded approach. The Sol executor applies the advice and verifies it. Stop repeated executor retries once that escalation threshold is reached.

A missing secret, missing authorization, unavailable service, or usage exhaustion is an external blocker rather than a technical puzzle. Record it and continue independent work when possible; three attempts do not authorize spending, secret access, publishing, or destructive operations.

## Completion and checkpoints

An executor reports changed files, what the user can now do, tests/manual checks performed, and remaining limitations. The coordinator reviews integration and meaningful user flows. Commit a finished verified slice locally. The final release assessment includes live research quality and desktop journeys; a green unit-test suite alone is insufficient.

Main stays protected. No push, publication, deployment, or merge is part of this workflow without new authorization.
