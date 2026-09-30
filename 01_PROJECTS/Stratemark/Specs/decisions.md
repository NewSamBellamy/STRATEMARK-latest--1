# Stratemark overhaul decision register

## Agreed constraints

| ID | Decision | State |
| --- | --- | --- |
| D01 | Prepare and discuss the overhaul before starting a build. | Confirmed September 30, 2026 |
| D02 | Target a free, open-source desktop app using the user's own keys. Provider usage may cost money. | Confirmed product direction |
| D03 | Work on a separate exploration branch and preserve existing work. | Confirmed |
| D04 | Use the original restrained design direction and improve company-specific card identity. | Confirmed product direction |
| D05 | Keep card interaction simple and exclude the flip/back action. | Confirmed product direction |
| D06 | Keep figures, claims, freshness, and confidence honest and inspectable. | Confirmed product direction |
| D07 | Aim for a persistent research collection and useful ongoing competitive intelligence. | Confirmed product direction; feature scope pending |
| D08 | Broaden model/search access and design future MCP integrations. | Confirmed direction; release sequencing pending |
| D09 | Astra plans the later build; GPT-6.1 Sol agents implement it. | Confirmed September 30, 2026 |
| D10 | An executor makes three distinct attempts at a technical blocker before calling Astra for help. | Confirmed September 30, 2026 |
| D11 | No push, publication, deployment, or merge to main is authorized. | Confirmed boundary |
| D12 | Pause the earlier automatic improvement loop during founder review. | Applied September 30, 2026 |

## Founder feedback

The founder supplied handwritten architecture notes on September 30, 2026. Their cleaned meaning and proposed additions are separated in [Founder research architecture](founder-research-architecture.md). These are product-direction decisions, not authority to start implementation.

| Comment ID | Journey / feature IDs | Requested change in plain language | Decision | Reason / tradeoff | Release priority | Acceptance example |
| --- | --- | --- | --- | --- | --- | --- |
| C01 | J03-J05, F08-F16 | Begin with a defined market and let a Deck Sentinel discover players while assigning research. | Expand | Discovery and company research should proceed together. | Sequencing pending | A newly discovered company receives a task while discovery can continue. |
| C02 | J09-J10, F33-F47 | Give each company a persistent Card Scout and a growing company research database. | Expand | Persistent ownership is requested; the bounded worker-pool implementation is a proposal. | Sequencing pending | New research accumulates in the same company dossier and updates its card and workspace. |
| C03 | J06-J07, F17-F22 | Organize entities by company, infrastructure, and distribution roles and useful researched metrics. | Expand | Exact ranking criteria, multiple role membership, and metric comparability remain to settle. | Pending definition | Cards explain their market role and the selected sort criterion. |
| C04 | J07, F21, L02 | Add specialist research for trends, positive culture news, barriers to entry, and negative stories. | Expand | This reopens Culture and Vice in proposed scope after their earlier display retirement. | Pending taxonomy | Each specialist produces sourced market findings under its relevant tab. |
| C05 | J07-J10, F21-F25 | Market specialists create findings cards about the market rather than owning one company each. | Keep and clarify | Findings may refer to companies without inheriting company financial metrics. | Sequencing pending | A trend card retains its own evidence and links the affected companies. |
| C06 | J14-J15, F35, F58-F61 | Add continuous company research and an Updates tab in the deeper company dashboard. | Expand | Cadence, meaningful change detection, local runtime, budgets, and consent need design. | Pending controls | An update explains a supported change and its date, without duplicating unchanged news. |
| C07 | F52-F55 | Produce additional company reports from accumulated research. | Unresolved wording | The handwritten report phrase may mean written reports or white papers. | Pending clarification | Specify report type and creation trigger before implementation. |
| C08 | P01-P11 | Carry forward scope review, seeds, BYOK breadth, evidence, vault, budgets, MCP, benchmarks, and release quality. | Keep | These earlier requirements were not rescinded by the architecture notes. | Release scope pending | The overhaul plan explicitly includes or defers each requirement. |

Allowed decisions: keep, expand, simplify, combine, remove, defer, unresolved.

## Questions the review must settle

1. What single outcome should a first-time user reach in their first session?
2. Which information should fit on a company card, and which belongs in deeper research?
3. Should the card reader stay as a separate step or become part of the company workspace?
4. Which company sections help a decision, and which add unnecessary navigation?
5. How should the app explain company size, relevance, evidence quality, and comparison?
6. What should a returning user see first: saved research, changes, ongoing work, or a new prompt?
7. Which provider combinations and external integrations are required for the first release?
8. Which refresh actions require consent, budgets, and visible schedules?

These are discussion topics, not blockers requiring an answer before any useful planning can continue.
