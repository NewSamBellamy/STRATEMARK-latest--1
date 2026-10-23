/**
 * Scoped print → the PDF path the on-screen reports share (a saved report, a briefing, a site audit, a signal finding).
 * The browser's print pipeline is the highest-fidelity, zero-dependency PDF engine available; the `.brf-print-root` /
 * `.brf-no-print` CSS (index.css) scopes it to just the report element so the app chrome never ships in the file.
 *
 * Every PDF carries Stratemark's branding: the report renders a print-only masthead and colophon (components/PrintFrame),
 * and this adds the running footer ("Stratemark · {title}" and "Page n of N") through a page rule that exists only for
 * the length of the print. Reports with a designed cover print through features/export instead and carry the same footer.
 */
import { cssString, paperFor } from '@/features/export/print/pageStyle';

const FOOTER_FONT = '7.5pt "Google Sans Flex", ui-sans-serif, "Segoe UI", system-ui, Arial, sans-serif';

/** The scoped page rule: paper by locale, comfortable margins, and the branded running footer. */
export function scopedPageCss(title: string, locale: string | null | undefined): string {
  const box = `font: ${FOOTER_FONT}; color: #68716f;`;
  const left = `"Stratemark \\00b7  ${cssString(title.trim() || 'Report')}"`;
  return [
    `@page { size: ${paperFor(locale)}; margin: 18mm 16mm 20mm;`,
    ` @bottom-left { content: ${left}; ${box} }`,
    ` @bottom-right { content: "Page " counter(page) " of " counter(pages); ${box} }`,
    '}',
  ].join('\n');
}

export function printScoped(title = 'Report'): void {
  document.body.classList.add('brf-printing');
  const style = document.createElement('style');
  style.setAttribute('data-sm-print-page', '');
  style.textContent = scopedPageCss(title, typeof navigator === 'undefined' ? null : navigator.language);
  document.head.appendChild(style);
  const previousTitle = document.title;
  document.title = `${title} · Stratemark`;
  const cleanup = () => {
    document.body.classList.remove('brf-printing');
    style.remove();
    document.title = previousTitle;
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}
