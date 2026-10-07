# Z Code / GLM 5.3 Flash — verified transfer state

This update supersedes the earlier uncommitted-work and missing-GitHub-backup statements in the migration handoff and Z Code's initial assessment.

## Verified preservation

- Repository: `https://github.com/NewSamBellamy/STRATEMARK-latest--1.git`.
- Branch: `checkpoint/2026-10-06-zcode-glm5-3-flash-migration`.
- Code checkpoint: `3ad3d9293e50949309f51011e4a6562b38f03206`.
- GitHub remote head was checked and matched that exact checkpoint. A following documentation-only commit adds this transfer update.
- The seven interrupted code/test edits are committed as WIP. The category baseline is committed too. This preserves them; it does not validate them. The unresolved testing and implementation details in `STRATEMARK-ZCODE-HANDOFF.md` still apply.
- Backend needs work; the owner approves the card design. This is the migration checkpoint from Codex into Z Code with GLM 5.3 Flash.
- Main and earlier branches were not changed.
- The remaining local dirt is `apps/desktop/vitest.config.ts` (no substantive diff displayed; preserve locally) and `.pnpm-store/` (dependency cache, excluded).

## Same computer

Z Code may continue in `C:/Users/shann/Documents/Codex/2026-09-28/i-x20/work/stratemark-card-redesign-revival`. Refresh Git state instead of using cached memory: HEAD has advanced from `6974692`, the branch has changed, and the seven edits are no longer uncommitted.

The folder is a linked worktree whose Git history lives under `work/stratemark/.git`. Keep the parent repository intact. Do not remove the Codex directories while using this checkout. No copy or credential transfer is necessary merely to open this same local checkout in another editor.

## Standalone checkout or another computer

Choose a NEW empty destination and clone this exact branch. Do not clone over an existing project:

```text
git clone --branch checkpoint/2026-10-06-zcode-glm5-3-flash-migration --single-branch https://github.com/NewSamBellamy/STRATEMARK-latest--1.git <new-empty-destination>
```

Inspect `git log -3 --oneline` and `git status --short`; verify `3ad3d92` is in the history, then read `START-HERE.md`, this update, `docs/STRATEMARK-ZCODE-HANDOFF.md` and `AGENTS.md`.

The clone carries code/history, not browser IndexedDB, native research databases or API keys. Existing local preview research can remain usable on the same computer/origin. Before relocating or deleting anything, export research through the app and validate the export; do not place private data or credentials in GitHub. Storage/export completeness remains an acceptance task, not a claim made by this handoff.

## Next work

Reconcile the WIP diff and tests against the recorded stop state. Begin the handoff's Phase 1 with a saved-evidence reproduction of one missing metric. Preserve the approved cards and distinguish confirmed causes from hypotheses. Do not repeat the preservation commit or push the old recovery branch assuming it is the migration checkpoint.

## Git upload issue resolved

The interrupted upload stalled in the installed Git `credential-helper-selector`. The successful push used the installed credential manager through command-scoped configuration; no global Git settings or credentials were changed. If that selector hangs again, use the same command-scoped helper selection with the intended remote and branch:

```text
git -c credential.helper= -c credential.helper=manager push newsam <your-working-branch>
```

In a fresh clone the remote will normally be `origin`; inspect `git remote -v` first. Never include a token in a URL, command output or document.
