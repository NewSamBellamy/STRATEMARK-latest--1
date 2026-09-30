# Shared action contract

Plan version: 1.0.0. Normative companion to [NORTHSTAR.md](NORTHSTAR.md).
Status: design, not implemented API. Catalogue IDs are stable; wire schemas are finalized and fixture-tested in G00 before executors change callers.

G00-P01/P02 implementation status: all catalogue metadata and 19 request schemas now exist in `packages/contracts/src/actions.ts`, alongside structured failures and a pure lifecycle transition rule. No transport/service is wired to them yet; the other 43 requests fail closed in that parser. Runtime schemas remain additive candidates until their complete result/policy/adapter fixtures pass. See BUILD-STATE for actual verification and remaining gates, not this catalogue as proof of a working API.

## 1. One action system

Every button, scheduled task, IPC request, and permitted MCP tool maps to one of the actions below. Business rules, authorization, spend, evidence rules, and state transitions live in the local action service. Transport adapters authenticate callers and translate schemas; they cannot create parallel research implementations.

An action has: stable name/version; typed input/output; required scope; allowed target types; read/write/billable behavior; consent requirements; idempotency behavior; revision preconditions; cancellation behavior; structured error codes; observable UI states; and audit policy. G00 publishes runtime-validated schemas and contract fixtures for the complete catalogue. No new action ships without these definitions and a named user outcome.

## 2. Request, receipt, and read contracts

Command envelope:

```json
{
  "contractVersion": "1",
  "requestId": "req_example",
  "idempotencyKey": "caller-generated-stable-key",
  "action": "company.research.start",
  "vaultId": "v_example",
  "target": { "companyId": "co_example", "marketId": "m_example" },
  "expectedRevision": 12,
  "input": { "sections": ["products"], "mode": "fill_gaps" },
  "policyRef": "policy_user_approved",
  "budgetRef": "budget_user_approved"
}
```

This is an illustrative fixture, not existing wire compatibility. `expectedRevision` is required when modifying a revisioned target; create commands instead constrain the parent/vault revision. IDs resolve inside the authenticated vault and allowed grant, not arbitrary paths. `policyRef` and `budgetRef` refer to already authorized policies; sending their IDs does not grant authority. Caller identity comes from trusted transport/session authentication, NEVER from a model's JSON claim to be the owner.

An accepted command returns a persisted receipt with `actionId`, request ID, action/version, target, accepted timestamp, resulting revision, and status. EVERY asynchronous command requires a stable `runId`; optional task IDs refine it. No asynchronous success promise without durable acceptance. Replay the same key and canonical payload for the same authenticated principal/vault to get the same receipt, never a second charge. A changed payload under that key yields `IDEMPOTENCY_CONFLICT`. Persist the dedupe record atomically with acceptance; retain it for the run and documented retry horizon. Same-key duplicates from two simultaneous clients must collapse transactionally.

A27 returns a typed, revisioned output manifest: output kind, record/result ID, status, originating scope, input revision, evidence references, and a bounded payload or read action/reference. Scope proposals, answers, comparison explanations, and support-check outcomes remain retrievable through A27; briefs/dossiers also have their typed read actions. Results survive reconnect/restart and are filtered by current grants, not only the grant at submission. Failed/partial outputs state what is missing.

Read queries use typed inputs and return `contractVersion`, vault/record IDs, revision, observed-at timestamp, freshness state, result fields, evidence references, coverage gaps, and cursor/limit where applicable. Fixed-revision reads identify the actual snapshot. Queries cannot initiate provider calls, create jobs, update last-research dates, or mutate records. Access/disclosure audit entries are allowed and excluded from content revision. Local previews are read/compute operations; previewing scope is not paid planning unless the user explicitly selects AI assistance.

