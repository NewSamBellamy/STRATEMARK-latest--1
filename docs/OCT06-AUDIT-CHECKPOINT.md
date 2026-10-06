# October 6 founder audit — implementation checkpoint

Branch: `revival/initial-card-redesign`. Preserve the approved collectible-card geometry and original design language. No main merge or production release implied.

## Founder acceptance criteria

1. One simple Describe a market input; no Whole market/Only these companies selector.
2. Correct, crisp logos without stretching tiny icons; bounded fallback and explicit retry.
3. Specialist previews add meaningful detail beyond the card's two front lines.
4. Specialist full findings read as a full-width editorial report, not a tiny PDF beside a card.
5. Initial company cards and previews show evidence-backed business figures before being described as ready.
6. Overview, Metrics, Live Intel, Team, Products and Governance contain useful company-specific research, not empty shells or irrelevant quotations.

## Implemented in this checkpoint

- Removed the scope selector and its state/transport overrides. Natural-language exact-company requests remain supported by the backend.
- Full-finding mode hides the card, provides a near-fullscreen reading layout, and restores the card on Back to overview.
- Specialist previews avoid repeating the front's saved copy when additional saved findings exist. Missing extended content is explicit; no new claims are invented.
- Fixed sentence splitting that cut a decimal price such as $0.97 into $0. on specialist card fronts.
- Logo probes time out after four seconds, compare the smaller image dimension, and continue past sub-256px raster candidates. Existing vector preference, honest monogram, retry and upscale ceiling remain.
- Local Vite preview uses the existing DNS-pinned desktop original-source reader. This bridge rejects non-loopback clients, different origins, missing custom headers, wrong methods/content types, oversized payloads and excess concurrency. It is not included as a production endpoint and does not receive API keys.
- Gemini's one bounded schema-repair retry now receives the actual validation error rather than repeating the identical prompt.

## Verified results — do not inflate these claims

- Web typecheck and production build passed. Build still warns about large chunks and Firebase import splitting.
- Web suite: 37 files / 229 tests passed before the final small preview-copy refinement; CardReader tests passed again after the initial copy change.
- Backend typecheck and new Gemini repair regression test passed.
- Official Microsoft investor release: local bridge returned HTTP 200, retrieved status and 4,000 retained characters. Retrieval does not independently verify claims.
- Live Gemini test first failed because market structuring omitted `vertical`. After the repair change, a second exact-company request discovered only Microsoft and opened its infrastructure card.
- Crucially, that live card still showed unknown figures and no accepted company snapshot. A subsequent Find more metrics pass accepted no figures. The hydration problem is NOT solved.
- The live overview retained official Microsoft pages but selected generic product quotations; those are not a useful company overview.

## Highest-priority next slice: meaningful first-card hydration

Trace one fresh company's provider notes, selected original URLs, retained passages, proposed observations, rejection reasons and stored read projection. Do not run another large census first.

Current code-level gaps:

- Initial hydration reads only two sources and commonly reserves one for the company homepage. General marketing pages crowd out filings and investor disclosures.
- Provider citation redirect URLs may not resolve to a readable original within the reader's bounded redirect rules.
- Textual metric acceptance expects legal company name, exact figure, metric definition, units and a literal reporting date in a short single quote. Real filings often establish issuer/date/unit in document context and use tables or first-person prose. Replace this limitation with tested document-context evidence, not relaxed citation-only verification.
- The first-ready gate currently treats completion of `hydrateCompanyCard` as readiness even when the returned snapshot and every metric are unknown. Completed attempts are not equivalent to accepted content.
- SEC deterministic annual-revenue extraction already exists; route to an actually discovered matching filing/issuer, and keep annual revenue distinct from ARR.

Done means a real live public-company run produces useful source-backed profile + applicable figures on the front, preview and dashboard; reopen preserves them; private/non-disclosing companies retain explicit unknowns; wrong-issuer, wrong-period, annual-revenue-as-ARR and customer-vs-user confusion are rejected. No fake numbers or globally weakened evidence gates.

## Following slices

1. Specialist report generation/storage: actual evidence-backed extended report, sections, inline source associations, readable export/share. Current full finding still uses existing summary/key points; layout is improved, research depth is not.
2. Logo identity/resolution: persist verified original assets and dimensions, detect inaccurate logo identity, source larger/vector originals. Probe improvements do not guarantee every company has a correct logo.
3. Company dossiers: fact-focused overview and leadership/product sources; expose why work is blocked or incomplete without presenting generic homepage text as a finished dashboard.
4. Release hardening: native end-to-end research, persistence, provider setup, retries/cancellation, packaging and production security. A development bridge is not a shipped browser or desktop release.

## Preserve

Do not change card proportions, redesign the home form, invent metrics, copy keys, silently launch unlimited paid research, overwrite user decks or touch unrelated desktop config. Small verified checkpoints; report failed live tests alongside passing unit tests.
