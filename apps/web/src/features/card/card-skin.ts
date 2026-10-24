/**
 * The card's frame skin, by where the card lives:
 * - split: every card in a market deck (the default). Primary top and left, secondary bottom and right, a cream seam.
 * - foil: cards in Saved (favorites). A thick metallic conic ring with brushed grain and a light band that follows the pointer.
 * - acrylic: a company followed in Today. A clear case with a brand-colour label strip and a reflection that slides with the pointer.
 * - embossed: a raised satin bezel around a recessed face (kept from the options page; no screen uses it now).
 */
export type CardSkin = 'split' | 'foil' | 'embossed' | 'acrylic';

export const DEFAULT_CARD_SKIN: CardSkin = 'split';

/** Largest lean, in degrees, a card takes toward a mouse pointer. The same numbers as the frame options preview. */
export const SKIN_TILT: Record<CardSkin, number> = { split: 5, foil: 6, embossed: 9, acrylic: 7 };

/** Dark or light text, whichever reads on a `#rrggbb` fill (WCAG relative luminance); light when the colour cannot be read. */
export function inkFor(fill: string | null | undefined): string {
  const m = /^#([0-9a-f]{6})$/i.exec(fill ?? '');
  if (!m) return '#ffffff';
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#14201c' : '#ffffff';
}
