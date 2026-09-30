# Stratemark overhaul planning hub

Status: researched north star v1.0.0 ready for review. Implementation has not started and is not authorized by these documents.

Prepared September 30, 2026 on exploration branch `feat/claim-level-signal-evidence`; latest inspected code baseline `3f18af2`.

## Current source of truth

1. [North star](NORTHSTAR.md): chosen direction, simple journey, screens, user stories, architecture, and non-goals.
2. [Phased goals](PHASES.md): G00-G08, acceptance gates, research experiments, and production readiness.
3. [Action contract](ACTIONS.md): A01-A62, shared UI/MCP behavior, permissions, costs, and recovery.
4. [Research evidence](RESEARCH.md): dated official sources, alternatives, repository risks, and unverified facts.
5. [Build state](BUILD-STATE.md): cold-start instructions and the single execution ledger.
6. [Build workflow](build-workflow.md): Astra planning, GPT-6.1 Sol implementation, and three distinct attempts before escalation.

Use comments such as `NS10: ...`, `US09: ...`, `A16: ...`, or `G04: ...`. Plain-language feedback is welcome. Version decisions deliberately and update affected gates rather than maintaining competing plans.

## Historical input, not competing plans

- [Journey and feature inventory](journey-and-features.md): code-backed pre-overhaul inventory, not proof of complete live verification.
- [Founder research architecture](founder-research-architecture.md): cleaned handwritten meaning; pending questions are now resolved by north-star defaults.
- [Decision register](decisions.md): human constraints, feedback history, and links to selected defaults.
- [Earlier scaffold](overhaul-draft.md): superseded by the complete north star.

The previous audit and [open research roadmap](../../../docs/OPEN-RESEARCH-ROADMAP.md) are background material. This folder is the entry point for the new overhaul. Earlier roadmap suggestions are not automatically release scope.

The existing improvement automation is paused during review. It may resume only after the founder authorizes the build and its instructions are updated to match the approved plan. Application code, stored research, credentials, and the main branch are outside this preparation change.

Only product decisions belong in these files. Do not copy private transcripts, provider keys, customer research, recordings, or assistant session dumps into this public-source repository.
