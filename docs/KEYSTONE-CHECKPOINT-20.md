# Keystone checkpoint 20 — inspectable live verification failures

Date: 2026-10-05. Branch: `revival/initial-card-redesign`. Card aesthetic unchanged.

## Actual user journey and finding

- Inspected the existing OpenAI company Metrics dashboard in the current browser preview, reloaded current source, paused shared background research, and ran two explicit employee Fact-checks using the already configured key. No key was read, copied or placed in a script.
- Both completed as Unverified because no original page could be read. The stored employee figure remained 5K/Estimated. This is not validation of that figure. Reload preserved the figure and the shared pause.
- The second check displayed two original attempts, both Blocked Google grounding redirect URLs, with the browser supported-host restriction as the reason. Returned search links also included an irrelevant retailer; source relevance/selection needs work. Provider titles are not validated original hosts.
- The second result was observed by 20 seconds after clicking; this is an upper-bound observation including tool intervals, not a precise latency benchmark. Exactly two manual checks were initiated; provider request/token counts and dollar spend were not measured. Work already sent before pausing may have finished. No broad census, new deck or unattended run was launched.

## Connected improvement

- Optional `VerifyMetricResult.originalSources` exposes retrieval status, requested/final URL, capture time, reason, partial flag and retained text. Browser/native Gemini verification returns detached copies after persistence. The persisted-cloud endpoint already returns originals and Sentinel passes its response through; this additive contract makes the existing result consumable by the shared UI.
- Metric Fact-check now offers a collapsed Inspect source checks disclosure. Reading evidence costs no extra research call. Empty attempted lists are distinguished from blocked/unavailable pages. Readable excerpts are plain text and explicitly not accepted claims; retrieval dates are not business reporting dates.
- Older transports without the optional field keep working. No source access/security boundaries were relaxed, no connector/proxy added and no acceptance rules changed. Research excerpts/attempts already persist; the expanded result panel remains session-local and is not yet a saved evidence-history browser.

## Verification and red team

- Four added tests failed before implementation: backend receipt return, blocked-page inspection, plain-text malicious excerpt/safe link, and empty-attempt explanation. Focused suites then passed (31 verification tests, 11 FactCheck tests).
- Initial full gate caught a test fixture missing its required structure stub; corrected the fixture. Final `pnpm check` exited 0, including 182 web tests. Credential-dependent shell audits self-skip and remain NOT RUN, separately from the two browser checks above.
- Desktop and browser production builds both exited 0, run sequentially. Existing Firebase import/large-chunk warnings remain. Builds are not installer or live desktop validation.
- Live disclosure expanded successfully and showed both blocked reasons. Screenshot stored outside the repo: `C:/Users/shann/Documents/Codex/2026-09-28/i-x20/artifacts/checkpoint-20-source-checks.jpg`.

## Shared blast radius

Contracts changed additively; research, browser/native IPC consumers and cloud Sentinel compile against the same optional field. Full workspace checks cover all consumers. API source-return behavior is pre-existing, not newly live-certified. No migration needed.

## Next bounded task

Validate protected native original retrieval for actual grounding links without extracting credentials. Resolve accessible original URLs through the protected transport, prioritize relevant sources over arbitrary first-two citations, and establish one accepted figure plus one explicit unavailable figure through card/overview/dashboard/reopen. Do not weaken original validation or declare company/dashboard completion from this inspection improvement. Continue the whole-product map: Scouts, deeper sections, brand assets, specialist reports, ranking, provider routes, local vault/MCP and release remain unfinished.
