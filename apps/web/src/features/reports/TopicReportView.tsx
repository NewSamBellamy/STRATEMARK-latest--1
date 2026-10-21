/**
 * A topic-based company report on screen: a cover line with the company mark,
 * a contents strip, then one section per topic with a real picture where the
 * sources published one, short readable text, a plain "Not found" note where
 * the research came up empty, and the sources as numbered footnotes.
 */
import { useEffect, useMemo, useState } from 'react';
import { SafeMarkdown } from '@/components/ResearchMarkdown';
import { ExternalLink } from 'lucide-react';
import type { Report, ReportTopic } from '@mi/contracts';
import { Logo } from '@/features/card/Logo';
import { buildTopicReportModel, type ReportCompanyInfo, type ReportImage, type TopicReportSectionModel } from '@/features/export/topicReportModel';
import { resolveSectionImages, shotSections } from '@/features/export/reportImages';

/** Pictures arrive section by section so the page fills in instead of waiting on the slowest capture. */
export function useReportImages(report: Report): Map<ReportTopic, ReportImage[]> {
  const [images, setImages] = useState<Map<ReportTopic, ReportImage[]>>(new Map());
  useEffect(() => {
    let live = true;
    const sections = report.sections ?? [];
    const withShot = shotSections(sections);
    const used = new Set<string>();
    setImages(new Map());
    for (const section of sections) {
      void resolveSectionImages(section, withShot.has(section.topic), used).then((found) => {
        if (!live || found.length === 0) return;
        setImages((current) => new Map(current).set(section.topic, found));
      });
    }
    return () => { live = false; };
  }, [report]);
  return images;
}

function Figure({ image }: { image: ReportImage }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-surface-2">
      <img src={image.src} alt="" loading="lazy" className="h-48 w-full object-cover" onError={() => setBroken(true)} />
      <figcaption className="px-3 py-1.5 text-[11px] text-faint">
        {image.kind === 'screenshot' ? 'Capture of the source page' : 'Image'} · {image.credit}
      </figcaption>
    </figure>
  );
}

function Section({ section, index }: { section: TopicReportSectionModel; index: number }) {
  return (
    <section id={`sec-${section.topic}`} className="scroll-mt-20 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <h2 className="font-display text-xl font-semibold tracking-tight text-content">
        <span className="mr-2 tabular-nums text-primary-ink">{String(index + 1).padStart(2, '0')}</span>
        {section.title}
      </h2>
      {section.images.length > 0 && (
        <div className={section.images.length > 1 ? 'mt-4 grid gap-3 sm:grid-cols-2' : 'mt-4'}>
          {section.images.map((img) => <Figure key={img.src} image={img} />)}
        </div>
      )}
      <div className="markdown mt-4 max-w-[70ch] text-[15px] leading-[1.75]">
        <SafeMarkdown>{section.markdown}</SafeMarkdown>
      </div>
      {section.gaps.length > 0 && (
        <p className="mt-4 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200">
          <span className="font-semibold">Not found.</span> {section.gaps.join(' ')}
        </p>
      )}
      {section.researchedDeeper && (
        <p className="mt-3 text-[12px] text-muted">This section needed research beyond what was already stored.</p>
      )}
      {section.footnotes.length > 0 && (
        <ol className="mt-4 space-y-1 text-[12px]">
          {section.footnotes.map((f) => (
            <li key={f.n} value={f.n} className="flex items-start gap-1.5 text-muted">
              <span className="w-5 shrink-0 tabular-nums text-faint">{f.n}.</span>
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 text-primary-ink hover:underline">
                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{f.title}</span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function TopicReportView({ report, company }: { report: Report; company: ReportCompanyInfo }) {
  const images = useReportImages(report);
  const model = useMemo(() => buildTopicReportModel(report, company, images), [report, company, images]);
  return (
    <div>
      <div className="flex items-center gap-3">
        <Logo name={company.name} website={company.website} logoUrl={company.logoUrl} className="h-12 w-12 border border-border" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-muted">Stratemark · Company report</p>
          <p className="mt-0.5 text-xs text-muted">{model.dateText}{model.costLine ? ` · ${model.costLine}` : ''}</p>
        </div>
      </div>

      {model.demo && (
        <p className="mt-4 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-muted">
          Demo report, compiled from the sample deck&apos;s stored research. With a key connected, a report also researches what is missing.
        </p>
      )}

      {model.hero && (
        <div className="mt-5">
          <Figure image={model.hero} />
        </div>
      )}

      <nav aria-label="Report sections" className="mt-5 flex flex-wrap gap-1.5">
        {model.sections.map((s) => (
          <a key={s.topic} href={`#sec-${s.topic}`} className="rounded-full border border-border bg-surface px-3 py-1 text-[12px] text-muted hover:text-content">
            {s.title}
          </a>
        ))}
      </nav>
      {model.openGapCount > 0 && (
        <p className="mt-3 text-[12.5px] text-muted">
          {model.openGapCount} of {model.sections.length} sections have gaps the research could not fill. They say so below; nothing is estimated to cover them.
        </p>
      )}

      <div className="mt-6 space-y-8">
        {model.sections.map((s, i) => <Section key={s.topic} section={s} index={i} />)}
      </div>
    </div>
  );
}
