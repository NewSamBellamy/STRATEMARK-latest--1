# Build state and cold-start checklist

Plan version: 1.0.0. Updated September 30, 2026.

## Current truth

Latest active goal (September 30, after G00-P02): use GPT-6.1 Sol for planning
and integration, `gpt-6-luna` workers at `high` effort for bounded implementation.
Astra is disabled, including help/escalation. Development spending limits are
deferred by the human; do not stop for missing API telemetry or require cost
projections before worker dispatch. This overrides the historical campaign
instructions below, not product privacy, bounded execution, phase dependencies,
context ceilings or live-research consent. Goal is active (verified via goal tool).
Latest completed packet: G00-P05 below. G00 contracts and reproduced baseline
are frozen for offline G01 work; this is not product-readiness or service parity.
G01-P01 is verifying packaged SQLite before any authoritative schema or cutover.
The full goal remains active; do not restart planning.
Earlier $50/Astra campaign instructions are historical, not current dispatch
rules. The human reports API-key sign-in; actual development spend is unknown.
The ChatGPT usage tool cannot measure that API account's charges. No billing
preflight blocks this development goal; live product research still requires
separate explicit approval and a numeric cap.

- Planning: complete researched v1 north star, action catalogue, phase goals, and evidence ledger.
- Implementation: G00 contract/baseline freeze complete: 62 requests, 20 typed cached-read results, created-record receipts, run outputs, policies and versioned retained evidence records. Existing product still has 11 reproduced RED defects; shared service is not connected to callers. G01 packaged binding investigation is underway, not vault completion or live cutover.
- Branch: `feat/stratemark-spinoff-local-agents`, created from `b2c6398`; predecessor `feat/claim-level-signal-evidence` retained unchanged. Personal-fork checkpoint destination: remote newsam, `NewSamBellamy/STRATEMARK-latest--1`.
- Inspected code baseline: `3f18af2`. The documentation commit will follow that baseline; determine current HEAD from git rather than treating this baseline as current code forever.
- Goal tool: the human's replacement Sol-planner/Luna-worker goal is active, verified at G00-P03 start. No billing blocker remains for development. Keep the full goal active at packet boundaries.
- Next work: G01 packaged SQLite binding/crash/online-backup proof, then offline durable vault and safe migration. No live data migration is authorized. G02/G07 own runtime enforcement and actual adapter parity; source-level caller inspection is not that proof.
- Paid research: zero calls in this planning pass. Any live evaluation requires an approved numeric cap and secure keys.
- Automation: previously paused; do not resume it or change its execution model without current human authorization and an updated prompt aligned to these goals.
- Push: latest human explicitly authorized periodic checkpoints ONLY to this new personal-fork branch. No overwriting existing refs, upstream/Tobi pushes, main merge, release or deployment. First upload verified at `73e61c0e0f9f20e063fd290ef9fb3a122f570061`; all 49 pre-existing remote branch refs remained unchanged, including main at `c945b31dee0095331b8487133c131c36e76ba601`. Verified owner NewSamBellamy, public fork of Maruf. The shorter old URL redirects to Maruf and is unsafe as a personal destination. Read actual local/remote tips before each later fast-forward checkpoint.
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
7. Sol prepares and integrates bounded packets; Luna high-effort workers implement. All transports share the same service. Technical escalation goes to Sol, never Astra; see [build-workflow.md](build-workflow.md).
8. Verify and update state with evidence before claiming completion. An unknown status stays unknown. No raw keys, private transcripts, customer research, or provider payload dumps in committed handoffs.

## Execution ledger

