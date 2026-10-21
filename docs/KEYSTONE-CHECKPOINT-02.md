# Keystone checkpoint 02 — source authority and reconciliation

Date: 2026-10-03 local. Branch: `revival/initial-card-redesign`.
Plan: [Keystone build and test plan](../01_PROJECTS/Stratemark/Specs/Keystone-Build-and-Test-Plan.md).

## Implemented

- Citation authority is derived from the real URL, never a supplied primary-source label. Malformed URLs and URLs containing credentials are excluded.
- Written attribution remains visible, but cannot earn machine verification without a usable citation. Unrecognized sources remain inspectable and are not silently deleted.
- Repeating the same number no longer lets a weaker automated observation erase a human check, stronger citation, support date or conflict history. Disagreement cannot override a human-checked number.
- A forged-authority metric is unknown on the company profile used by the card and reader. Legacy stored rows are not silently mutated by rendering.
- No card styling, provider configuration or user data was changed. No paid application research was invoked.

## Regression evidence

Nine new provenance regressions failed before the central fix. Focused suites subsequently passed: provenance 33, card-view 20, metric verification 21. Tests cover Reddit labelled primary, lookalike publisher domains, unknown publishers, malformed URLs, embedded credentials, prose-only attribution and human-lock/source-history loss. One additional human-disagreement case covers a stronger automated publisher still losing to an explicit human review.

Positive fixtures now use recognized publisher URLs, not invented hosts claiming primary authority. These are mocked contracts, not fetched pages. The research fixture using `techcrunch.example` now explicitly expects downgraded headcount and its warning in the estimated revenue method note.

Final `pnpm check` exited 0: all workspace types and lint passed; contracts 92, mocks 15, research 296, desktop 27, API 158 and web 134 tests reported passing. Three credential-dependent research audits returned early and must not be counted as live factual-accuracy evidence. No installer or full browser recording was produced for this backend-only slice.

## Red team / next checkpoint

1. A recognized publisher still does NOT establish exact claim support. An irrelevant Reuters/SEC URL could pass this publisher gate. Original retrieval plus company, field, unit, reporting period and exact passage validation remain required.
2. The separate cloud verification route still duplicates logic and lacks the preceding checkpoint's complete verdict/value/date protections. Unify and test it next before claiming all verification paths are safe.
3. Unknown legitimate small-company websites are conservatively downgraded. Add identity-bound official-domain verification, not a permissive model label or a giant fixed publisher list.
4. Equal numbers can describe different periods or populations. Typed observations and immutable evidence records remain unbuilt; source strength alone is not a universally correct merge rule.
5. Human verification is an explicit user decision, not proof of infallibility. Automated disagreement is retained for review rather than silently overwriting it.

K1 remains incomplete. This checkpoint closes reproducible integrity failures; it is not a production-readiness or live accuracy claim. Preserve the approved design. GitHub backup is not confirmed while authentication remains unresolved; unrelated untracked files remain untouched.
