# Build state and cold-start checklist

Plan version: 1.0.0. Updated September 30, 2026.

## Current truth

September 30 execution update: the human explicitly authorized the full overhaul one phase at a time, with gap checks, production as the outcome, and a roughly $50 session budget. This supersedes the launch supplement's planning-only/bounded-G01 authorization, not its monetary safety gates. G00 has begun with an additive contract slice. No phase is complete. Reuse the reviewed plan rather than repeatedly commissioning Astra planning.

The human reports API-key authentication and an unset spending limit. Actual billing project, processing tier, baseline spend and current spend remain unverified. The ChatGPT usage-limit tool cannot report API-account spending. Do not interpret unknown spend as zero or promise the $50 ceiling is enforced. Finish/checkpoint this first local slice, then require verified billing controls before further paid agent dispatch or live research. A $40 enforced project limit alone can lag; see [LAUNCH.md](LAUNCH.md) for the additional accounting/reservation gate. No subagent was launched in this slice.

- Planning: complete researched v1 north star, action catalogue, phase goals, and evidence ledger.
- Implementation: G00 in progress; first shared action contract slice, not yet connected to application callers.
- Branch: `feat/claim-level-signal-evidence`; main must not be used for this exploration.
- Inspected code baseline: `3f18af2`. The documentation commit will follow that baseline; determine current HEAD from git rather than treating this baseline as current code forever.
- Goal tool: an active full-overhaul execution goal exists; read its actual objective. Do not mark it complete when a packet or phase finishes, or replace it with a narrower objective.
- Next work: remaining G00 contracts and baseline fixtures after billing preflight. G01 waits on its required contracts/fixtures; no live migration is authorized.
- Paid research: zero calls in this planning pass. Any live evaluation requires an approved numeric cap and secure keys.
- Automation: previously paused; do not resume it or change its execution model without current human authorization and an updated prompt aligned to these goals.
- Push / main merge / public deployment / publication: not authorized.
- Current application tests: see packet G00-P01 below for dated execution evidence. Historical counts are not a substitute for a fresh check; live quality, packaged desktop and visual journeys remain unverified in this slice.
- Document verification: local links and balanced code fences passed; unique registers checked (22 defaults, 30 stories, 62 actions, 9 goals, 26 sources); JSON command example parsed; canonical files had no candidate credential patterns. Markdown formatting checked separately before commit.
- Astra final planning review: seven substantive gaps identified and addressed (service lifetime, migration fences, imported authority, restored budgets, asset/evidence retention, asynchronous output retrieval, and human approval boundary). Re-review found no remaining material contract contradictions; this is planning consistency, not application verification.

## Cold start: do not depend on the conversation

1. Read root `AGENTS.md`, this file, and [NORTHSTAR.md](NORTHSTAR.md) completely.
2. Check actual branch, dirty files, recent commits, active goals, available models, and usage limits. Preserve changes you did not make. A mismatch is a fact to resolve, not an excuse to overwrite the tree.
3. Read the active goal in [PHASES.md](PHASES.md), relevant actions in [ACTIONS.md](ACTIONS.md), and source/baseline findings in [RESEARCH.md](RESEARCH.md).
4. Read the latest completed/active packet record and actual tests/errors. If no packet exists, do not assume one was executed.
5. Confirm implementation authorization and phase dependencies. Research/planning approval is not authorization to migrate live data or spend credits.
6. Revalidate volatile provider/protocol claims before implementation; model availability, capabilities, SDKs, prices, and terms can change.
7. Astra prepares the bounded packet; authorized Sol executors implement it. All transports share the same service. Follow the three-distinct-attempt rule in [build-workflow.md](build-workflow.md).
8. Verify and update state with evidence before claiming completion. An unknown status stays unknown. No raw keys, private transcripts, customer research, or provider payload dumps in committed handoffs.

## Execution ledger

