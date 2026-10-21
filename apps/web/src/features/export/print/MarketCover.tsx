/**
 * The market report's cover: one full-bleed page, dark panel, the title, the counts from the model and a fan of three
 * real card faces. The page is made full-bleed by the per-job @page rule (print/pageStyle.ts, `bleedCover`).
 */
import logoMark from '@/assets/logo-mark.svg';
import type { FullReportModel } from '../fullReportModel';
import { PrintCardFace } from './PrintCardFace';

/** The companies whose cards go in the fan: the three with the most sourced figures (ties keep deck order). */
export function fanCompanies(model: FullReportModel) {
  return model.companies
    .map((c, i) => ({ c, i, n: c.faceSourced }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, 3)
    .map((x) => x.c);
}

export function MarketCover({ model }: { model: FullReportModel }) {
  const n = model.companies.length;
  const fan = fanCompanies(model);
  // Left, centre, right: the strongest card sits in the middle, on top.
  const order = fan.length === 3 ? [fan[1]!, fan[0]!, fan[2]!] : fan;
  return (
    <section className="sm-mcover" data-testid="market-cover">
      <div className="sm-mcover__panel">
        <div className="sm-mcover__top">
          <img className="sm-mcover__mark" src={logoMark} alt="" />
          <p className="sm-mcover__eyebrow">Stratemark &middot; Market report</p>
        </div>
        <h1 className="sm-mcover__title">{model.title}</h1>
        <p className="sm-mcover__date">{model.dateText}</p>
        <div className={`sm-mcover__fan sm-mcover__fan--${order.length}`} data-testid="cover-fan">
          {order.map((c, i) => (
            <div key={c.id} className={`sm-mcover__card sm-mcover__card--${i}`}>
              <PrintCardFace data={c.card} width="hero" />
            </div>
          ))}
        </div>
        <p className="sm-mcover__counts" data-testid="cover-counts">
          {n} {n === 1 ? 'company' : 'companies'} &middot; {model.figureCount} sourced figures &middot; {model.unknownCount} marked Unknown
        </p>
        <p className="sm-mcover__rule">Every figure carries its source. Where a source could not be found it says Unknown.</p>
      </div>
    </section>
  );
}
