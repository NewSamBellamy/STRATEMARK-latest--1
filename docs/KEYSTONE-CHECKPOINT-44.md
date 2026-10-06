# Keystone checkpoint 44 — role-safe first-ready and native source acceptance

Date: 2026-10-06 local. Branch: `revival/initial-card-redesign`. Parent: `1b2abeb`.

## Connected behavior

- An exact-scope run now treats a fully hydrated Company, Infrastructure, or Distribution card as a valid first-ready result. It no longer strands a researched selected entity solely because discovery correctly assigned a non-Company role.
- A deck without a category in its URL opens on the first populated card category, while an empty/running deck still falls back to Company.
- The deck header counts unique organizations represented by the three core entity card roles rather than only literal Company cards.
- On a failed run, captured research steps are available in a collapsed, labeled log panel; they remain out of the default error text until requested.
- Added an opt-in native source acceptance test. It retrieves two public official pages, verifies HTTP 200 plus retained excerpt/hash, persists them to isolated temporary storage, reopens them and removes that storage. It makes no model/API calls.

## Verification

- `pnpm check` exited 0: workspace typecheck, lint, and unit tests. The Windows sandbox denied Vitest/esbuild filesystem access on the first attempt; the approved elevated rerun completed successfully.
- Opt-in `STRATEMARK_LIVE_SOURCE_ACCEPTANCE=1` desktop source test passed: two official pages retrieved, saved and reopened. The test does not report separate per-site timing and does not exercise Gemini.
- The latest bounded browser-preview run selected exactly Microsoft and Anthropic and produced one Company plus one Infrastructure entity. Four browser source reads were blocked; core metrics remained Unknown. This validates honest unknown handling and mixed-role discoverability, not useful accepted figures or the native desktop route. Provider cost/call count was not observable.
- The repository's previous desktop and browser builds passed before this checkpoint's final test-only/docs work; no new build or installer verification is claimed here.
- No credentials were inspected, no global research pause was changed, no deployment/main merge/push occurred.

## Red team / remaining risks

- The native source reader works in isolation, but the real Electron UI path from a user-started Gemini run through first card, retained originals, dashboard and reopen has not been exercised in this environment.
- A successful HTTP read is not accepted evidence by itself. It does not prove a metric, a company fact, or independent corroboration.
- The browser path remains constrained by blocked source reads. Keep its failure state honest; do not weaken source acceptance to make cards look complete.
- The saved preview still contains cards with Unknown core figures and at least one generic summary. This checkpoint improves routing/diagnostics, not dossier usefulness or visual quality.
- The live acceptance test is intentionally narrow and opt-in; it proves source retrieval/persistence only, not provider-backed research, product readiness, or production behavior.

## Next measurable steps

1. Trace the actual native repository path that hydrates a first card and asks for its overview; build a no-key integration regression over the real repository + native source store, asserting retained source outcomes and honest rendering without invented facts.
2. If the Electron UI can be made available, run one bounded public/private Gemini journey through card, reader, overview, Products & Roadmap, refresh, and reopen. Do not inspect or copy key material. Record accepted evidence, unknown reasons, duration, and costs only where observable.
3. Use the observed failure to improve one source-to-claim or company-dossier section end to end; do not add broad scaffolding or repeat the blocked browser run.
4. Continue with specialist-card completeness, durable Scout/Sentinel execution, defensible ranking, provider routing, local vault/MCP actions, and production readiness. This is a progress checkpoint, not a completed milestone.
