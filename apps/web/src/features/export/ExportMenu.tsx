/**
 * One Export menu for every surface. Which entries appear depends on what the
 * host page can honestly export:
 *   deck        -> deck report (PDF), data (CSV), PowerPoint
 *   company     -> company report (PDF), data (CSV)
 *   transcript  -> chat transcript (Markdown, PDF)
 *
 * PDFs use the browser/Electron print pipeline with the print stylesheet in
 * print.css: the report is rendered off-screen, body gets `sm-exporting`, and
 * everything else is hidden for the duration of window.print().
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileSpreadsheet, FileText, MessageSquareText, Presentation, Printer } from 'lucide-react';
import type { CardWithCompany, ThreadMessage } from '@mi/contracts';
import { cn } from '@/lib/cn';
import { usePopoverSide } from '@/lib/usePopoverSide';
import { exportDeckPptx } from '@/features/reports/pptx';
import { PrintDocument, type PrintJob } from './PrintDocument';
import {
  buildReportModel,
  companiesFromCards,
  downloadText,
  fileSlug,
  localDate,
  metricsToCsv,
  transcriptToMarkdown,
  type ExportCompany,
} from './exportModel';

export interface ExportMenuProps {
  deck?: { title: string; cards: readonly CardWithCompany[] };
  company?: ExportCompany;
  transcript?: { title: string; scopeLabel?: string | null; messages: readonly ThreadMessage[] };
  className?: string;
  /** `ghost` matches the deck action bar; `icon` is the compact variant for panel headers. */
  variant?: 'bar' | 'icon';
}

const ITEM =
  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-content hover:bg-surface-2 disabled:opacity-50';

async function imagesSettled(root: ParentNode, timeoutMs = 2500): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img')).filter((i) => !i.complete);
  if (imgs.length === 0) return;
  await Promise.race([
    Promise.all(imgs.map((i) => new Promise<void>((r) => { i.addEventListener('load', () => r(), { once: true }); i.addEventListener('error', () => r(), { once: true }); }))),
    new Promise<void>((r) => setTimeout(r, timeoutMs)),
  ]);
}

export function ExportMenu({ deck, company, transcript, className, variant = 'bar' }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState<{ doc: PrintJob; fileTitle: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const side = usePopoverSide(ref, open, 256);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

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

  const print = useCallback((doc: PrintJob, fileTitle: string) => {
    setOpen(false);
    setError(null);
    setJob({ doc, fileTitle });
  }, []);

  const deckCompanies = deck ? companiesFromCards(deck.cards) : [];
  const date = localDate();

  const deckReport = () =>
    deck &&
    print(
      { kind: 'report', model: buildReportModel({ title: deck.title, kind: 'deck', companies: deckCompanies }) },
      `${deck.title} - Stratemark market report`,
    );
  const companyReport = () =>
    company &&
    print(
      { kind: 'report', model: buildReportModel({ title: company.name, kind: 'company', companies: [company] }) },
      `${company.name} - Stratemark company report`,
    );
  const csv = () => {
    setOpen(false);
    if (deck) downloadText(`${fileSlug(deck.title)}-metrics-${date}.csv`, metricsToCsv(deck.title, deckCompanies), 'text/csv');
    else if (company) downloadText(`${fileSlug(company.name)}-metrics-${date}.csv`, metricsToCsv(null, [company]), 'text/csv');
  };
  const pptx = async () => {
    if (!deck) return;
    setOpen(false);
    setBusy('pptx');
    setError(null);
    try {
      await exportDeckPptx({ marketName: deck.title, cards: [...deck.cards], thesis: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PowerPoint export failed.');
    } finally {
      setBusy(null);
    }
  };
  const transcriptMd = () => {
    if (!transcript) return;
    setOpen(false);
    downloadText(
      `${fileSlug(transcript.title)}-conversation-${date}.md`,
      transcriptToMarkdown({ title: transcript.title, scopeLabel: transcript.scopeLabel, messages: transcript.messages }),
      'text/markdown',
    );
  };
  const transcriptPdf = () =>
    transcript &&
    print(
      {
        kind: 'transcript',
        title: transcript.title,
        scopeLabel: transcript.scopeLabel ?? null,
        dateText: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
        messages: transcript.messages,
      },
      `${transcript.title} - Stratemark conversation`,
    );

  const hasData = Boolean(deck && deckCompanies.length > 0) || Boolean(company);
  const hasTranscript = Boolean(transcript && transcript.messages.length > 0);
  if (!deck && !company && !transcript) return null;

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        className={
          variant === 'icon'
            ? 'inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] text-muted hover:border-primary/50 hover:text-primary-ink'
            : 'inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content transition-colors hover:bg-surface-2'
        }
        aria-haspopup="menu"
        aria-expanded={open}
        title="Export this as a PDF report, spreadsheet, PowerPoint or transcript"
        onClick={() => setOpen((v) => !v)}
        disabled={variant === 'icon' ? !hasTranscript : !hasData && !hasTranscript}
      >
        <Download className={variant === 'icon' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        {busy ? 'Exporting…' : 'Export'}
      </button>
      {open && (
        <div role="menu" className={cn('absolute top-full z-50 mt-1 w-64 rounded-xl border border-border bg-surface p-1 shadow-card', side === 'left' ? 'left-0' : 'right-0')}>
          {deck && (
            <>
              <button role="menuitem" type="button" className={ITEM} disabled={deckCompanies.length === 0} onClick={deckReport}>
                <Printer className="h-4 w-4 text-muted" />
                <span>Deck report (PDF)<span className="block text-[11px] text-faint">Cover, contents, every company, sources</span></span>
              </button>
              <button role="menuitem" type="button" className={ITEM} disabled={deckCompanies.length === 0} onClick={csv}>
                <FileSpreadsheet className="h-4 w-4 text-muted" />
                <span>Data (CSV)<span className="block text-[11px] text-faint">Sourced metrics with URLs and as-of</span></span>
              </button>
              <button role="menuitem" type="button" className={ITEM} disabled={deckCompanies.length === 0} onClick={() => void pptx()}>
                <Presentation className="h-4 w-4 text-muted" />
                <span>PowerPoint (.pptx)</span>
              </button>
            </>
          )}
          {company && (
            <>
              <button role="menuitem" type="button" className={ITEM} onClick={companyReport}>
                <Printer className="h-4 w-4 text-muted" />
                <span>Company report (PDF)<span className="block text-[11px] text-faint">Metrics table with source footnotes</span></span>
              </button>
              <button role="menuitem" type="button" className={ITEM} onClick={csv}>
                <FileSpreadsheet className="h-4 w-4 text-muted" />
                <span>Data (CSV)</span>
              </button>
            </>
          )}
          {transcript && (
            <>
              {(deck || company) && <div className="my-1 border-t border-border" />}
              <button role="menuitem" type="button" className={ITEM} disabled={!hasTranscript} onClick={transcriptMd}>
                <FileText className="h-4 w-4 text-muted" />
                <span>Chat transcript (Markdown)</span>
              </button>
              <button role="menuitem" type="button" className={ITEM} disabled={!hasTranscript} onClick={transcriptPdf}>
                <MessageSquareText className="h-4 w-4 text-muted" />
                <span>Chat transcript (PDF)</span>
              </button>
            </>
          )}
          {error && <p className="px-3 py-2 text-[11px] text-negative">{error}</p>}
        </div>
      )}
      {job && createPortal(<PrintDocument job={job.doc} />, document.body)}
    </div>
  );
}
