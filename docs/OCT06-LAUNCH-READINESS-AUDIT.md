# October 6 launch-readiness audit

Branch: revival/initial-card-redesign. Product checkpoint: 41d3422.
Verdict: NO-GO for a public production launch. Preserve the approved card design.
This pass tested and inspected; it did not implement product fixes or publish research.

## Evidence ledger

- PASS: pnpm check completed successfully: workspace typechecks, lint and unit/integration suites. Research suite: 598 tests; web: 230; desktop: 44 passed and one live acceptance test skipped. Fixture tests are not proof of live Gemini quality. The research live-search test had no environment key and did not exercise a paid live request.
- PASS: desktop build completed. This is compilation, not an installed-app acceptance test. The web build warns about a roughly 1.89 MB main JavaScript chunk (512 KB gzipped) and Firebase splitting.
- INVALID INITIAL BROWSER RUN: the normal E2E port 4173 belonged to Lumin, not Stratemark. Seven failures from that run are discarded as product evidence. The test configuration blindly reuses any server on that port.
- ISOLATED BROWSER RUN: fresh Stratemark Vite server on loopback port 4187, Chromium: four passed, three failed, one skipped. Markets/deck/dashboard serious-or-critical accessibility scans passed, as did Culture/Vice routing. This was a development build, not the packaged release.
- TEST DEBT: the three isolated failures were a tier locator selecting a hidden label, stale no-key alert wording/element expectations, and a password-gate test expecting a gate absent from this configuration. The no-key failure snapshot shows the actual honest Gemini-key gate. These failures do not establish that research ran without a key. The single-file embed test skipped because its artifact was unavailable.
- LIVE UI FAILURE CONFIRMED: reopened the Microsoft deck generated in the preceding actual Gemini test. Card, preview and Metrics still have unknown employees, revenue/ARR, users/customers and market cap; no accepted company snapshot. Overview says readable originals were found but no excerpt passed its checks. No new large paid census was launched during this audit.
- PASS: local source bridge rejects missing custom header (403), foreign origin (403), and a loopback HTTPS source (blocked: Unsafe source URL). These are focused checks, not a comprehensive security certification.
- CODE-CONFIRMED SHARING RISK: opening Share automatically submits an encoded research snapshot URL to TinyURL, with is.gd fallback, when within its length limit. No separate disclosure/consent gate was found in that path. We did not trigger this with user research.
- CODE-CONFIRMED LINK PORTABILITY GAP: shareUrlFor uses the current window origin/path. A link generated from this localhost preview points recipients to their own localhost, not this machine. A packaged custom-origin link also needs a verified public recipient route or portable file workflow. No public recipient journey was verified.
- CODE-CONFIRMED SHARE METADATA GAP: SharedMetric retains type/value/confidence/top citation, but not measurement definition or period. Recipient reader labels by metricType; verify revenue versus ARR, customer versus user semantics and reporting periods survive sharing before release.

## Launch priorities, in order

### 1. Useful first-card research — blocker

Fix original-source selection and evidence extraction before running another broad market census. Initial hydration reads only two originals and general homepages can displace investor material. Grounding redirect URLs can fail original retrieval. Current quote matching requires issuer, figure, units, definition and reporting date inside a short passage; real filings often establish these across document context and tables.

Acceptance: a fresh public-company research run produces an accurate, source-backed company snapshot and applicable available business figures on card, preview and dashboard. A private company keeps genuinely undisclosed values unknown. Preserve issuer/period/unit/definition checks; do not weaken the system into citation-only verification. Annual revenue is not ARR. Reopening preserves accepted evidence.

### 2. Honest completion, latency and recovery — blocker

The first-card-ready path currently follows a completed hydration attempt and entity-card role, not proof of usable accepted content. Show finding companies, verifying profile, verifying figures, ready/partial/blocked distinctly. Expose why sources or checks failed. Clearly explain which actions still spend credits while background research is paused.