| Goal | State       | Packet / commit evidence | Remaining                                                                                          |
| ---- | ----------- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| G00  | In progress | G00-P01 below            | 53 action request schemas, result/error schemas, caller coverage, reproduced risks and screenshots |
| G01  | Not started | None                     | Vault and migration                                                                                |
| G02  | Not started | None                     | Shared runtime, policies, secrets                                                                  |
| G03  | Not started | None                     | Progressive research and evaluation                                                                |
| G04  | Not started | None                     | Cards and coherent frontend journey                                                                |
| G05  | Not started | None                     | Decision outputs and findings                                                                      |
| G06  | Not started | None                     | Local monitored updates                                                                            |
| G07  | Not started | None                     | Scoped MCP                                                                                         |
| G08  | Not started | None                     | Production verification                                                                            |

Only one authoritative execution ledger lives here. Action schemas are authoritative in contracts once built; update this plan when implementation intentionally changes the design. Do not create competing status files in unrelated folders.

## Packet template

Append completed packet summaries here or link small authored packet records from this ledger. A packet is not an assistant session dump.

```text
Packet ID / plan version / goal ID:
Authorization source and boundaries:
User outcome / story IDs / action IDs:
Entry dependencies and inspected code baseline:
Allowed files and exclusive/shared ownership:
Required contracts / invariants / migration effects:
Approach, alternatives rejected, and source IDs:
Acceptance examples, including failure/empty/recovery behavior:
Verification commands / manual scenario / live spend cap:
Actual results with date and commit or dirty-tree context:
Changed files / local commit:
Known limitations / unverified claims / next safe packet:
Technical blocker attempts 1/2/3, distinct hypothesis and evidence:
Astra escalation outcome if required:
```

Completion claims must link to real test/manual evidence. A screenshot verifies only the shown state. A mock/provider fixture verifies the contract, not live output quality. A green build does not prove cancellation, privacy, costs, or installer behavior. External blockers do not need three billable retries; record them and proceed only with independent authorized work.

## Goal and context discipline

An existing human-created broad goal must retain its actual objective. Execute one bounded phase/packet at a time inside it; do not redefine success or mark the whole goal complete at a slice boundary. Do not invent tool token budgets. Mark complete only when the actual objective and its acceptance gates are achieved. Pause only at the user's explicit request. Repeated external-blocker handling follows the goal tool's rules.

User context ceiling: 200k tokens for every agent, not a spend allowance. Checkpoint around 100k; hand off before an estimated 150k to leave room for verification and recovery. Use the policy in [build-workflow.md](build-workflow.md). Cumulative goal tokens are usage, not necessarily the current context window. Exact context occupancy and forced compaction are not exposed by this toolset; do not claim hard automatic enforcement. Keep packets small and start clean workers only after billing gates permit them.

## Packet G00-P01 — Shared action contract foundation

Authorization: current human phased-build goal; separate branch, local commits only, no live data migration/provider research. Baseline HEAD at packet start: `a07bddb`.

Changed shared module: `packages/contracts/src/actions.ts`, exported additively from `index.ts`, with behavioral fixtures in `actions.test.ts`. Uses existing Zod dependency; no provider, database, UI, or network side effects.

- All A01-A62 have stable metadata (effect, potential billing, scope ceiling, human-only boundary).
- Nine actions have strict versioned request schemas: A03, A04, A14, A16, A27-A31. Other catalogue entries deliberately fail closed at this parser.
- Paid starts/resume require budget/policy references, idempotency key and safe revision; reads cannot accept spending fields or force-research flags. Targets reject paths; event pagination and discovery bounds are finite.
- Research receipts require a run ID, action-appropriate target and matching resume run. Pause/cancel request states are distinct from acknowledged terminal states.
- These schemas do NOT authenticate a caller, enforce a budget, perform idempotency, persist a receipt, run research, or fix existing callers. References are not authority. Metadata is not an MCP grant.

Verification: initial targeted test failed because `./actions` did not exist, then 23 initial tests passed after implementation. Sandbox prevented the initial test runner from loading configuration; approved unsandboxed local execution resolved that environment issue without changing runner configuration. Two additional adversarial cases were subsequently added; final results recorded at integration below.

