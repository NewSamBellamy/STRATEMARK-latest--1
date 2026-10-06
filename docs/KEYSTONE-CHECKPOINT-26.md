# Keystone checkpoint 26 — Ask reads the saved research dossier safely

Date: 2026-10-05 (local). Branch: `revival/initial-card-redesign`. Preceding commit: `3dd6b8d`.

## Connected improvements

The browser/native GeminiRepository Ask path now reads retained original-source excerpts, not only saved model notes. It does not fetch another page or introduce another model call for this lookup. The normal grounded answer and existing long-conversation distillation still use models. Original reads must succeed before either paid operation; the acknowledged user question remains saved if a read fails so the user can retry.

Lookup is company-scoped, including selected-card deck restrictions: first eight scoped companies, three concurrent local reads, at most twenty recent attempts each. Only retrieved, validated receipts are eligible. Lexical relevance selects at most four contiguous 1,200-character excerpts, deduplicated by company/source/content hash, within 6,500 serialized record characters. The prompt explicitly discloses partial coverage. Capture/retrieval time is not a publication or reporting date. Saved documents remain untrusted data, not independently accepted facts.

Ask company context now uses the shared current-revision selector and provenance projection, not every raw duplicate metric. Ambiguous, invalid and unsupported figures remain Unknown. Selected Culture/Insight/Vice/Barrier cards provide their finding context rather than silently substituting a linked company's metric profile. Unsourced adverse claims are not injected as sourced risk signals.

Stored-source citations are attached only when the answer mentions their exact URL; a URL prefix within a different link does not count. Provider-returned citations remain separate. This improves source-use attribution, not claim entailment verification. Incoming conversation scope and returned answer/get/list objects are deep-copied so caller mutation cannot silently rewrite retained messages or citations without saving.

No UI redesign, provider routing change, key extraction, paid live research or data migration in this checkpoint.

## Test-driven red team

Thirteen new dossier-context regressions pass. Twelve behavioral failures were observed before their corresponding fixes; the bounded-source lookup case is an additional adversarial passing test.

- Retained originals survive reopen and enter scoped Ask context.
- Native lookup uses read/list only, never retrieve/save, and rejects cross-company or blocked receipts.
- Unused stored sources do not become answer citations; misleading URL prefixes do not count.
- Current duplicate metrics replace obsolete context; ambiguous ties remain Unknown.
- Late relevant passages enter context without forwarding whole documents.
- Original storage failure prevents answer and long-history distillation spend.
- Signal-card questions retain their finding and source context; unsourced adverse claims stay out.
- Duplicate sources and large batches stay bounded without modifying retained text.
- Input scope and nested returned conversations cannot mutate the stored research trail.

## Verification actually run

- Final `pnpm check`: exit 0, workspace typechecks, lint and unit suites passed. The new dossier-context suite reports 13 passing tests.
- Desktop `pnpm build`: exit 0. Browser `pnpm --filter @mi/web build`: exit 0, run afterward to leave browser-configured assets.
- Existing Firebase import and large-bundle warnings remain. Compilation is not installer acceptance.
- Credential-dependent live search/census/judge audits returned early: NOT RUN as live audits. No fresh factual-accuracy, real latency, recording or full user-journey claim.

## Important release blocker discovered — next priority

Static inspection found `/api/research/chat` in `apps/api/src/app.ts` is a separate legacy cloud implementation, not this repository Ask path. It appears to lack the shared cloud authentication/spend guard and thread ownership boundary, invokes paid distillation inside a retryable Firestore transaction, omits scoped retained evidence, and returns `{reply, distilledActive}` while SentinelRepository expects a ResearchThread. This is a code/contract finding, not a demonstrated deployed exploit.

Next vertical slice: add authorization/ownership and budget boundaries, keep model calls outside retryable transactions, align the cloud response with the actual web consumer, and reuse scoped evidence with regression tests. Do not claim cloud Ask is covered because it imports the updated prompt. Inspect storage contracts and existing API authorization tests before implementing; do not create a second divergent research engine.

## Remaining limitations / full vision

Lexical first-eight-company retrieval is interim local lookup, not indexed knowledge-base search or exhaustive deck coverage. Shape validation does not establish document authenticity or correct entity identity. Prompt warnings are not a prompt-injection guarantee; exact URLs are not proof a statement follows from a passage. Current-row ordering still needs typed reporting periods, durable observation/history and human lock/release semantics. Other shallow repository reads are not covered by the conversation clone fix.

Real configured-key original retrieval, accepted metrics and save/reopen agreement remain unverified. Sentinel/Scout scheduling and resume, specialist reports, complete dashboards, source-backed narrative acceptance, scoring, provider capability routing, local queryable vault, MCP, connectors and production packaging remain unfinished as tracked in the delivery map. This checkpoint advances dossier reuse and integrity; it does not finish the backend or establish that it is bulletproof.
