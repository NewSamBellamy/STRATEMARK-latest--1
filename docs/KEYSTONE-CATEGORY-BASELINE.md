# Project Keystone — category baseline

Recorded October 3, 2026. Current application checkpoint: `62255a7` on `revival/initial-card-redesign`.

Preview: http://127.0.0.1:4174/

The welcome screen and saved Frontier AI Laboratories deck were opened successfully. This was a preview restoration and focused code review, not a new live research run or complete production audit. Saved numbers are not independently fact-checked by this baseline. Some company cards still lack location and metrics; parent-company figures can appear on division cards. Gemini is the current live provider. No MCP implementation was found in this branch.

## Build categories

1. **Cards and first impression:** approve proportions, brand colors, logo quality and fallback, complete concise copy, metric layout, and the first card overview.
2. **Research accuracy and completeness:** validate sources, dates and entity scope; distinguish revenue from ARR and users from customers; handle conflicting facts; make essential card research the first research milestone.
3. **Starting and managing research:** simplify scope, inclusion/exclusion and region; show clear progress, costs and failures; support cancel, retry and resume; finish optional local voice input.
4. **Company dashboards and finding reports:** make every section useful; clearly separate stored research from fresh research; finish contextual chat and cited readable/exportable finding reports.
5. **Continuous intelligence:** complete Sentinel, company scouts and specialist coordination; prove scheduling, freshness, meaningful change detection and pause/resume; clarify what happens while the desktop app is closed.
6. **Keys, models and provider access:** expand beyond Gemini with capability-aware provider adapters, search/tool support, connection checks, secure key storage and clear cost controls. Provider support must not silently imply grounded research support.
7. **Local vault, saving and sharing:** verify reliable persistence, backups, restore, import/export and shared read-only decks; keep private keys and private notes out of shares; show where data lives.
8. **MCP and agent connections:** expose defined actions for research, retrieval, updates and exports; scope agent access to local data and require approval for changes or paid research; integrate compatible clients and document client-specific limits.
9. **Desktop release and final polish:** verify installation, updates, performance, accessibility, responsive layouts, empty/error states and the complete journey on a real build.

## Working agreement

- Work on one category at a time, in small visible slices.
- Start with category 1; founder review determines acceptance.
- Each slice states the intended result, changes made, evidence checked and remaining gaps.
- Save an identified commit after each ready slice; distinguish local save from a confirmed GitHub upload.
- Preserve the approved light/green design language and collectible hero proportions.
- Use focused context and handoff notes to keep costs controlled. Founder manages the remaining API budget; a model switch does not change scope or acceptance criteria.
- Move to the next category only after founder approval. Dependencies may require a small supporting change in another category, which must be explained.
