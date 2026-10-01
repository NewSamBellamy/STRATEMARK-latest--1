# Closed Stratemark build packet evidence

Historical records copied intact from BUILD-STATE on September30, 2026.
Current status, authority and next work live only in [BUILD-STATE.md](BUILD-STATE.md).
Statements below describe their original packet date, not current execution
instructions or release readiness. Consult relevant records selectively.

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

## Packet G01-P01 — Native binding proof and safe legacy inspection

Entry HEAD `ed58ebc`, September30. That contract checkpoint was pushed normally
to the personal spin-off; all49 other branch refs were unchanged. Sol integrated
the bounded Luna/high worker's optional native spike (worker closed). No provider
calls, secret reads, real research migration, installer launch, signing or
publication. Generated packages/fixture data remain ignored, not in Git.

Legacy fixes: normalize/migrateSnapshot is now a pure format inspection and no
longer changes running jobs to failed. Restart recovery remains explicit at the
legacy repository constructor; existing restart test still passes. Future-format
inspection retains an independent exact-format copy, including unknown fields.
Repository construction rejects future formats with SCHEMA_TOO_NEW before client
construction/provider work/writes. Explicit invalid versions and missing migration
steps fail instead of fabricating a current-version stamp. The future baseline was
strengthened to require early refusal, zero provider calls, zero writes and
unchanged source, not skipped or weakened. This is not G02 durable-lease recovery.

Test-first evidence: original inspection/startup assertions failed before the
separation; 10 additional malformed-version/missing-chain/future-ownership cases
failed at intended assertions before guards. Final migrations19 + pipeline19 pass;
desktop storage5 pass. Final full root gate passes typecheck/lint/contracts353/
mocks16; research326 pass/7 ordinary baseline failures; downstream suites stop.
Independent downstream runs: desktop29 pass/1 plaintext-key boundary failure;
web148 pass/1 quota-retention failure; API158 pass. Both mocked web journey tests
pass. Live research fixtures that return early without a key are not quality proof.
One intermediate typecheck failed on the test fixture's optional migration type,
and a later lint failed on explicit native globals; both were fixed and rerun.

Native fixture files: apps/desktop/scripts/sqlite-spike.mjs runner,
apps/desktop/src/sqlite-spike.mjs entry, optional --sqlite-spike build switch.
Ordinary builds remove only the exact optional bundle. Runner requires parsed
success markers, not merely an exit code; creates its own temporary DB, confirms
the PID/path of its own child, forces termination only there, and validates its
temporary root before cleanup. All data is synthetic. Checks prove FTS5 search,
WAL reopen, real online backup while committed WAL frames exist, backup reopen,
1,582,112-byte uncommitted-WAL forced-crash rollback, committed-record survival,
and integrity_check=ok. SQL sqlite_version/source_id agree with runtime metadata.

Verified final artifact: ignored apps/desktop/release/sqlite-spike-20260930-ed58ebc-3.
Unsigned NSIS installer SHA256:
`4955249e9a2dd8083c7337ecd7a3676b27603828225ea72b444d61bbffea038f`.
The same checks passed in both win-unpacked and the payload extracted from that
actual installer, with the module inside resources/app.asar. Installer was never
installed/launched. Chosen offline adapter binding: node:sqlite, Electron44.4.5,
embedded Node24.21.0, SQLite3.53.4, SQL source ID
`2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc`.

