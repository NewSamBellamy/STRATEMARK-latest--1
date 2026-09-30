# Fresh-session launch: GPT-6.1 Sol, $50 maximum

Prepared September 30, 2026. Execution supplement to north-star v1.0.0, not a replacement product plan. Status: handoff prepared; billing preflight UNVERIFIED; application build NOT STARTED.

## Setup once

Open this repository as the project:
`C:\Users\shann\Documents\Codex\2026-09-28\i-x20\work\stratemark-cards`

Use branch `feat/claim-level-signal-evidence`. Sign in through the application's secure API-key flow, choose `gpt-6.1-sol`, medium reasoning, and Standard processing. Never paste a key into chat or a repository file. API authentication and billing are not established by selecting a model. The current session's saved CLI authentication could not be confirmed; no credentials or billing settings were changed.

Use a dedicated OpenAI API project/key with no other traffic. In project Limits, configure a **$40 monthly spend limit with Enforce a hard limit enabled**, not just an alert. Confirm the starting project spend and actual processing tier. This setting must be configured/verified by the owner; it has NOT been set by this handoff.

OpenAI documents that hard-limit enforcement can lag and slightly overshoot. The $10 buffer reduces that risk; it is not a mathematical guarantee. If a strict $50 ceiling is required, the execution route must also bound/reserve each request's maximum cost and include all in-flight calls. If the chosen Codex route cannot expose sufficient spend/request controls, do not claim enforcement or launch an unattended goal; stop for a controlled billing route. A goal's token budget is not a dollar limit. [Official spend controls](https://developers.openai.com/api/docs/guides/spend-limits).

## Budget and scope

| Allocation                                                        | Maximum planned spend |
| ----------------------------------------------------------------- | --------------------- |
| Sol implementation and coordination                               | $30                   |
| Sol verification and final checkpoint                             | $5                    |
| Astra help, only after three distinct failed technical approaches | $5                    |
| Untouched margin for delayed accounting                           | $10                   |
| Absolute user ceiling, all categories combined                    | $50                   |

Stop opening implementation packets at $30 total known/reserved spend; remaining working allowance is only for verification/checkpoint and necessary bounded help. Never deliberately dispatch past $40 total known/reserved spend. Unknown usage is not zero. Count this preparation if it was billed to the same campaign, subagents, retries, cache writes, reasoning/output tokens, tool fees, taxes/adjustments if applicable, and any other provider costs. No live Stratemark research, paid search, image generation, signing purchases, or broad benchmark campaign in this first run.

Initial objective: finish G00's contract/caller baseline and then a verified, bounded G01 local-vault foundation slice if funds and dependencies permit. Do not promise all G00-G08 for $50. A partial phase stays partial. G02-G08 remain future work unless separately authorized; stop with a usable checkpoint, not a half-integrated rewrite.

First packet: inventory research callers, run baseline checks, define/version the action schemas and failure fixtures in small batches. Second packet only after its required contracts pass: packaged SQLite feasibility and a tested vault adapter behind existing interfaces, using synthetic migration fixtures. Never migrate the user's real research in this campaign. Commit ready slices locally; preserve unrelated work; no push/main merge/publication/deployment.

## Token-efficient execution

- One active Sol worker, serial packets. No parallel swarm, full-history forks, repeated planning, or repeated Astra reviews. The existing north star already received Astra review.
- Read `AGENTS.md`, this file, `BUILD-STATE.md`, and `NORTHSTAR.md` once at cold start. Then read only the active PHASES section, relevant ACTIONS entries, and necessary code. Skills still must be read when applicable.
- Use bounded file searches and targeted snippets. Return only useful error output, not entire logs or source files.
- Medium reasoning by default; high only for a concrete tricky invariant. No max/ultra by default. Standard tier; verify child tiers separately before any escalation. Do not silently substitute models.
- Run targeted tests during iteration and the full required gate at integration. Do not skip meaningful verification to save tokens.
- Every packet ends with a compact checkpoint: goal/action IDs, changed files, actual checks, limitations, local commit, and reconciled/unknown spend. Keep the detailed status in BUILD-STATE; cost summary in BUILD-BUDGET.json. No private project IDs, keys, invoices, or billing screenshots in git.
- Three distinct hypotheses before Astra help; same-command repetition is not progress. Help needs known pricing and remaining reserve; if unavailable, report the blocker instead of overspending.
- The $50 ceiling spans sessions and monthly billing resets. Do not reset the campaign ledger, resume the old automation, or interpret a monthly limit reset as renewed authorization.

## Paste this into the fresh session

> Prepare to execute the Stratemark $50 campaign from `01_PROJECTS/Stratemark/Specs/LAUNCH.md`. Read its billing preflight and the canonical north-star/build-state files. Use GPT-6.1 Sol and preserve the exploration branch. I authorize G00 followed by a bounded G01 foundation slice only after the billing preflight is verified. Create one concrete goal for the next packet, not the whole production overhaul. Follow the $40 working limit/$50 absolute ceiling across sessions, serial execution, and three-attempt Astra rule. If authentication, spend visibility, or enforcement is unverified, stop before implementation and tell me exactly which setup remains. Otherwise implement, verify, commit locally, and checkpoint within the authorized budget. Never push, merge main, deploy, migrate live user data, run paid product research, or revive the older automation.

The prompt carries the new implementation authorization when submitted by the human; merely reading this file does not start the build. Goal objects are chat-specific: create the actual implementation goal in that fresh chat. The current chat's goal is preparation only.

## Pricing reference, not a token allowance

Checked September 30: Sol Standard short-context rates are $2/M input, $0.10/M cached input, $2.50/M cache write, $10/M output. Reasoning/output, tier, context length, and extra services affect cost; recheck at launch. Do not turn $50 into one guessed total-token budget. [Model pricing](https://developers.openai.com/api/docs/models/gpt-6.1-sol). [API authentication](https://learn.chatgpt.com/docs/auth). [Processing tiers](https://developers.openai.com/api/docs/guides/fast-mode).
