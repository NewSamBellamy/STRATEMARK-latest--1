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
