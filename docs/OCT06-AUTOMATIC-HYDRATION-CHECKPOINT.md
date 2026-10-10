# Automatic hydration repair — October 6, 2026

## Outcome: PARTIAL, NOT a completed hydration fix

Founder request: cards should automatically show all available, accurate core
business figures without requiring manual metric hunts. No card redesign.

Full `pnpm check` passes for this checkpoint. This is automated verification,
not proof of successful live company hydration.

## Implemented

- New and resumed deck creation, incremental additions and ADK enrichment run
  one focused missing-metric follow-up before returning a hydrated company.
- Skip the follow-up when employees, revenue/ARR, users/customers and
  valuation/market cap already have accepted evidence.
- Maximum extra work: one grounded call, one extraction, two original reads.
  No perpetual retries or proxy filling. Retain existing accepted figures.
- Preserve discovered original URLs if follow-up search returns no usable links.
- Recognize equivalent terminal legal suffixes (Corp./Corporation,
  Inc./Incorporated, Ltd./Limited). Never infer trade names or another entity.
- Route discovered SEC /edgar/data filing leads to the existing issuer-validated
  financial observation reader, alongside /Archives/edgar/data leads.
- Cloud receipt storage accepts metrics_hunt attempts under existing bounds.
- Preserve initial source-attempt array identity; follow-up evidence cannot
  mutate an earlier saved attempt. Persistence failures still block publication.
- Fixed independently reproduced cross-deck identity corruption: a new run for
  the same company name previously replaced an older company record with the
  new ID, orphaning older cards and duplicating IDs. Hydration now updates only
  its own scoped company ID. Regression checks old companies/cards remain intact.
  This prevents future corruption; it does not reconstruct already lost records.

## Live verification — failure explicitly retained

Used the existing configured Gemini connection through the app, without reading
or copying the key. An initial request failed with "Failed to fetch" before
company research; retry reached discovery. A development reload interrupted
that run. The test deck's Refresh action was also invoked; that action hunts for
new entrants and marks metrics stale, so it is NOT initial-hydration verification.

An uninterrupted Microsoft-only run produced deck
`mkt_microsoft-corporation_y18s7`, company `cmp_microsoft-corporation_3r9qn`.
All four core card slots remained unknown. Research-only export confirmed:
an old official annual report extract, an unavailable original, and a follow-up
with no fetched sources. Those observations motivated the scoped source fixes.

A further uninterrupted run after those fixes produced deck
`mkt_hyperscale-cloud-infrastructure-enterprise-softw_87664`.
The resulting Microsoft card STILL displayed four unknown figures. This is a
failed product acceptance test. No synthetic values or manual overrides added.
The live test decks and research-only exports were retained; no user data deleted.

## Red-team findings / next work

The current generic acceptance gate demands a single direct statement containing
the full legal entity, exact value, metric definition, explicit currency and
literal reporting date. Annual revenue prose additionally demands a specific
literal interval phrase. Real issuer disclosures use tables, first-person text,
separate headings/date context and approximate reported counts. A 4,000-character
contiguous extract cannot reliably retain all those relationships. Another
search pass alone cannot repair this mismatch.

Next milestone must address structured disclosure interpretation and retained
entity/date/unit context, with separate tests for headcount, fiscal revenue,
dated market cap and precisely scoped customer populations. Do NOT simply
disable evidence checks or relabel model estimates verified. Preserve dates,
whole-company versus product scope, exact versus approximate reporting and
issuer-reported versus corroborated status. Require successful live public AND
private company cards, matching preview/dashboard values and offline reopen.

Creation still treats an attempted company research unit as completed even when
all business figures are unsupported. Useful-card readiness and recovery status
need a separate explicit acceptance rule that does not endlessly retry genuinely
undisclosed private data. A universal whole-company user count may not exist;
never sum incompatible product populations to fill the slot.

This adds bounded provider work but has NOT demonstrated improved live metric
coverage or latency. Do not describe it as production-ready or "all numbers fixed".
No UI design changes, deployment, main merge or fabricated research in this slice.
