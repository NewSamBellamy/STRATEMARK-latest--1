/**
 * Print a report document the way every export does: mount it off-screen, wait
 * for its pictures, tell the print stylesheet to show only it, call the
 * browser's print (which is "Save as PDF" too), then tear everything down.
 * Any screen can use this; the Share & export menu and Today both do.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PrintDocument, type PrintJob } from './PrintDocument';

async function imagesSettled(root: ParentNode, timeoutMs = 2500): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img')).filter((i) => !i.complete);
  if (imgs.length === 0) return;
  await Promise.race([
    Promise.all(imgs.map((i) => new Promise<void>((r) => { i.addEventListener('load', () => r(), { once: true }); i.addEventListener('error', () => r(), { once: true }); }))),
    new Promise<void>((r) => setTimeout(r, timeoutMs)),
  ]);
}

export function usePrintJob(): { print: (doc: PrintJob, fileTitle: string) => void; host: ReactNode } {
  const [job, setJob] = useState<{ doc: PrintJob; fileTitle: string } | null>(null);

  // Once the print document is mounted, print it, then tear everything down.
  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    const prevTitle = document.title;
    const cleanup = () => {
      document.body.classList.remove('sm-exporting');
      document.title = prevTitle;
      window.removeEventListener('afterprint', cleanup);
      if (!cancelled) setJob(null);
    };
    void (async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const host = document.querySelector('.sm-print-doc');
      if (host) await imagesSettled(host);
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
      window.removeEventListener('afterprint', cleanup);
    };
  }, [job]);

  const print = useCallback((doc: PrintJob, fileTitle: string) => setJob({ doc, fileTitle }), []);
  return { print, host: job ? createPortal(<PrintDocument job={job.doc} />, document.body) : null };
}
