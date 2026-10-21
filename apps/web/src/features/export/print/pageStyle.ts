/**
 * The per-job @page rule: paper size by locale, margins, and the running footer
 * ("Stratemark · {title}" left, "Page n of N" right; none on the cover). @page
 * cannot read custom properties and the title differs per job, so the rule is
 * built here and injected as a style element for the length of the print job.
 */
import type { PrintJob } from '../PrintDocument';

export type PaperSize = 'A4' | 'Letter';

/** Margins in mm, from the print design system: 20 top, 18 sides, 22 bottom. */
export const PAGE_MARGIN_MM = { top: 20, side: 18, bottom: 22 } as const;

const FOOTER_FONT = '7.5pt "Google Sans Flex", ui-sans-serif, "Segoe UI", system-ui, Arial, sans-serif';
const FOOTER_COLOUR = '#68716f';

/** Letter for the US and Canada, A4 for everywhere else (and when the locale is unknown). */
export function paperFor(locale: string | null | undefined): PaperSize {
  const region = /^[a-z]{2,3}[-_]([a-z]{2})\b/i.exec((locale ?? '').trim())?.[1]?.toUpperCase();
  return region === 'US' || region === 'CA' ? 'Letter' : 'A4';
}

function flattenControls(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    out += c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029 ? ' ' : ch;
  }
  return out.replace(/ {2,}/g, ' ');
}

/** Make text safe inside a double-quoted CSS string: backslashes and quotes escaped, line breaks flattened. */
export function cssString(text: string): string {
  return flattenControls(text)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

/** The title the footer carries: the deck, company, product or person the report is about. */
export function printTitleOf(job: PrintJob): string {
  switch (job.kind) {
    case 'report':
    case 'marketReport':
      return job.model.title;
    case 'transcript':
      return job.title;
    case 'topicReport':
    case 'dailyReport':
      return job.model.company.name;
    case 'productReport':
      return job.model.product.name;
    case 'personReport':
      return job.model.person.name;
  }
}

/** Full page height and width per paper, for a cover that fills the sheet (see `bleedCover`). */
const SHEET = { A4: { w: '210mm', h: '297mm' }, Letter: { w: '8.5in', h: '11in' } } as const;

/**
 * `bleedCover` makes the first page full-bleed (margin 0, no footer) and publishes the sheet size as
 * --sm-page-w / --sm-page-h so the cover can fill it. Only the market report asks for it.
 */
export function printPageCss({ locale, title, bleedCover = false }: { locale?: string | null; title: string; bleedCover?: boolean }): string {
  const m = PAGE_MARGIN_MM;
  const sheet = SHEET[paperFor(locale)];
  const left = `"Stratemark \\00b7  ${cssString(title.trim())}"`;
  const box = `font: ${FOOTER_FONT}; color: ${FOOTER_COLOUR};`;
  return [
    `@page { size: ${paperFor(locale)}; margin: ${m.top}mm ${m.side}mm ${m.bottom}mm;`,
    ` @bottom-left { content: ${left}; ${box} }`,
    ` @bottom-right { content: "Page " counter(page) " of " counter(pages); ${box} }`,
    `}`,
    `@page :first { ${bleedCover ? 'margin: 0; ' : ''}@bottom-left { content: ""; } @bottom-right { content: ""; } }`,
    ...(bleedCover ? [`:root { --sm-page-w: ${sheet.w}; --sm-page-h: ${sheet.h}; }`] : []),
  ].join('\n');
}
