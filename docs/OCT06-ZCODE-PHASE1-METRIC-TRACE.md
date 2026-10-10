# Z Code Phase 1 checkpoint — one missing metric traced end to end

Date: 2026-10-06 (late). Builder: Z Code / GLM 5.3 Flash. Branch:
`checkpoint/2026-10-06-zcode-glm5-3-flash-migration`. This checkpoint follows
`STRATEMARK-ZCODE-HANDOFF.md` §8 Phase 1 and its §9 evidence rules.

## Customer-visible failure

Companies with retained, paid-for research show empty metric slots
("Unknown") on cards, inspector and dashboard. Scale on this machine: the
native store (`%APPDATA%/stratemark/research/repo.json`) holds 222 companies,
894 metric rows, 72 saved evidence records. For the 42 companies that have
saved evidence, **235 of 235 metric rows are null while 48 company-profile
evidence records retain grounded Google output**.

## Confirmed root cause (was §6 "invalid binding" hypothesis; now proven)

Traced field: OpenAI annual recurring revenue (and confirmed identical
behavior for booked annual revenue and headcount).

Evidence record: `OpenAI, Inc.`, topic `company_profile`, captured
2026-10-05T22:16Z, provider `google-search`, 31 grounding supports, trusted
lane intact (`answerText === text`).

The retained answer is catalog-style: the answer header names the company
("### Company Profile: OpenAI, Inc. / OpenAI Group PBC") but the metric
supports are anonymous labeled sections citing third-party sources, e.g.
support s10: "Revenue & Annual Recurring Revenue (ARR) … Approaching ~$70
Billion ARR as of September 2026 … (Axios / Reuters / Bloomberg)", sources
axios.com/valueaddvc.com; s20 "Employee Count … 4,500 to ~7,850 employees …",
sources wikipedia.org/staffingindustry.com/makerstations.io.

Replaying this exact evidence offline through the production path
(`hydrateCompanyCard` → `reportedCompanyMetrics` → `recoverOmittedClaim` →
`reportedMetricCitations`, packages/research/src/reported-metrics.ts) shows:

- The trusted lane activates; `recoverOmittedClaim` finds the numbers.
- `reportedMetricSupportSchema.safeParse` succeeds (claim is schema-valid).
- `reportedMetricCitations` returns **zero citations** every time, because
  its identity gate requires the claim sentence to (a) name the company
  (start-anchored `entity()` match) or (b) start with a metric label AND
  include the official domain (openai.com) among the support's sources.
  Catalog supports satisfy neither: no in-passage company name, third-party
  sources. The number then never persists; the row stays
  `value: null, confidence: 'unknown'`.

Blast radius measured across all 48 profile records: 47 name the company only
in the answer header; 197 of 1,458 supports carry catalog labels; 10 records
have no support naming the company at all. This single gate explains the
235/235 null pattern; no separate display-layer defect is needed to explain
the missing metrics for this evidence class (downstream of the gate, store,
card and dashboard faithfully show the honest unknown).

## Repair direction (Phase 2, not yet implemented)

Identity binding needs a third anchor that does not weaken the existing
guards: answer-level identity. In the trusted lane the whole answer was
retrieved for this company; a support whose claim sentence names NO company
at all (neither the subject nor any other) could bind to the answer's
subject, while sentences naming another company (e.g. s8 "led by Thrive
Capital, with Microsoft, NVIDIA…" — investors, not the subject) must stay
rejected. Ranges (4,500–7,850; $840B–$852B) must remain ambiguous/unknown per
the existing no-multiple-values policy. The discriminating risk is
cross-company contamination inside one answer (s5 names Anthropic and Google
with their own market-share figures) — the repair must reject those, not
recover them.

## WIP reconciliation results (transfer doc "Next work" step 1)

- `packages/research/src/reported-metrics.ts` WIP refinement is now verified:
  typecheck fixed (definitions array was untyped; typed as
  `NonNullable<ReportedMetricSupport['definition']>`), all 52 tests in its
  file pass including the two new recovery/ambiguity tests.
- The three WIP hypothesis tests fail against unmodified behavior, as the
  handoff predicted: `gemini-timeout.test.ts` "paces retry attempts within
  the same model quota" and "shares quota when grounding and extraction use
  the same model" (Phase 3 quota/pacing defects, now proven by failing
  tests); `pipeline.test.ts` "finishes deck research without launching
  hidden dashboard work" (`createResearchedDeck` calls `getDashboardTab`
  twice — overview, team_org — during creation; Phase 3 scheduling).

## Files changed this checkpoint

- `packages/research/src/reported-metrics.ts` — typecheck-only repair of the
  WIP recovery refinement (commit 118d617).
- `packages/research/src/reported-metrics.test.ts` — added the
  catalog-identity regression pair (defect + control) distilled from the
  real retained evidence.

## Tests actually executed (exact results)

- `pnpm --filter @mi/research typecheck` → passes (failed before the typing
  repair with TS2322 at reported-metrics.ts:116, then :101 during the fix).
- `pnpm --filter @mi/research test:run` → 746 tests: **743 passed, 3 failed**
  (only the three pre-existing WIP hypothesis tests listed above). No test
  was skipped. Vitest ran without the previously recorded Windows EPERM
  failure.
- Offline evidence replay (scratch, deleted after use): OpenAI profile
  evidence → all five metric types unknown; forensic gate walk → schema OK,
  citations=0 at the identity gate for s10/s11/s20. No API call was made at
  any point; all replay used retained evidence (zero spend).

## Remaining uncertainty

- Whether the 8 overview/team/live_intel evidence records (OpenAI browser
  workspace) share the catalog-style shape; not yet inspected.
- The exact intended scheduling policy for the hidden-dashboard-work test is
  a product decision (handoff §5 item 2), not settled by this checkpoint.
- Quota/RPM numbers for the current key remain unmeasured (Phase 3).

## Next task

Phase 2 slice: design and implement answer-level identity binding in
`reportedMetricCitations`/`recoverOmittedClaim` with the contamination guards
above, flipping the committed defect test to recover the $70B ARR claim while
the control and all existing ambiguity tests stay green. Then re-run the
offline replay over all 48 profile records to measure the recovery yield
before any new provider spend.

## Backup status

Committed locally on the migration checkpoint branch; not yet pushed. Push
recipe for the credential-helper stall is in
`docs/ZCODE-TRANSFER-VERIFIED.md` (command-scoped `credential.helper=manager`).
