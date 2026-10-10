# Keystone checkpoint 33 — explain rejected company facts

Date: 2026-10-05 local. Branch: `revival/initial-card-redesign`. Parent: `9a22808`.

## Connected change

The existing literal-passage checker now returns its rejection explanation alongside citations internally. Its original citations-only interface remains unchanged. Canonical company facts carry that explanation in the existing method note, including through saved cards and reopening. The existing Unknown badge uses the supplied note instead of discarding it; no layout, card proportions, colors or controls changed.

Supported failure explanations distinguish missing originals, unreadable originals, quote mismatch, aged/future dates, ambiguous attribution, incompatible units, numeric mismatch, invalid receipts and inadequate publisher quality. Only evidence-tested candidate observations get those detailed explanations; unverified legacy observations can still have generic notes. Explanations identify mechanical check limitations, not a finding that the real business lacks the metric. Raw source errors are not echoed. Raw observations remain unchanged and human corrections retain their existing protection.

No evidence requirement was relaxed, no model/network calls added and no new dependency, schema, service or parallel verifier introduced. This slice improves inspection and prevents generic gaps from hiding the reason research failed; it does not increase demonstrated live company coverage.

## Verification and boundaries

Four repository regressions failed before implementation, then passed for missing/blocked/mismatched/stale originals across facts, saved cards and reopen without paid calls. Two checker cases cover consistency and no raw-error disclosure. The dashboard badge case failed before the tooltip fix, then passed. Existing acceptance/rejection cases remain green.

Final `pnpm check` exited 0: types/lint and 1,137 tests (contracts 103, mocks 15, research 501, desktop 36, API 271, web 211). Desktop build exited 0; browser build ran last and exited 0 to restore browser-configured shared output. Existing bundle-size warnings remain. Credential-dependent self-skips are not live proof.

Actual native window and its homepage accessibility tree were readable. Screenshot capture returned `FrameArrived timed out`; after reselecting the current window, clicking a visible deck returned `coordinate input geometry is unavailable`. A keyboard attempt left document focus unchanged. No fresh Gemini call, native user-data mutation, key inspection, installed-release test or native accepted-fact journey was performed. Browser preview was already running on 4174; an attempted second preview correctly refused the occupied port. The existing reader rendered four Unknown figures and 15 tracked sources, not 15 verified facts.

## Red team / next gate

This is a small inspectability improvement, not production readiness and not completion of the source-to-card milestone. Literal prose acceptance still excludes many legitimate first-person reports and tables. Prioritize a supported native live journey or authenticated structured filing/source coverage; don't keep adding guard-only checkpoints or spend on repeated browser CORS failures. Need explicit metric definitions/periods, issuer identity, accepted-proof retention, deeper dossier quality and the remaining nine delivery areas in the delivery map. Current native automation failure should be repaired or the founder can perform the bounded live check; never extract a configured key as a shortcut.

Local checkpoint only; no push/deploy/main merge or remote backup is claimed. Unrelated untracked files preserved.
