# Keystone checkpoint 32 — scoped issuer facts and reporting-period aging

Date: 2026-10-05 local. Branch: `revival/initial-card-redesign`. Parent: `75ea1e3` (checkpoint 31).

## Connected improvement

Previously, original-source selection could prioritize a company's website, but the literal-passage gate, verification transition, reconciliation, chart and renderer would discard its authority because they lacked company context. A supported issuer figure could consequently become Unknown or Estimated between screens.

Company website context now reaches initial company hydration, protected local/cloud verification and hunts, canonical facts, local reconciliation, charts, overview, card projections and metric hooks. The raw facts cache remains intact: the hook uses the existing company query and projects only in `select`, so company context can arrive without overwriting history. No new provider request, dependency, schema field, parallel service or visual restyle.

Default publisher checks remain conservative when no company context is supplied. Supplied citation credibility still has no authority. The scoped issuer route matches the exact declared website host, normalizing only `www`; it does not automatically grant parent/sibling/subdomain or public-suffix authority. Shared user-edited hosts and social/junk sources cannot gain authority by being declared the website. Opaque redirects must resolve to an eligible final original; a requested issuer URL that ends elsewhere is not issuer evidence.

Issuer eligibility is NOT claim acceptance. The existing literal company/value/basis/unit/date/receipt checks, conflicting-observation rules, human locks, non-integer person-count rejection, automatic-zero-user and market-share restrictions remain. Exact issuer passages are explicitly attributed as issuer-reported, not independently corroborated, in citations, read-view notes and overview figure text. `verified` here represents mechanical source-claim checking, not an audit of the business or independent corroboration.

The existing 366-day outer reporting-period ceiling now also applies relative to the current read/check time, rather than only the old retrieval date. Old receipts do not become current by reopening or checking them again. Future reporting dates and invalid reference clocks fail closed. Raw historical observations remain stored. This ceiling is NOT a complete per-metric freshness policy, and a figure inside it need not describe the business today.

## Verification

RED failures were observed before fixes at the publisher/context, literal issuer passage, saved facts, card presentation, future/aged reporting-period and shared user-content-host seams. Additional native hydration, chart, overview, hook/cache, owned cloud reads and cloud verification/persistence regressions cover the connected path. There are 19 new cases versus checkpoint 31.

Final full gate: typechecks/lint and **1,130 tests**, exit 0 (contracts 103, mocks 15, research 495, desktop 36, API 271, web 210). Credential-dependent census/judge self-skips are not live proof. Desktop build exit 0. Browser build ran last, exit 0, restoring browser-configured shared output. Existing chunk/Firebase warnings remain. Shared-contract additive signatures were checked across web, desktop, API, research and mocks; the array-map adapter was updated to avoid treating a callback index as website context.

No fresh paid Gemini run, actual native GUI research journey, user-data mutation, installer or real Firestore proof in this turn. Tests use controlled issuer passages and retained receipts; they are NOT live factual accuracy evidence. No keys were read or copied, and no push/deploy/main merge is claimed.

## Red team / next acceptance gate

1. **Finish useful real coverage, not another guard-only slice.** Revalidate the configured native runtime and run a small bounded real company task through its protected source reader and existing key. Measure accepted facts, explicit Unknown reasons, first-ready time, calls and reopen agreement. Do not route around browser CORS or extract a key to a harness.
2. Declared website context is attribution metadata, NOT independently verified domain ownership/legal issuer identity. Exact-host eligibility intentionally excludes unreviewed subdomains. Add explicit authenticated issuer/filing identity or corroborated identity evidence rather than blindly broadening suffix/alias matching. Evaluate legitimate structured filing sections for useful public-company facts; keep private-company reporting distinctly attributed.
3. First-person prose, aliases, tables, ARR versus annualized/recognized revenue, user/customer denominators, currencies and reporting intervals remain incomplete. The present literal gate will still withhold many legitimate real sources. Do not invent a rewritten company/date quote to obtain acceptance.
4. Per-metric reporting freshness, independent source corroboration, accepted-proof pinning beyond the 20-attempt window, complete original export/restore and indexed reads remain. Snapshot fixtures use 2026 reporting dates; future clock-policy test maintenance should use explicit/frozen clocks, not weaken the production aging check.
5. Internal ranking still has raw-input review gaps; deeper prose is not certified. Keep all nine product/backend areas in the delivery map in scope, including durable Scouts/scheduling, specialist reports, provider capability routing, local/MCP permissions and the actual release journey.

No whole milestone is finished; backend goal remains active.
