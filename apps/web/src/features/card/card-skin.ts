/**
 * The card's frame skin, by where the card lives:
 * - split: every card in a market deck (the default). Primary top and left, secondary bottom and right, a cream seam.
 * - embossed: cards in Saved (favorites). A raised satin bezel around a recessed face.
 * - acrylic: a company followed in Today. A clear case with a brand-colour label strip.
 */
export type CardSkin = 'split' | 'embossed' | 'acrylic';

export const DEFAULT_CARD_SKIN: CardSkin = 'split';
