/**
 * The one "Share & export" menu for every surface. Three groups, each shown
 * only when the host page can honestly offer it:
 *   Create    -> compose a report from the stored research (with an optional focus)
 *   Share     -> a read-only share link (opens the share dialog)
 *   Download  -> what the page can export:
 *     deck        -> deck report (PDF), data (CSV), PowerPoint
 *     company     -> company report (PDF), data (CSV)
 *     transcript  -> chat transcript (Markdown, PDF)
 *     downloads   -> anything else the host passes in (a report's own PDF / Markdown)
 *
 * PDFs use the browser/Electron print pipeline with the print stylesheet in
 * print.css: the report is rendered off-screen, body gets `sm-exporting`, and
 * everything else is hidden for the duration of window.print().
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FilePlus2, FileSpreadsheet, FileText, Link2, MessageSquareText, Presentation, Printer, Share2 } from 'lucide-react';
import type { CardWithCompany, ThreadMessage } from '@mi/contracts';
import { cn } from '@/lib/cn';
import { usePopoverSide } from '@/lib/usePopoverSide';
import { useGenerateReport } from '@/hooks/data';
import { useCompanyCard } from '@/hooks/today';
import { useRepository, useSupports } from '@/lib/repository/RepositoryProvider';
import { ShareDialog } from '@/features/share/ShareDialog';
import { ReportWizard } from '@/features/reports/ReportWizard';
import { useCompanyReportRun } from '@/features/reports/useCompanyReportRun';
import type { SharePayload } from '@/lib/share/codec';
import { exportDeckPptx } from '@/features/reports/pptx';
import type { PrintJob } from './PrintDocument';
import { usePrintJob } from './usePrintJob';
import { buildFullReport, type SignalBriefsInput } from './fullReportModel';
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

/** The stored dashboard sections a company report reads. */
const PROFILE_TABS = ['overview', 'products_roadmap', 'team_org', 'history', 'live_intel'] as const;
type StoredTabsInput = Record<string, Partial<Record<(typeof PROFILE_TABS)[number], { content: unknown; lastRefreshedAt?: string }>>>;

export interface ExportMenuProps {
  /** `id` lets the PDF carry what the deck has stored beyond its cards (profiles, history, news). */
  deck?: { id?: string; title: string; cards: readonly CardWithCompany[] };
  company?: ExportCompany;
  transcript?: { title: string; scopeLabel?: string | null; messages: readonly ThreadMessage[] };
  className?: string;
  /** `bar` matches the deck action bar; `icon` is the compact variant for panel headers. */
  variant?: 'bar' | 'icon';
  /** Offer a share link: the dialog packages the payload when it opens. */
  share?: { title: string; subtitle?: string | null; build: (onStage: (stage: string) => void) => Promise<SharePayload>; page?: { deckId: string; cardId?: string | null } };
  /**
   * Offer "Create report". A company report (`kind: 'company'` with a `name`)
   * opens the section picker and runs in the background; a deck report opens
   * after a short focus prompt; `onClick` lets a host (the chat panel) own the flow.
   */
  report?:
    | { kind: 'deck'; subjectId: string | undefined }
    | { kind: 'company'; subjectId: string | undefined; name: string; cardId?: string | null; deckId?: string | null }
    | { label: string; onClick: () => void };
  /** Extra Download entries a host owns (a report page's own PDF or Markdown). */
  downloads?: readonly ExportDownload[];
}

export interface ExportDownload {
  key: string;
  label: string;
  hint?: string;
  icon?: 'pdf' | 'markdown' | 'slides' | 'data';
  disabled?: boolean;
  onSelect: (ctx: { print: (doc: PrintJob, fileTitle: string) => void }) => void | Promise<void>;
}

const DOWNLOAD_ICONS = { pdf: Printer, markdown: FileText, slides: Presentation, data: FileSpreadsheet } as const;

const GROUP =
  'px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-faint';

const ITEM =
  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-content hover:bg-surface-2 disabled:opacity-50';

