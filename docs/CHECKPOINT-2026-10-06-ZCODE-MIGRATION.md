# October 6, 2026 — Codex to Z Code migration checkpoint

Branch: `checkpoint/2026-10-06-zcode-glm5-3-flash-migration`.

This is the checkpoint where the owner moves Stratemark out of Codex and into Z Code using GLM 5.3 Flash.

**The backend needs work. The design is good on the cards.** Preserve the approved collectible-card design while repairing research speed, metric completeness, evidence handling and dashboard hydration.

Start with [the complete migration handoff](STRATEMARK-ZCODE-HANDOFF.md) and `AGENTS.md`. The handoff separates established behavior, unresolved questions, unfinished changes and the recovery sequence.

This checkpoint deliberately preserves the interrupted work as WIP. Seven code/test files include unverified final edits; the new scheduling tests have no corresponding implementation yet. Earlier passing tests do not validate this working state. No new full test suite or live research run was performed for this archival checkpoint. It is not beta-ready or production-ready.

The historical category baseline is included for context. Local dependency caches, credentials, recordings and private research are excluded. Browser/native research data must be exported and preserved separately before moving computers.

The previous committed implementation was `c51ee585cca2aa772e89955aac120dd7690d083a`; the documentation handoff was `6974692`. This dated branch preserves both plus the interrupted tracked code edits. Main is not changed.
