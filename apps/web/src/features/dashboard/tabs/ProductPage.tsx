/**
 * A product's own page: name, key metrics, overview, how it is received and a
 * growth timeline, with a PDF report. It opens from stored research (the
 * product's record, the roadmap and news stories that name it) and fills in the
 * rest only when asked: "Research this product" is one grounded pass that uses
 * research credits. Figures carry their source; anything nobody reports says
 * "Not reported" and is never estimated.
 */
import { ExternalLink, FileText, Loader2, Search } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Product, RoadmapItem } from '@mi/contracts';
import { publisherOf } from '@mi/contracts';
import { Modal } from '@/components/ui/Modal';
import { AiCover } from '@/components/media/AiCover';
import { localDate } from '@/features/export/exportModel';
import { usePrintJob } from '@/features/export/usePrintJob';
import {
  buildProductReportModel,
  metricRows,
  productTimeline,
  relatedRoadmap,
  relatedStories,
  sentimentTally,
  type Sentiment,
} from '@/features/export/productReportModel';
import { useStoredLiveIntel } from '@/hooks/today';
import { qk } from '@/lib/query/keys';
import { sourceHref } from '@/lib/sourceHref';
import { useRepository, useSupports } from '@/lib/repository/RepositoryProvider';
import { cn } from '@/lib/cn';

const SENTIMENT_DOT: Record<Sentiment, string> = { positive: 'bg-emerald-500', neutral: 'bg-slate-400', negative: 'bg-rose-500' };

