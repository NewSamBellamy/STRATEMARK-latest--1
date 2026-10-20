/**
 * The real collectible card face, drawn for a printed document.
 *
 * It renders the app's own `CollectibleCard` with the app's own face model (`buildCardView`), so a printed card can
 * only show what the card in the app shows. There is deliberately no prop that accepts a figure: callers hand over the
 * card, never numbers. Print-only styling lives in cardface.css.
 *
 * The face clips below about 260 px wide, so it is always laid out at a fixed 300 px and a smaller size is that same
 * layout scaled down inside a fixed-size box (the box keeps the page layout honest, the inner element is scaled).
 */
import type { CardWithCompany } from '@mi/contracts';
import { CollectibleCard } from '@/features/card/CollectibleCard';
import './cardface.css';

export type PrintCardFaceWidth = 'hero' | 'lineup';

export function PrintCardFace({ data, width }: { data: CardWithCompany; width: PrintCardFaceWidth }) {
  return (
    <div className={`sm-cardface sm-cardface--${width}`} data-testid="print-card-face" data-face-size={width}>
      <div className="sm-cardface__inner">
        <CollectibleCard data={data} />
      </div>
    </div>
  );
}
