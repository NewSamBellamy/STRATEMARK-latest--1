import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, FileUp, Link2, Loader2 } from 'lucide-react';
import { METRIC_TYPE_LABELS, type ResearchDocumentResult } from '@mi/contracts';
import { useRepository, useSupports } from '@/lib/repository/RepositoryProvider';
import { useOverrideMetric } from '@/hooks/data';
import { formatMetricValue } from '@/lib/format';
import { readFileText, readUrlText, type DroppedDocument } from '@/lib/research/readDroppedSource';

type Phase =
  | { name: 'idle' }
  | { name: 'reading'; label: string }
  | { name: 'done'; result: ResearchDocumentResult }
  | { name: 'error'; message: string };

type Figure = ResearchDocumentResult['figures'][number];

/**
 * Drop in research done elsewhere (a PDF, a markdown file, pasted text, a page address) and have this company's research
 * base take it in. What comes back is a summary, findings and figure proposals, each with a word-for-word quote from the
 * document. A figure only reaches the card when the person applies it, which makes it user-verified.
 */
export function DropInResearch({ companyId, companyName }: { companyId: string; companyName: string }) {
  const repo = useRepository();
  const supported = useSupports('addResearchDocument');
  const override = useOverrideMetric();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [over, setOver] = useState(false);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [applied, setApplied] = useState<Record<string, true>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const phaseName = phase.name;
  // The reader's detail column scrolls; bring the panel, its Add button and any result fully into view.
  useEffect(() => {
    if (open || phaseName === 'done') rootRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [open, phaseName]);
  if (!supported) return null;

  const take = async (read: () => Promise<DroppedDocument>, label: string) => {
    setPhase({ name: 'reading', label });
    try {
      const doc = await read();
      setPhase({ name: 'reading', label: `Reading “${doc.title}” for ${companyName}…` });
      const result = await repo.addResearchDocument!({
        companyId, companyName, title: doc.title, text: doc.text, sourceUrl: doc.sourceUrl, kind: doc.kind,
      });
      setApplied({});
      setUrl('');
      setText('');
      setPhase({ name: 'done', result });
      void qc.invalidateQueries({ queryKey: ['dashboard', companyId] });
    } catch (err) {
      setPhase({ name: 'error', message: err instanceof Error ? err.message : 'That could not be added.' });
    }
  };

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void take(() => readFileText(file), `Reading ${file.name}…`);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    onFiles(event.dataTransfer.files);
  };
  const busy = phase.name === 'reading';

  return (
    <section ref={rootRef} className="mt-4 rounded-lg border border-border bg-surface-muted/50" aria-label="Drop in research">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-[12.5px] font-medium text-content"
      >
        <span className="flex items-center gap-2">
          <FileUp size={15} aria-hidden /> Drop in your research
          <span className="font-normal text-muted">PDF, markdown, text or a link</span>
        </span>
        <ChevronDown size={15} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} aria-hidden />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-3.5 pb-3.5 pt-3">
          <div
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-4 text-center text-[12px] ${over ? 'border-primary bg-primary/5' : 'border-border'}`}
          >
            <span className="text-muted">Drop a file here, or</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-border bg-surface px-3 py-1 text-[12px] font-medium text-content hover:bg-surface-2 disabled:opacity-60"
            >
              Choose a file
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              aria-label="Choose a research file"
              accept=".pdf,.md,.markdown,.txt,.csv,.json,.html,.htm,text/*,application/pdf"
              onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }}
            />
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => { e.preventDefault(); if (url.trim()) void take(() => readUrlText(url), 'Reading the page…'); }}
          >
            <Link2 size={14} className="shrink-0 text-muted" aria-hidden />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste a link to an article or report"
              aria-label="Link to read"
              className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] text-content placeholder:text-faint"
            />
            <button
              type="submit"
              disabled={busy || !url.trim()}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content hover:bg-surface-2 disabled:opacity-50"
            >
              Read
            </button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) void take(async () => ({ title: 'Pasted notes', text, kind: 'text' as const }), 'Reading your notes…');
            }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              aria-label="Paste research text"
              placeholder="Or paste text: a deep research report, meeting notes, a transcript"
              className="w-full resize-y rounded-md border border-border bg-surface px-2.5 py-2 text-[12px] text-content placeholder:text-faint"
            />
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <span className="text-[10.5px] text-faint">
                It is kept with this company&apos;s research, labelled as yours and never as independently verified.
              </span>
              <button
                type="submit"
                disabled={busy || text.trim().length < 40}
                className="rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-surface disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </form>

          {phase.name === 'reading' && (
            <p className="flex items-center gap-2 text-[12px] text-muted" role="status">
              <Loader2 size={14} className="animate-spin" aria-hidden /> {phase.label}
            </p>
          )}
          {phase.name === 'error' && <p className="text-[12px] text-negative" role="alert">{phase.message}</p>}
          {phase.name === 'done' && (
            <Result
              result={phase.result}
              applied={applied}
              pending={override.isPending}
              onApply={(figure) => override.mutate(
                {
                  companyId,
                  metricType: figure.metricType,
                  value: figure.value,
                  note: `From your document “${phase.result.title}”: “${figure.quote}”`,
                },
                { onSuccess: () => setApplied((a) => ({ ...a, [figure.metricType]: true })) },
              )}
            />
          )}
        </div>
      )}
    </section>
  );
}

function Result({ result, applied, pending, onApply }: {
  result: ResearchDocumentResult;
  applied: Record<string, true>;
  pending: boolean;
  onApply: (figure: Figure) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3 text-[12px]" role="status" data-testid="drop-in-result">
      <p className="flex items-center gap-1.5 font-medium text-content">
        <Check size={14} className="text-positive" aria-hidden /> Added “{result.title}” to your research
      </p>
      {result.truncated && <p className="text-muted">The document was long, so only the first part was kept.</p>}
      {result.digestFailed && <p className="text-muted">It is saved and searchable, but the summary could not be written just now.</p>}
      {result.summary && <p className="leading-relaxed text-content">{result.summary}</p>}
      {result.findings.length > 0 && (
        <div>
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">What it says</p>
          <ul className="space-y-1.5">
            {result.findings.map((f) => (
              <li key={f.claim}>
                <span className="text-content">{f.claim}</span>
                <span className="block text-[11px] italic text-muted">“{f.quote}”</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.figures.length > 0 && (
        <div>
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Figures it states</p>
          <ul className="space-y-1.5">
            {result.figures.map((f) => (
              <li key={f.metricType} className="flex items-start justify-between gap-3">
                <span>
                  <span className="font-medium text-content">{METRIC_TYPE_LABELS[f.metricType]}: {formatMetricValue(f.metricType, f.value)}</span>
                  <span className="block text-[11px] italic text-muted">“{f.quote}”</span>
                </span>
                {applied[f.metricType]
                  ? <span className="shrink-0 text-[11px] font-medium text-positive">Applied</span>
                  : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => onApply(f)}
                      className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-content hover:bg-surface-2 disabled:opacity-60"
                    >
                      Apply to card
                    </button>
                  )}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10.5px] text-faint">Applying a figure marks it as confirmed by you, with the quote as its source.</p>
        </div>
      )}
      <p className="text-muted">Saved to Research &amp; Sources. Chat answers from it too.</p>
    </div>
  );
}
