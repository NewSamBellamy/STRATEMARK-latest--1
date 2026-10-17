# Keystone checkpoint 30 — one accepted company facts lane

Date: 2026-10-05 local. Branch: `revival/initial-card-redesign`. Parent checkpoint: `ea09e3e`.

## Connected user-visible improvement

Company cards, inspection, saved cards, dashboard headline figures, charts, and company facts in Ask now share a conservative evidence projection. A legacy Verified label plus a URL no longer establishes a business figure. Unsupported observations become Unknown in the read view; original values, citations, and history remain stored. Human-confirmed corrections remain separate, not independently verified.

Approved card layout, hero proportions, typography, colors, and background were not redesigned. The real existing OpenAI card/reader/overview agree after reload: old figures lacking matching retained original evidence are Unknown. Fifteen tracked sources remain research activity, not fifteen verified figures. This improves consistency; it does NOT prove useful live factual coverage.

## Wiring completed

- `company-facts.ts` validates observations, selects the current revision, scopes/bounds original reads, and reuses the literal company/value/date/basis/unit passage gate. Missing proof, conflicting values, cross-company documents, fractional person counts, and automatic zero-user claims are withheld. Automatic market share requires a market/denominator/period contract; a percentage alone is insufficient.
- Local/browser card reads and `getCompanyFacts` are read-only projections. `getCompanyMetrics` remains raw audit history. Overview/chart/Ask facts use the same rules; retained source context is separately labeled.
- Desktop main/preload/renderer have an accepted-facts channel. Old hosts request update/restart rather than substituting raw labels. Demo data has an explicit demo-only implementation.
- Cloud renderer revalidates originals on deck, inspection, saved-card and offline-cache reads. Authenticated card reads project facts without a paid research requirement. Cloud metric dashboard reads receive owned originals.
- Existing cloud verification diagnostics have a validated compatibility adapter shared with company originals, source reads and Ask. Synthetic read-row IDs are bookkeeping, NOT immutable provenance or proof. Original ledgers are unchanged; the actual source passage must still match.
- Saved cloud bookmarks resolve to owned decks/cards rather than masquerading as company cards. Unresolvable/deleted/foreign references are not invented; the API returns `unresolvedCount`. Legacy deck-less lookup is bounded to 100 owned candidates and four concurrent reads. Saved-card facts reach their dashboard too.
- Share preflight reloads accepted facts instead of resurrecting raw metrics. Failed/old transport withholds unsupported figures rather than trusting legacy labels.

## Verification

Tests were observed failing before fixes at the local card/chart/Ask, renderer/native, cloud/offline, sharing, authenticated cloud reads, fractional headcount, saved-card/dashboard, and verification-ledger seams.

Final `pnpm check`: exit 0, all workspace typechecks/lint and 1,105 tests passed (contracts 95, mocks 15, research 489, desktop 33, API 265, web 208). This includes 23 new cases; credential-dependent census/judge suites self-skip and are NOT live proof. Desktop build exit 0. Browser build is run last to restore browser-configured shared output; existing large-chunk/Firebase warnings remain.

Real configured browser: reloaded the existing OpenAI overview, confirmed background research stayed paused, checked overview/At a glance, then returned to the card inspector and checked all four metrics. No fresh research run or manual check was requested; no key was copied. Actual provider usage/cost was not independently metered.

Screenshots outside the repository:

- `C:/Users/shann/Documents/Codex/2026-09-28/i-x20/keystone-checkpoint-30-overview.jpg`
- `C:/Users/shann/Documents/Codex/2026-09-28/i-x20/keystone-checkpoint-30-reader.jpg`

Compilation is NOT native-runtime/installer or real Firestore deployment proof. No push, deploy, main merge or remote-backup claim.

## Red team and next acceptance gate

Do not add another disconnected integrity subsystem. Next: a useful, measured source-to-card/reader/overview/reopen run through the protected native reader. Browser source access remains intentionally restricted; do not weaken it or spend repeatedly bypassing CORS. Use a small bounded public/private-company test and prove useful accepted figures or justified explicit Unknowns, with source-access reasons and measured calls/timing.

Outstanding risks:

1. Mechanical English matching is not independent semantic truth. Legal-name aliases, subsidiaries, source corroboration, reporting periods, source priority and freshness aging need real evaluation. A supported historical figure is not necessarily current today.
2. ARR/revenue, users/customers/active-user denominators, currencies, private valuation/public market cap need typed definitions and consistent labels, not prose heuristics.
3. Internal rank/retier inputs, deeper generated tabs, descriptions, reports/briefings, raw owned deck snapshots, incoming shares/imports and export consumers still require an accepted-facts/claims review. This read boundary does not certify all prose or scoring.
4. Verification diagnostics are bounded and may be evicted. Immutable accepted-source retention is unfinished; losing proof intentionally withholds figures while preserving raw observations.
5. Legacy bookmark recovery has a 100-deck ceiling. Unresolved counts need frontend recovery UI. Saved-only cloud data is not a complete offline audit-history view; authoritative server observations remain intact. Review account-scoped cloud caches and company identity across decks before release.
6. Durable Scout scheduling, specialist story/report journeys, broader BYOK capability routing, MCP/local permissions, packaging/security/accessibility and the complete release journey remain on the delivery map.

This checkpoint strengthens a connected trust boundary. The backend goal remains active; the product is not production-ready.