| Goal | State                             | Packet / commit evidence       | Remaining                                                           |
| ---- | --------------------------------- | ------------------------------ | ------------------------------------------------------------------- |
| G00  | Contract/baseline freeze complete | G00-P01-P05 below              | Legacy defects remain RED; enforcement/parity belong to G01/G02/G07 |
| G01  | In progress                       | G01-P01 binding spike underway | Packaged binding gate, vault and offline migration                  |
| G02  | Not started                       | None                           | Shared runtime, policies, secrets                                   |
| G03  | Not started                       | None                           | Progressive research and evaluation                                 |
| G04  | Not started                       | None                           | Cards and coherent frontend journey                                 |
| G05  | Not started                       | None                           | Decision outputs and findings                                       |
| G06  | Not started                       | None                           | Local monitored updates                                             |
| G07  | Not started                       | None                           | Scoped MCP                                                          |
| G08  | Not started                       | None                           | Production verification                                             |

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
Sol technical escalation outcome if required (Astra disabled):
```

Completion claims must link to real test/manual evidence. A screenshot verifies only the shown state. A mock/provider fixture verifies the contract, not live output quality. A green build does not prove cancellation, privacy, costs, or installer behavior. External blockers do not need three billable retries; record them and proceed only with independent authorized work.

## Goal and context discipline

An existing human-created broad goal must retain its actual objective. Execute one bounded phase/packet at a time inside it; do not redefine success or mark the whole goal complete at a slice boundary. Do not invent tool token budgets. Mark complete only when the actual objective and its acceptance gates are achieved. Pause only at the user's explicit request. Repeated external-blocker handling follows the goal tool's rules.

User context ceiling: 200k tokens for every agent, not a spend allowance. Checkpoint around 100k; hand off before an estimated 150k to leave room for verification and recovery. Use the policy in [build-workflow.md](build-workflow.md). Cumulative goal tokens are usage, not necessarily the current context window. Exact occupancy and forced compaction are not exposed here; do not claim hard automatic enforcement. Keep packets small and start clean workers with a declared model, effort and exclusive scope; development cost projections are not a current gate. Unknown spending never becomes a claim of remaining funds.

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

## Packet G00-P02 — Cached query and lifecycle rules

Authorization: human explicitly requested continuation; separate branch, estimated $50 working target, no new worker or live product-research calls. Entry HEAD: `bd36d7b`. Shared write scope: `packages/contracts/src/actions.ts` and `actions.test.ts`; no framework/dependency changes.

Ten additional strict query schemas cover A01/A02/A05/A10/A20/A23/A33/A52/A59/A61. Search, company identity hints, comparison targets and pagination are bounded; evidence and updates require one unambiguous target. Cached queries reject budget/force/extra fields. Provider status accepts an opaque connection ID, not credentials. This is a contract foundation, not a connected library/search implementation.

Added the 16 documented structured error codes with a fixed recovery action name and no free-text provider exception/stack/payload fields. Added a pure run-state transition rule: pause/cancel requests cannot skip acknowledgement, and a terminal attempt cannot resurrect through an ordinary transition. Retry must have a separately accepted attempt. Runtime fencing, leases and actual worker quiescence remain G02 work; this function alone does not enforce them.

Tests were written first: 12 failed / 34 passed before implementation (missing ten reads and lifecycle/error exports), then 46/46 passed. Contract typecheck passed. Full integration results follow after the actual gate completes; no phase completion is claimed.

Final September 30 verification:

- `pnpm check`: exit 0 on the final application code. All workspace typechecks, root lint and recursive unit suites passed. The original journey tests passed in the full run (2/2, 3.834 seconds total; primary flow 2.809 seconds). This new success does not establish a root cause for the previous timing failure or prove live research quality.
- `pnpm --filter @mi/desktop build`: exit 0, renderer and main/preload bundles generated. Not an installer, launch, crash/recovery or signing test. Build warned about chunks above 500 kB; the largest initial chunk was approximately 1.55 MB minified / 432 kB gzip, a concrete G04/G08 loading-performance gap. Do not hide the warning by raising its threshold.
- Scoped formatting and `git diff --check`: exit 0. Temporary journey diagnostics removed; that test file has no content diff. Only additive contracts/tests and current authorization/checkpoint documentation are committed.

Next safe packet: finish scope/research command and output/policy schemas, with a bounded Sol sidecar for disjoint synthetic baseline fixtures if its cost projection is recorded. Keep G00 open; do not begin live migration or claim the existing UI now uses the new service.

Journey diagnostic evidence: temporary stage timing on the existing mock flow returned 16.550 seconds in one run and 2.816 seconds in a subsequent finer-grained run, both below the unchanged 20-second timeout. The Metrics transition segment varied markedly; finer-grained link lookup/click was fast on the second run. No reproducible root cause was established. Both diagnostics were removed; `app-flow.test.tsx` is unchanged. Do not claim a timeout fix, relax assertions, or convert these fixture runs into browser/production performance evidence.

Remaining G00: 43 request schemas, typed output manifests and full result/policy contracts, complete current caller map, deterministic unsafe-behavior reproductions and representative screenshots. None of the legacy callers is yet routed through the new contracts. No visual changes, MCP integration, vault migration, key-boundary fix or production acceptance yet.

## Packet G00-P03 — Sol/Luna execution and evidence-based baseline

Current authorization: human active goal disables Astra and defers development
spend limits. Sol plans/integrates; Luna high-effort workers implement. Updated
AGENTS, LAUNCH, build-workflow and BUILD-BUDGET so fresh sessions don't re-open
billing or old model decisions. Product paid-evaluation consent and no-push /
no-main / no-live-migration boundaries remain. Entry HEAD `44bfeb8`.

Dispatched one worker: `gpt-6-luna`, `high`, no history fork, exclusive
`packages/contracts/src/actions.ts` and `actions.test.ts`. Worker Nash completed
and was closed. No Astra, live model research, user-data reads or publication.
Actual development spend is unknown; no projection/hard-cutoff claim.

Added 15 strict schemas: A06-A09, A12-A13, A15, A17-A19, A21-A22, A24,
A32 and A34. All 34 supported requests have finite strict inputs. Cached scope
preview and local market creation don't carry paid-work authority. Library
questions cannot turn on web retrieval; web expansion is explicit and bounded.
Inputs retain revisioned targets, template version and failed-task selection.
Membership requires market and company revision preconditions. Service must
still resolve/authenticate policies, sources, human judgment and task eligibility;
parse success is not authorization or execution. Receipt schemas aren't expanded.

Worker TDD evidence: 15 valid new-request cases initially rejected, then 80/80
action tests passed; contract typecheck passed. Coordinator review caught forced
seed/geography requirements and name-based ambiguity rejection. Added 2 failing
tests, then made no-seed discovery and null geography valid and duplicate checking
apply to exact normalized seed hints, not company names. Final 82/82 action tests
passed. No new dependencies or framework.

Added CALLER-MAP with current user journey, renderer/IPC calls, hidden provider
entry points and local/cloud dispositions. It is an inspected migration register,
not adapter-parity proof or a claim that every visible button is accepted.

Eight ordinary RED synthetic reproductions establish current release blockers:

1. Missing overview navigation makes one grounded provider call.
2. Migration inspection rewrites a running job to failed.
3. A too-new schema still accepts a persisted write.
4. A deferred old-owner response overwrites a replaced snapshot.
5. Numeric storage strips reporting-period identity.
6. Cancellation returns cancelled while the mocked provider remains pending.
7. Electron preload exposes stored-key retrieval; no real key was read.
8. Quota handling persists a snapshot with saved reports discarded.

These remain failing acceptance assertions; do not skip/invert/delete them or
call the product healthy. They expose existing defects rather than changing
production behavior. Eight reproduced gaps aren't proof of eight fixes.

September 30 verification:

- `pnpm --filter @mi/contracts test:run -- src/actions.test.ts`: 82/82, exit 0.
- Final `pnpm check`: all workspace typechecks and root lint passed; full
  contracts suite 190/190; mocks 16/16; research 314 passed / 6 failed (the new
  baseline cases), exit 1. Dependent desktop/web/API test suites didn't run after
  recursive research failure; do not claim a full green gate. Earlier fixture
  typing/lint failures were repaired before this final gate.
- Targeted desktop bridge baseline: 1/1 RED, exposed method assertion (not an
  Electron startup or credential-access failure).
- Targeted web quota baseline: 1/1 RED, [] reports vs saved synthetic report.
  Final fixture typing/lint passed in the gate; use targeted rerun after any edit.
- Local esbuild configuration was denied by sandbox; approved local execution
  outside it loaded the runner. No config/assertion/timeout was weakened.
- No UI, runtime caller, persistence implementation, stored keys or user research
  was changed. Desktop build was not rerun for this contract/baseline slice;
  prior bundle-size warning and packaged/live/visual acceptance remain open.

Next G00-P04: remaining 28 local/settings/monitor/grant request schemas, complete
typed receipts/output manifests and grant/egress/budget policy contracts. Delegate
one bounded Luna worker, serialize shared contract writes; Sol integrates/reviews.
Also finish cross-market identity / period-conflict reproductions and synthetic
screenshots/current-button review. G00 remains open; G01 then fixes vault/migration
gaps and G02 fixes lifecycle/secrets/cached-call ownership. Don't restart planning,
stop for missing development spend telemetry, invoke Astra or claim production.

Compact handoff for context: requested ceiling remains 200k, checkpoint around
100k and handoff before estimated 150k. Exact active occupancy isn't exposed;
new workers get only owned packet context. No live sessions/workers remained after
the verification commands complete. Keep the active full goal, not a new subgoal.

## Packet G00-P04 (entry bffd47c)

Sol coordinator; Luna `gpt-6-luna/high` worker Archimedes (ID
`01a0f40f-9cd2-76f1-98d7-6286e66ba0c6`) owns only actions.ts/actions.test.ts,
adding remaining28 request schemas. No history fork or Astra. Main owns research
baseline, public-sample browser fixture and docs; shared contract writes remain
serialized until worker completion/closure. No live product-provider calls or user data.

Main added three ordinary RED baseline checks. After fixing a missing createdAt
in the synthetic card fixture, the selected3 failed at intended assertions:
shared company leaves market_b's cached opportunity; same-name distinct-domain
companies collapse to one identity on resumed ingestion; different reporting
periods merge into one row. Final whole baseline9/9 RED; targeted research
typecheck and scoped lint passed. These are defects established, not fixed.

Public-sample browser baseline startup FAILED (session53575 exited1); no
screenshots were created. Direct web build reproduced exit2 from TypeScript:
actions.ts:1002 accesses possibly undefined `second` under noUncheckedIndexedAccess.
The error was sent to the existing Luna owner; no competing edit or blind retry.
The fixture uses isolated port4187, blocked external traffic and fresh storage.
Four screenshots remain unverified. Production doesn't depend on preview4174.

Archimedes completed and was closed. Independently verified 176 action tests;
review added a public-domain/IPv6 prefix regression and retained finite-number
rejection. Fixed prefix classification; all178 action tests pass. All62 actions
have input schemas. Shape validation is not authentication, approval or dispatch.

Coordinator implemented additive `action-results.ts` after the worker closed:
typed receipts distinguish job/write/local effects and action-specific targets,
require job run IDs, bind resume/pause/cancel to their run, and do not accept read
query receipts. Versioned output manifests pin scope/input revisions and evidence,
retrieve dossiers/briefs via typed reads, preserve incomplete gaps, and support
pre-market scope drafts and no-result failure. Seven result tests pass. Scope
filtering, evidence verification and durable acceptance remain future runtime work.

Browser startup investigation then reproduced a genuine app wiring error:
DeepDiveProviderWithPanel used route hooks above App's router. Moved it inside
either HashRouter/MemoryRouter; no visual restyling or user-data change. The
production public-sample browser fixture passed after rebuilding: Library,
deck, reader, Company brief and reload, with all external requests blocked.
Four screenshots were inspected locally in ignored apps/web/test-results.
Observed baseline gaps: washed-out Anthropic fallback, internally scrolling
deck cards clipped at viewport bottom, repeated descriptions, reader/header
sourced/credible counts confusing beside overview evidence health, and researcher/live
language not backed by actual no-key activity. No sample metric is endorsed as
a current verified company fact. E2E seeds only an isolated preview access
profile; account-free onboarding is not yet implemented/proven. These captures
are not packaged/live evidence.

Browser harness also bound localhost while checking127.0.0.1: direct probes
returned localhost200/127refused. Playwright now passes the requested host and
strict port to Vite, not a larger timeout. Existing lighter journey2/2 and new
real-panel/router-root regression1/1 pass. Web build passed (large chunks and
Firebase mixed-import warning remain). Scoped source/test lint passed; initial
command included ignored Playwright config and returned a warning, then correctly
scoped command passed without changing lint rules. Temporary startup log removed.

Second bounded Luna worker Nietzsche `01a0f41f-7406-74d2-9213-af60e9c6b6fa`
completed action-policies.ts/test.ts and was closed. Four versioned policy
records have14 passing tests: vault-revision-bound approval challenges, selected
expiring grants, explicit record/input-only egress, and finite time/budget bounds.
Model-only work does not require retrieval. Request-bound scope assistance and
provider tests work before companies exist. Strict currency budgets reject
unknown prices; request/token-only budgets may explicitly allow unpriced routes.
Restored budgets cannot parse as active under their restored reference. These
are contract checks, not persistent enforcement/replay/revocation guarantees.

Sol review reproduced and fixed request/persisted-grant allowlist drift: cached
library search, comparison and run status were unavailable in grant requests.
Both now reuse one metadata-derived finite unique action list, excluding never
and human-only actions; paid job grants need policy/budget refs. Exported policies
additively after worker closure. Shared writes remained serialized.

Final September30 verification on this packet's tree:

- Full contracts308/308 passed (actions179, results7, policies14).
- `pnpm check`: all6 package typechecks and root lint passed; contracts308 and
  mocks16 passed; research314 passed/9 ordinary baseline failures. Exit1. The
  recursive failure prevented downstream web/desktop/API suites from running.
- Independently: real public browser journey1/1, existing web journey2/2,
  real-panel/router-root regression1/1, scoped lint all passed; web build and
  desktop build:main passed. Browser captures reviewed, no paid/live calls.
- Targeted desktop key-boundary baseline1/1 RED; web report-retention baseline1/1
  RED. Initial web invocation used a nonexistent guessed test path; verified
  path is src/lib/repository/overhaul-storage-baseline.test.ts, and its rerun
  reached the actual retention assertion. No test skip/inversion/timeout change.
- Typecheck during worker test-first RED temporarily failed on a missing policy
  module; final integrated typechecks passed. Both workers closed; temporary
  preview92672 was stopped (interrupt returned terminal exit1 as expected).
  Unrelated user previews were untouched. Full desktop build/installer/signing
  and live research still open.

Local startup commit: `012aff3`; contract/baseline/docs checkpoint: `b2c6398`.
Both are preserved on the predecessor and new spin-off branch. New human
checkpoint-push authority is recorded above; no main merge/migration/release.
Next G00-P05: typed cached-read projections and explicit record/version envelopes,
including sparse/period/conflict/evidence states. Reuse existing domain schemas
where correct, do not add generic untyped payloads or another backend. Verify
contract fixtures and current action/caller review before G00 completion. Then
G01 starts the packaged SQLite binding spike and offline vault/migration work.
Keep the full goal active; development spend is unknown and not a blocker.

## Packet G00-P05 — Cached read and retained evidence freeze

Entry HEAD `6d55272`, September30. Human requested uninterrupted progress while
away; existing separate-branch/personal-fork policy remains. Sol planned and
integrated; Luna high worker Euclid (`01a0f437-a363-79a3-8384-36ce6e45525f`)
implemented only vault-evidence.ts/test.ts and was closed after review. No Astra,
new dependency, paid product research, actual user data, or secret access.

Additive action-reads.ts covers all20 read actions with strict typed results,
vault/request/record revision, freshness, gaps, evidence and bounded pagination.
Correlation rejects wrong request/vault/target/fixed revision; nested identities
and selected company sets are checked. Sparse cards remain sparse. Numeric card
facts retain actual value/unit/currency/period and source references, rather
than disconnected formatted strings. At most3 facts; text facts have their own
support. Evidence bundles retain source versions/passages and reject dangling
links/foreign vault records. Complete briefs require retained support; unknown
prices stay null; preview cannot promise closed-app monitoring. Creation receipts
for markets/schedules/grants/connections/budgets/trash identify the created ID
and revision. Provider status reuses input capability vocabulary (no drift).

Worker records separate observed/published/event dates, origins and selected
visibility. Zero is valid; unknown is null; supported/conflicted observations
need retained evidence. Coordinator review reproduced/fixed equivalent timestamp
spelling mismatches, unknown-period comparability, supported-null/conflict gaps,
and forced fake public URLs/hash values on private/failed source records.
Unknown periods or money without currency have no comparison key. Shape validation
does not establish truth, access, human confirmation, protected storage or runtime
fencing. G01 must enforce reference relationships and append-only persistence;
G02/G07 must enforce current grants including transitive support on actual reads.

Test-first missing modules were reproduced after the sandbox esbuild access
failure was resolved by approved offline execution, not runner changes. Later
independent adversarial cases failed at intended assertions before fixes.
Final `pnpm check`: all6 package typechecks and root lint passed; contracts353
and mocks16 passed; research314 passed/9 ordinary RED baseline failures; exit1.
Downstream web/desktop/API suites did not run after that recursive failure.
Earlier intermediate checks are superseded by this final tree. Existing 2 extra
desktop/web RED baselines and public browser captures are prior G00-P04 evidence,
not newly fixed/retested outcomes. No full green, live-quality or packaged claim.

G00 freeze acceptance: complete catalogue request/read/error/state/policy shapes,
command/output identity, canonical evidence/version primitives, current caller/
route dispositions, public captures and deterministic risk reproductions exist.
They provide the baseline for fixes, not a production implementation. Runtime
authorization/transport parity cannot be proven by shape tests and is explicitly
deferred to the shared service gates, not silently marked passing. Physical record
schemas can extend these contracts in G01 without weakening their trust rules.

Direct installed-runtime investigation: Electron44.4.5, Node24.21.0, SQLite3.53.4;
built-in FTS5 lookup and backup function passed using an in-memory synthetic DB.
First probe had a shell quoting error (Electron returned0 despite syntax error),
corrected probe produced parsed version/search evidence. This is NOT packaged,
crash/recovery, installer, security-patch or signing acceptance. G01-P01 worker
Descartes (`01a0f442-bd46-7d00-9086-02b01c974b90`, Luna/high) owns only optional
build spike entry and isolated SQLite process scripts; no vault/user migration.
Next: verify that same binding in an unsigned unpacked artifact with publishing
disabled, FTS5, crash rollback, reopen/integrity and real online backup, then build
the actual vault. Keep the broad goal active and checkpoint tested milestones.

## Change record (history)

- September30 GitHub backup verification: created only the absent spin-off remote branch, guarded by an expected-absent ref lease; no existing history was force-updated. GitHub tip matched local `73e61c0`; all 49 prior branch refs were identical before/after. Root gate remains honestly RED as recorded in G00-P04. Limited credential-pattern review found only two public article URL-slug false positives in HEAD and no candidate patterns in added history; not an exhaustive secret audit. Git's first-run credential-helper selector stalled two attempts before transfer; interrupted those attempts and closed only their identified selector processes. Using installed Git Credential Manager directly for the upload succeeded without reading credentials or changing global settings. Branch tracks newsam; local remote.pushDefault is newsam. Future checkpoints must use normal fast-forward pushes, not the initial create-only lease.

- September30: human authorized periodic GitHub checkpoint saves on a new branch under NewSamBellamy, preserving everything else. Verified personal fork is STRATEMARK-latest--1; shorter old URL redirects to Maruf. Created feat/stratemark-spinoff-local-agents from b2c6398, retained predecessor, and added separate newsam backup remote without changing origin/tobi. Core model/provider/MCP direction remains the accepted north star; universal compatibility is a target, not a tested claim.

- September 30, 2026: current execution policy changed by human goal to Sol planning/Luna high-effort workers, Astra disabled, development billing gates deferred. Product decisions remain v1.0.0; no change to release privacy/consent or deployment authority.
- September 30, 2026, v1.0.0: researched defaults chosen after handwritten architecture review and read-only Astra red team. Created canonical spec, A01-A62 actions, G00-G08 goals, dated source ledger, and this cold-start record. No application code/data/provider credentials changed; no implementation agents launched. Astra's planning review is not implementation evidence.
