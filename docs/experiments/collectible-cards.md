# Collectible card exploration

Branch: `feat/collectible-card-exploration` (isolated from the `feat/desktop-release-integration` baseline, commit `b131b66`). This is a reviewable UX experiment, not a release or scoring-model rewrite.

## Core journey

Deck → inspect a card → Evidence / Maturity → Explore research dashboard → Back to the same card. The dashboard stays the place for deep research. The card is deliberately one-sided: evidence already has a dedicated tab, so a reverse only duplicates the workflow. No customizer in this pass.

## Direction

Physical-card cues are restrained: portrait proportion, a company-colored frame, a neutral hero-logo window, a slight pointer tilt, and reflected light only on well-sourced high-tier cards. These cues do **not** indicate investment merit or scarcity. All content is available without pointer motion; reduced-motion users get no tilt or transitions. No Pokémon/other franchise images, branding, pack-opening mechanics, or rarity claims are copied.

Reference: [The Pokémon TCG Comes to Smartphones in New, Exciting Ways](https://corporate.pokemon.co.jp/en/topics/detail/t-28/), especially the tactile tilt/parallax and individualized inspection of digital cards. This experiment translates the interaction principle into market research, not the game's visual IP.

## Data boundaries

- Face and inspector share one `buildCardView` read-only projection. Stored research records are not rewritten by the visual treatment.
- The face selects up to two strong, comparable facts across any company type. It prefers cited/human-checked figures and keeps unscoped market share in the detailed Evidence tab.
- A recorded maturity tier is withheld from the card face until at least one comparable figure has a clickable source. Infrastructure and distribution cards remain entity profiles, not company-maturity rankings. Model-guessed palettes are not treated as real company branding.
- No fabricated 1–99 rating or “strong/weak” quality label. Existing maturity tiers remain identified as **stage** and the shared CMS explanation remains in the Maturity tab. Backend scoring is unchanged.
- No `users → customers` renaming, synthetic growth arrow, or `+` qualifier. Counts use the actual metric name and bounded compact formatting. Unknown and invalid numeric values render “Unknown,” never zero.
- A `verified` badge on this surface needs a clickable receipt. Legacy URL sources are made clickable, but prose-only attributions render as estimates. Human-confirmed data remains human-confirmed; presentation never claims to perform human review.
- Market share lacks stored market scope and reporting period; it is disclosed, not inferred. “Captured” is the snapshot capture date, not a claim about the economic reporting period. Source conflicts are flagged.
- Signal cards do not borrow company statistics or maturity. Their artwork is decorative and deterministic, not generated evidence.

## Still open

This does not repair incorrect underlying research or establish metric reporting periods. Those need a separate backend schema/provenance and source-audit pass before production. The BYOK live research path still requires a real key and is not represented by the shipped sample deck. Card customization, collection/rarity system, sound/haptics, and production packaging/signing are deliberately out of scope pending founder review.