Acceptance: an empty Microsoft card cannot be presented as a finished research result. Measure time to first useful card and time to complete, provider calls and failures. Exercise rate limits, timeout, cancellation, restart and resume without losing accepted work or duplicating charges. No fixed latency promise until measured.

### 3. Complete company dossiers — blocker for the full-product promise

Source business summaries, products, leadership and org-chart identity from relevant originals instead of generic homepage marketing. Gate individual sections by actual retained evidence. Prioritize overview and figures, then leadership/products and current intelligence. Do not invent teams or reporting relationships.

Acceptance: follow one new company from card through every dashboard section; each section has useful sourced content or an explicit honest blocked/not-applicable state. Validate executive photos and roles. Cached/offline reads remain available without a key. We did not complete fresh live generation for every dashboard tab in this audit.

### 4. Safe, portable sharing and exports — blocker

Remove automatic research transmission to public shorteners or require an explicit informed opt-in. Provide a working recipient destination or portable deck file. Preserve definitions, dates and citations. Test large payloads and corrupt/untrusted imports. Sharing should not quietly trigger paid verification just by opening a dialog.

Acceptance: a second machine with no Stratemark account/key opens a shared deck and report, sees correct figures and citations, and receives no credentials or unwanted private data. Test real mobile/email recipients and full PDF output; codec unit tests are insufficient.

### 5. Real specialist reports — high priority

The enlarged finding reader now has a better layout, but currently expands saved summary/key points; it is not a newly researched deep report. Culture, Vice, Insight and Barrier cards need meaningful extended context rather than repeated front text. Keep allegations attributed, evidence linked unobtrusively, and uncertainty clear.

Acceptance: front one-liner, preview explanation and full report are three genuinely useful levels. Full report reads as a coherent cited story and produces a readable shared/exported artifact. Images are optional; evidence depth comes first.

### 6. Shipped desktop and release safety — blocker

Verify the installer on a clean machine: key setup, live research, original retrieval, retained files, offline reopen, restart, migration, uninstall/reinstall and recovery. The development source bridge is not a production endpoint. Native renderer security settings include context isolation, no Node integration, sandbox and web security; encrypted key storage exists, but the installed journey was not exercised here. Review release owner/configuration and signing before any publication.

Acceptance: the actual packaged app passes the same useful-research journey as development, with no credentials in exports/logs/repository. Signing, update distribution and supported operating systems are explicitly verified rather than assumed.

### 7. Final experience, logos and scope discipline — high priority

Preserve card proportions and the approved design. Validate correct, crisp original logos, balanced brand colors, long names/copy, responsive previews, loading/error states and source controls. Assess performance on a real slower machine. Repair stale E2E expectations and isolate test ports so release checks are trustworthy.

Acceptance: real new companies, not only seeded samples, look complete and readable across desktop/mobile layouts. No wrong-logo identity or endless invisible retries. Automated accessibility results cover only three tested pages, not the entire application. Research currently runs through Gemini; universal-provider keys and production MCP should not be advertised as complete until implemented and exercised end to end.

## Build sequence / next checkpoint

Do priority 1 plus its readiness contract first, not a redesign or another agent framework. Trace one public company's discovered sources, readable originals, candidate facts, rejection reasons, accepted storage and UI projection. Add regression cases for contextual filing evidence and wrong issuer/period/metric definitions. Then repeat a bounded real Gemini test and reopen the result. Capture the before/after card and dashboard. Only proceed when useful research reaches the screen reliably; otherwise record the exact failed boundary.

Following checkpoints: dossiers and recovery; sharing/privacy; specialist reports; installed-release acceptance and final polish. Do not call the product production-ready merely because compilation and fixture tests pass.

## Boundaries

No product code fixes, pushes, deployments, key changes or third-party sharing were performed in this audit. Existing unrelated working-tree changes were preserved. Temporary test configuration was removed; browser failure artifacts are retained under apps/web/test-results/launch-audit. Earlier live research details and exact root-cause hypotheses remain in docs/OCT06-AUDIT-CHECKPOINT.md.
