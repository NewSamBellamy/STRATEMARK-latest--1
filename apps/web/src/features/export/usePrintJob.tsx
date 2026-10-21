/**
 * Print a report document the way every export does: mount it off-screen, wait
 * for its pictures, tell the print stylesheet to show only it, call the
 * browser's print (which is "Save as PDF" too), then tear everything down.
 * Any screen can use this; the Share & export menu and Today both do.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PrintDocument, type PrintJob } from './PrintDocument';
import { printPageCss, printTitleOf } from './print/pageStyle';

const CEILING_MS = 4000;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Logos probe their sources with off-screen images, which no <img> in the document reveals: each Logo says when it is done. */
async function logosSettled(root: ParentNode, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (root.querySelector('[data-logo-settled="false"]') && Date.now() < deadline) await wait(50);
}

/** Wait for the report's pictures, logos and fonts, but never longer than a few seconds, so printing cannot hang. */
export async function printAssetsSettled(root: ParentNode, timeoutMs = CEILING_MS): Promise<void> {
  const fonts = typeof document !== 'undefined' && document.fonts?.ready ? document.fonts.ready.then(() => undefined) : Promise.resolve();
  const imgs = Array.from(root.querySelectorAll('img')).filter((i) => !i.complete);
  const images = imgs.length === 0 ? Promise.resolve() : Promise.all(imgs.map((i) => new Promise<void>((r) => { i.addEventListener('load', () => r(), { once: true }); i.addEventListener('error', () => r(), { once: true }); })));
  await Promise.race([
    (async () => {
      await logosSettled(root, timeoutMs);
      // The winning logo mounts its <img> only after it settles, so the pictures are counted after the logos.
      await Promise.all([fonts, images, ...Array.from(root.querySelectorAll('img')).filter((i) => !i.complete).map((i) => new Promise<void>((r) => { i.addEventListener('load', () => r(), { once: true }); i.addEventListener('error', () => r(), { once: true }); }))]);
    })(),
    wait(timeoutMs),
  ]);
}

export function usePrintJob(): { print: (doc: PrintJob, fileTitle: string) => void; host: ReactNode } {
  const [job, setJob] = useState<{ doc: PrintJob; fileTitle: string } | null>(null);

  // Once the print document is mounted, print it, then tear everything down.
  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    const prevTitle = document.title;
    // @page cannot be set from a class: the job's paper size and footer live in a style element for the length of the job.
    const pageStyle = document.createElement('style');
    pageStyle.setAttribute('data-sm-print-page', '');
    pageStyle.textContent = printPageCss({ locale: typeof navigator === 'undefined' ? null : navigator.language, title: printTitleOf(job.doc) });
    document.head.appendChild(pageStyle);
    const cleanup = () => {
      document.body.classList.remove('sm-exporting');
      document.title = prevTitle;
      pageStyle.remove();
      window.removeEventListener('afterprint', cleanup);
      if (!cancelled) setJob(null);
    };
    void (async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const host = document.querySelector('.sm-print-doc');
      if (host) await printAssetsSettled(host);
      if (cancelled) return;
      document.title = job.fileTitle;
      document.body.classList.add('sm-exporting');
      window.addEventListener('afterprint', cleanup);
      try {
        window.print();
      } catch {
        cleanup();
      }
    })();
    return () => {
      cancelled = true;
      document.body.classList.remove('sm-exporting');
      document.title = prevTitle;
      pageStyle.remove();
      window.removeEventListener('afterprint', cleanup);
    };
  }, [job]);

  const print = useCallback((doc: PrintJob, fileTitle: string) => setJob({ doc, fileTitle }), []);
  return { print, host: job ? createPortal(<PrintDocument job={job.doc} />, document.body) : null };
}
