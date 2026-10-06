# Keystone checkpoint 49 — roadmap lifecycle guard and honest source diagnostics

Date: 2026-10-06 local. Branch: `revival/initial-card-redesign`. Parent: `fead8d8`.

## Connected behavior

- Products & Roadmap no longer labels a product live when its official quote says availability is in the future (for example “available next year” or a future dated start). The decision is based on the quoted official text, not a model status alone.
- The shared source inspector now explains that a blocked/unavailable original read may reflect reader limits, network-safety rules, or source-retention policy; it is not by itself evidence that the publisher refused access. Missing HTTP responses are shown as such rather than silently implying an HTTP denial.
- Root cause for the recent browser preview failure is now established: BYOK web research uses a deliberately restricted browser reader. It rejects arbitrary company domains (including `meta.com`) and opaque Google grounding redirects before making a request. The browser diagnostic count represented retained receipt rows, not distinct hosts. This does not indicate that Meta blocked Stratemark. Native/desktop retrieval has a separate SSRF-checked transport that can follow and revalidate public redirects.
- No reader allowlist or redirect safety rules were weakened. No live rerun was made after this finding, so improved live source coverage is not claimed.

## Verification

- Added two red/green lifecycle regressions. Before the fix, both future-availability cases were incorrectly rendered as live; after the fix, the focused Products & Roadmap suite passed (24 tests).
- Added the source-inspector clarification regression. Focused dashboard source tests passed (6 tests).
- Full `pnpm check` passed after both changes: typecheck, lint, and all workspace suites (1,261 passing; one live/native environment-dependent test skipped).
- The prior bounded browser run remains the only provider-backed observation: two exact-scope companies, six blocked receipt rows, no usable retained company excerpts, and one bounded metrics refresh with no qualified figures. Paid-call total was not measurable. Saved-card state was verified across reload in checkpoint 48.

## Red team / remaining risks

- The browser preview still cannot directly retain arbitrary company pages; many official-company facts will therefore remain Unknown in this mode. Do not add corporate hosts to the list as a cosmetic fix—CORS, redirect and SSRF constraints still apply.
- The safe desktop reader and browser reader have different capabilities. The UI now explains the generic outcome, but the app still needs a clear capability-aware path so the user knows when desktop retrieval is needed and the web flow does not spend source slots on unsupported leads.
- No end-to-end provider-backed run has yet demonstrated accepted company figures, a populated sourced Team & Org chart, or measured research latency/cost.
- The future-date guard is intentionally conservative but only evaluates the known future-language patterns and literal dated start expressions; it is not a general natural-language temporal reasoner.

## Next

Continue Section 2 of the build brief: make retrieval capability explicit at the repository boundary, preserve safe native retrieval, avoid futile browser reads, and give the user an accurate explanation. Then run one bounded live journey only when the path can exercise the intended reader; record cost only if the app exposes a reliable counter. Continue the backlog after that checkpoint.
