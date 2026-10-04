# Keystone: source-first company intelligence

Status: implemented foundation, not a completed independent fact-checker.
Date: 2026-10-03. Branch: revival/initial-card-redesign.

## Why

Start with original evidence rather than whichever search result is easiest to summarize. Preserve the research behind the card so future questions can reuse it. Keep the existing card design unchanged.

## Source order depends on the question

| Question | Start here | Expand to | Important distinction |
| --- | --- | --- | --- |
| Revenue, ownership, financial position | Jurisdictional filings, annual/interim reports, investor relations | Independent financial reporting and dated specialist data | Fiscal revenue, TTM, ARR and annualized run-rate are different |
| Private-company scale | Official disclosures and named investors | Reputable independent reporting | Missing public data remains unknown; company-reported is not independently verified |
| Users and customers | Dated original disclosure with a definition | Reporting that identifies the original source | Paying customers, active users, registrations and downloads are different |
| Products, pricing, team and brand | Official product, documentation, pricing, leadership and press-kit pages | Independent context | Resolve legal entity and division; portraits and logos are not AI-generated substitutes |
| Valuation | Funding announcement or dated market data | Independent financial reporting | Funding-round valuation is not current market capitalization |
| Vice/controversy | Regulator/court records, attributable investigations, company response | Independent corroboration | Allegations are not adjudicated findings |
| Culture/insight/barrier | Original research and attributed evidence relevant to the finding | Specialist reporting and community accounts where appropriate | Sentiment cannot establish financial facts or generalize a whole company |

Investor platforms are useful leads and comparisons, not automatic proof. Respect licensing and paywalls; no paid feed is connected by this change.

## What this checkpoint implements

- Shared source-priority instructions in grounded research and Ask, independent of provider endpoint.
- Official-domain search guidance in company enrichment and dashboard research; missing websites must be resolved, not guessed.
- Source classification based on hostname boundaries, not publisher names embedded in arbitrary titles or query strings. Opaque grounding redirect metadata is classified conservatively.
- An additive local `researchEvidence` collection: company identity, topic, captured timestamp, grounded notes, citations and search queries. No credentials stored here.
- Company enrichment and dashboard ground calls save sourced notes even before structured dashboard output is produced. Unscoped discovery/chat output is not added to company evidence.
- Scoped keyword retrieval via `getResearchEvidence`. Ask receives bounded relevant notes only from companies in its scope. Retrieval itself makes no model request; Ask still does.
- Stable company-ID remapping keeps notes associated with the company after ingestion. Existing snapshots without this collection remain readable.
- Stored notes are explicitly labelled model research, not raw pages or independently verified claims. Stored citations are not automatically attached to an answer unless the answer cites their URL.

## Acceptance and red-team checks

Tests cover spoofed publisher names/domains, official-domain boundaries, opaque redirects, unsafe website protocols, sourced/scoped recording, isolation between companies, protected retrieval copies, dashboard persistence across reopening, and Ask reuse without adding unused source citations.

This is prompt-level source prioritization, not deterministic retrieval routing. A source URL alone does not prove the exact claim. Existing provenance checks still permit some unknown publishers; classification hardening does not close that remaining verification gap.

Checkpoint verification: workspace typechecking and lint passed; research suite reported 286 passing tests and contracts 82. Live provider audits self-skipped without keys, so these counts are not live research verification. The full `pnpm check` did not pass: web `src/test/app-flow.test.tsx` could not find the `Back to card` button after dashboard navigation (132 other web tests passed). No UI code changed in this slice; the cause of that journey failure remains unconfirmed. The final research integration test was additionally typechecked and run successfully.

## Next milestones, in order

1. Claim receipts: exact supporting passage when retrievable, original URL, publication date, reporting period, metric definition, currency, entity and corroboration state. Fail closed for unsupported metrics; retain conflicting claims.
2. Source acquisition: fetch original filings/pages with permission and licensing controls, document hash/version and local source files. Do not confuse grounded notes with fetched originals. Retry transient failures, not missing facts forever.
3. Freshness: topic-specific refresh rules and user-enabled scout schedules. Show reporting dates separately from collection dates. Budget/concurrency limits and pause controls remain mandatory.
4. Scale the local library: separate append-only evidence storage from the growing main snapshot; index company, topic and time; add scoped export/deletion and backup. Current collection is a foundation, not a million-user-scale database claim.
5. Provider adapters: capability-based reasoning/search/image routes. A different reasoning model needs a compatible search provider; a key alone does not supply all capabilities.
6. MCP: expose approved, scoped read/search actions over this evidence store, then user-approved research/refresh actions. No credential exposure and no unrestricted file access.

Before calling this production-quality, run a small user-approved paid live research audit against public/private/small-business examples and compare card/dashboard facts to the originals. This checkpoint does not spend the app's Gemini credits or claim that live quality gate passed.

## Primary references consulted

- [TradingView financial data](https://www.tradingview.com/support/solutions/43000543506-how-to-access-financial-data-on-tradingview/): financial statements, annual/quarterly/TTM periods, external providers and differences between figures.
- [SEC filings and APIs](https://www.sec.gov/search-filings): original filings, submissions/XBRL APIs and RSS.
- [Google Search grounding](https://ai.google.dev/gemini-api/docs/google-search): search and grounding metadata/citations; this is not independent claim verification.