Primary references checked September30: [official Electron release](https://releases.electronjs.org/release/v44.4.5)
confirms embedded Node version; [matching Node API source](https://raw.githubusercontent.com/nodejs/node/v24.21.0/doc/api/sqlite.md)
marks the API Stability1.2/release-candidate, with synchronous DB calls;
[SQLite release history](https://www.sqlite.org/changes.html) matches the exact
3.53.4 source ID and includes the preceding WAL-reset fix. This is a specific
patch/version check, not a comprehensive dependency/CVE clearance. Follow
[SQLite's defensive-input guidance](https://www.sqlite.org/security.html): private
main-process boundary, bound parameters, extensions off, trusted_schema off,
defensive mode, bounded queries and validated imports. Keep API candidate status
and production performance/installation/security/signing gates open at G08.

Packaging failure and diagnosis: artifact1 failed a real syntax assertion. Byte
audit found retained module content intact but archive offsets wrong beginning
at the workspace migration-test source, which was being edited/formatted during
packaging. Frozen-tree rebuild2 passed; final rebuilt bundle/package3 and extracted
installer payload passed. Never edit/format dependency or app files while a
package is being assembled; use a frozen checkout/checkpoint for release builds.
This was not hidden by extracting/replacing just the broken test module.

Reproduction (publishing/signing disabled, fresh output directory required):

```powershell
pnpm --filter @mi/desktop exec node scripts/build.mjs --sqlite-spike
# From apps/desktop, with a NEW ignored output path and frozen source:
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
pnpm exec electron-builder --win nsis --x64 --publish never --config.directories.output=release/sqlite-spike-NEW --config.forceCodeSigning=false --config.win.signAndEditExecutable=false
# From repository root; use the matching generated executable and ASAR:
node apps/desktop/scripts/sqlite-spike.mjs --electron apps/desktop/release/sqlite-spike-NEW/win-unpacked/Stratemark.exe --module apps/desktop/release/sqlite-spike-NEW/win-unpacked/resources/app.asar/dist/sqlite-spike.cjs
```

Open: G01 vault schema/transaction fences, company identity/memberships, passage/
observation relationships, offline fixture migration and full backup/restore;
9 legacy release blockers, G02 shared service/secrets, frontend redesign and MCP.
No production readiness, always-on operation or host compatibility claim.

## Packet G01-P02 — Offline inventory vault and explicit quota failure

Entry HEAD `467f624`, September30. P01 backup verified at that exact tip with all49
other refs unchanged. Sol built/integrated the native inventory; bounded Luna/high
worker Heisenberg (`01a0f456-68cf-7f20-bb7d-62491d2dcac7`) owned only legacy
localStore.ts/test.ts and quota baseline. Worker finished and closed. No Astra,
live research, key reads, actual user data, UI restyle, live migration or publication.

New apps/desktop/src/vault.ts is an isolated G01 adapter, NOT installed as the
production repository. A single versioned SQLite file retains companies, markets,
many-to-many role memberships, append-only record history, FTS5, vault revisions
and real online backups. It uses the shared strict record/version validator and
precise timestamp comparator; no fake numeric facts or auto company merging.
IDs, not names, determine identities. Bound parameters and literal FTS terms;
bounded cursor pages include their read-snapshot vault revision. Too-long/many
search terms fail rather than discarding the query tail. Creation time is
immutable, update time cannot go backwards even at submillisecond precision,
record revisions advance exactly once inside BEGIN IMMEDIATE transactions, and
failed writes roll back state/history/index/revision. Two handles' stale record
writes fail; this does NOT fence a stale worker after vault replacement.

Existing files are inspected read-only before journal/header changes. Future,
unrecognized, wrong-vault, corrupt or broken-FK files fail safely; no reset or
auto-adoption of unrelated SQLite data. Reads reject body/index identity mismatch.
Extensions off, defensive mode, foreign keys, trusted_schema off; input schemas
are strict. Backup refuses current/existing destination. Internal paths are
trusted local paths, NOT connector parameters. Owner locking, writer generations,
restore/cutover, path/symlink boundaries and backup-race/asset drills remain open.
No source passages/observations/claims/reports/grants/budgets are in this inventory
schema yet; do not mistake it for an all-record vault or expose it to MCP.

Desktop @types/node is pinned to24.19.0 to match embedded Node24 API; lockfile
updates are this type/peer-context change, not a runtime-provider upgrade. Vite5
predates node:sqlite's builtin list; native createRequire resolves only that Node
builtin with real types. No runner/config/timeout workaround or added native addon.
Ordinary main builds still remove the optional SQLite proof entry.

Legacy quota fix: a synchronous write attempts the whole snapshot exactly once;
failure throws LocalStorePersistenceError and preserves prior report-bearing
stored bytes, backup and source. No shedding dashboards/reports, no false
IndexedDB-success log. Mirror runs only after a full local commit and consumes
its own async rejection; it remains best-effort, not a second authority. The
baseline was strengthened to require an explicit failed save and unchanged prior
research, rather than the impossible assertion that an always-rejected write
somehow durably saved. Existing shrinking-write backup behavior still passes;
backup is attempted only after primary success. Existing corrupt-read/start-clean
and stale-tab/replica-recovery concerns remain open; this fix does not solve them.
Repository in-memory rollback and polished user-facing recovery belong to G02/G04.

Test-first: missing vault module failed collection after native builtin routing;
initial12 acceptance cases passed with actual temporary DBs. Independent three
assertions then reproduced timestamp/body-ID/FK gaps before fixes. Paging/tail
cases also failed before implementation. Final native tests19/19, canonical
evidence9/9. Worker quota tests went RED against stripped retries, precommit
backup replacement and false mirror success; final scoped8/8 pass. Coordinator
strengthened synthetic fixture shapes rather than keeping never-casts.

Final verification: pnpm check passes all6 typechecks/root lint/contracts353/
mocks16; research326 pass/7 known RED failures (root exit1, downstream not run).
Independent desktop48 pass/1 existing secret-boundary RED; full web153/153 pass,
including both journey tests. Earlier import-style lint errors were fixed without
disabling rules, then full gate rerun. Formatting/diff checks passed after worker
source was formatted. No API suite rerun this packet; P01's API158 is historical.
Live provider fixtures return early without keys and prove no research quality.

Optional native fixture now imports the actual vault module. Structured proof
requires shared company across two markets, retained correction history, rejected
stale record revision, bounded search continuation and reopened native-vault backup,
in addition to prior SQL/FTS/crash/online-backup checks. New required proof fields
failed against the old packaged fixture before implementation. All checks passed
in native Electron and in ignored unsigned package
apps/desktop/release/sqlite-spike-20260930-467f624-vault/win-unpacked, module inside
resources/app.asar. Runtime/source ID match P01. Package tree was frozen; no
installer/new UI run this packet. P01's installer payload proof is not retroactively
a new full-installation claim for P02.

Next bounded packet: persist canonical retained evidence with actual hash/link
validation and period-compatible observations; avoid a new opaque whole-vault
JSON snapshot, generic arbitrary-SQL API or premature service/renderer cutover.
Add minimum exclusive owner/writer-generation fencing before fixture migration.
Remaining8 original blockers stay ordinary RED; broad goal stays active. Save
each meaningful verified checkpoint to newsam spin-off, never main.

## Packet G01-P03 — Retained evidence and period-aware native observations

Entry HEAD `fc59ac2`, September30. P02 fast-forward backup verified at that tip;
all49 other remote branches remained unchanged. Sol owns integration/evidence,
Luna/high worker Ampere owns only vault-schema.ts/test.ts (completed and closed).
US01/US13/US16/US23/US30; prepares A05/A25/A42/A47/A61, not a wired action service.
No Astra, provider calls, key reads, live data, UI redesign, installation or publication.

Native vault schema2 has an explicit transactional chain from P02 schema1.
Read-only inspection accepts only recognized schemas/identity/mandatory columns,
checks integrity/FKs and never upgrades. Write initialization rechecks under
BEGIN IMMEDIATE; failed DDL rolls back without stamping2. Existing inventory,
history, FTS and vault revision survive the synthetic upgrade. A missing evidence
column, unrelated DB, too-new version or wrong identity is refused, not repaired.
This is not a validated external import or complete malicious-schema auditor.

vault-evidence-store.ts reuses the canonical source/passage/observation validators.
Sources retain exact UTF-8 text (at most2000000 bytes) and a checked SHA256;
lossy Unicode and false hashes are rejected. Failed/blocked retrieval has no
fabricated content/hash. Private user-provided evidence need not have a public URL.
Sources append exact versions with CAS/chronology checks. Passages must hash
correctly, occur verbatim in that source version, retain origin and never broaden
its selected company/market scope. Quotes and observations are immutable records
at revision1; corrections append new IDs rather than rewriting old support.

Immutable internal metric definitions retain label/meaning/unit/currency mode/
scope kind/period kind. Numeric observations must fit the definition, reference
an existing company, and use the exact source/version/passage tuple. Composite
FKs, ordered evidence junctions and append-only triggers preserve relationships.
Market-scoped observations require membership in that market and market-scoped
evidence; company-wide observations require explicit company-scoped evidence.
This avoids promoting private market-only evidence into a shared dossier.
Company/market metric scopes are implemented; product/segment/geography scope
registries remain open and fail closed here. This is not connector authorization.

Periods, currency, scope, metric definition and company determine comparison
identity. Different periods coexist; same-period competing values and real zero
are retained. Unknowns stay null and unknown periods are not comparable. Bounded
cursor pages carry one SQLite snapshot revision. Different-value flags are review
candidates, NOT adjudicated conflicts. Presence/hash/link checks do not prove a
quote supports the stated number or period; semantic support checking and eligible
card-fact selection remain G03/G04. A declared supported record is not a human
attestation; the strict schema rejects user_verified. No production writer/service
or existing research path has been switched to this adapter.

Verification (actual final source):

- Test-first18 evidence cases: initial16 missing-method failures; Unicode case
  reproduced lossy retention before its fix; definition getter failed before
  implementation. Final inventory19 + evidence18 + schema15 =52/52 pass on real
  disposable SQLite. No mocks/timeouts/rules changed. Coordinator reviewed and
  reran Luna's schema tests with the actual evidence DDL.
- pnpm check: all6 typechecks/root lint/contracts353/mocks16 pass;
  research326 pass/7 original failures; root exit1, downstream not reached.
  Independent desktop81 pass/1 original secret-boundary failure. Full web153/153
  pass, both journeys pass (3.085s total). API not rerun; historical158 not current
  evidence. Keyless live fixtures return early, not live quality verification.
- Normal desktop main build passes and removes optional proof bundle. Source
  formatting/whitespace checks pass. A scoped lint attempt included the already
  ignored scripts file and warned; final non-ignored source lint/root lint pass.
  One runner invocation omitted required arguments; corrected explicit invocation
  passes. Neither environment/invocation error was counted as assertion RED.
- Optional native proof requires new evidence/upgrade fields; old P02 package
  fails those assertions. Rebuilt Electron and unsigned unpublished ASAR proof
  pass: schema1 company/history survive upgrade2, retained source/passages and
  two annual observations survive backup, true zero retained, periods not combined,
  false hash rejected. Prior FTS/WAL/online backup/SIGKILL checks also pass.
  Runtime matches P01: Electron44.4.5/Node24.21.0/SQLite3.53.4, same SQL source ID,
  1582112 uncommitted WAL bytes before kill, committed data survives, uncommitted
  absent, integrity ok. Fresh ignored artifact:
  apps/desktop/release/sqlite-spike-20260930-fc59ac2-evidence/win-unpacked.
  Frozen source during packaging; no new NSIS/full GUI/installation proof.

Remaining:8 original legacy/security defects (not fixed merely by new adapter
tests), exclusive owner/writer generations, staged snapshot migration, reports/
findings/jobs/policies/assets and validated export/import/restore/GC. Internal
source reads can return large text; do not expose them as unbounded MCP responses.
Backup path/race and malicious-import boundaries, source retention performance,
semantic verification and true UI/service parity remain open. Continue G01-P04;
keep the full goal active and back up meaningful slices only to newsam spin-off.

## Packet G01-P04 — Exclusive owner and late-result write fences

Entry HEAD `6500427`, September30. Sol owns native ownership, integration,
packaged proof and this ledger. Luna/high worker Raman owns the legacy repository
fence and tests; completed, reviewed and closed. Sol strengthened the field-order
regression and existing restart scenario. No Astra, key reads, provider calls,
live research/data migration, UI restyle, installation or publication.
US13/US23/US24/US30; prepares A27-A31/A42/A43/A47, not wired action-service parity.

Native schema3 adds persisted writer generation and a fresh opaque nonce, with
explicit transactional v1-to-v2-to-v3 and v2-to-v3 upgrades. Inspection and genuine
read-only handles never upgrade or advance a generation; missing, invalid and
future schemas still fail closed. Owner construction advances once, including
after a crash. Inventory, histories and retained evidence survive the upgrade.

A separate identified SQLite guard file holds BEGIN IMMEDIATE for the native
owner's lifetime. The research database commits independently in WAL mode.
This reuses SQLite's local process locking, not expiring PID/heartbeat files.
An existing guard file is not proof of a live owner, and unrelated guard data
is refused, not deleted. Canonical parent/path resolution and regular-file,
no-hardlink checks prevent competing guard names for the tested aliases. File
identity checks fence a replaced/moved file; Windows additionally refuses a
rename of a currently open native database. Nonce mismatch permanently invalidates
the owner even if older metadata reappears. See official SQLite
[transactions](https://www.sqlite.org/lang_transaction.html) and rollback-guard
[locking](https://www.sqlite.org/lockingv3.html); actual process behavior is tested
below, not inferred from documentation alone.

The base handle exposes cached reads/status/backup/close, not mutation methods.
Its trusted internal writer() captures one generation. All inventory/evidence
writes check it before/inside their transaction and before commit. Advancing the
generation fences existing capabilities without changing content revision.
Runtime jobs must capture once when accepted, not reacquire a new capability to
save a late result. Readers cannot obtain writers or advance a generation.
No path, nonce, SQL handle or writer factory is exposed to renderer/MCP.

Legacy GeminiRepository now compares canonical JSON content with the last
successfully persisted baseline before a write, clones input/write payloads,
and permanently rejects ownership loss with REPOSITORY_OWNERSHIP_LOST. Failed
storage writes do not advance the saved baseline. Object key order is not an
authority change; array order and JSON value semantics remain significant.
Migration writes use the same guard. The existing late-provider baseline now
requires an explicit rejection and unchanged replacement with zero extra writes.
An externally changed saved job is resumed through a deliberately reopened
repository, not an already-open stale owner. Cached completed-job reads need
not throw merely because they do not write. This transitional content guard is
NOT atomic cross-process CAS and cannot detect identical-content ABA replacement.
Failed saves can still leave in-memory changes; rollback/error UX remains open.

Test-first and integration evidence:

- New owner tests initially fail for missing reader/captured-writer boundaries;
  stored nonce ABA test fails before the permanent-invalidity latch. Final
  inventory19 + evidence18 + schema16 + owner11 =64/64 on real disposable DBs.
- Worker reproduces blind late persistence; its six fence tests pass after the
  fix. Integration finds a legitimate alias/merged-store key-order false positive;
  a seventh regression fails before canonical comparison, then passes. The first
  restart assertion targeted a no-write completed-job read; corrected to a real
  write, and wrapped the synchronous error correctly. Final fence7 and pipeline19
  pass. No baseline assertion is skipped/inverted and no timeout/config is relaxed.
- Standard pnpm check: all6 typechecks/root lint/contracts353/mocks16 pass;
  research334 pass/6 original RED failures, root exit1. Independent desktop93
  pass/1 original renderer-secret RED; web153/153 pass (both journeys, 3.037s).
  API not rerun. Keyless live tests return early: no live quality claim.
- Expanded packaged-proof assertions fail against P03's old ASAR. Rebuilt native
  Electron and fresh unsigned unpublished ASAR pass all required structured
  fields. A confirmed-live second process cannot obtain ownership; a reader can
  read committed data without writing. Forced SIGKILL with1582112 uncommitted WAL
  bytes leaves committed data intact/uncommitted absent/integrity ok. Replacement
  owner obtains generation2 and saves a correction. Old generation capabilities
  cannot save inventory or evidence. Upgrade, period/zero, hashes and backups
  continue passing. This is the actual bundled module, not extracted substitutes.
- Frozen artifact: apps/desktop/release/sqlite-spike-20260930-6500427-owner/
  win-unpacked, module resources/app.asar/dist/sqlite-spike.cjs. Runtime remains
  Electron44.4.5/Node24.21.0/SQLite3.53.4 with P01's source ID. No edits during
  packaging. No new NSIS/install/full-GUI acceptance. Normal desktop main build
  passes and removes the optional proof bundle. Formatting and whitespace pass.
  Sandbox compiler denial is resolved by approved identical offline commands;
  runner configuration is unchanged.

Limitations: exclusive owner is per canonical local file, not an authenticated
cross-process service or a registry across copies of the same vault ID. Not a
defense against privileged arbitrary SQLite/filesystem writes; network filesystem
behavior is unverified. Closed backup copies preserve historical generations:
future restore must drain/fence the old owner and advance beyond the active
generation, never blindly adopt a backup counter. Provider cancellation/draining,
attach/handoff, durable job leases, complete migration/rollback, guarded backup
paths/races, assets/GC, imported disabled authority and scope enforcement remain
open. Hash/link checks still do not establish semantic support or human verification.

Seven original release blockers remain: uncached tab triggers provider, legacy
metric period loss, premature cancellation, shared-company projection invalidation,
same-name/different-domain collapse, different-period conflict collapse, renderer
plaintext-key retrieval. Keep these ordinary RED while implementing the phased
replacement. G01-P05 is typed remaining records and staged synthetic migration,
not a live migration or permission to skip G02-G08. Full goal remains active.
Read actual Git tips before each authorized fast-forward spin-off checkpoint.

## Change record (history)

- September30 GitHub backup verification: created only the absent spin-off remote branch, guarded by an expected-absent ref lease; no existing history was force-updated. GitHub tip matched local `73e61c0`; all 49 prior branch refs were identical before/after. Root gate remains honestly RED as recorded in G00-P04. Limited credential-pattern review found only two public article URL-slug false positives in HEAD and no candidate patterns in added history; not an exhaustive secret audit. Git's first-run credential-helper selector stalled two attempts before transfer; interrupted those attempts and closed only their identified selector processes. Using installed Git Credential Manager directly for the upload succeeded without reading credentials or changing global settings. Branch tracks newsam; local remote.pushDefault is newsam. Future checkpoints must use normal fast-forward pushes, not the initial create-only lease.

- September30: human authorized periodic GitHub checkpoint saves on a new branch under NewSamBellamy, preserving everything else. Verified personal fork is STRATEMARK-latest--1; shorter old URL redirects to Maruf. Created feat/stratemark-spinoff-local-agents from b2c6398, retained predecessor, and added separate newsam backup remote without changing origin/tobi. Core model/provider/MCP direction remains the accepted north star; universal compatibility is a target, not a tested claim.

- September 30, 2026: current execution policy changed by human goal to Sol planning/Luna high-effort workers, Astra disabled, development billing gates deferred. Product decisions remain v1.0.0; no change to release privacy/consent or deployment authority.
- September 30, 2026, v1.0.0: researched defaults chosen after handwritten architecture review and read-only Astra red team. Created canonical spec, A01-A62 actions, G00-G08 goals, dated source ledger, and this cold-start record. No application code/data/provider credentials changed; no implementation agents launched. Astra's planning review is not implementation evidence.

## Archived G01-P05 — checkpoint ec8dcee

Entry HEAD `9e63778`, September30. P04 GitHub tip verified identical and all49
other refs unchanged. Sol owns additive contracts/native records/schema, packaged
proof and integration. Luna/high worker Franklin owns only legacy correction
invalidation and its test; completed, reviewed and closed. No Astra, provider
calls, key reads, live data migration, UI restyle, installation or publication.
US13/US16/US19/US23/US30; prepares A05/A18/A22/A25/A47, not action-service parity.

Native schema4 retains versioned qualitative claims, market findings and reports
in typed append-only tables. Each version has strict metadata, exact evidence
links, immutable origin/target, revision CAS and chronological history. Findings
have their own market support and company memberships; no inherited numeric
metrics. Risk records preserve allegation/event/ongoing/resolution attribution.
Imported claims/findings remain reported/unknown, not locally verified; an
imported reported resolution can be preserved without claiming local resolution.
Imported reports remain incomplete with an explicit unvalidated-evidence gap.
No machine metadata can set human verification.

Report prose is saved verbatim. Input pins identify exact company/market history,
claim, observation, finding or earlier report revisions. Older reports retain
their input versions after later corrections. An identity-only version registry
and foreign-key junctions enforce retained references; it is not a generic JSON
vault store. All transitive support is pinned; missing versions, mismatched
passages, cycles, oversized dependency graphs and scope expansion fail before
commit. Source/hash/link validity is NOT semantic adjudication of the prose.
Unknown/attributed records do not become eligible card facts through this adapter.

Company or market report scope is explicit. A market report may reference a
member company's company-wide evidence, not another market's private evidence.
A company report cannot launder market-private input reports. Finding support
must be directly market-scoped, not borrowed from company-only passages.
Cross-market report projections, scoped connector reads and semantic fact
selection remain future service/G03/G05 work, not claims of completed parity.
Internal reads support exact/latest versions and bounded cursor pages carrying
one SQLite revision; full prose/source payloads must not be exposed as unbounded
MCP responses. Trusted captured-generation writers fence all new record saves.

Version1/2/3-to4 upgrades retain inventory/history/evidence and existing writer
generation. A v3 fixture at generation7 upgrades without resetting it. Collision
during new DDL rolls back to the original schema3 and data, not a repaired/reset
vault. Registry population uses retained inventory history and observations.
Actual owner construction still advances the generation separately.

Legacy correction fix follows all entity-card-to-deck-to-market memberships to
invalidate affected opportunity caches, including manual/cited corrections and
other canonical metric updates. It preserves unrelated markets, handles multiple
decks once, and falls back only to a unique legacy name when no valid owner link
exists. Ambiguous/stale legacy names are not identity proof. The unchanged G00
shared-company correction baseline now passes; ownership-loss protection remains.

Verification of final sources:

- Six additive contract cases: missing module RED, then GREEN. An additional
  imported-resolution assertion reproduces lost attribution before its fix.
- Eleven native research cases: nine missing-method RED; deep dependency case
  later reproduces save/read bound mismatch before the fix. Save validation now
  counts its root, so accepted records can be read at the same graph bound.
  Exact observation pins retain true zero and period/definition support.
  Native totals inventory19/evidence18/schema18/owner11/research11 =77/77.
- Worker unchanged baseline RED before fix; final new projection8/8 pass (six
  worker cases, two coordinator ambiguity/stale-name cases). No skipped/inverted
  baseline or relaxed timeout/config. Full pnpm check: all6 typechecks/root lint,
  contracts359/mocks16 pass; research343 pass/5 original failures, root exit1.
  Independent desktop106 pass/1 original secret-boundary failure; web153/153
  pass, both journeys3.087s. API not rerun; historical158 is not current evidence.
  Keyless live fixtures return early, not live research quality.
- New required packaged assertions fail against old P04 ASAR. Expanded native
  Electron and fresh unsigned unpublished ASAR pass: schema1-to4; historical
  claim/finding/report versions and report inputs survive later corrections and
  real backup; private report scope expansion refused; old writer cannot save a
  report. Prior owner contention/read-only reader/forced SIGKILL takeover,
  FTS/WAL/backup/period/zero/hash checks pass. Runtime remains
  Electron44.4.5/Node24.21.0/SQLite3.53.4, P01 source ID,1582112 pending WAL bytes,
  recovery integrity ok and replacement generation2.
- Frozen ignored artifact: apps/desktop/release/
  sqlite-spike-20260930-9e63778-research/win-unpacked, actual module inside
  resources/app.asar/dist/sqlite-spike.cjs. No source edits during packaging;
  no new NSIS/install/full-GUI acceptance. Ordinary desktop main build passes and
  excludes the optional proof entry. Formatting/diff checks pass. Compiler
  sandbox restrictions use identical approved offline commands, not new runners.

Remaining: passive jobs/attempt history, receipts/policies/schedules, saved items,
complete company identity/market scope, assets and full staged migration plus
validated backup/restore/import/export/trash/GC. No live adapter cutover; no
provider draining, real job runtime, MCP host, card redesign or production release
acceptance. Six original blockers remain: uncached-tab provider call, legacy
period loss, premature cancellation, same-name/different-domain collapse,
different-period conflict collapse, renderer plaintext-key retrieval. The broad
G00-G08 goal remains active.

## Closed packet — G01-P06

Entry HEAD `ec8dcee`, September30, clean personal spin-off branch. The prior
checkpoint was verified on GitHub with all49 other refs unchanged. Sol owns
offline snapshot inspection, proof entry and integration; Luna/high worker
Laplace owns the bounded legacy identity patch/tests. Coordinator review caught
and corrected post-publication ID remapping before integration. Worker completed
and closed; no active workers remain. No Astra, stored-key/customer-data reads,
provider calls, live migration, UI restyle, installation or publication.
US01/US13/US14/US16/US23; prepares A10/A44/A45, not action-service parity.

Internal inspectLegacySnapshot accepts JSON text, not arbitrary filenames.
It recognizes unversioned v1, explicit v1 and v2 and uses the registered version
chain. Unknown/future versions and unrecognized top-level families fail closed;
nothing is silently dropped or stamped current. Input ceilings are50MiB UTF8,
64 container levels and200000 structural tokens. Duplicate object members,
including escaped duplicate keys, fail before JSON.parse can lose a value.
Invalid JSON, nonfinite parsed numbers and structural credential fields fail
with safe code/family errors, not source-value/error-payload dumps. Credential
field refusal is not a guarantee that arbitrary prose contains no sensitive text.

Inspection covers all14 known array/map families plus dashboard-tab counts.
Stable IDs and references are checked across companies, markets, decks, cards,
metrics, risks, reports, saved cards, briefings, threads/memory and job partials.
Minimal older job metadata remains readable history; present typed metadata
validates. Uncommitted companies/decks/markets remain within their historical
job rather than being inserted into main inventory. Duplicate partial-card and
memory-fact IDs are refused. Site-audit subjects may be external URLs, not
fabricated company IDs. Known display schemas validate, but their transformed
output is NOT used as retained historical content: nested scope/period fields
are preserved through a separate raw-data migration copy.

Exact original JSON and its byte length/SHA256 are retained for future staging.
Saved report prose, numeric zero, explicit periods, old confidence labels and
job statuses are preserved, not normalized into new facts/authority. Imported
attestations are counted as attributed assertions; no local attestations,
runnable jobs, schedules, grants or budget approvals are proposed. URLs/snippets
do not become supporting passages. External logo references and missing support
remain review gaps; nothing is fetched. Company IDs are never merged by the
inspector. Explicit card/deck links yield market-role proposals; a unique legacy
market-name fallback is labeled legacy_name, not evidence of scope or identity.
Ambiguous names/domains stay review groups. Private evidence disclosure still
requires the future scoped service.

canApply is always false. The returned snapshot/originalJson are internal,
local-only staging inputs, NOT renderer/MCP read results or live repository
hydration. No staged database was created and no live adapter was switched.
storage.ts only exposes the existing validation schema additively (plus
formatting); the old live parser's conversion behavior is unchanged. Thus the
nested-field preservation fix here is NOT a claim that legacy live imports
or cached UI projections are already corrected.

Legacy repository ingestion/hydration no longer merges saved dossiers by name.
Unique eligible normalized domain evidence can reuse an existing ID before
stub publication; missing/ambiguous domains stay distinct. Conflicting supplied
IDs allocate a separate unpublished identity instead of overwriting a dossier.
After publication, later domain discovery cannot rekey/delete the dossier,
dashboard, metrics or job partial. Explicit candidate-domain mismatch cannot
fall back to a unique name. A conservative shared-profile-host guard excludes
hostname-only reuse on common profile sites; it is not exhaustive semantic
domain/ownership validation. Briefings dedupe company IDs and ambiguous names
do not resolve to an arbitrary dossier. P04 ownership fences and P05 multi-market
invalidation remain intact.

Verification of final sources:

- Inspection module missing RED first, then19/19 GREEN. Additional RED checks
  reproduced duplicate partial identity, stripped nested scope/period fields,
  numeric overflow, bare-domain review gaps and invalid catalog roles before
  fixes. Public repository sample also passes inspection. A coordinator long-name
  identity check was already GREEN and required no implementation change.
- Luna identity tests RED before implementation and coordinator-requested
  immutable-ID/conflicting-ID/shared-profile checks; final identity11/11.
  Existing unchanged same-name baseline now passes. No baseline edits/skips,
  relaxed timeouts, changed runners or fake live success.
- Full pnpm check: all6 typechecks/root lint pass; contracts359/mocks16 pass;
  research355 pass/4 original failures, root exit1. Independent desktop125
  pass/1 original key retrieval failure; native inventory19/evidence18/schema18/
  owner11/research11 =77/77; inspection19/19. Web153/153, both journeys2.990s.
  API not rerun; keyless live fixtures are not live research-quality evidence.
- New packaged assertions fail against P05's actual ASAR before implementation.
  Native Electron and frozen fresh unsigned unpublished ASAR pass all known
  inspection formats, exact-original preservation, history-not-resumed,
  attribution-not-authority, shared memberships and future/duplicate refusal.
  Prior schema1-to4/evidence/report/backup/owner contention/reader/SIGKILL takeover
  proof remains GREEN: Electron44.4.5/Node24.21.0/SQLite3.53.4, same SQL source ID,
  1582112 pending WAL bytes, integrity ok and replacement generation2.
- Ignored artifact: apps/desktop/release/
  sqlite-spike-20260930-ec8dcee-inspection/win-unpacked, actual proof inside
  resources/app.asar/dist/sqlite-spike.cjs. Source frozen during packaging;
  ordinary desktop main build passes and excludes the optional proof entry.
  This is NOT new NSIS/install/full-GUI acceptance. Formatting/diff checks pass.

Remaining: actual typed/passive legacy retention and staged conversion, complete
company identity/scope, assets and backup/restore/import/export/trash/GC;
service ownership/handoff/provider draining, durable task runtime, MCP and the
card/journey overhaul. Legacy names still appear in some job checkpoints; this
is not new durable-ID scheduler acceptance. Same-domain ownership resolution
and human ambiguity/merge records remain G01/G03 work. Five original blockers
remain: uncached-tab provider call, legacy period loss, premature cancellation,
different-period conflict collapse and renderer plaintext-key retrieval.
Full G00-G08 goal stays active; G01 is not complete.

## Closed packet — G01-P07

Entry HEAD `f3e999e`, September30, existing open changes preserved. Sol integrates
typed inventory/context, schema5, proof and review fixes. Luna/high Averroes built
the bounded asset sidecar; Luna/high Beauvoir independently red-teamed it.
Both workers closed. No Astra, live user-data access/migration, provider calls,
visual acceptance, installation, main update, release or deployment.

Shared additive inventory contracts replace desktop-private shapes. Existing
minimal records retain their exact shape; optional profiles and identity hints
retain descriptions, HQ, HTTP(S) references and brand metadata. Aliases/domains
are search candidates, not verified identity, automatic merging or rekeying.
Profiles are reported metadata, not evidence-backed claims. Market scope drafts
reuse the established goal/inclusions/exclusions/region/depth/seeds contract;
original legacy framing is separate. Seed IDs reference existing companies and
each market revision retains its ordered seed foreign keys. No approved scope,
budget, monitor schedule or task authority is minted by saving this metadata.

Native schema5 has a derived full-text identity index and append-only scope-seed
links. Real v1/v2/v3/v4 fixtures upgrade through explicit transactions without
rewriting prior record bodies/history/research or owner state. Failed v4-to5
DDL rolls back; read handles refuse upgrades. New market/membership reads and
bounded pages/history use the same native snapshot and writer fences.
Replacement saves are full records, not patches: accidentally omitting prior
profile/hints/scope fields fails explicitly; history and current/search remain
unchanged. Empty hint arrays explicitly clear hints. Missing/changed identity
search rows fail read-only inspection rather than silently hiding companies.
This validation is an O(collection-size) opening check, not a repair operation,
all-index consistency guarantee or MCP disclosure filter.

Internal asset sidecar uses fixed SHA256 filenames and an8MiB per-asset operating
bound. Trusted caller chooses an absolute root with an existing parent. Bytes
are staged/flushed, checked and linked without overwriting an existing hash.
Reads verify file identity/length/hash and refuse ordinary symlink/root
substitution, hardlinks and corrupt entries. Own ordinary-failure temps are
cleaned; unrelated files are preserved. Write authority is injected and checked
before creating a root and before publication; this primitive is NOT yet wired
to a captured vault writer or database asset references.

Verification:

- Five initial context behavior failures reproduced before implementation.
  Further RED cases reproduced split-field search and absent historical seed
  indexes. Final context9/9 and asset9/9 pass, including coordinator RED fixes
  for stale root creation and modified flushed temp content.
- Independent red team reproduced omitted-context loss and damaged-index
  silence. Both fixed with RED then GREEN tests. The existing indexed-ID
  corruption fixture was given a valid new-schema FTS row so it still checks
  identity mismatch; its original expectation was not relaxed.
- Final desktop145 pass/1 original plaintext-key failure; native inventory19/
  evidence18/schema20/owner11/research11/context9/assets9 =97/97.
  Contracts369/mocks16 pass, research355 pass/4 original failures.
  Web153/153, both mock journeys3.655s. Full engineering gate remains RED;
  API unchanged/not rerun; keyless live fixtures are not live quality evidence.
- New context assertions fail against P06's unchanged actual ASAR first.
  Fresh unsigned unpublished ASAR passes schema1-to5 and actualv4 upgrade,
  context/history/seed FK/backup/search, asset publication/corruption/late-write,
  and prior evidence/report/owner/reader/forcedSIGKILL checks.
  Electron44.4.5/Node24.21.0/SQLite3.53.4, same SQL source ID,
  1582112 uncommitted WAL bytes, integrity ok, replacement generation2.
  Native row prototypes were normalized only in the proof comparison; exact
  expected fields remain asserted.
- Frozen ignored package: apps/desktop/release/
  sqlite-spike-20260930-f3e999e-context/win-unpacked, actual
  resources/app.asar/dist/sqlite-spike.cjs. Ordinary main build passes and
  excludes proof entry. This is NOT new NSIS/install/full-GUI verification.

### Checkpoint red team — value, risks and next direction

Needle moved: a necessary migration gap is smaller; rich inventory and scopes
no longer have to be discarded. Ordinary omitted-field and index corruption
cases now fail safely. No user-facing live vault improvement is claimed:
the current app still uses its legacy repository. Do not count module/test
volume as research quality or UI acceptance.

Unfixed limitations: no asset-reference transaction or asset-aware backup/
restore/manifest; file flush/link tests do not prove power-loss directory
durability on Windows or hostile filesystem race immunity. No parent/subsidiary
merge/review record, full passive legacy retention, staged conversion/cutover,
trash/purge/relocation, service runtime or read-scoped MCP yet. The whole goal
remains active and G01 remains incomplete.

Next implementation should pair migration completion with demonstrable journey
improvement, not another unbounded schema detour. First fix existing cached
navigation: opening a missing company section must return a visible missing
state with an explicit research action and zero provider calls. Preserve
deliberate accepted-run warm-up; do not convert it to silent user-navigation
work. Then finish passive record retention and staged fixture conversion as the
integration path to one native authority. Security/key retrieval, period loss/
conflict and cancellation still block release. Visual prototype and full five-
section journey must be reviewed against real sparse/error/keyboard cases.

## Closed packet — G01-P08

Entry HEAD `743d3f4`; September30. Sol fixes shared repository behavior and
integrates Luna/high Hooke's bounded missing-section UI. Luna/high Socrates
independently reviewed the focused diff (read-only; did not run tests), finding
no additional concrete introduced regression. Both workers closed. G01 and the
full production goal stay active; this is a legacy journey repair, not G02/G04
acceptance. No provider calls, keys, live migration, release or deployment.

User outcome: opening a company research section reads saved content or shows
an explicit missing state. It never starts tab generation or joins an in-flight
paid request. The six deeper views expose a visible research button, settings
when disconnected, pending state and safe failure copy. Free saved-read retry
and billable research retry are distinct; paid actions are disabled without a
key. Overview and existing metric facts remain visible without deeper content.
Original visual language retained; this is not the full five-section redesign.

Shared `getDashboardTab` defaults to saved-only reads. Explicit true requests
deduplicate by company/tab. Legacy ownership is checked before provider dispatch
and after completion; a failed storage write restores the prior in-memory tab.
The already-accepted deck run's warm-up uses explicit research intent only for
missing sections. It is NOT a new durable job/budget/cancellation guarantee.
Explicit baking/audit callers and paid fixture setup now pass true; the original
A04 cached-navigation test and stale-writer expectations were not relaxed.

The older cloud adapter no longer posts generation on read. Explicit results
are cached for the current repository lifetime; failures are observable and do
not replace saved content. Unmapped companies cannot silently select another
market. This memory cache is NOT durable cloud/local vault storage or a security/
budget retrofit of the old cloud server.

Coordinator red-team tests found and fixed two integration bugs: navigating
during a paid run could place its result under the new company/tab, and explicit
results bypassed the display compatibility checks used by cached reads. Mutation
identity now isolates pending/error state and completion routes by the validated
original result. Display normalization is shared in behavior, not historical
evidence rewriting. Null or mismatched research results fail visibly.

Verification:

- RED: original A04 plus missing-read/in-flight/ownership/dedup regressions
  reproduced (5 failures). Cloud read/dedup regressions reproduced (2). Cross-
  navigation and fresh-result compatibility failures each reproduced then fixed.
- Research361 pass/3 original failures; contracts369/mocks16 pass. All six
  typechecks and root lint pass. Full gate remains RED: legacy metric periods
  are dropped, cancellation acknowledges too early, and different periods merge.
- Independent desktop145 pass/1 original renderer plaintext-key failure; native
  suites97/97 unchanged/green. API158/158 rerun/green. Web166/166 green, including
  the rendered every-section missing-state journey and original two mock flows.
  Final strengthened navigation test checks the new view is idle before the old
  request resolves. Keyless live fixtures are not live-quality evidence.
- Real Chromium public-sample browser journey passes: library/deck/reader/company/
  reload, external requests blocked. Screenshots inspected for deck/company.
  Production web build passes with existing chunk-size/Firebase splitting
  warnings. No new packaged desktop/installer/MCP/live-provider proof.
- Ignored browser artifacts: `apps/web/test-results/overhaul-baseline-G00-publ-7193e-eader-and-company-workspace-chromium`.
  Public sample only; screenshot proves shown state, not customer data fidelity.

### Checkpoint red team — needle, gaps and next direction

Needle moved in the current app: tab navigation no longer causes surprise paid
generation; missing sections have an actionable, honest state; failed research
preserves useful data; cross-navigation results stay attached to their target.
Do not turn these tests into a claim that all legacy background actions have
approved budgets, durable ownership, cancellation or universal provider support.

Visual review remains NOT accepted. Offline/blocked logo fallback makes
Anthropic's mark almost invisible; the long company description is duplicated;
header source counts versus overview credible-figure counts need distinct clear
semantics. Sparse/error/keyboard/mobile/card-craft review and five-section
consolidation remain. Fix the concrete fallback contrast defect as a bounded
visible repair, then return to full passive legacy retention and staged fixture
conversion toward one native authority; do not continue disconnected schema
work indefinitely.

Four original release blockers remain (three research tests + one secret test).
Also unfinished: asset/database reference and backup integration, recovery/
relocation, service/key/budget/job runtime, provider/retrieval quality evaluation,
evidence-first Ask/comparison, monitored updates, scoped local MCP and installer/
production journey acceptance. No live data or paid research is authorized.

## Closed packet — G01-P09

Entry HEAD `9bfb4c9`; September30. Coordinator's bounded visible repair after
P08's actual browser inspection, without another worker/architectural detour.
Separate exploration branch only; no brand/data changes, provider calls, live
migration, installation or publication. Full production goal/G01 remain active.

Observed failure: Anthropic's pale palette made the offline lettermark almost
invisible on the paper hero. The logo probe also rendered a blank block until
network lookup settled, potentially leaving a company unidentified indefinitely.

Fix: preserve trusted stored palettes, real logos and the existing collectible
style; choose readable monogram ink separately from decorative brand color.
Existing contrast math evaluates ink against a conservative paper shade; light/
neon accents use editorial ink while sufficiently dark accents keep their hue.
The company monogram is visible immediately, including during unresolved lookup;
usable real artwork still replaces it. No generated artwork or invented brand.

Verification:

- Seven palette tests reproduced RED before implementation; unresolved logo
  lookup reproduced a separate RED. All8 new cases pass; GameCard16/16.
- Full web174/174 pass, including original deck/reader/company journeys,
  cached-only missing sections, explicit research, failure and navigation races.
  All six typechecks/root lint pass.
- Actual Chromium public-sample journey and production web build pass.
  All external requests blocked; actual Anthropic monogram computed color is
  asserted dark `rgb(28,43,40)`. Updated deck screenshot inspected: visible mark,
  retained frame identity, no change to metric values or card-opening actions.
- P08 research361 pass/3 original failures, desktop145 pass/1 key failure,
  native97/97 and API158 pass are prior verified evidence, unchanged/not rerun
  for this CSS/Logo-only slice. Entire release gate is still RED.
- Public-sample screenshots remain ignored browser artifacts at
  `apps/web/test-results/overhaul-baseline-G00-publ-7193e-eader-and-company-workspace-chromium`.
  Not live output quality, customer-data preservation or packaged desktop proof.

### Checkpoint red team — needle, limits and next direction

Needle moved visibly: failed or pending identity lookup no longer leaves blank/
unreadable company artwork. Card facts, brand palette, real artwork, controls and
no-flip behavior are unchanged. Shared Logo review confirms no new fetch, key,
paid work or research mutation path; it removes one presentation-only state.

Remaining visual gaps: loaded transparent-white artwork is not universally
adapted to its background; artwork optical-quality/network privacy/cache work
needs the planned local asset integration. The description repeats in the
company workspace; evidence/source count semantics, sparse metrics, density,
keyboard/mobile and full five-section journey still need dedicated acceptance.
Do not call this final card craft or full accessibility approval.

Return to G01-P10: complete typed/passive retention of every remaining legacy
record family and nested partial job results; preserve exact original exports
and original IDs/relationships. Staged fixture conversion must compare counts,
content and links, retain historical evidence without display normalization,
and import NO task/approval/budget/monitor authority. Keep active user data
untouched. Then integrate one native authority/recovery rather than accumulating
more disconnected modules. G02 handles shared runtime/secrets/provider budgets/
cancellation; G03 quality/retrieval; G04 card/journey; G05 decision outputs;
G06 monitors; G07 scoped local MCP; G08 production release acceptance.

## Closed packet — G01-P10

Entry HEAD `92554e4`; September30. Full production goal/G01 remain active.
Sol integration; two serial Luna/high workers (fixture/tests, then read-only
red team); at most one active, no history fork/Astra. Separate exploration
branch only; no live migration/provider calls/installation/publication.

User outcome / seams: G01, US13/14/16/23/30, A44/A45/A46 preparation.
Native schema6 can retain ALL14 inspected legacy families as individually
indexed, immutable historical records: markets, decks, companies, metrics,
cards, vice claims, reports, briefings, saved cards, jobs, threads, dashboards,
company-market associations and opportunity analysis. Source manifest pins
original byte hash/length/version plus reconstructed-content checksum/counts.
Existing v1-v5 vault upgrades are transactional; previous bodies/history,
evidence, owner generation and search are not rewritten.

Complete raw JSON data semantics survive close/reopen and native online backup:
unknown nested fields, source wording, numeric zero, reporting periods, exact
array order/IDs/links, omitted optional families, minimal old jobs and nested
uncommitted partial results. Only validated historical records are retained.
Display schemas do not strip research; unsupported metrics/citations are NOT
promoted to supported observations/passages/current reports. Imported
`user_verified` wording stays attributed raw history, not local attestation.
Queued/running status is historical only; no queue/schedule/grant/budget revived.

Captured owner writes validate input, expected vault revision and complete
family/count/content/relationship roundtrip before one atomic commit. Exact
original-source replays are idempotent without revision advance; new source
bytes require the current revision and coexist. Read-only source catalogue
allows rediscovery after restart, explicitly not-yet-verified. Record pages
are bounded to100 entries and8MiB payload bytes; an oversized record is not
dropped and remains available through trusted internal export. Whole source/
export inspection is bounded to50MiB/200k lexical tokens. No renderer/MCP API.

Verification:

- Worker10 initial behavior failures reproduced missing API; later schema1/
  absent-version/zero-version additions were integrated and verified locally.
  Coordinator corrected invalid synthetic fixture inputs and test-interface
  drift; original release baseline assertions were not weakened.
- Schema6 RED (actual5), catalogue RED (missing API), reviewer missing/replaced
  guard RED2, and large-page byte-bound RED were reproduced then fixed.
- Final desktop167 pass/1 original stored-key failure, including native119/119,
  retention17/17, schema25/25 and inspection19/19. Late injected SQLite failure
  rolls ALL families/source/revision back; damaged content/export fails;
  immutable guards, stale capability, source replay and consistent backup pass.
- `pnpm check`: all6 typechecks/root lint, contracts369/mocks16 pass;
  research361 pass/3 original failures. Independent web174/174 and API158/158
  pass. Final all6 typechecks/root lint rerun pass after red-team fixes.
- Native Electron runtime AND new unsigned Windows ASAR proof pass: retained
  full/minimal legacy fixtures, semantic roundtrip, passive authority, source
  idempotency, fenced writer, closed-vault/online-backup reopening; prior
  evidence/search/context/owner/crash checks remain green.
  Electron44.4.5 / Node24.21.0 / SQLite3.53.4 (same recorded source ID as P07).
  Forced crash has1582112 uncommitted WAL bytes; committed data survives,
  uncommitted rows absent, integrity ok, replacement writer generation2.
- Ignored proof artifact:
  `apps/desktop/release/sqlite-spike-20260930-92554e4-retention/win-unpacked`.
  Actual packaged `Stratemark.exe` ran the bundled ASAR module; ordinary main
  rebuilt without the proof afterwards. No signing/installer/full GUI proof.
- Native/offline checks use synthetic temporary data; no actual key/network
  research/customer migration. Backend packet does not claim new visual review.

### Checkpoint red team — moving the needle and remaining limits

Reviewer found v6 accepted missing append-only guards. Coordinator reproduced
missing AND no-op-replaced guards; now opening/reading/reconstructing/retaining
refuses missing or altered guard SQL. Checksums detect damaged content and
relationships are revalidated. These are NOT authenticated provenance against
a hostile local editor who rewrites an entire DB/guards/checksums.

Needle moved: previously unretained reports/conversations/saved items/partial
jobs now survive native storage AND packaged backup/reopening in full fixture
roundtrips, an explicit prerequisite to migration. This remains INTERNAL
PASSIVE RETENTION, not connected app data, paid-run control or G01 completion.
Original source byte hash is metadata; export preserves JSON data semantics,
not original whitespace/numeric spelling. Untouched original byte backup and
asset-pinned validation are mandatory before staged cutover. No old AI claim
is promoted to present-day evidence or automatically trusted human review.

Next G01-P11: staged synthetic migration with untouched byte-exact source copy,
all-family counts/content/link verification, managed asset references, explicit
inventory projections retaining IDs/multi-market memberships and one-authority
read integration. Failures leave original intact and candidate unapproved.
Do not add disconnected modules without exercising this converter/read path.
No live customer migration. G01 still needs backup/restore/assets/trash/disk
relocation and service lifetime/cutover. The four original release blockers
(metric period loss, cross-period reconciliation, cancellation acknowledgment,
renderer stored-key retrieval) still fail and belong to integrated G01/G02.
G04 visual gaps and G03/G05/G06/G07/G08 release work remain unaccepted.
