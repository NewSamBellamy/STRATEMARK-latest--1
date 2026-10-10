# Release acceptance checklist — Windows desktop, clean machine

Date: 2026-10-07. Owner: Shannon (execute by hand on a machine that has never
run Stratemark). This is the ship gate from the Oct-6 launch-readiness audit
("the installed journey was not exercised"). Do not tag a release until every
box is checked on a clean machine. Record actual results in the boxes, never
assumptions.

## 0. Build

- [ ] Tag the release commit (`v0.2.0` suggested — 0.1.x predates the recovery)
      and confirm the GitHub Actions release workflow produces
      `.exe/.blockmap` artifacts for all three platforms. The pnpm-pin fix
      (packageManager-driven, no manual version) must be in the tagged commit.
- [ ] Windows: note that the binary is UNSIGNED — SmartScreen/Defender will
      warn. Decision recorded: ship unsigned with a documented bypass
      ("More info → Run anyway") until a signing cert is bought, OR block the
      release on a cert. Owner's call before tagging.

## 1. First contact (fresh install)

- [ ] Installer runs; per-user install completes without admin rights.
- [ ] App launches; no crash dialog (main-process crash handlers are wired —
      any `uncaughtException` now shows a visible error box instead of dying
      silently; if one appears, record the message).
- [ ] Access-code unlock works with a founder code.
- [ ] Gemini key entry works (Settings), key survives app restart
      (safeStorage-encrypted `gemini.key.enc`).

## 2. The core journey — research

- [ ] Create one small deck (exact scope, 2 companies) end to end. Record
      time-to-first-card and total. Then fill `docs/PERFORMANCE-BASELINE.md`
      from the run log + usage meter (retries, rate-limited seconds).
- [ ] Card figures carry confidence badges; unknowns render as the honest
      Unknown treatment (never zero). Spot-check one figure's receipts.
- [ ] Dashboard tabs open on demand; each is either researched, honestly
      empty, or a retryable error — never a fake "Nothing here yet" caused by
      a network failure.
- [ ] Background research respects the pause control.

## 3. Persistence & recovery

- [ ] Quit the app fully; reopen — deck, cards, metrics identical.
- [ ] Kill the app process mid-research (Task Manager); reopen — no data loss
      beyond the in-flight pass; job shows as resumable/failed, not stuck.
- [ ] Export research (Settings → Data safety); note the file size; confirm
      the disclosure that original page texts/images stay on the machine.
- [ ] Import the export back; reload; data identical.

## 4. Upgrade path

- [ ] With a v0.1.x install present (old schema v1 or v2 data), install this
      build over it; open; verify the schema migration preserved decks and no
      future-version lockout appears.
- [ ] Document how the user updates (manual download — auto-update is NOT
      wired; `electron-updater` absent by design for now).

## 5. Uninstall / worst case

- [ ] Uninstall the app; confirm `%APPDATA%/Stratemark` (research + key) is
      RETAINED and stated as such, or removed only with an explicit choice.
- [ ] Reinstall; confirm the previous research reopens.

## Known limitations to state in release notes (not blockers)

- Auto-update not wired (manual download; blockmaps already uploaded).
- Exports do not carry original page texts / generated images.
- Unsigned binaries (SmartScreen warning; documented bypass).
- brain.json in old installs is orphaned legacy data; safe to ignore.
