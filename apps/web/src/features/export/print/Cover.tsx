/**
 * The shared cover of the company, topic, product, person, daily and transcript reports: one dark, full-bleed page
 * (the per-job @page rule removes the margin on page one, see pageStyle.ts) with the Stratemark mark, the title, a
 * meta list and an optional hero (the real card face, a publisher picture, a portrait). The market report has its own.
 * Styling: reports.css.
 */
import type { ReactNode } from 'react';
import { StratemarkMark } from './StratemarkMark';
import './reports.css';

/** What every cover says about figures: sources, "Unknown" and nothing invented. */
export const COVER_NOTE_DEFAULT =
  'Every figure in this document carries its source. Where the research does not support a figure it is shown as Unknown, never guessed or filled in. "Estimated" means a source reported the figure but it has not yet been checked against the original document.';

export interface CoverProps {
  eyebrow: string;
  title: string;
  /** One quiet line under the title (a role, a one-liner). */
  subtitle?: string | null;
  meta: readonly string[];
  /** A company mark shown in a white tile above the title. */
  logo?: ReactNode;
  /** The picture on the page: the card face, a cover image, a portrait. */
  hero?: ReactNode;
  /** `side` puts the hero beside the meta list (a card); `stack` puts it under the title, full width (a picture). */
  layout?: 'side' | 'stack';
  /** The closing note; `null` for none. Defaults to the plain statement about sources. */
  note?: ReactNode;
}

export function Cover({ eyebrow, title, subtitle, meta, logo, hero, layout = 'side', note }: CoverProps) {
  const text = note === undefined ? COVER_NOTE_DEFAULT : note;
  return (
    <section className="sm-cv" data-testid="print-cover">
      <div className="sm-cv-brand">
        <span className="sm-cv-word"><StratemarkMark size={20} />Stratemark</span>
        <span className="sm-cv-kind">{eyebrow}</span>
      </div>
      <div className="sm-cv-main">
        {logo && <div className="sm-cv-logo">{logo}</div>}
        <h1 className="sm-cv-title" data-long={title.length > 38 ? 'true' : undefined}>{title}</h1>
        {subtitle && <p className="sm-cv-sub">{subtitle}</p>}
        <div className="sm-cv-bar" />
        <div className={`sm-cv-stage sm-cv-stage--${layout}`}>
          {hero && <div className="sm-cv-hero">{hero}</div>}
          <ul className="sm-cv-meta sm-cover-meta">
            {meta.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      </div>
      {text && <div className="sm-cv-note">{text}</div>}
    </section>
  );
}
