# Keystone build status / next-session handoff

Updated: 2026-10-03. This is a planning checkpoint; K0-K9 are not implemented by the new plan.

## Read first

1. [Consolidated build and test plan](../01_PROJECTS/Stratemark/Specs/Keystone-Build-and-Test-Plan.md)
2. [Research architecture and audited gaps](../01_PROJECTS/Stratemark/Specs/Keystone-Research-Architecture.md)
3. [Sentinel Market Position scoring](../01_PROJECTS/Stratemark/Specs/Keystone-Market-Position-Scoring.md)

Repository: `C:/Users/shann/Documents/Codex/2026-09-28/i-x20/work/stratemark-card-redesign-revival`.
Branch: `revival/initial-card-redesign`. Preserve main and unrelated local work.

## Actually completed

- `a8f0d15`: source-priority prompts, hostname-based classification hardening, local scoped grounded notes and Ask reuse. Not independent claim verification or a raw-document vault.
- `a3f2216`: architecture audit and phased specification.
- `60ca414`: proposed 1-99 deck-relative scoring methodology, common-basis/reranking rules. Not implemented.
- Current planning slice: consolidated company/finding journeys, four finding-card requirements, execution order, acceptance gates, performance/cost measurements and continuity notes. No application code changed.

## Known verification / blockers

Previous `pnpm check` had a failing web full-journey Back-to-card assertion. Its cause remains unconfirmed. Research/contracts tests passed at that checkpoint; live provider audits self-skipped. Do not reuse those results as proof of current production readiness.

GitHub push was blocked by Windows/Git authentication. Local checkpoint is not a remote backup. Existing untracked `.pnpm-store/` and `docs/KEYSTONE-CATEGORY-BASELINE.md` must not be swept into commits or deleted casually.

## Next bounded task

K0: inspect worktree and scripts, restore working preview, reproduce/resolve the dashboard journey issue, capture approved card/reader baseline and collect labelled timing/call-count measurements without paid live research.

Then K1: one trustworthy company enrichment/verification -> evidence receipt -> accepted fact -> matching card/reader slice. Close prose-only/irrelevant-citation verification, verdict/value and false-freshness defects with adversarial tests. No scoring UI/provider fleet/connector scaffolding yet.

Live tests need explicit scope/spend approval before invoking user research credits. Never expose keys. Source count is not confidence; an unrated private company is not a weak company. Save full evidence while compacting session notes well before the context boundary.

## Milestones

| Milestone | State |
| --- | --- |
| K0 Baseline and navigation | Not started |
| K1 Evidence correctness, card+reader | Not started |
| K2 Durable queryable dossiers | Not started |
| K3 Sentinel/Scouts, first-ready latency, branding | Not started |
| K4 Complete coherent company dashboards | Not started |
| K5 Specialist stories/reports/shards | Not started |
| K6 Deterministic cohort scoring | Not started |
| K7 Tested single/mixed-provider routes | Not started |
| K8 Meaningful opt-in monitoring | Not started |
| K9 Connector and release hardening | Not started |

At handoff update only with verified facts: last commit, files changed, implemented behavior, tests/run type, measurements, spend if known, blocker and next action. Record founder-approved design decisions; never call planned work completed.
