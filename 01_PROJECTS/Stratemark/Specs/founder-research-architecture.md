# Founder direction: persistent market and company research

Status: planning input, not implementation authorization. Recorded September 30, 2026.

Historical extraction: the later researched [NORTHSTAR.md](NORTHSTAR.md) v1.0.0 resolves the proposed labels, defaults, report interpretation, and open questions below. Preserve this as source meaning, not a competing specification. Implementation remains unauthorized.

The founder supplied photographs of two distinct handwritten product-planning pages. The second and third attachments show the same page. This document preserves cleaned product meaning rather than copying the photographs or a private transcript into the repository. It separates requested direction from proposed additions and unresolved decisions.

## Meaning extracted from the notes

### Define a market

The user describes a market, such as Frontier AI Labs, and begins building a research deck.

### Role 1: Deck Sentinel

The Sentinel is the main agent. It organizes decks and research, assigns subagents, and manages memory. More responsibilities may be added later.

It uses an ongoing web-search loop to discover players in the defined industry. Finding a new company immediately triggers a company research assignment. Discovery continues while existing assignments run.

As results return, it synthesizes the market and organizes companies using meaningful categories. The notes mention market share, users, revenue, and ARR. It organizes cards into companies, infrastructure, and distribution, and decides where entities belong in that industry.

It also starts specialist researchers with focused jobs.

### Role 2: Card Scout

A Scout is a persistent company researcher. Once assigned, it researches the company and builds a personal research database for it.

It synthesizes the information it finds and prepares it for the company card and the company dashboard. The notes name overview, metrics, and product roadmap, followed by other possible sections.

It continues researching new information and produces reports. New developments appear in an Updates tab in the deeper company dashboard.

The meaning of the handwritten report phrase is uncertain: it appears to say "white reports," which could mean written reports or white papers. This remains unresolved; it is not being interpreted as whitespace/opportunity reports.

### Role 3: Bonus Card Researchers

These specialists cover market-level research purposes:

- Insight: research trends in the market.
- Culture: research positive culture news in the market.
- B2E: research barriers to entry in the market. The label is interpreted from its explicit description.
- Vice: research negative stories in the market.

These researchers do not each own a single company. They create findings cards around their research, displayed under their corresponding market tabs. Findings may still refer to specific companies.

## Proposed product structure

This is our interpretation of the direction, with additions called out below.

| Surface           | Purpose                                 | Main content                                                                 |
| ----------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| Research library  | Reopen ongoing research                 | Markets, saved companies, recent changes, existing reports                   |
| Market deck       | Understand the players and the market   | Companies, infrastructure, distribution, insights, culture, barriers, risks  |
| Card reader       | Understand one company quickly          | Identity, purpose, a few useful supported facts, why it belongs, sources     |
| Company workspace | Explore the accumulated company dossier | Overview, metrics, products, supporting evidence, reports, and Updates       |
| Research activity | Understand work and control it          | Discoveries, queued tasks, active work, gaps, failures, pause/resume, budget |

Culture and Vice were hidden in the previous exploration. The new notes request those purposes again. Restore them to proposed scope for review, not to application code. Recommend the user-facing label Risks for Vice and Barriers to entry for B2E; exact labels remain a founder decision.

Infrastructure and distribution describe an entity's role in a market. A company can hold more than one role and belong to more than one market. Specialist findings are separate records that can link to those companies without inheriting their financial metrics.

## Proposed full journey

The steps below include our recommended missing controls. They describe future behavior, not current shipped capability.

| ID  | Simple sentence                                                                                      | Basis                                                       |
| --- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| N01 | You open your library and start a market or reopen an existing one.                                  | Prior product direction plus recommended return entry point |
| N02 | You describe the market, your goal, region, and any companies that must be included.                 | Notes plus prior seed-company direction                     |
| N03 | You confirm the scope, provider setup, research depth, and budget.                                   | Recommended checkpoint                                      |
| N04 | The Sentinel starts discovering relevant companies and market roles.                                 | Notes                                                       |
| N05 | Each new company gets a persistent dossier and a Scout assignment.                                   | Notes; dossier separation is a recommendation               |
| N06 | Scouts research companies while the Sentinel keeps discovering more players.                         | Notes                                                       |
| N07 | The first useful, supported cards appear before all research is finished.                            | Recommended progressive delivery                            |
| N08 | You browse companies, infrastructure, and distribution, using clear filters.                         | Notes                                                       |
| N09 | You open a card for a short orientation and then explore its deeper company research.                | Prior confirmed interaction direction                       |
| N10 | You inspect facts and sources, ask questions, compare companies, or request missing research.        | Notes plus existing product direction                       |
| N11 | Market specialists publish sourced trend, culture, barrier, and risk findings in their own sections. | Notes                                                       |
| N12 | You save findings, create reports, and share or export a snapshot.                                   | Notes plus existing product direction                       |
| N13 | You choose what should be monitored and how often it can spend your budget.                          | Recommended consent and scheduling control                  |
| N14 | You return to meaningful changes, unresolved gaps, and research you can resume.                      | Recommended return experience                               |

