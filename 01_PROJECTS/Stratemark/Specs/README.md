# Stratemark overhaul review

Status: founder review. Implementation has not started.

Prepared September 30, 2026 from exploration branch `feat/claim-level-signal-evidence`, baseline `49d717a`.

## Read and comment in this order

1. [Journey and feature inventory](journey-and-features.md): the current experience in simple sentences, with stable IDs for comments.
2. [Decision register](decisions.md): agreed direction and space for founder feedback.
3. [Overhaul specification draft](overhaul-draft.md): the structure we will complete after the review.
4. [Build workflow](build-workflow.md): Astra planning, GPT-6.1 Sol implementation, and the three-attempt escalation rule.

Use comments such as `J06: ...` or `F18: ...`. A comment may say keep, expand, simplify, combine, remove, or change. Unstructured feedback is also welcome; it will be mapped to these IDs without requiring the founder to rewrite it.

The previous audit and [open research roadmap](../../../docs/OPEN-RESEARCH-ROADMAP.md) are background material. This review folder is the entry point for the new overhaul. Earlier roadmap suggestions are not automatically approved scope.

The existing improvement automation is paused during review. It may resume only after the founder authorizes the build and its instructions are updated to match the approved plan. Application code, stored research, credentials, and the main branch are outside this preparation change.

Only product decisions belong in these files. Do not copy private transcripts, provider keys, customer research, recordings, or assistant session dumps into this public-source repository.