export function ProductPage({
  product, companyId, company, roadmap, onClose,
}: {
  product: Product;
  companyId: string;
  company: { name: string; logoUrl: string | null; websiteUrl: string | null };
  roadmap: readonly RoadmapItem[];
  onClose: () => void;
}) {
  const repo = useRepository();
  const qc = useQueryClient();
  const canResearch = useSupports('researchProductBrief');
  const printer = usePrintJob();
  const key = qk.productBrief(companyId, product.name);
  const stored = useQuery({ queryKey: key, queryFn: async () => (await repo.peekProductBrief?.(companyId, product.name)) ?? null });
  const research = useMutation({
    mutationFn: () => repo.researchProductBrief!({ companyId, productName: product.name, force: !!stored.data }),
    onSuccess: (brief) => qc.setQueryData(key, brief),
  });
  const intel = useStoredLiveIntel(companyId);
  const brief = stored.data ?? null;
  const stories = relatedStories(intel.data?.items ?? [], product.name);
  const planned = relatedRoadmap(roadmap, product.name);
  const metrics = metricRows(product, brief);
  const timeline = productTimeline(brief, planned);
  const tally = sentimentTally(stories);
  const hasUrl = !!product.url && /^https?:\/\//.test(product.url);

  const report = () => {
    const model = buildProductReportModel({
      company: { name: company.name, logoUrl: company.logoUrl, website: company.websiteUrl, hq: null },
      product, brief, stories, roadmap: planned,
    });
    printer.print({ kind: 'productReport', model }, `${company.name} ${product.name} - Stratemark product report ${localDate()}`);
  };

  const heading = (text: string) => <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-faint">{text}</h3>;

  return (
    <Modal open size="xl" onOpenChange={(o) => { if (!o) onClose(); }} title={product.name}
      description={product.status ? `${company.name} · ${product.status}` : company.name}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={report}><FileText className="h-4 w-4" /> Download report (PDF)</button>
            {canResearch && (
              <button type="button" className="btn-ghost" disabled={research.isPending} onClick={() => research.mutate()}
                title="One grounded research pass on this product. It uses research credits, so it only runs when you ask.">
                {research.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {research.isPending ? 'Researching…' : brief ? 'Research again' : 'Research this product'}
              </button>
            )}
          </div>
          {hasUrl && (
            <a href={product.url!} target="_blank" rel="noopener noreferrer" className="btn-ghost"><ExternalLink className="h-4 w-4" /> Official page</a>
          )}
        </div>
        {research.isError && <p role="alert" className="text-[13px] text-negative">{research.error instanceof Error ? research.error.message : 'The research did not finish.'}</p>}

        <div className="h-[150px] overflow-hidden rounded-xl border border-border">
          <AiCover cacheKey={`product:${company.name}:${product.name}`} title={`${company.name} — ${product.name}`}
            context={`Product card art. ${product.description} Depict the essence of using this product — the experience, the interface mood, the domain — as premium collectible-card artwork.`}
            url={product.url ?? ''} source="news" />
        </div>

        <section aria-label="Overview">
          {heading('Overview')}
          {brief?.overview.trim() && <p className="mb-2 text-[14px] leading-relaxed text-content">{brief.overview.trim()}</p>}
          <p className={cn('text-[14px] leading-relaxed', brief?.overview.trim() ? 'text-muted' : 'text-content/90')}>{product.description || 'Not reported.'}</p>
        </section>

        <section aria-label="Key metrics">
          {heading('Key metrics')}
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {metrics.map((m, i) => (
              <div key={`${m.label}-${i}`} className="panel px-3.5 py-3">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{m.label}</dt>
                <dd className={cn('mt-1 text-[14px] leading-snug', m.value ? 'text-content' : 'text-faint')}>{m.value ?? 'Not reported'}</dd>
                {m.value && (m.asOf || m.source) && (
                  <p className="mt-1 text-[11px] text-faint">
                    {m.asOf}{m.asOf && m.source ? ' · ' : ''}
                    {m.source && <a href={sourceHref(m.source.url, m.source.title)} target="_blank" rel="noopener noreferrer" className="text-primary-ink hover:underline">{publisherOf(m.source.url, m.source.title)}</a>}
                  </p>
                )}
              </div>
            ))}
          </dl>
          {!brief && <p className="mt-2 text-[12px] text-faint">{canResearch ? 'Usage, pricing and growth figures are filled in when you research this product.' : 'Usage, pricing and growth figures need a research key.'}</p>}
        </section>

        <section aria-label="How it is received">
          {heading('How it is received')}
          {brief?.sentiment && (brief.sentiment.summary.trim() || brief.sentiment.positive.length > 0 || brief.sentiment.negative.length > 0) ? (
            <div className="space-y-3">
              {brief.sentiment.summary.trim() && <p className="text-[14px] leading-relaxed text-content/90">{brief.sentiment.summary.trim()}</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                {brief.sentiment.positive.length > 0 && (
                  <div className="panel p-3.5"><p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Praised for</p>
                    <ul className="list-disc space-y-1 pl-4 text-[13px] text-content/90">{brief.sentiment.positive.map((t) => <li key={t}>{t}</li>)}</ul></div>
                )}
                {brief.sentiment.negative.length > 0 && (
                  <div className="panel p-3.5"><p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Criticised for</p>
                    <ul className="list-disc space-y-1 pl-4 text-[13px] text-content/90">{brief.sentiment.negative.map((t) => <li key={t}>{t}</li>)}</ul></div>
                )}
              </div>
              {brief.sentiment.sources.length > 0 && (
                <p className="text-[11px] text-faint">Sources:{' '}
                  {brief.sentiment.sources.slice(0, 6).map((s, i) => (
                    <span key={s.url}>{i > 0 ? ', ' : ''}<a href={sourceHref(s.url, s.title)} target="_blank" rel="noopener noreferrer" className="text-primary-ink hover:underline">{publisherOf(s.url, s.title)}</a></span>
                  ))}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[13px] text-muted">No reception research for this product yet.</p>
          )}
          {stories.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-[11px] text-faint">In the news, as already stored for {company.name}: {tally.positive} positive, {tally.neutral} neutral, {tally.negative} negative.</p>
              <ul className="space-y-1.5">
                {stories.map((s) => (
                  <li key={s.url} className="flex items-start gap-2 text-[13px]">
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', SENTIMENT_DOT[s.sentiment])} aria-label={s.sentiment} role="img" />
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-content hover:text-primary-ink hover:underline">{s.title}</a>
                    <span className="shrink-0 text-[11px] text-faint">{s.publisher ?? publisherOf(s.url, null)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section aria-label="Growth timeline">
          {heading('Growth timeline')}
          {timeline.length > 0 ? (
            <ol className="space-y-3 border-l border-border pl-4">
              {timeline.map((t, i) => (
                <li key={`${t.title}-${i}`} className="relative">
                  <span className={cn('absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border border-surface', t.origin === 'roadmap' ? 'bg-slate-400' : 'bg-primary')} aria-hidden />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{t.date ?? 'Undated'}{t.origin === 'roadmap' ? ' · planned' : ''}</p>
                  <p className="text-[14px] font-medium text-content">{t.title}</p>
                  {t.detail && <p className="text-[13px] leading-snug text-muted">{t.detail}</p>}
                  {t.sourceUrl && <a href={t.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary-ink hover:underline">{publisherOf(t.sourceUrl, null)}</a>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-muted">No dated milestones for this product yet.{canResearch ? ' Research it to build the timeline.' : ''}</p>
          )}
        </section>
      </div>
      {printer.host}
    </Modal>
  );
}
