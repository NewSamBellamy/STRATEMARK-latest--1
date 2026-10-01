# Retained research briefs and native deck browsing

October 1, 2026, 16:53 PDT. Application `28f393044c2d750fc9ed103436c5c5cafdc2d0e7`. Branch `feat/stratemark-spinoff-local-agents`, personal spin-off `NewSamBellamy/STRATEMARK-latest--1`. Remote SHA verified; main unchanged at `c945b31dee0095331b8487133c131c36e76ba601`. Documentation follows separately. No release/deployment/migration.

## User-visible improvement

- Opening a card now reveals retained Overview, Products & business/Capabilities/Channels, Market position and Updates when the sources provide them.
- Each note retains its own source links, period, unreviewed status and distinction between reporting, analysis and estimates. Unknowns stay visible; estimates need methods and assumptions.
- Open questions make gaps explicit. This is not yet an executable follow-up research control.
- Larger editorial identity and green/paper hierarchy; friendly source market prevents confusing identical company/role cards from different decks. Close remains accessible when long content scrolls on a narrow window.
- Deck search combines with type filters, displays useful result counts and no-results recovery, and preserves search/filter/focus when a card closes. Search covers retained names/summaries/card text, not the whole source corpus.
- The same brief appears in Saved Cards and survives keyless restart. Reading/navigation adds no research requests. Save/remove/Undo preserves original research.

Coverage advanced: U21/U22/U25/U28/U30/U31/U38 and saved-return behavior. These are partial R1/R2 outcomes, not closed milestone claims.

## Connected backend

The existing two hydration calls now produce an optional bounded role-aware brief. Mapping accepts only each note's own source indices; missing/invalid attribution is omitted with reasons. Entity card leads include retained note citations. Service validates binding before broader company-level leads are merged. Existing card JSON commits atomically with task outcomes; no new storage table/framework. Shared schema limits serialized UTF-8 content to128KiB and refuses verification authority. Findings never inherit entity briefs/metrics.

## Evidence

Stable `pnpm check` session80704 exit0: all six typechecks, lint, contracts381/mocks16/research434/API158/desktop520/web313 =1822 reportedtests. Three optional live/LLM tests skipped because no key was supplied. This is deterministic behavior evidence, not live quality. Final desktop build90541 exit0; known1.63MB web-entry warning remains.

Full real Electron/IPC/pipeline/SQLite walkthrough2138 exit0 at clean application commit above. Receipt dirty=false, failures=[], synthetic provider responses and fictional companies, no live research. All available native flows plus seven synthetic compositions were visited; unimplemented features explicitly listed in the receipt.

- [Research, partial failure/retry, rich cards, search and collection](C:/Users/shann/Documents/Codex/2026-09-28/i-x20/outputs/checkpoints/native-journey-aEbNPG/01-native-research-and-recovery.webm)
- [Keyless restart, retained reading, narrow controls and seven-card composition](C:/Users/shann/Documents/Codex/2026-09-28/i-x20/outputs/checkpoints/native-journey-aEbNPG/02-reopen-and-seven-card-composition.webm)
- [Receipt](C:/Users/shann/Documents/Codex/2026-09-28/i-x20/outputs/checkpoints/native-journey-aEbNPG/receipt.json)
- [Reader screenshot](C:/Users/shann/Documents/Codex/2026-09-28/i-x20/outputs/checkpoints/native-journey-aEbNPG/company-research-overview.png)
- [Narrow source reader and reachable Close](C:/Users/shann/Documents/Codex/2026-09-28/i-x20/outputs/checkpoints/native-journey-aEbNPG/narrow-retained-source.png)

Video SHA256: part1 `4EB68692EA3058BDD6C2A642D69E4CA2F0D7C0BAF70B03A4C06A4CAA9524AAFB`; part2 `294DF51E45D08219A4A93A3C0CB8CF2A27493F53437ACF126470354BFF248F15`. Media lives outside source; links are local to the founder's machine, not publicly hosted.

## Red team and limitations

Repaired: malformed URL throwing from safeParse; per-card citation binding before service lead merging; indistinguishable same-company/role readers across markets; fixture target selection contaminated by another company's name in source text; scrolled-away Close on narrow windows. Focused RED→GREEN tests, bounded independent review and actual journey checks support these repairs.

Diagnostic `native-journey-omAoeK` failed before the fixture correction; `native-journey-Ch42PN` passed dirty before final narrow repair. Neither is final acceptance. Gate47648 failed an inherited inline-import lint rule; final80704 is authoritative.

Verdict: continue. This produces useful retained research and easier browsing, not only scaffolding. But linked draft notes are not passage-verified canonical claims, fixture text does not measure model quality, three role-aware tabs are not completed deep dashboards, and seven compositions are not seven real research destinations. Founder aesthetic approval remains pending. Normal startup remains legacy-authoritative at this commit. Providers, deeper questions/reports, sharing, monitoring, MCP/plugins and packaged production gates remain unfinished.

Next high-impact result: native normal startup for genuinely new profiles without touching existing libraries, explicit unsupported-route handling and no renderer legacy restoration in native mode. Existing-data migration remains a distinct protected operation. Development dollar spend/cache savings are unobserved; founder monitors externally. No paid product evaluation was performed.