## Gaps and recommended resolutions

### G01: Market boundaries and purpose

"Frontier AI Labs" can include model developers, infrastructure, product companies, or all three. Ask for a goal, scope, geography, inclusions, and exclusions in one short checkpoint. A pricing comparison and an investor landscape should not trigger identical research.

### G02: Search completion

Web search cannot establish that every company was found. Set a discovery budget, required seed coverage, minimum useful coverage, and a stopping rule for diminishing discoveries. Explain what was searched and what remains uncertain. Offer a further discovery pass instead of a completeness badge.

### G03: Early usefulness

The notes could be read as ranking only after all company workers are started. Do not make the user wait for the entire market. Publish initial sourced cards as they become useful, mark their research state, and deepen them over time.

### G04: Persistent ownership versus constant execution

A persistent Scout should mean saved memory, known gaps, a work queue, and scheduled resumable tasks. It does not require a model process per company running constantly. Use a bounded worker pool and prioritize work behind a simple interface.

### G05: Company identity across decks

Resolve aliases, parent companies, subsidiaries, brands, and domains before creating assignments. Reuse one company dossier across decks while storing market-specific roles, fit, and scope separately. Researching the same company twice should not create contradictory isolated identities or duplicate charges needlessly.

### G06: Evidence before presentation

Search discovery is not the same as verified research. Retrieve useful source pages, extract supported claims, record dates and metric definitions, and retain contradictory observations. A figure's source link is attribution, not proof that the figure is comparable or independently checked. Add a shared evidence check across all three research roles, not another mandatory user-facing screen.

### G07: Ranking versus sorting

Keep reported size, user-goal relevance, evidence confidence, and research completeness distinct. Sorting by ARR requires compatible periods and definitions. Ranking a company as best requires an explicit objective and visible criteria. Unknowns should remain unknown rather than lowering a company's quality score.

### G08: Category membership

Treat company/infrastructure/distribution as market roles rather than mutually exclusive permanent company identities. Support multiple roles without showing confusing duplicates. Keep findings linked to relevant companies and to the market, with their own evidence.

### G09: Specialist coverage and balance

The notes specifically request positive culture news and negative stories. Define what Culture includes: internal workplace culture, external community/brand culture, or both. Keep those findings useful rather than turning the category into publicity. For Risks, distinguish allegations, established events, current developments, and resolved issues; retain dates and relevant context. Exact taxonomy and reinstatement scope remain open.

### G10: Meaningful updates

An update should explain what changed, when it happened, the source, and why it matters. Avoid new reports for repeated stories or unchanged pages. Store observations separately from the current card so changes can be inspected and corrected. Never imply full monitoring during periods when the local app was closed.

### G11: Research controls and recovery

Centralize provider selection, usage accounting, task priority, scheduling consent, cancellation, retries, checkpointing, and restart recovery. A pause must stop new work and explain any remaining in-flight requests. Maintain useful partial results after provider failures. Show actual activity rather than invented agent narration.

### G12: Research quality and release requirements

Assess entity coverage, supported claims, missed seeds, freshness, duplicate findings, contradictions, latency to the first useful card, and provider cost. Carry forward accessibility, original visual style, restrained company-specific cards, protected keys, import/export, migration/recovery, and permissioned future MCP access. Handwritten architecture does not replace these prior requirements.

## Proposed visible controls

The user should not need to configure agent internals. A provisional minimal set is Start research, Research more, Ask, Compare, Follow updates, Pause, and Sources. Setup and scope can use sensible defaults with optional advanced choices. Exact controls and placements will be settled in the overhaul plan.

## Decisions still open

1. What counts as useful initial coverage and how much research is the default?
2. Which two or three facts belong on cards in different markets?
3. How should sorting and goal-based comparison work?
4. What does Culture include, and should Vice become Risks?
5. Does the report phrase mean written reports or white papers?
6. Which existing company sections remain primary, optional, combined, or removed?
7. What monitoring cadence and spending behavior should be the default?
8. Should company research be reused across decks as proposed, and how should conflicting market contexts display?

Do not launch the build or resume the implementation automation from this document. Incorporate founder corrections, then use Astra to prepare the reviewable overhaul plan and retain the recorded GPT-6.1 Sol executor workflow.