September 30 final checkpoint evidence (this packet's working tree):

- `pnpm --filter @mi/contracts test:run -- src/actions.test.ts`: exit 0, 25/25 passed after final formatting/additional cases.
- `pnpm --filter @mi/contracts typecheck`: exit 0 after final code edits.
- `pnpm check`: exit 1. All package typechecks and root lint passed. Unit runner reported 794 passed / 1 failed across packages (795 total before the last two contract cases). The existing `apps/web/src/test/app-flow.test.tsx` full-journey test hit its 20-second timeout. Three live research/audit tests returned early without an API key; these counts are not live quality evidence.
- `pnpm --filter @mi/web test:run -- src/test/app-flow.test.tsx`: exit 0, 2/2 passed in isolation without code/config changes. The formerly timed-out journey took 13.934 seconds; collection/setup was also slow. Runner load is a hypothesis, NOT an established root cause. Full `pnpm check` remains failed, not retroactively green.
- Scoped formatting and diff whitespace checks passed. `pnpm exec eslint packages/contracts/src/actions.ts packages/contracts/src/actions.test.ts packages/contracts/src/index.ts --max-warnings=0`: exit 0 on final code.
- No UI, legacy action caller, provider credentials, user data, package/dependency versions or test timeout was changed. No live research, paid retrieval, new subagent or publication was launched. No packaged build, installer, MCP host or visual acceptance was verified.

Checkpoint is a locally saved additive foundation, not G00 completion or permission to open a PR. Next verification packet should isolate the journey's slow/timing behavior and rerun the full gate before claiming integration success. Do not relax assertions or increase timeouts merely to obtain green results.

Current inspected caller seams (not a complete mapping or reproduced defect claim):

| Seam                      | Current code                                                                         | Required migration                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Tab read / forced refresh | `apps/web/src/hooks/data.ts:172`, `:447`; `packages/research/src/repository.ts:1258` | Separate A04 cached read from explicit A16 command; tab miss currently invokes research |
| Renderer hunt queue       | `apps/web/src/lib/agentic/useHuntRunner.ts`                                          | A15/A27-A31 durable service ownership; UI is not a scheduler                            |
| Automatic refresh         | `apps/web/src/hooks/useAutoRefresh.ts`                                               | A34/A36-A38 opt-in schedule and bounded consent                                         |
| Desktop commands          | `apps/desktop/src/main.ts:290`, `:361`, `:364`                                       | Shared action adapter; current legacy IPC still active                                  |
| IPC research lifecycle    | `apps/web/src/lib/repository/ipc-repository.ts:72`                                   | Accepted run lifecycle, not caller progress callback/AbortSignal alone                  |
| Stored key retrieval      | `packages/contracts/src/ipc.ts:105`, `apps/desktop/src/main.ts:369`                  | G02 status-only protected settings boundary                                             |
| Snapshot report shedding  | `apps/web/src/lib/repository/localStore.ts:75`                                       | G01 explicit storage failure/recoverable vault, never silent report loss                |
| Company membership        | `packages/research/src/repository.ts:112`                                            | G01 canonical company with many market memberships                                      |

Remaining G00 gaps: runtime schemas for 53 actions and complete typed results/errors/policies; state transition enforcement; every visible action/caller mapped; synthetic risk reproductions and adapter parity; representative screenshots. No production or visual improvement claim. Next packet: bounded remaining read/identity schemas and synthetic baseline reproductions, not a UI rewrite or live migration. Money remains unknown; no extra paid worker dispatch yet.

If capacity is exhausted, leave a compact verified checkpoint without claiming completion. Any future resumed automation must check usage before repository edits, stay quiet for unchanged/non-actionable states, and honor current model/scope/authorization. The earlier Luna automation is not permission to execute this Astra/Sol overhaul.

## Change record

- September 30, 2026, v1.0.0: researched defaults chosen after handwritten architecture review and read-only Astra red team. Created canonical spec, A01-A62 actions, G00-G08 goals, dated source ledger, and this cold-start record. No application code/data/provider credentials changed; no implementation agents launched. Astra's planning review is not implementation evidence.
