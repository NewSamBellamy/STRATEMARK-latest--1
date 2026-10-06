# Keystone checkpoint 48 — person-level Team & Org source evidence

Date: 2026-10-06 local. Branch: `revival/initial-card-redesign`. Parent: `77d4e36`.

## Connected behavior

- Team & Org now obtains a bounded set of original pages before extracting people. Search snippets and model-written citations alone cannot create a person record.
- Each displayed person must be supported by a contiguous quote in a retained original page. The quote must contain the person's name and exact reported title; optional biography details are kept only when supported by that quote. Unsupported names/titles are omitted, and uncertain reporting lines stay unset.
- Accepted people carry their supporting URL, quote and retrieval timestamp into the dashboard. The UI exposes the original page and supporting passage without implying that retrieval time is the claim's publication date.
- Accepted source selections and originals are saved for offline reopen. Cloud dashboard calls now retain `team_org` originals under the same bounded source-record checks already used for other tabs.
- Legacy cached people without person-level originals no longer reappear as if verified; the cache reopen remains no-spend and returns an honest empty chart.

## Verification

- Focused tests cover exact-quote/source/title enforcement, optional-field support, reporting-line validation, blocked-source empty results, offline local reopen, cloud route retention/reopen, and Firestore source-type acceptance.
- Full `pnpm check` passed for this slice: typecheck, lint, and workspace unit suites. Prior run recorded 1,259 passing and 1 skipped; the skipped case requires a live source/provider environment.
- In the bounded two-company Gemini browser run, both cards remained Unknown when no acceptable company snapshot was available. Six original-page attempts were blocked and no usable source excerpt was retained. One bounded “Find more metrics” pass returned no qualified figures. This is honest failure handling, not successful live source coverage; total paid-call count was not observable.
- Saved the Anthropic test card and reloaded the deck. The post-reload `Unsave card` state confirmed the saved-card choice persisted. Test deck: `mkt_frontier-ai-model-developers_4krd3`.
- No additional provider calls, visual redesign, deployment or release were performed during this verification.

## Red team / remaining risks

- The model still chooses which original passages to propose; exact quote matching prevents fabrication of those quotes but does not establish that the source is authoritative, current, or comprehensive.
- Current title and team completeness are not proven by this slice. Aliases/transliteration, portraits and evidence-based stopping criteria remain open.
- The live cloud/browser research journey still failed to retain originals for the two tested companies. Diagnose retrieval/source-host failures before presenting Team & Org as live-ready. Do not weaken SSRF, redirect or evidence rules to make the test look green.
- The saved/reopened test used the local Card Lab browser state; it does not prove native desktop, cloud-account sync, or production behavior.

## Next

Follow the ordered build brief: red-team the Products & Roadmap path already implemented at checkpoint 38, then continue the live research journey and dossier gaps. Keep the run moving after each verified checkpoint; do not treat this focused slice as completion of a product milestone.
