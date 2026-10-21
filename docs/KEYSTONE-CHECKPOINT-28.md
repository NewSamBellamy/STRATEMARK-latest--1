# Keystone checkpoint 28 — inspectable company dashboard research

Date: 2026-10-05 local. Branch: `revival/initial-card-redesign`. Previous commit: `89e868c`.

## Connected changes

- Every researched dashboard section (overview, live intel, team/org, governance, history, products) retains the actual provider search citations outside model-generated content. The existing synthesis receives that catalog as untrusted attribution, not proof. Bounded gap-fill passes combine their real citations; model-invented citation fields cannot replace this envelope. No extra model or web-fetch call was added; the catalog does add input tokens.
- Local browser/native repository caches acknowledge section content and sources together. Cache/in-flight return values are detached so caller changes cannot overwrite retained research. Legacy sections remain readable, visibly unattributed, with no automatic paid replacement. Native IPC shares this return contract, but native runtime behavior was NOT verified in this run.
- One collapsed source inspector is shared across the six researched company sections. It exposes source links and collection date, explicitly distinguishing search attribution from independent verification and collection time from source publication time. Existing card visuals and dashboard layouts are unchanged. Source metadata is normalized centrally; malformed rows, non-web/credential-bearing links and exact duplicate URLs cannot crash/bloat the inspector.
- Local metric chart reads bypass old cached charts and derive current company-scoped points using shared revision/provenance checks. Ambiguous, invalid, unknown and estimated observations are not silently plotted as established facts. These free reads do not rewrite historical charts or incur model calls. This does NOT resolve measurement-period/definition semantics: `Current` still means selected stored revision, not independent proof of current reporting period.
- A forced refresh now joins an active pass instead of launching duplicate paid research and risking a late stale overwrite. A later explicit refresh after completion still bypasses cache.
- The actual cloud tab endpoint returns the source envelope; the web cloud adapter retains it. That legacy route now validates scope/tab and uses existing authenticated spending, rate, estimated-budget, exact deck ownership and cloud entitlement checks before model resolution. Model calls are metered through the existing hook; provider errors are not logged/echoed. Local BYOK remains free/accountless. Cloud section caching/persistence is NOT implemented here: cloud reopen can still trigger another research pass.

## Red-team / automated verification

- Tests were added before fixes. Thirteen original regressions reproduced missing source retention, cache aliasing and stale/invalid chart values. Five endpoint cases reproduced missing spending/entitlement/budget gates and wrong error status. Subsequent red-team cases reproduced duplicate forced-refresh calls and a malformed-citation UI crash.
- New coverage: 15 research journey cases, six actual API endpoint cases, four source-inspector cases and one actual cloud-adapter transport case (26 total).
- Final `pnpm check`: exit 0; all workspace typechecks/lint and reported contracts 95 / mocks 15 / research 461 / desktop 33 / API 258 / web 200 cases passed. Credential-dependent automated audits self-skipped: NOT RUN as live audits.
- Final desktop build: exit 0. Browser build afterward: exit 0, leaving browser-configured assets. Existing Firebase import and large-bundle warnings remain. Builds are not installer or native runtime proof.

## Live observations and remaining acceptance gate

Two bounded overview operations were observed through the existing configured browser key: opening the uncached saved company overview, then one explicit scoped refresh after the fix. Background research remained paused. No credentials were extracted or copied; no broad census, new deck, unrelated tabs or automatic retries were launched. Actual paid call counts, token costs and latency were not independently metered. The normal overview code uses one ground + one structure request; HQ imagery is a separate possible operation, not included in a claimed cost/count.

The refreshed OpenAI overview retained 25 unique provider citation URLs and its source inspector opened successfully. These are Google grounding attribution URLs, many titled only `openai.com`, NOT 25 independently fetched original pages or verified claims. The live output still repeats financial figures (including valuation/funding) without passing the stricter per-metric original-passage gate. Overview side-rail estimates remain estimates, while the existing 62.5% market-share checkmark lacks visible denominator/period proof. Do not label this live run accurate or the backend bulletproof.

After a real browser reload, the same refreshed overview and 25-source inspector were retained. Returning to the original card reader worked: employees/ARR/reach/valuation all remained Unknown/No source-backed figure. This is conservative rendering, not a completed useful company dossier; unchecked overview numbers have not been made acceptable by their citation count. No claim is made that refresh/reload produced zero paid requests based solely on visible loading states.

Visual evidence is saved outside the Git checkout at `C:/Users/shann/Documents/Codex/2026-09-28/i-x20/keystone-checkpoint-28-sources.jpg`; generated screenshots are not committed. The inspector is deliberately collapsed by default. Source page titles/underlying redirect destinations and per-claim source mapping still need refinement; many identical publisher labels are not a polished final evidence reader.

Native app accessibility was readable, but click geometry was unavailable and the single fresh capture recovery timed out. No native live research/reopen/installer success is claimed. Preserve that blocker; do not restart the app or launch broad paid work to paper over it.

Next high-value slice: a bounded canonical company dossier/claim acceptance path. Reuse scoped retained originals and accepted current metrics in dashboard synthesis; keep numeric narrative claims unknown/unconfirmed unless entity, definition and reporting period match the original passage. Measure source-to-card/reader/overview agreement and reopen on one company, including a genuinely accepted original or explicit unavailable result. Then use that proven contract for Scout jobs and specialist reports. Search-source attribution improves inspectability, not factual entailment, completeness, ranking validity or production readiness.

No push, deploy, publication, main merge or user-data deletion this checkpoint. Unrelated untracked baseline/store files remain untouched.
