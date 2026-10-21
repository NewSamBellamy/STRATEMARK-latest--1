# Keystone checkpoint 47 — remove speculative Team & Org profile prompts

Date: 2026-10-06 local. Branch: `revival/initial-card-redesign`. Parent: `ebed879`.

## Connected behavior

- Team & Org research now requests concrete reported facts (current title, career roles, company tenure, prior company and explicitly named ownership/project) instead of impressions about personality, working style, interests, strengths or what a leader "brings to the table."
- Reporting lines may be returned only when a source explicitly states them; otherwise they remain unset.
- The same factual constraints apply to the bounded follow-up search and its synthesis prompt.
- No card, UI, or layout changes.

## Verification

- Focused `dashboard-evidence.test.ts`: 22 passed; includes assertions against the exact first-pass prompts.
- Full `pnpm check` passed: workspace typecheck, lint, and unit tests. Research 583; contracts 108; mocks 15; web 221. API and desktop suites passed in the same gate.
- Live Gemini, 30-company census, and model-judge tests were skipped because this process has no provider key. No key was read and no external model call was made.

## Red team / remaining risks

- Prompt discipline is not claim-level proof. Current output still relies on grounded search notes and general tab citations; each person/detail needs retained source lineage and claim-specific validation before the org chart can be described as verified.
- The existing fixed five-person follow-up trigger remains an arbitrary completeness proxy and can add an unnecessary search for a small company.
- Portrait sourcing, aliases/transliteration, current title freshness and user corrections remain unresolved.

## Next

Implement source-linked person records (exact source URL and quoted support, safely retained locally), then only display fields supported by those originals. Separately replace the five-person threshold with a measured evidence-based completion rule. Continue the remaining backend, user journey, provider, MCP, design and release areas from the delivery map; this checkpoint does not complete a full product area.
