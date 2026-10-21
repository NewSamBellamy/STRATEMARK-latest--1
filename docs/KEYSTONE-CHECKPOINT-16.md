# Keystone checkpoint 16 — avoid interpretation without originals

Date: 2026-10-05. Branch: `revival/initial-card-redesign`. Approved visual design unchanged.

## Implemented

- Protected local/native/browser single-metric verification stops before the interpretation model when no original has retrieved, non-whitespace text. The persisted-cloud verification endpoint follows the same rule.
- Original attempts still save before this decision. The shared verification transition still records the attempt, preserves the number and its prior support dates, respects human-reviewed locks, and downgrades an automated verified badge when it cannot be corroborated. Unavailable pages are not proof that a fact is absent.
- Readable originals still use the existing interpretation and original-passage acceptance checks. The legacy local repository without original-source services is intentionally unchanged; this is not blanket certification of legacy paths.
- Card reader dashboard links no longer call the deck-close handler before route departure. That handler changes the deck query, issuing an unnecessary competing navigation. A direct regression test failed before this correction and passes afterward; ordinary modal close and finding chat remain unchanged. No aesthetic changes.

## Measured scope / red team

- Tests first reproduced four local failures and the corresponding cloud unnecessary interpretation call. Local fixtures cover no citations, unavailable receipts and whitespace-only extracts, including company-scoped evidence and attempt recovery after reopening.
- For the protected single-metric no-readable-original case, model requests change from two to one: grounding remains, interpretation is skipped. This is a request-count result, not a measured live latency, dollar saving or accuracy improvement.
- Retrieval limits, source ambiguity and the conservative acceptance rule remain. This change makes failure cheaper; it does not make missing company figures complete. The next priority is live accepted-source coverage, not a larger fleet of agents.

## Verification and handoff

The initial workspace gate passed types/lint/backend suites but failed the known card-to-dashboard journey. An unchanged isolated run passed, confirming intermittency. A smaller regression then demonstrated the duplicate navigation callback deterministically. After its removal, the reader and full mock journey passed together (eight tests). Final `pnpm check` exited 0: workspace typechecks, lint and unit suites passed, including 406 research tests, 221 API tests and 154 web tests. Three credential-dependent audits self-skipped and remain NOT RUN. This does not prove every timing issue is cured; a real-browser/desktop journey remains necessary.

Final `pnpm build` passed desktop main/preload and renderer compilation after the navigation correction. The normal browser production build also passed and restored the browser preview bundle; existing large-chunk/Firebase import warnings remain. Launching the current development desktop stalled while downloading its Electron runtime and was canceled. No configured key was extracted, no old installed binary was substituted for the current build, and no paid benchmark was completed. Never count self-skipped live audits as provider verification.

Next: bounded public/private-company verification through the latest native desktop using its normally configured key, without extracting credentials or copying existing user research. Inspect acceptance and unavailable reasons and compare card/reader/dashboard. Then implement scoped extraction with matching cache identity and explicit definition/period handling. Avoid broad paid census tests.
