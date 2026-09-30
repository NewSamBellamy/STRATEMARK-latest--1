# Spec: Stratemark overhaul

SUPERSEDED September 30, 2026: the complete canonical specification is [NORTHSTAR.md](NORTHSTAR.md), with [ACTIONS.md](ACTIONS.md), [PHASES.md](PHASES.md), and [BUILD-STATE.md](BUILD-STATE.md). The scaffold below is historical only; its pending questions are not the current planning state. Do not use it as an alternate build plan.

Status: review scaffold. No implementation authorization. Fill this specification after the founder comments on the journey and feature inventory, then have Astra plan the accepted scope.

## 1. Problem statement

The current app offers many research surfaces, but the journey from market prompt to useful company understanding is fragmented. Company cards, metrics, research depth, and the return experience need to work together. The founder wants high-quality, simple research that grows into a persistent company-intelligence collection.

## 2. Solution overview

Product direction: help a user define a research goal, discover the market, scan distinct and trustworthy company cards, explore supported evidence, ask useful questions, retain findings, and understand later changes. The final screen structure and feature scope remain pending founder feedback.

The September 30 handwritten direction adds three research responsibilities: a Deck Sentinel coordinates market discovery and memory, persistent Card Scouts build company research, and specialist researchers produce market findings. See [Founder research architecture](founder-research-architecture.md) for extracted meaning, proposed steps N01-N14, gaps G01-G12, and unresolved wording. These steps describe desired future behavior rather than the existing app. Exact scheduling, data ownership, ranking, taxonomy, and release scope remain planning decisions.

## 3. Exhaustive user stories

Pending review. Each accepted story must have an ID, actor, action, benefit, relevant journey/feature IDs, observable acceptance criteria, and priority. Cover first run, return visits, sparse evidence, contradictions, provider failure, cancellation, restart, import, and accessibility. Do not turn every existing feature into a required story automatically.

## 4. Implementation decisions

Pending Astra planning after review. Record:

- Approved navigation and card-to-company transitions.
- Provider and retrieval configuration, capabilities, and secret ownership.
- Research stages, budgets, cancellation, checkpoints, and recovery behavior.
- Evidence records, source passages, dates, human corrections, and conflicting claims.
- Storage migrations and a recovery plan for existing research.
- Ranking/comparison definitions appropriate to the user's goal.
- Boundaries for local monitoring and optional integrations.
- Exact contracts, modules, file ownership, and dependency order for each work packet.

Keep user-facing controls simple; put reusable research, evidence, and budgeting behavior behind small shared interfaces rather than duplicating it in screens.

## 5. Testing and verification seams

Each work packet must name the real user behavior being checked and the appropriate verification command or manual journey. The repository-wide engineering gate is `pnpm check` from the project root. This preparation change does not alter application behavior, so application tests were not rerun for the planning documents.

The approved plan must include:

- Real research benchmarks with authorized keys and explicit spending limits.
- Provider failures, unsupported claims, missing figures, and conflicting evidence.
- Cancel/resume/restart and workspace migration/recovery.
- First-time setup, card browsing, company exploration, return navigation, and output sharing.
- Visual checks at desktop and narrow widths, keyboard access, and reduced motion.
- A check that visible agent activity corresponds to actual work.

## 6. Out of scope

During review: application code changes, new research runs, provider spending, design implementation, migration execution, and executor deployment.

Permanent until new authority is given: pushing, publishing, deploying, or merging to main.

Release-specific deferrals will be chosen from founder feedback, rather than assumed here.

## 7. Delivery plan and approval

Pending. Astra will turn accepted decisions into ordered milestones with acceptance criteria, dependencies, executor packets, and checkpoints. The founder reviews the completed overhaul plan before the build begins. A work packet must be concrete enough to review and execute without reinterpreting a broad aspiration.
