# Keystone checkpoint 15 — connected browser original receipts

Date: 2026-10-05. Branch: `revival/initial-card-redesign`. No visual redesign or production release.

## Implemented

- The actual browser BYOK repository selection now supplies a bounded original-source reader. Initial entity enrichment, additions and single-metric verification use the existing shared numeric publication gate instead of the browser's citation-only legacy route. Explicit native original-source services still take precedence; cloud selection is unchanged.
- Browser reads are direct HTTPS/CORS requests to a conservative list of established public filing/reporting hosts. No proxy, subscription, API key, cookie, referrer or redirect bypass is involved. Arbitrary company domains are not automatically allowed because browser networking lacks the native transport's DNS pinning. Unreadable/blocked originals retain a reason and cannot verify a metric.
- Reader results are bounded to 256 KiB, six seconds and an unchanged 4,000-character excerpt, with a SHA-256 body receipt. Unsupported content, non-200 responses, visible noarchive/nosnippet directives, opaque/redirected responses and unsafe URLs do not produce retained extracts. Browser-exposed headers do not guarantee visibility of every server directive. A receipt is not semantic proof.
- The repository owns local retention when given a reader capability: originals save in the acknowledged snapshot before synthesis. Save failure blocks synthesis/publication. Duplicate attempt IDs cannot overwrite different content. Short successful-read/in-flight coalescing reuses the existing shared mechanism.
- Company/metric-scoped receipt reads return detached copies and make no provider call. Snapshot receipts survive restart and the existing JSON export/import path without copying the API key. New attempt records receive shape/size validation, including malformed/duplicate-import rejection. This is not authentication of imported evidence or exhaustive workspace reference validation.

## Verification / red team

- Before implementation, two repository tests reproduced absent pre-synthesis receipt retention and interpreting/revising despite failed original storage. Both now pass.
- Fourteen browser-reader fixtures cover direct retrieval/options/hash, six unsafe/unsupported URLs, transport/CORS failure, size/type/restriction/error handling and bounded HTML excerpt selection. They use simulated fetch responses, not real public CORS or live provider access.
- Added actual repository deck-creation integration: the locally retained reader is used, source failures remain unknown across stored card/reader queries, and company-scoped attempts are retained. This targeted pipeline suite passed 21 tests.
- Added actual browser storage adapter round-trip with fake IndexedDB: a separate opener sees committed originals before synthesis; verification survives reopen and JSON import; API key is absent from the snapshot and offline receipt reads do not ground again. The fourteen-case browser storage suite passed after the new malformed-import case was observed failing and fixed. Fake IndexedDB is not an independent live-browser/device test.
- Full `pnpm check` passed workspace types/lint/unit suites, including 402 research tests and 153 web tests. The additional deck-creation test was then added and passed in the 21-test targeted pipeline suite; research typecheck was rerun. Credential-dependent live audits self-skipped and remain NOT RUN. The previously intermittent Back-to-card test passed unchanged; its root cause remains unresolved.
- Earlier compile checks caught a new test-wrapper type mismatch, desktop/browser fetch type mismatch and incomplete new test fixtures. These were corrected before the successful gate.
- `pnpm build` passed desktop main/preload and production browser compilation. Existing bundle-size/Firebase import warnings remain. No installer/live full-company benchmark/recording was run. No paid provider research was launched, no key was extracted, and no user data was deleted.

## Before / after and limits

| Area | Before | Now |
| --- | --- | --- |
| Browser numeric promotion | Credible citation could promote without original receipt | Same protected gate; unavailable originals cannot promote |
| Original retention | No connected browser originals | Acknowledged local snapshot retention before interpretation |
| Evidence reuse | Native/cloud originals only | Browser receipts readable by company/metric after reopen and backup import |
| Retrieval coverage | Grounded links looked sufficient | Explicit direct-CORS limits; unknown rather than manufactured confidence |

The browser can now be more honest but show fewer populated figures. Grounding redirect links, most non-CORS sites, arbitrary official small-company sites, PDFs and paywalls remain unavailable to this direct reader. Full retrieval coverage needs the protected desktop host or an explicitly configured/approved retrieval capability. There is no hidden fallback to a cloud proxy. Existing saved legacy metrics are not retroactively recertified or erased.

Local receipts remain embedded in snapshots, not separately indexed documents. Write amplification, artifact lifecycle/canonical identity rebinding, semantic/period/definition acceptance, narrative truth, dashboard completion and a compact user-facing receipt inspector still require work. Native originals are separate files and are not magically included in browser exports. Synchronous API BYOK remains a distinct legacy path; this slice does not certify it.

No latency/accuracy gain is inferred from fixtures. Each company still uses its existing model calls plus at most two bounded original reads; unreadable sources can add waiting time. Measure accepted coverage and time together before increasing deck size.

## Next

Run one bounded configured-key company journey through the intended desktop/native route, inspecting supported and unavailable facts rather than repeating the zero-source key test. Then implement company/metric-scoped original extraction and explicit period/definition observations, keeping one accepted revision across card, reader and requested dashboard. Add an explicit retrieval capability for browser coverage only with disclosed destination/permission; never silently relay a user's key. Continue K1/K2 before agent-fleet/scoring/provider UI expansion.
