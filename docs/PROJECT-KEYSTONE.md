# Project Keystone

Project Keystone is the hands-on Stratemark product line built from the approved initial card redesign.

## Fixed baseline

- Approved design commit: `4a41445` (`Simplify collectible cards to one strong face`)
- Working branch: `revival/initial-card-redesign`
- Main and later experimental branches remain separate.
- Preserve the premium light-and-green design language, one-sided cards, large company marks, restrained metrics, and card-to-research journey.

## Working agreement

- Make small, targeted iterations with visible user review between slices.
- Prioritize changes the founder can see or feel in the frontend, research quality, and journey.
- Do not add speculative architecture, screens, or features.
- Never fabricate research, metrics, verification, or source quality.
- Commit and push each approved, tested checkpoint to this branch.
- Record the checkpoint below before beginning the next slice.

## Checkpoints

| Date | Checkpoint | Status |
| --- | --- | --- |
| 2026-10-01 | Restored and founder-approved initial card redesign | Baseline |
| 2026-10-01 | Removed welcome-screen clock and added rotating market suggestions | Verified |

## Next slice

Replace browser speech recognition with optional local Whisper large-v3-turbo transcription through whisper.cpp. The model must download only with explicit user consent, report its disk requirement, stay on-device, and retain a clear no-model state rather than silently using a hosted browser service.
