# Keystone checkpoint 09 — relevant original excerpts

Date: 2026-10-04 local. Branch: `revival/initial-card-redesign`. Previous checkpoint: `977c200`.

## Delivered behavior

The shared native source transport now selects a useful contiguous 4,000-character window instead of always retaining the page prefix. This is wired into existing desktop and cloud original retrieval, not an unused research scaffold. Short pages remain unchanged; pages without numeric business cues keep the original prefix. Selection considers employee/headcount, revenue/ARR, users/customers, valuation, market cap and market share cues with nearby numeric text. Distinct categories win over repetitive menu labels; equal scores prefer the earliest candidate window. Up to 600 preceding characters retain nearby company/date context; windows near the end shift back to keep the full available budget.

No extra source fetch, model call, dependency, stored-receipt schema, cache key or UI change. Existing network byte/time limits, retention restrictions, content hashing and original-passage acceptance remain unchanged. Selection never concatenates distant text, invents a quote or upgrades confidence. The saved text is an exact contiguous slice of the existing normalized page text, not a verbatim raw HTML archive. Full response-body hashes still identify the received bytes.

## Verification

Eight pure selection cases and three native-transport integration cases were added. Four selection regressions and the long-header retrieval regression were observed failing before implementation. The native retrieval fixture now demonstrates late evidence entering the shared passage gate; a wrong company or wrong figure is still rejected. Script/style/comment content is excluded before selecting evidence. Short pages, absent cues, repetitive menus, end-of-page metrics, intact Unicode text, stable ties, context preservation and no cross-gap stitching are covered.

Local synthetic CPU measurement only: 25 extractions of a 252,000-character repetitive business-text fixture produced 4,000-character intact slices; p50 11.30 ms, p95 18.96 ms. Zero network reads and zero model calls in this measurement. This is selection overhead on one fixture, NOT faster Gemini research or a live publisher/accuracy benchmark.

Full `pnpm check` exited 0: types, lint and all workspace unit suites passed. Research now reports 345 tests; the source retrieval suite reports 28 and web remains 139. Eleven cases were added in this checkpoint. Three credential-dependent provider audits returned early and are NOT RUN as live audits without a configured key.

## Red-team findings / remaining limits

- This is query-independent relevance selection, not company/metric-specific retrieval. A dense competitor section can win. The acceptance gate still rejects a wrong-company quotation, but useful target evidence may be omitted. Do not call it exhaustive extraction or better accuracy proven on live sources.
- Numeric dates can trigger relevance and titles may mention metrics without reporting them. Selection alone establishes no support. HTML normalization still does not establish rendered visibility; JavaScript-only pages, PDFs, paywalls, layout-dependent tables and hidden elements remain unsupported or imperfectly handled.
- Only one contiguous window is retained. Distant dates, definitions and conflicting figures may be omitted. The 256 KiB transport bound also still limits what can be inspected. Missing evidence must remain unknown, never invented.
- Mechanical passage acceptance is not semantic proof. Canonical entity aliases, identity-bound source authority, reported periods/definitions and immutable accepted-fact revisions are still required. Browser-only and initial enrichment/dashboard/specialist ingestion still lack the new original gate.
- No Gemini key was extracted, copied or exposed; no paid research was triggered. No complete milestone or production readiness claim.

## Next bounded work

Introduce company/metric-scoped passage selection with cache/storage identity accounted for, rather than adding an optional query that silently reuses a different query's cached receipt. Then evaluate a bounded supported/unavailable/conflicting sample with a securely configured Gemini key. Carry the same acceptance rules into initial card/reader research; retain unknowns when unsupported. Preserve the approved design and unrelated work.

Local exploration checkpoint only; main untouched. GitHub backup must be separately confirmed, not inferred from a local commit.