Structured failures include `INVALID_INPUT`, `NOT_FOUND_OR_NOT_ALLOWED` (avoid existence leaks), `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `CONSENT_REQUIRED`, `BUDGET_REQUIRED`, `BUDGET_EXCEEDED`, `PRICE_UNKNOWN`, `CAPABILITY_UNSUPPORTED`, `PROVIDER_UNAVAILABLE`, `RATE_LIMITED`, `CANCELLED`, `VAULT_BUSY`, `STORAGE_FAILURE`, `MIGRATION_REQUIRED`, and `SCHEMA_TOO_NEW`. Return safe details, retryability, and next action; never include keys or private records outside the grant.

## 3. Action catalogue

Notation: R = cached read/compute; W = local write; J = durable job, possibly billable. Human = trusted direct UI confirmation. MCP availability below is a ceiling, not an automatic grant. Every permitted MCP operation still needs selected target scope. A UI disclosure or MCP grant records precisely which operation, records, provider routes, limit, and expiry were approved.

Human-only actions require a service-issued approval challenge bound to exact action, payload hash, actor, revisions, expiry, and single consumption. The dedicated trusted confirmation surface consumes it; ordinary renderer/MCP calls cannot approve their own proposals. Changed input or a stale/replayed challenge fails. Protect that surface separately from untrusted research content. Authentication identifies a client; it is not human attestation. This boundary assumes an uncompromised local application/OS, not magical detection of human presence.

### Library, identity, and scope

| ID / action               | Input -> result                                                                        | Behavior / consent                                                   | UI / MCP                                        |
| ------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| A01 `library.search`      | Query, entity kinds, filters, cursor -> bounded cached matches with evidence/freshness | R; `research:read`; no network                                       | Search library / read tool                      |
| A02 `market.list`         | Filters/cursor -> accessible markets and state                                         | R; `research:read`                                                   | Library / read tool                             |
| A03 `market.get`          | Market ID, optional revision -> scope, deck state, roles, findings/gaps                | R; `research:read`                                                   | Open market / read tool                         |
| A04 `company.get`         | Company ID, optional revision, section -> dossier/card projection and sources          | R; `research:read`; opening does not research                        | Open/explore company / read tool                |
| A05 `evidence.get`        | Claim/source/passage ID, optional revision -> retained support, dates, conflicts       | R; grant applies to linked content as well                           | Sources / read tool                             |
| A06 `scope.preview`       | Goal, seeds, region, inclusions/exclusions, depth -> normalized proposal/gaps          | R; deterministic; unresolved seed aliases retained                   | Scope review / optional tool                    |
| A07 `scope.assist.start`  | Draft scope + approved connection/budget -> suggested proposal job                     | J; explicit billed planning; not a required onboarding step          | Help define scope / separately granted job tool |
| A08 `market.create`       | Confirmed scope proposal + vault revision -> market/scope revision                     | W; `research:write`; records scope, does NOT start research          | Create market / granted command                 |
| A09 `market.scope.update` | Market ID/revision + changed scope -> new scope revision and impact preview result     | W; `research:write`; no retroactive rewriting of research            | Edit scope / granted command                    |
| A10 `company.resolve`     | Names/domains/context -> existing candidates, match evidence, ambiguity                | R; no fuzzy-name auto merge or outbound search                       | Seed review / read tool                         |
| A11 `company.merge`       | Two IDs/revisions + reviewed identity evidence -> reversible merge record              | W; Human only; impact preview, jobs reconciled, references preserved | Resolve duplicate / unavailable externally      |
| A12 `membership.update`   | Market/company IDs/revisions + roles/fit reason -> membership revision                 | W; `research:write`; fit based on evidence or labeled human judgment | Review roles / granted command                  |
| A13 `saved.update`        | Accessible item ID/revision + save/remove -> saved-item state                          | W; `research:write`; does not delete evidence                        | Save company/finding / granted command          |

### Research and useful outputs

| ID / action                     | Input -> result                                                                                | Behavior / consent                                                       | UI / MCP                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| A14 `market.research.start`     | Market/scope revision, depth, seeds, limits, provider/budget refs -> run receipt               | J; `research:run`; Sentinel + Scouts under one policy                    | Start research / granted job tool          |
| A15 `market.discovery.expand`   | Market revision, exclusions, target/batch limit -> expansion receipt                           | J; explicit new bounded discovery, reuse known dossiers                  | Research more / granted job tool           |
| A16 `company.research.start`    | Company/revision, sections, fill-gaps/refresh mode -> Scout receipt                            | J; `research:run`; reuse valid source evidence; no implicit full refresh | Research this section / granted job tool   |
| A17 `finding.research.start`    | Market revision, trend/culture/barrier/risk kind, focus -> specialist receipt                  | J; bounded; separate finding evidence and safety checks                  | Research findings / granted job tool       |
| A18 `answer.from_library.start` | Question, accessible target/revisions, model/budget refs -> answer receipt                     | J; model may cost even without web; only selected cached evidence        | Ask saved research / granted job tool      |
| A19 `answer.research.start`     | Question, target/scope, allowed web expansion, provider/budget refs -> answer/research receipt | J; explicit web egress and cost; useful gaps retained                    | Ask with web / separately granted job tool |
| A20 `comparison.get`            | Company IDs/revisions, metric/criteria profile -> aligned cached comparison                    | R; deterministic; incompatible facts and unknowns flagged                | Compare / read tool                        |
| A21 `comparison.explain.start`  | Comparison revision, goal/weights, model/budget refs -> narrated comparison receipt            | J; no invented universal score                                           | Explain comparison / granted job tool      |
| A22 `report.create.start`       | Targets/revisions, brief template/version, model/budget refs -> saved brief receipt            | J; immutable input snapshot, citations, unknowns                         | Create brief / granted job tool            |
| A23 `report.get`                | Report ID/revision -> cached brief and input references                                        | R; `research:read`                                                       | Open brief / read tool                     |
| A24 `evidence.check.start`      | Claim/observation IDs/revisions, retrieval scope -> support-check receipt                      | J; support check is NOT human verification                               | Check support / granted job tool           |
| A25 `observation.correct`       | Observation/revision, corrected value/status, reason/support -> correction history             | W; Human only; retains original observation                              | Correct fact / unavailable externally      |
| A26 `observation.confirm`       | Observation/revision + explicit human attestation -> `user_verified` correction event          | W; Human only; agent cannot attest or forge actor                        | Confirm fact / unavailable externally      |

### Jobs, monitoring, and connections

| ID / action                 | Input -> result                                                                                   | Behavior / consent                                                                 | UI / MCP                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| A27 `run.get`               | Run ID -> tasks, status, gaps, estimated/known spend, typed revisioned output manifest/results    | R; current scope enforced for outputs and linked evidence                          | Research activity / read tool                                   |
| A28 `run.events.list`       | Run ID + event cursor/limit -> ordered replayable events                                          | R; redacted, persisted event sequence                                              | Activity stream / read tool                                     |
| A29 `run.pause`             | Run/revision -> pause-request receipt                                                             | W; authorized owner/grant; halt new dispatch, checkpoint active work               | Pause / granted command                                         |
| A30 `run.resume`            | Run/revision + still-valid budget/policy -> resume receipt                                        | W/J; revalidate grants, capabilities, prices, reservations                         | Resume / granted command                                        |
| A31 `run.cancel`            | Run/revision -> cancel-request receipt and eventual terminal state                                | W; same ownership; abort/fence children, no evidence deletion                      | Cancel / granted command                                        |
| A32 `run.retry`             | Failed task/run IDs/revisions + retry selection -> bounded attempt receipt                        | J; failed subsets only, no automatic duplicate paid ambiguity                      | Retry failed work / granted job tool                            |
| A33 `updates.list`          | Market/company ID + since/cursor -> meaningful cached changes                                     | R; event and observation dates, old/new support                                    | Updates / read tool                                             |
| A34 `updates.check.start`   | Selected company IDs/revisions + change focus/budget -> bounded check receipt                     | J; check changed evidence, suppress duplicates                                     | Check for updates / granted job tool                            |
| A35 `monitor.preview`       | Selected companies, cadence, request/token/currency limits -> schedule/cost/availability proposal | R; no automatic provider test                                                      | Follow updates setup / optional read tool                       |
| A36 `monitor.enable`        | Confirmed proposal, policy/budget refs -> schedule with next eligible tick                        | W; Human initial grant; `monitor:manage`; daily default, off by default            | Follow updates / human-approved scope only                      |
| A37 `monitor.update`        | Schedule/revision + bounded changes -> new policy preview or schedule revision                    | W; increases/egress/cadence expansion require Human reapproval                     | Monitoring settings / only reduce/disable under delegated scope |
| A38 `monitor.disable`       | Schedule/revision -> stopped schedule, related run state                                          | W; halt future dispatch; identify active request cancellation choice               | Stop following / granted command                                |
| A39 `connection.grant`      | Client binding, selected records/actions, expiry, policy -> revocable grant handle                | W; Human; read-only default; never trust self-declared client ID as authentication | Connect assistant / unavailable externally                      |
| A40 `connection.revoke`     | Grant ID/revision -> denied future access and affected task status                                | W; Human; revoke queued dispatch and later disclosure                              | Revoke connection / unavailable externally                      |
| A41 `connection.audit.list` | Grant/client ID + cursor -> redacted access/action/disclosure log                                 | R; Human local scope, no exposure of other clients                                 | Connection activity / unavailable externally                    |

### Local data and credentials

| ID / action               | Input -> result                                                                                           | Behavior / consent                                                                                | UI / MCP                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| A42 `export.preview`      | Selected IDs, format, evidence depth -> scope/size/privacy preview                                        | R; no automatic bulk disclosure                                                                   | Export setup / unavailable externally                |
| A43 `export.create`       | Confirmed preview/revisions + trusted save-dialog handle -> export receipt/file manifest                  | W/J; Human; consistent snapshot, no secrets                                                       | Export / unavailable externally                      |
| A44 `import.preview`      | Trusted open-dialog handle -> validated schema, identity conflicts, proposed counts                       | R; untrusted file; size/decompression limits, no mutation                                         | Import preview / unavailable externally              |
| A45 `import.apply`        | Approved preview hash + vault revision -> fenced transaction/result                                       | W/J; Human; backup, drain workers, validate staged data, rollback                                 | Confirm import / unavailable externally              |
| A46 `backup.create`       | Vault ID + retention policy -> consistent snapshot/checksum receipt                                       | W/J; local approved policy; never naive live WAL file copy                                        | Backup / unavailable externally                      |
| A47 `backup.restore`      | Validated backup handle/hash + vault revision -> restored generation/receipt                              | W/J; Human; exclusive fence and recovery fallback                                                 | Restore / unavailable externally                     |
| A48 `vault.relocate`      | Trusted directory-dialog handle + revision -> validated new location                                      | W/J; Human; local disk check, quiesce, verify, rollback                                           | Move research folder / unavailable externally        |
| A49 `record.trash`        | Item/revision + confirmed impact preview -> reversible tombstone                                          | W; Human; shared company/market dependencies shown                                                | Delete / unavailable externally                      |
| A50 `record.restore`      | Tombstone ID/revision -> restored item/references                                                         | W; Human; revalidate identities                                                                   | Restore deleted item / unavailable externally        |
| A51 `record.purge`        | Tombstone/revision + explicit confirmation -> deletion receipt with backup caveats                        | W/J; Human; retention policy; no forensic-erasure promise                                         | Permanently delete / unavailable externally          |
| A52 `provider.status`     | Connection ID -> configured/capability/test status, never stored key                                      | R; local settings scope                                                                           | Provider settings / unavailable externally           |
| A53 `provider.configure`  | Trusted settings channel + endpoint/protocol/key + permission policy -> status                            | W; Human; secret stays behind trusted boundary, no logs/exports                                   | Connect provider / unavailable externally            |
| A54 `provider.test.start` | Connection + consented bounded test limits -> capability/test receipt                                     | J; possible cost disclosed; no confidential research needed                                       | Test connection / unavailable externally             |
| A55 `provider.remove`     | Connection/revision -> disabled connection, secret removed, affected jobs                                 | W; Human; dispatch stops; never silent fallback                                                   | Disconnect provider / unavailable externally         |
| A56 `budget.preview`      | Connections, targets, request/token/currency ceilings, duration -> priced or explicitly unpriced proposal | R; current pricing metadata; no provider call; strict unknown-price routes rejected               | Budget setup / local only                            |
| A57 `budget.approve`      | Confirmed proposal/hash + owner revision -> authorized budget/policy reference                            | W; Human; initial approval, top-up, or increased limits require confirmation                      | Approve budget / unavailable externally              |
| A58 `budget.restrict`     | Budget/revision + lower ceilings or stop -> restricted policy and affected jobs                           | W; Human or explicitly granted restrictive command; never raises authority                        | Reduce/stop budget / granted command may only reduce |
| A59 `budget.get`          | Accessible budget ID -> limits, reservations, known/estimated usage, remaining constraints                | R; local or granted run scope; no other connections disclosed                                     | Spend/activity / granted read tool                   |
| A60 `preferences.update`  | Owned view/settings revision + display/sort/metric-profile preferences -> preference revision             | W; local view preferences only, never permissions, monitoring, egress, or money limits            | View/settings / unavailable externally               |
| A61 `vault.status`        | Vault ID -> schema, availability, storage/backups status and safe local location                          | R; Human local scope; no raw secret paths or file contents                                        | Storage settings / unavailable externally            |
| A62 `navigation.open`     | Known vault/source/record ID -> safely validated local navigation or OS-open acknowledgement              | Nonbillable local UI effect; Human; derived allowlisted location, never arbitrary executable/path | Open research folder/source / unavailable externally |

No general `execute`, `read_file`, `write_file`, `sql`, `shell`, `fetch_url`, or `get_key` action. MCP standardized `search` and `fetch` wrappers may map ONLY to A01/A04/A05/A23 and return bounded granted records. `fetch` takes a stable record ID, not an arbitrary URL. Include original public source URLs for attributable citations and local app links for navigation; private-only records must not be given fabricated public URLs.

Pure frontend state such as focus, expanded panels, scroll, and route transitions does not need a domain command or network call. Persistent display preferences use A60. Opening an original public source in a browser can contact that website; it is an explicit user navigation action, not an implicit research fetch.

## 4. Runtime states and safety invariants

Task states: queued -> running -> completed | partial | failed. Running/queued work can enter pausing -> paused, or cancelling -> cancelled. A run aggregates its declared children and reports incomplete scope. Leases and attempt IDs are independent of a UI connection. Event cursors survive restart.

- Pausing stops dispatch immediately. Active calls may finish/checkpoint; their possible cost stays reserved and visible. Paused is acknowledged only when no active worker can continue unauthorized work. Resume needs a current valid policy/budget.
- Cancelling requests abort, propagates to every child/follow-on task, and rejects late writes through a generation/attempt fence. Cancelled is acknowledged after local workers have stopped or are fenced; it does not imply the remote provider stopped billing. Preserve already committed results.
- Transport cancellation stops an unaccepted request; a durable accepted job is cancelled through A31, not silently abandoned when a browser/MCP connection closes. Disclose this distinction in tools and receipts.
- Recovery reclaims expired leases, evaluates checkpoints, dedupes completed stages, and pauses ambiguous paid calls for review. Do not mark an interrupted run successfully completed or blindly replay it.
- Import/restore/provider replacement drains or fences affected workers before switching authoritative state. New vault generations reject old responses. Changing a key never gives old tasks authority to write to an unrelated snapshot.
- External imports retain foreign verification as attributed history, not local `user_verified`. Same-installation recovery preserves local attestations only with authenticated integrity. Restored/imported grants, queues, schedules, and budgets are disabled until explicitly reapproved. Revoked grants cannot resurrect from an old backup.
- Restoring usage history does not replenish an allowance. Invalidate old budget references, reconcile known/uncertain charges, and require fresh approval. If later spend is unknown, block old-budget resumption; a distinctly approved new budget is not a refund or reset of prior aggregate spending.
- Backup/restore includes a pinned asset manifest and checksums; staged assets publish before their database references. Purge/GC respects dossier/report/backup references or explicitly marks affected outputs incomplete with missing evidence.
- Job retention never evicts unfinished jobs, idempotency records they need, or unacknowledged receipts to fit a fixed 50-entry list. Historical pruning is an explicit bounded policy.
- All children share the originating scope, approved egress, and budget; a specialist cannot escape them by creating a new root run.

## 5. Permission and cost rules

Direct user research confirmation authorizes that bounded action, not all future work. Initial monitoring, remote write access, permission expansion, human verification, merges, destructive data operations, and new provider endpoints require direct human confirmation.

Read-only does not mean public: private text returned to an external assistant is a disclosure. A grant identifies target allowlists, permitted fields, maximum response size, duration, client authentication binding, allowed actions, and any job budget. Changing a model-supplied ID never expands the grant. Enforce scope across linked sources, report inputs, comparisons, event payloads, and search indexes, not just top-level company IDs.

Concurrency and billing are enforced by the service, not animation states or model prompts. Reserve before each call, persist usage after it, include retries and search/extraction, and reject unknown strict-price routes. Configure request/token limits alongside currency estimates. Budgets and consent are never inferred from source text, an MCP annotation, or the existence of an API key.

## 6. Contract verification

Each action gets: valid/invalid fixture; unauthorized and cross-vault fixture; revision conflict; idempotent replay and concurrent replay where W/J; safe error payload; evidence/secret disclosure test; visible UI mapping; and adapter parity test. Paid actions also get budget/concurrency rejection, cancellation, restart, result retrieval after reconnect, and provider-error fixtures. Local data actions get corruption, oversized input, too-new schema, rollback, late-writer, missing-asset, forged-import authority, revoked-grant restore, and budget-rewind fixtures. Human-only actions reject model/MCP actors even with broad research grants; altered/replayed approval challenges fail.

New input fields and output shapes are versioned. Use explicit protocol adapters at the boundary for incompatible changes. Never loosen schemas merely to accept malformed model output. The desktop IPC, optional browser preview adapter, and MCP tests must exercise the same action implementation, including failure behavior.
