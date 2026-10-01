# Working Agreement — Multi-Agent Repository Conventions

This repository is worked by more than one autonomous agent plus its owner. These
are the rules that keep that from turning into a mess. They are short on purpose.

## Who works here

| Handle                         | Runtime                    | Owns                                                                      |
| ------------------------------ | -------------------------- | ------------------------------------------------------------------------- |
| **Shannon** (`@NewSamBellamy`) | human, owner               | Product direction, design, merge authority on anything ambiguous          |
| **Morgan**                     | Hermes / Cursor            | Lead development, feature work, UI wiring, packaging and release          |
| **Blackbeard**                 | HyperAgent (Claude Opus 5) | Backend architecture, agent/ADK layer, data integrity, security hardening |

## Rule 1 — Never push to `main`

Every change arrives by pull request. No exceptions, no "small fix" carve-out.

## Rule 2 — `pnpm check` must pass before you open a PR

```bash
pnpm check    # typecheck → lint → tests
```

If you cannot run it, say so **in the PR body, in plain words**: `VERIFICATION NOT
RUN`. Do not imply a gate passed when it did not.

**This rule exists because it was broken and it cost us.** PR #1 was merged with an
unverified gate while the sandbox had no registry access. Its typecheck fallout then
sat on `main` alongside four failing tests, three typecheck errors, and twenty-nine
lint errors — while a handoff document reported "260/260 passing." A real product
regression (decks silently shipping with zero infrastructure and zero distribution
entities) hid inside that noise for days, with a passing-looking test suite on top
of it.

Related: CI previously enumerated test packages by hand and omitted `@mi/research`,
the 174-test backend. It now runs `pnpm -r test:run`. **Never enumerate packages in
CI again** — a new package must not be able to escape the gate by being forgotten.

## Rule 3 — Branch naming, so we never collide

```
<type>/<agent>-<slug>
```

- `feat/`, `fix/`, `chore/`, `hardening/`, `docs/`
- Agent segment: `morgan-`, `blackbeard-`, or omitted for Shannon
- Examples: `hardening/blackbeard-rate-limiter`, `feat/morgan-valuation-sliders`

One concern per branch. If a PR needs the word "and" twice to describe it, split it.

## Rule 4 — Path ownership (advisory, not a lock)

| Path                      | Primary                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `apps/web/**`             | Morgan                                                           |
| `apps/desktop/**`         | Morgan (packaging), Blackbeard (security surface)                |
| `packages/research/**`    | Blackbeard                                                       |
| `packages/contracts/**`   | Shared — **announce in the PR body**, since it breaks both sides |
| `services/**`             | Blackbeard                                                       |
| `.github/**`, root config | Either, but flag it                                              |

Touching another agent's primary path is fine. Doing it silently is not.

## Rule 5 — Contracts are a shared blast radius

`@mi/contracts` is imported by web, desktop, and research. A change here can break
all three. Additive changes (new optional field, new export) are low risk. Renames,
type narrowing, and removals need a note in the PR body naming what else you checked.

## Rule 6 — Stacked PRs

When work depends on an unmerged PR, base the branch on that PR's branch and say so
in the first line of the body: `Stacked on #N — merge that first.` Merge bottom-up.

## Rule 7 — Handing work across agents

Use a GitHub issue labeled `handoff:morgan` or `handoff:blackbeard`. Include:

1. Exact file paths and line numbers
2. What is wrong or wanted, concretely
3. Acceptance criteria the other agent can verify without re-deriving your context

Do not hand off by describing the problem in a PR comment and hoping.

## Rule 8 — The design is frozen

No UI/UX changes, no restyling, no component restructuring without Shannon's explicit
go-ahead. If a backend change would need a UI change to be visible, **the backend
adapts to the existing view contracts.** Design tweaks are Shannon's call.

## Rule 9 — Data integrity is not negotiable

The product's entire premise is that no figure is invented. In code that means:

- `verified` confidence requires a usable citation. Unsourced figures are downgraded.
- An `unknown` figure carries a `null` value.
- Unsourced vice/controversy claims are **dropped**, not displayed.
- Charts never impute or zero-fill.
- Only a human may set `user_verified`.
- Signal cards (`culture`, `vice`, `insight`) never inherit an entity's metrics.

A function that returns a plausible number without evidence is a defect even if
nothing calls it yet. One shipped in `proxy-estimator.ts` and two tests asserted its
hardcoded figures as correct; see PR #3.

## Rule 10 — Do not commit tooling artifacts

`.aider*`, `.claude/`, `.cursor/`, session files, editor caches, generated media.
These are gitignored. A committed assistant transcript is a privacy problem in a
public repository, not just clutter.

## Rule 11 — Never commit secrets

No API keys, tokens, or credentials in code, tests, fixtures, commit messages, or PR
bodies — including in a git remote URL. If one is exposed anywhere, treat it as
compromised and rotate it immediately.

## Stratemark overhaul planning entry point

Current human direction (October 1): planning only for a complete v2 product overhaul.
Read `01_PROJECTS/Stratemark/Specs/MASTER-PLAN.md`, `EXPERIENCE-MAP.md`,
`DELIVERY-PLAN.md` and `BUILD-STATE.md`. These replace ALL older planning,
phase-order and model-role instructions. Seven card types and their complete
research destinations, sharing, provider access and agents are explicit scope.
Astra is the requested planner/reviewer; earlier no-Astra rules are superseded.
Do not start the build or resume an automation until a new build instruction.

The founder explicitly authorizes planning changes to UI/UX while retaining the
original design language; Rule 8 is not a prohibition on this requested plan.
A later build uses complete user outcomes and R0–R8 gates, not the old G00–G08
queue. Historical code/test evidence remains useful; consult it selectively.

Preserve `feat/stratemark-spinoff-local-agents`. Prior checkpoint authority is
limited to fast-forward saves on the verified personal `newsam` branch,
NewSamBellamy/STRATEMARK-latest--1. No force updates, main/origin/tobi changes,
deployment or publication. Live product experiments need their numeric allowance;
live data migration needs its applicable approval. Never expose credentials.

Use LAUNCH.md and build-workflow.md for context/role/verification discipline.
The founder requires a verified personal-branch GitHub backup, full real journey
screen recording and plain-English done/improved/gaps/next report at each
integrated build checkpoint. Follow the recording rules in build-workflow.md.
A document cannot guarantee zero hallucinations, million-user capacity, automatic
context enforcement or product readiness. Record actual evidence and gaps.

## PR body template

```markdown
## What

One or two sentences.

## Why

The problem. Link the issue or audit finding.

## Verification

- [ ] pnpm check green ← or: VERIFICATION NOT RUN, because ...
- Tests added: ...

## Risk / blast radius

Shared contracts touched? Other agent's paths touched? What did you check?
```
