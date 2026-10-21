/**
 * Small pieces the company, topic, product, person, daily and transcript reports share: the running head of a
 * section, the numbered note list, the credit line under a picture. Styling: reports.css.
 */
import type { ReactNode } from 'react';
import type { ReportImage } from '../topicReportModel';
import { imageCaption } from './shared';
import { Row, Section } from './Section';

/** Rule 9: an item the stored profile holds without a source says so, rather than looking sourced by sitting on a sourced page. */
export const UNSOURCED_PROFILE_NOTE = 'From the stored company profile; no source was attached to this item.';

export interface NoteItem { n: number; title: string; url: string; direct: boolean }

/** The running head: who the report is about, over the section title and its number. Repeats on every page the section covers. */
export function SectionHead({ about, n, title }: { about: string; n?: number | string; title: string }) {
  return (
    <div className="sm-r-head">
      <p className="sm-r-eyebrow">{about}</p>
      <h2 className="sm-r-h2">
        {n != null && <span className="sm-r-n">{typeof n === 'number' ? String(n).padStart(2, '0') : n}</span>}
        {title}
      </h2>
    </div>
  );
}

/** A report section: a running head over rows that may break across pages between blocks. */
export function ReportSection({
  id, about, n, title, className, children,
}: { id?: string; about: string; n?: number | string; title: string; className?: string; children: ReactNode }) {
  return (
    <Section id={id} className={`sm-r-section${className ? ` ${className}` : ''}`} head={<SectionHead about={about} n={n} title={title} />}>
      {children}
    </Section>
  );
}

export { Row };

/** Numbered notes: publisher in ink, the address in muted text when it is a real page (never an expiring redirect). */
export function NoteList({ notes }: { notes: readonly NoteItem[] }) {
  if (notes.length === 0) return null;
  return (
    <ol className="sm-r-notes">
      {notes.map((f) => (
        <li key={f.n} value={f.n}>
          <span className="sm-r-note-title">{f.title}</span>
          {f.direct && <> <span className="sm-r-note-url">{f.url}</span></>}
        </li>
      ))}
    </ol>
  );
}

/** A superscript note number. */
export function Ref({ n }: { n: number | null | undefined }) {
  return n ? <sup className="sm-r-ref">[{n}]</sup> : null;
}

/** A real picture with its credit. */
export function Figure({ image }: { image: ReportImage }) {
  return (
    <figure className="sm-r-figure">
      <img src={image.src} alt="" />
      <figcaption>{imageCaption(image)}</figcaption>
    </figure>
  );
}

export function Figures({ images }: { images: readonly ReportImage[] }) {
  if (images.length === 0) return null;
  return (
    <div className={images.length > 1 ? 'sm-r-figures sm-r-figures--2' : 'sm-r-figures'}>
      {images.map((img) => <Figure key={img.src} image={img} />)}
    </div>
  );
}

/** The cover's picture: the publisher image or the portrait, caption included. */
export function CoverPicture({ src, caption, portrait }: { src: string; caption: string; portrait?: boolean }) {
  return (
    <figure className={portrait ? 'sm-cv-pic sm-cv-pic--portrait' : 'sm-cv-pic'}>
      <img src={src} alt="" />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
