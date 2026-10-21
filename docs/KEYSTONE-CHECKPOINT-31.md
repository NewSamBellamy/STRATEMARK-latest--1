# Keystone checkpoint 31 — useful bounded original reads and native continuity

Date: 2026-10-05 local. Branch: `revival/initial-card-redesign`. Parent: `2b5f9f3` (checkpoint 30).

## What changed for users

- Native accepted-fact reads no longer silently truncate a requested 20-attempt evidence window to 10. The regression saves a supported employee figure, adds ten newer failed reads, restarts the native store/repository, and checks facts, deck card, inspector, saved card and overview. The original metric stays intact; reads make no provider calls.
- The shared native/API source reader accepts HTML/plain-text reports up to 2 MiB, instead of rejecting everything above 256 KiB. Real Microsoft annual-report HTML was 601,259 bytes. Streaming and returned-body overflow still fail closed with a specific document-limit reason. Retained text remains a maximum of 4,000 characters; full response bytes are hashed.
- Targeted excerpt fallback now prioritizes the requested metric when a filing uses first-person prose instead of the literal company name. The retained excerpt remains one unchanged contiguous slice. This improves inspectable evidence, NOT attribution: a first-person quote still fails automatic metric acceptance without a sufficient identity contract.

Approved design, card proportions, branding and UI controls were not changed. No new dependency or parallel research system.

## Actual public-source evaluation

The production pinned-IPv4/TLS reader was invoked directly, then through the native original-source services. No API key was read, copied or supplied. No Gemini/model request, background-research toggle or user-vault mutation. Public test artifacts stayed in temporary directories.

Three fixed public locators, seven bounded passes (21 reader invocations total), were used to reproduce failure, safely identify the byte-limit cause, evaluate the fix and check persistence. Temporary diagnostic logging was removed. Initial search via agent-reach/Exa was rate-limited; the web-search fallback located the original pages. Search output was NOT treated as an original receipt.

Final native-service read → save → reopen results:

| Original locator | Result | Read time | Reopen |
| --- | --- | --- | --- |
| `https://www.microsoft.com/investor/reports/ar25/` | Retrieved; 4,000-char employee-targeted excerpt and SHA-256 | 737 ms | Receipt values unchanged |
| `https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft-20260630.htm` | Explicitly unavailable: exceeds 2 MiB; no partial text/hash published | 315 ms | Failure receipt unchanged |
| `https://www.anthropic.com/news/series-h` | Retrieved; 4,000-char valuation-targeted excerpt and SHA-256 | 149 ms | Receipt values unchanged |

Times are this machine's single final sample, NOT a general latency benchmark. Retrieval/retention is not factual certification. No live provider-generated metric was accepted in this evaluation. The repository/card/overview continuity test uses controlled source and metric fixtures; it is not a completed live research journey. An initial JSON-string comparison falsely differed because schema parsing reordered keys; value-based equality confirmed unchanged records.

## Verification

Five new regression cases were observed failing before their corresponding fixes. An additional actual-stream coverage case was added; the existing stream-overflow case was aligned with the new limit and strengthened to check no retained partial evidence.

Final `pnpm check`: exit 0; workspace typechecks/lint and **1,111 tests** passed (contracts 95, mocks 15, research 490, desktop 35, API 268, web 208). Credential-dependent census/judge self-skips are not live proof. Desktop build exit 0. Browser build ran last, exit 0, restoring browser-configured shared output. Existing large-chunk/Firebase warnings are unchanged. No native GUI/installer, real Firestore deployment, push, merge or production-readiness claim.

## Red team / next gate

1. **Useful acceptance is still the central gap.** Known official-company domains are prioritized during discovery but the automatic metric publisher gate lacks that scoped context. Literal-name, first-person, table, date and unit limitations still withhold useful information. Do not simply trust supplied credibility labels or allow issuer prose to become independent verification. Finish a typed issuer/subject/reporting-period proof across ingest, canonical facts, cards, overview, charts and reopen, with adversarial cases and a bounded live Gemini run.
2. **Long filings remain unsupported beyond 2 MiB.** Do not keep increasing caps or synthesize from partial unproven bytes. Evaluate a legitimate bounded filing section/access adapter. PDF/compression, source retention restrictions and browser CORS remain explicit limitations. Per-read limits do not constitute a global concurrency/spend limit.
3. **Twenty records are a window, not durable accepted-proof retention.** Further failed attempts can still crowd out older supporting receipts. Source-linked accepted-fact retrieval/pinning and indexed vault reads remain unfinished. Current native list still scans the artifact directory; no million-user-scale claim.
4. Mechanical quotation support is not independent truth or freshness today. Metric definitions, source corroboration, parent/subsidiary identity, conflict handling and aging need measured coverage.
5. Keep all nine delivery areas in the delivery map in scope: durable Sentinel/Scouts, full dossiers, specialist reports, ranking/monitoring, multi-provider routing, local/MCP permissions, complete sharing/import and actual release journey. This checkpoint does not finish any whole milestone.

Next: prove useful accepted original-backed facts in a real bounded native company run, not another disconnected guard or higher test-count substitute. Goal remains active.
