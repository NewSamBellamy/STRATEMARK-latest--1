/** The lineup page: every company's card face at lineup size in a clean grid, scaled so the page is used. */
import type { CSSProperties } from 'react';
import type { FullReportModel } from '../fullReportModel';
import { PrintCardFace } from './PrintCardFace';
import { MARKET_ANCHORS } from './marketOutline';

/** The face is laid out at 300 px and scaled down; the content width of a page is about 658 px, its height about 890 px under the heading. */
export const LINEUP_FACE_PX = 300;

/**
 * Face width (px) and columns by company count, chosen so a short lineup fills its page instead of leaving the lower
 * half blank, and so the rows still fit one page: 2 columns of 290 px (up to 4), 3 of 200 (up to 6), 3 of 190 (up to 9),
 * 4 of 150 (up to 12). More than 12 keeps the compact grid (144 px, four columns) and may run to a second page.
 */
export function lineupLayout(count: number): { cols: number; width: number } {
  if (count <= 4) return { cols: 2, width: 290 };
  if (count <= 6) return { cols: 3, width: 200 };
  if (count <= 9) return { cols: 3, width: 190 };
  if (count <= 12) return { cols: 4, width: 150 };
  return { cols: 4, width: 144 };
}

export function Lineup({ model }: { model: FullReportModel }) {
  const { width } = lineupLayout(model.companies.length);
  const style = { '--lw': `${width}px`, '--ls': width / LINEUP_FACE_PX } as CSSProperties;
  return (
    <section id={MARKET_ANCHORS.lineup} className="sm-lineup" style={style} data-testid="lineup">
      <p className="sm-eyebrow2">The market</p>
      <h2 className="sm-h2b">The market, card by card</h2>
      <div className="sm-lineup__grid">
        {model.companies.map((c) => (
          <div key={c.id} className="sm-lineup__cell"><PrintCardFace data={c.card} width="lineup" /></div>
        ))}
      </div>
    </section>
  );
}