export function ExportMenu({ deck, company, transcript, className, variant = 'bar', share, report, downloads = [] }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const printer = usePrintJob();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [focus, setFocus] = useState('');
  const [builderOpen, setBuilderOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const side = usePopoverSide(ref, open, 288);
  const navigate = useNavigate();
  const generateReport = useGenerateReport();
  const runCompanyReport = useCompanyReportRun();
  const canGenerate = useSupports('generateReport');
  const repo = useRepository();

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
  useEffect(() => {
    if (!open) setFocusOpen(false);
  }, [open]);

  const print = useCallback((doc: PrintJob, fileTitle: string) => {
    setOpen(false);
    setError(null);
    printer.print(doc, fileTitle);
  }, [printer]);

  const deckCompanies = deck ? companiesFromCards(deck.cards) : [];
  const date = localDate();

  const deckReport = async () => {
    if (!deck) return;
    const fileTitle = `${deck.title} - Stratemark market report`;
    const short = () => print({ kind: 'report', model: buildReportModel({ title: deck.title, kind: 'deck', companies: deckCompanies }) }, fileTitle);
    if (!deck.id || !repo.exportShareSnapshot) return short();
    // The full report is built from what the deck has already stored (profiles, history, news, signals): no research.
    setOpen(false);
    setBusy('report');
    setError(null);
    try {
      const snapshot = await repo.exportShareSnapshot({ deckId: deck.id });
      print({ kind: 'marketReport', model: buildFullReport({ title: deck.title, cards: deck.cards, tabs: snapshot.dashboards, signalBriefs: (snapshot as { signalBriefs?: SignalBriefsInput }).signalBriefs }) }, fileTitle);
    } catch {
      short();
    } finally {
      setBusy(null);
    }
  };
  const companyCard = useCompanyCard(company?.id);
  const companyReport = async () => {
    if (!company) return;
    const fileTitle = `${company.name} - Stratemark company report`;
    const figuresOnly = () =>
      print({ kind: 'report', model: buildReportModel({ title: company.name, kind: 'company', companies: [company] }) }, fileTitle);
    // Usually loaded already; when the click came first, wait for it rather than fall back to the figures alone.
    const card = companyCard.data ?? (await companyCard.refetch().catch(() => null))?.data ?? null;
    if (!card) return figuresOnly();
    // The card face and the stored profile (overview, products, team, history, news) are read from what is already
    // stored, at no research cost (a repository that cannot peek contributes none); a section never researched is left out.
    setOpen(false);
    setBusy('report');
    setError(null);
    try {
      const stored: StoredTabsInput[string] = {};
      for (const tab of PROFILE_TABS) {
        const r = await repo.peekDashboardTab?.(company.id, tab);
        if (r) stored[tab] = { content: r.content, ...(r.lastRefreshedAt ? { lastRefreshedAt: r.lastRefreshedAt } : {}) };
      }
      const full = buildFullReport({ title: company.name, cards: [card], tabs: { [company.id]: stored } });
      print({ kind: 'report', model: { ...full, kind: 'company' } }, fileTitle);
    } catch {
      figuresOnly();
    } finally {
      setBusy(null);
    }
  };
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

  const composeReport = () => {
    if (!report || !('kind' in report) || report.kind !== 'deck' || !report.subjectId) return;
    setError(null);
    generateReport.mutate(
      { kind: report.kind, subjectId: report.subjectId, focus: focus.trim() || null },
      {
        onSuccess: (r) => {
          setOpen(false);
          setFocus('');
          navigate(`/reports/${r.id}`);
        },
        onError: (e) => setError(e instanceof Error ? e.message : 'Could not create the report.'),
      },
    );
  };
  const reportEntry = report
    ? ('kind' in report
      ? (canGenerate && Boolean(report.subjectId) ? (report.kind === 'company' ? 'builder' : 'compose') : null)
      : 'host')
    : null;
  const hasData = Boolean(deck && deckCompanies.length > 0) || Boolean(company);
  const hasTranscript = Boolean(transcript && transcript.messages.length > 0);
  const hasDownloads = hasData || hasTranscript || downloads.length > 0;
  if (!hasDownloads && !share && !reportEntry) return null;

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
        aria-label={variant === 'icon' ? 'Share and export' : undefined}
        title="Create a report, share a link, or download this"
        onClick={() => setOpen((v) => !v)}
      >
        <Share2 className={variant === 'icon' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        {variant === 'icon' ? null : busy ? 'Exporting…' : 'Share & export'}
      </button>
      {open && (
        <div role="menu" className={cn('absolute top-full z-50 mt-1 w-72 rounded-xl border border-border bg-surface p-1 shadow-card', side === 'left' ? 'left-0' : 'right-0')}>
          {reportEntry && (
            <>
              <p className={GROUP}>Create</p>
              {reportEntry === 'host' && report && 'onClick' in report ? (
                <button role="menuitem" type="button" className={ITEM} onClick={() => { setOpen(false); report.onClick(); }}>
                  <FilePlus2 className="h-4 w-4 text-muted" />
                  <span>{report.label}</span>
                </button>
              ) : reportEntry === 'builder' ? (
                <button role="menuitem" type="button" className={ITEM} onClick={() => { setOpen(false); setBuilderOpen(true); }}>
                  <FilePlus2 className="h-4 w-4 text-muted" />
                  <span>Create report<span className="block text-[11px] text-faint">Pick the sections; we research what is missing</span></span>
                </button>
              ) : focusOpen ? (
                <div className="px-3 pb-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-muted" htmlFor="share-export-focus">Focus (optional)</label>
                  <input
                    id="share-export-focus"
                    className="input mt-1.5 py-2 text-sm"
                    placeholder="e.g. who is winning enterprise, pricing pressure…"
                    value={focus}
                    onChange={(e) => setFocus(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') composeReport(); }}
                  />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-muted">Sourcing rules don’t change. Focus steers emphasis.</p>
                    <button type="button" className="btn-primary shrink-0 px-3 py-1.5 text-xs" disabled={generateReport.isPending} onClick={composeReport}>
                      {generateReport.isPending ? 'Composing…' : 'Compose'}
                    </button>
                  </div>
                </div>
              ) : (
                <button role="menuitem" type="button" className={ITEM} onClick={() => setFocusOpen(true)}>
                  <FilePlus2 className="h-4 w-4 text-muted" />
                  <span>Create report<span className="block text-[11px] text-faint">An executive report from the researched evidence</span></span>
                </button>
              )}
            </>
          )}
          {share && (
            <>
              <p className={GROUP}>Share</p>
              <button role="menuitem" type="button" className={ITEM} onClick={() => { setOpen(false); setShareOpen(true); }}>
                <Link2 className="h-4 w-4 text-muted" />
                <span>Share link<span className="block text-[11px] text-faint">A read-only copy, no account needed to open it</span></span>
              </button>
            </>
          )}
          {hasDownloads && (reportEntry || share) && <p className={GROUP}>Download</p>}
          {downloads.map((d) => {
            const Icon = DOWNLOAD_ICONS[d.icon ?? 'data'];
            return (
              <button key={d.key} role="menuitem" type="button" className={ITEM} disabled={d.disabled} onClick={() => { setOpen(false); void d.onSelect({ print }); }}>
                <Icon className="h-4 w-4 text-muted" />
                <span>{d.label}{d.hint && <span className="block text-[11px] text-faint">{d.hint}</span>}</span>
              </button>
            );
          })}
          {deck && (
            <>
              <button role="menuitem" type="button" className={ITEM} disabled={deckCompanies.length === 0} onClick={() => void deckReport()}>
                <Printer className="h-4 w-4 text-muted" />
                <span>Deck report (PDF)<span className="block text-[11px] text-faint">Full report: signals, every company, sources</span></span>
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
              <button role="menuitem" type="button" className={ITEM} onClick={() => void companyReport()}>
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
      {share && (
        <ShareDialog open={shareOpen} onOpenChange={setShareOpen} title={share.title} subtitle={share.subtitle} build={share.build} page={share.page} />
      )}
      {report && 'kind' in report && report.kind === 'company' && report.subjectId && (
        <ReportWizard
          open={builderOpen}
          onOpenChange={setBuilderOpen}
          companyId={report.subjectId}
          companyName={report.name}
          cardId={report.cardId}
          deckId={report.deckId}
          onStart={(input) => {
            void runCompanyReport({ companyId: report.subjectId as string, companyName: report.name, ...input });
          }}
        />
      )}
      {printer.host}
    </div>
  );
}
