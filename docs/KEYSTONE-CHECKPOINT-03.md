# Keystone checkpoint 03 — shared local/cloud metric verification

Date: 2026-10-03 local. Branch: `revival/initial-card-redesign`.
Preceding checkpoint: `1b8c920`. [Build plan](../01_PROJECTS/Stratemark/Specs/Keystone-Build-and-Test-Plan.md).

## Implemented

One pure metric transition now drives local and cloud verification and both correction shortcuts. It enforces numeric bounds, verdict/value consistency, publisher-grade attribution, human locks and separation of attempts from successful support. Cloud now persists completed inconclusive attempts even when no figure changes. Failed corroboration retains capture/support dates. Zero-to-zero is a confirmation, not a correction. Valid cited shortcuts remain zero-extra-call paths.

An additional user-facing gap was reproduced: confirming a stored estimate left its citation list empty and its confidence estimated while stamping a successful timestamp. Confirmation now attaches the cited support and updates confidence; local views receive a refresh event and stale local dashboards invalidate. Same-value confirmation keeps the original number/capture date and returns supported, not contradicted.

The approved UI/card styling is unchanged. No application key or research dataset was changed. The new shared contracts module is actively consumed by API and local repository, not unused scaffolding.

## Evidence and verification

- Twelve cloud regression tests failed before the first fix: unsupported mutation, inconsistent verdicts, invalid shortcut values, lost attempts, false human support timestamps and zero handling.
- Two more cloud cases and the local estimate-confirmation test then failed before the confirmation fix.
- Tests use isolated in-memory cloud stores and mocked model responses; assertions inspect persisted records, not just HTTP success. Recognized SEC/Reuters URLs are fixture inputs, not downloaded proof.
- Final `pnpm check` exited 0: workspace types and lint passed; contracts 92, mocks 15, research 296, desktop 27, API 172 and web 134 tests reported passing. Three credential-dependent research audits returned early; live Gemini audits remain NOT RUN. This checkpoint needed deterministic adversarial responses, not paid broad-market research. No Gemini/Google key was present in the shell environment; existing browser/desktop credentials were not extracted or copied.

## Red team / next slice

The shared gate still accepts publisher-grade citations, not exact page support. A credible irrelevant source can still lend authority. Next implement safely retrieved, identity-bound original receipts and claim/period/definition checks; test one bounded Gemini verification end-to-end once a configured route is usable. Preserve grounding support metadata and resolve Google citation redirects safely before classifying original publishers.

Same-value confirmations and 2% tolerance are not proof of matching reporting periods or measurement populations. Human disagreements are preserved, but a dedicated review queue is not built. Other ingestion paths (hunt/fact-check/red-team) require separate auditing. Cloud verification still lacks the local repository's durable scoped notes and local cached-dashboard invalidation behavior; those are not claimed complete by sharing the metric transition. Persistence/structuring errors and concurrent revision conflicts need dedicated recovery tests. No original-source accuracy, measured live latency, full browser recording, installer test or production-readiness claim.

Unrelated `.pnpm-store/` and `docs/KEYSTONE-CATEGORY-BASELINE.md` remain untouched. Local commit only; GitHub backup remains unconfirmed while authentication is unresolved.
