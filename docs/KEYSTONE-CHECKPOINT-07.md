# Keystone checkpoint 07 — local desktop original-source handoff

Date: 2026-10-03 local. Branch: `revival/initial-card-redesign`.
Preceding checkpoint: `00a6f7c`. [Execution plan](../01_PROJECTS/Stratemark/Specs/Keystone-Build-and-Test-Plan.md).

## Implemented and wired

- The existing desktop `verifyMetric` action now uses the original-source services supplied by Electron main. It reads at most two cited originals, saves a scoped attempt before interpretation and supplies extracts as untrusted evidence to the existing model call. A save failure stops interpretation and leaves the metric unchanged. The valid cited-correction shortcut is intentionally unchanged and still bypasses this retrieval path.
- Cloud and desktop use the same protected Node transport from `@mi/research/original-source-node`. The browser-safe package entry exports only receipt/service types, not the native module. Existing cloud safety tests remain active through its thin re-export. No new renderer fetch channel or arbitrary filesystem action was added.
- Desktop receipts are separate JSON artifacts in the app's owned `userData/original-sources` directory, scoped by company ID and metric. The preview uses its existing isolated userData override. A record has a generated UUID identity; IDs cannot contain paths. Files are size/schema checked, flushed before atomic hard-link publication and never overwritten by the save API. Temporary files are cleaned up best-effort; incomplete temporary artifacts are not queried.
- The native store reloads artifacts after restart, rejects malformed outcomes/path traversal/oversized records and returns bounded company/metric-scoped results without a model call. The concrete repository exposes `getOriginalSourceEvidence` for this native query. This is NOT a new renderer UI or MCP tool yet.
- Extracts stay outside the deck JSON; provider-generated notes remain in the existing scoped note store. Original text and generated notes are not relabelled as the same evidence.

## Verification

Two local-flow tests failed before wiring: originals were never saved/supplied, and failed evidence saves did not prevent interpretation or number changes. Four artifact tests failed against a no-op store: restart loss, overwrite acceptance, traversal acceptance and silent corruption loss. All now pass. Added real-filesystem integration drives GeminiRepository with a fixture client, fails interpretation, restarts the repository and queries the retained extract without another provider call; the saved metric remains unchanged and deck JSON does not contain the original extract.

Final `pnpm check` exited 0: types/lint passed; contracts 92, mocks 15, research 307, desktop 32, API 204 and web 139 tests reported passing. This checkpoint adds seven cases. Three credential-dependent research audits returned early and remain NOT RUN as live audits. No application research API spend or live source/TLS checks were performed; no Gemini/Google key was configured in the shell and no encrypted desktop key was extracted.

Browser production build and desktop main/preload build both exited 0. The transport's two distinctive markers were absent from web output and present in desktop main output. This is bundle verification, not an installed Electron journey or browser recording. Build warnings remain for existing large chunks (main web chunk about 1.84 MB minified) and mixed static/dynamic Firebase imports; no measured latency improvement is claimed. The only dependency change was cached Node development types and its research-package peer resolution; no runtime framework added.

## Red-team limits / next work

1. Retrieval is still not claim acceptance. Exact company/entity, passage, value, units, definition, date and period matching must be enforced before metric promotion, including matching-value observations and correction shortcuts. Current machine `verified` confidence remains weaker than this proposed gate. Do this next; do not move into scoring/Scouts on a false accuracy claim.
2. Separate local artifacts are NOT included in the existing JSON export/import or deck deletion flow. No automatic deletion/retention was introduced. Bundle export, privacy/retention controls, orphan recovery and workspace import identity are necessary before unattended monitoring or release. Keep the user's data directory backed up as a whole for now; do not claim JSON export is a complete artifact backup.
3. Native query scans the owned directory and fails visibly on a corrupt recognized artifact. A large-library index, selective recovery, migrations and concurrent/power-loss stress testing are still pending. File publication is atomic, not a promise of universal power-loss durability or tamper-proof storage. Research files are local plaintext, not the encrypted key store.
4. Scope is metric verification only, not initial deck creation, metric hunts, dashboards, logo discovery or specialist research. Browser-only research has no native transport and retains its existing behavior. Offline artifact queries work natively; neither a viewer nor IPC/MCP access has been shipped for these records.
5. Existing retrieval bounds and gaps remain: two sources, six seconds, public IPv4, limited HTML/plain-text prefix extraction, no PDF/JS-rendered pages, incomplete publisher-policy parsing. A hash identifies a received body; it does not prove that a company claim is true. Extra input tokens and I/O are bounded but not benchmarked.

No card design changes. Main and unrelated untracked work preserved. Saved as a local checkpoint; GitHub backup remains unconfirmed.
