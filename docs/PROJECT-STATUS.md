# Stratemark — Project Status (October 8, 2026)

Live view of what changed since the Codex→ZCode handoff, and what remains
before production. Commit refs are on `fix/zcode-identity-gate-recovery`
(43 local commits, tip `4f77dd6`+ — unpushed pending owner's word).

---

## Shipped — research trustworthiness (the audit's #1 risk)

| Fix | Root cause addressed | Commit |
|---|---|---|
| Sentence-expanded identity binding | Grounding supports are sub-sentence fragments; figures like Equinix's 13,716 employees and $100.98B market cap were silently dropped | `534c23f` |
| users claims require a reporting date | Undated "1B active users"-class figures rendered with unearned authority (red team #3) | `a6745b5` |
| Regional-breakdown guard | "13,716 employees globally, with 5,917 based in the Americas" blurred the whole-company count into ambiguity | `39247a8` |
| market_cap in the recovery set | The free recovery lane could never refill a rejected market cap | `6e6d943` |
| Roster-guarded offline repair | Lead-in sentences ("As of Dec 31, Equinix employed…") never bound during display | `a7323f7` |
| SEC multi-year revenue series | The chart panels were dead code — series were single "Current" points by design | `29c46ab` |

## Shipped — dependable completion (the audit's #2/#3 risks)

| Fix | What it does | Commit |
|---|---|---|
| Hydration retries + reconciliation sweep | One failed pass no longer strands a company forever | `6ad9aa1` |
| Discovery degradation | A provider outage ends expansion, keeps streamed companies | `bca6758` |
| Tier-review degradation | A 504 in the AI nudge pass can't discard paid research | `4e533be` |
| Finish-line banner | Job outcome stated in plain terms + coverage shortfalls verbatim | `5360a47`, `a6745b5` |
| Verification-loop cap | One automatic verification per metric per session (was 23× in 15 min) | `e97d80d` |

## Shipped — architecture for the "research gem" era

| Capability | What it enables | Commit |
|---|---|---|
| SQLite system of record (desktop) | Incremental durable persistence, queryable substrate, no 5MB ceilings | `82234a3` |
| Corpus retrieval + archive-first agent | The agent answers from accumulated research with citations; web search supplements | `1854b5e` |
| Deep-dive → Report persistence | Long-form stories open full-page and live in the Reports library | `4f77dd6` |
| Knowledge-base search + paging | The whole evidence corpus is visible and searchable (10-clamp gone) | `a47ecb1` |

## Shipped — the front page & cards

| Fix | Commit |
|---|---|
| Overview: who-they-are / what-they-do / by-the-numbers / what-matters | `c6f0dea` |
| Bar/Line/Area switchable charts; metric tiles keep verified/estimated honesty | `29c46ab` |
| Source counts = distinct receipts; card summaries; demo labeling | `5360a47` |
| Named progress ("Researching Metrics · Live Intel…"), empty-state taxonomy, sidebar deck dates | `a6745b5` |

## Shipped — discovery scope & honesty

| Fix | Commit |
|---|---|
| Scope prompt rewrite (no more hard-coded "include OpenAI/Anthropic/NVIDIA") | `e4317c8` |
| Coverage shortfalls surface verbatim in the deck UI | `a6745b5` |

---

## Open — judged against the red team (docs/OCT08-PRODUCTION-RED-TEAM.md)

1. **Empty-state coverage variance** — a run can still finish with thin
   specialist categories; the UI now *explains* it, but filling them reliably
   on every market is engine work (watch this run).
2. **Figure metadata depth** (#3/#4) — reporting dates are now enforced for
   user figures; publication-vs-effective dates for the rest render where the
   data exists. Estimated figures still carry equal visual weight on card
   fronts (design decision pending owner review).
3. **Reports full-page reading experience** (#10) — persistence + routing
   shipped; the reader's typography/section-nav pass is open.
4. **Timeline quote provenance** (#18) — quotes carry text + attribution but
   no source fields; needs a small contract change.
5. **Navigation consolidation** (#13) and research-controls vocabulary (#14) —
   design pass pending.
6. **Org-chart depth** (#17), AI-imagery policy (#11), ranking explainability
   UI (#21 — tierReason data exists), market-level conclusions (#23 — the
   Briefing exists; prominence open).

## Live validation run — Advanced Nuclear Technologies (Oct 8, 11:25–11:42)

A fresh real run on an untouched market, executed against every fix above
(recording: `stratemark-nuclear-run-oct8.mp4` on the owner's desktop; frame
captures in `.zcode/tmp/run-nuclear/`).

| Check | Result |
|---|---|
| Completion | **28/28 companies, zero warnings, zero stranded desks** |
| Finish-line banner | "✓ Baseline research complete — 28 companies · finished Oct 8, 11:42 AM" — live on the deck |
| Specialist coverage | Company 20 · Infrastructure 6 · Distribution 2 · Culture 3 · Vice 3 · Insight 2 · Barrier 3 (the Frontier run's all-zero categories did not recur) |
| Figure honesty | NuScale: $3.2B market cap Estimated with method note; unknowns honest; named progress pill ("Researching Overview…") |
| Cards | Real logos, real HQs, tier bands; source counts are distinct receipts |
| Agent answers | Archive-first retrieval live (LOCAL RESEARCH ARCHIVE in every Ask prompt) |

Remaining shortfalls seen in this run: the SEC revenue series only appears for
companies whose SEC receipts are retained (estimated-only companies show the
single honest point); "No source-backed company snapshot" one-liner persists
until the Overview tab is opened; report-composition progress is still a
spinner, not a percentage.

## Ship path

1. Owner review of the live app (this run).
2. Push `fix/zcode-identity-gate-recovery` → PR → tag v0.2.0.
3. Desktop: signed installer + auto-update decisions (owner).
4. Then: Sentinel decomposition (per-company scouts) on the new substrate.
