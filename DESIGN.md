# DESIGN.md — Stratemark / Market Intel Deck Builder

Persistent visual identity. Any agent touching UI in this repo reads this first, then loads the
**`tcg-intelligence-design-system`** skill for the full system (outcomes, anti-patterns, acceptance gates).

---

## What this product is

A competitive-intelligence tool where **every company is a collectible card** and **every figure is
provably sourced**. Research is grounded on Google Search via a user-supplied free Google AI Studio
(Gemini) key. Nothing is ever fabricated.

## The one-sentence brief

> Opening a deck should feel like opening a booster pack of a company's real financial identity — and
> then you should be able to read a research report on the same screen for an hour without eye strain.

## Two registers, sharply separated

| Surface | Register |
|---|---|
| Cards, deck grid, tier badges | **Collectible.** Tactile, brand-saturated, foil at high tiers. Pop hard. |
| Reports, dig-deeper, opportunity thesis, dashboard prose | **Editorial.** Calm, institutional, restrained. Stay quiet. |

Bleeding one into the other is the classic failure: foil behind a 900-word report (unreadable), or a
flat grey card grid (forgettable).

## Locked decisions

- **Canvas:** warm oatmeal off-white light mode (~`#F8F7F4`). Not stark white — it exists to prevent
  fatigue across long reading sessions. Chosen deliberately over dark/neon directions.
- **Card identity:** each card wears its company's own **brand triad** (primary = frame/header,
  secondary = stat container tint, accent = bars/stamp), derived from the real logo at runtime.
  Never hardcoded per company.
- **Hero window:** stays neutral. Logos come in every color; a colored backdrop muddies them.
- **Rarity:** material richness scales with maturity tier (T1 matte → T8 foil). Earned, not sprayed.
- **Charts:** confidence-aware. Verified = solid, estimated = soft/hatched, unknown = honest gap.
  Never impute, zero-fill, or interpolate to make a chart look complete.
- **Typography:** committed and non-default. Generic system-font stacks read as unfinished.

## Visual anchors (in this repo)

- **Target:** `docs/design/reference/TARGET-tcg-card-grid.png` — the approved card language.
- **Current state:** `docs/design/current/*.png` — what shipped; the gap to close.

## Hard constraints

- Runs on a **single free Gemini API key**. No paid data APIs, no second provider, no server.
- **No fabricated data, ever** — including in charts.
- Light theme, WCAG AA, keyboard navigable, `prefers-reduced-motion` respected.
- Works for **any** market or company on first run — no niche-specific hardcoding in the visual layer.

## Anti-patterns

Horizontal card tiles with a corner logo · every card sharing one neutral frame · brand color behind
the logo · light text on light brand bands · cartoon elemental icons or glossy plastic bevels ·
rainbow default chart palettes · charts implying precision the data lacks · foil behind body text ·
big bare numbers in empty white boxes · **sparkle or magic-wand icons anywhere** (lucide `Sparkles`,
`Sparkle`, `WandSparkles`, `Wand`; they read as AI-generated filler; the owner has banned them and
`eslint.config.js` fails the build on them. Use a plain icon that says what the button does, or none).
