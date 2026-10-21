# Keystone checkpoint 04 — preserve provider passage-to-source attribution

Date: 2026-10-03 local. Branch: `revival/initial-card-redesign`.
Previous implementation: `300008b`. [Build plan](../01_PROJECTS/Stratemark/Specs/Keystone-Build-and-Test-Plan.md).

## Implemented and wired

Both actual Gemini adapters (browser/Electron fetch and server SDK) now retain Google's passage-to-source support metadata. A shared parser preserves the untrimmed answer alongside the display text, original support/chunk indices, passage text, source URLs/titles and provider offsets. Offsets are recorded, not interpreted as JavaScript string positions. Sources without URLs cannot shift later mappings onto a different publisher.

The existing scoped local research recorder saves these mappings before structuring. Querying saved research returns deep copies so consumers cannot rewrite the underlying receipt by editing nested source arrays. Legacy/custom provider responses without support metadata still work; the application does not manufacture attribution for them. No additional provider calls or UI changes were introduced.

## Regression evidence

Eight cases failed before implementation; the nine-case provider/persistence suite now passes. It exercises both adapters, original-index mapping, unsupported text, empty/missing/out-of-range/negative/fractional source indices, mixed valid/invalid mappings, non-ASCII passages and nested copy isolation. Focused provider/evidence/SDK suites reported 27 tests passing.

Final `pnpm check` exited 0: workspace types and lint passed; contracts 92, mocks 15, research 305, desktop 27, API 172 and web 134 tests reported passing. Three credential-dependent live audits returned early and remain NOT RUN. No paid research, original-page fetch or live Gemini accuracy evaluation was run. The approved card design and existing user datasets are unchanged.

## Red team: what this does NOT prove

- Google attributes a GENERATED answer passage to sources; this is not a verbatim quote from a retrieved original, independently checked company identity or a verified reporting period.
- No metric is promoted merely because a support mapping exists. The verification transition has not yet been replaced with an original-passage gate.
- Grounding redirect URLs are preserved but not resolved. An unresolved Google URL can still be classified unknown; never guess its original publisher from the title.
- Mappings are persisted by the current scoped LOCAL recorder. The cloud adapter returns them, but durable cloud scoped notes are still unfinished. Unscoped discovery does not automatically become company evidence.
- Storage migration/import validation, quota durability and arbitrary malformed imported metadata remain K2 work. Keeping more metadata increases evidence size; no latency/storage-efficiency benchmark is claimed.

## Exact next checkpoint

Safely retrieve original sources through the desktop/server boundary (redirect/DNS/size/type/timeout and licence checks); retain source versions/passages separately from model notes. Match canonical company, metric, units, definition and reporting period against those originals before exposing new receipt-verified figures. Wire the accepted observation to the shared transition and card/reader, then run one bounded configured-key Gemini test. Do not add a pure validator with no real consumer and call K1 complete.

Progress remains on K1. K0 visual baseline is pending, K2 local durability and K3 Sentinel/Scouts follow. Company dashboards, specialist reports, scoring, providers, monitoring and MCP/release gates are not complete. Save checkpoints on this branch; no main mutation. GitHub backup remains unconfirmed, and unrelated untracked files are preserved.
