import { useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowUpRight, BookOpen, CircleHelp } from 'lucide-react';
import type { CardType, ResearchBrief } from '@mi/contracts';
import { sourceUrl } from '@/features/card/card-view';

const labels = {
  overview: 'Overview',
  offering: 'Products & business',
  position: 'Market position',
  updates: 'Updates',
};
const introductions = {
  overview: 'The business, in context.',
  offering: 'What it offers. Who it serves.',
  position: 'Where it fits in this market.',
  updates: 'Developments worth following.',
};
const noteLabels = {
  reported: 'Reported draft · unreviewed',
  analysis: 'Analysis · unreviewed',
  estimate: 'Estimate · unreviewed',
};

/** Retained research only. Navigation never starts inference or retrieval. */
export function NativeResearchBrief({
  brief,
  cardType,
}: {
  brief?: ResearchBrief;
  cardType: CardType;
}) {
  const [chosen, setChosen] = useState('overview');
  const sections = brief?.sections.filter((section) => section.blocks.length) ?? [];
  const selected = sections.some((section) => section.section === chosen)
    ? chosen
    : sections[0]?.section;
  if (!brief || !sections.length)
    return (
      <section className="rounded-xl border border-dashed border-border p-6">
        <BookOpen aria-hidden className="mb-3 h-5 w-5 text-muted" />
        <h3 className="font-display text-lg text-content">Research brief not retained</h3>
        <p className="mt-2 text-sm leading-6 text-muted">
          This card still has its saved summary and source material. Opening this reader does not
          backfill research or spend credits.
        </p>
      </section>
    );
  const sectionLabel = (section: keyof typeof labels) =>
    section === 'offering'
      ? cardType === 'infrastructure'
        ? 'Capabilities'
        : cardType === 'distribution'
          ? 'Channels'
          : labels.offering
      : labels[section];
  return (
    <section aria-label="Retained research brief" className="min-w-0">
      <Tabs.Root value={selected} onValueChange={setChosen}>
        <Tabs.List
          aria-label="Research sections"
          className="flex flex-wrap gap-x-5 gap-y-1 border-b border-border"
        >
          {sections.map(({ section }) => (
            <Tabs.Trigger
              key={section}
              value={section}
              className="border-b-2 border-transparent px-1 py-3 text-sm font-medium text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary data-[state=active]:border-primary data-[state=active]:text-primary"
            >
              {sectionLabel(section)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {sections.map(({ section, blocks }) => (
          <Tabs.Content
            key={section}
            value={section}
            className="pt-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
              Research notes
            </p>
            <h3 className="mt-2 font-display text-2xl leading-tight text-content">
              {introductions[section]}
            </h3>
            <div className="mt-5 divide-y divide-border">
              {blocks.map((block) => (
                <article key={block.id} className="py-5 first:pt-0">
                  <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                    <span className="rounded-full bg-surface-2 px-2 py-0.5">
                      {noteLabels[block.kind]}
                    </span>
                    <span>
                      {block.timeWindow ? `Period: ${block.timeWindow}` : 'Period unknown'}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words font-serif text-base leading-7 text-content">
                    {block.text}
                  </p>
                  {block.kind === 'estimate' && (
                    <div className="mt-3 border-l-2 border-border pl-4 text-sm text-muted">
                      <p>Method: {block.method || 'Not recorded'}</p>
                      {!!block.assumptions?.length && (
                        <ul className="mt-2 list-disc space-y-1 pl-4">
                          {block.assumptions.map((item, index) => (
                            <li key={index}>{item}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {!!block.citations.length && (
                    <ul
                      aria-label="Sources for this note"
                      className="mt-3 flex flex-wrap gap-x-4 gap-y-2"
                    >
                      {block.citations.map((citation, index) => {
                        const candidate = sourceUrl(citation.url);
                        const url = candidate ? new URL(candidate) : null;
                        if (!url || url.username || url.password) return null;
                        return (
                          <li key={`${citation.url}:${index}`} className="min-w-0">
                            <a
                              href={url.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex max-w-full items-start gap-1 break-words text-xs text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary"
                            >
                              <span className="min-w-0 break-words">
                                {citation.title || url.hostname}
                              </span>
                              <ArrowUpRight aria-hidden className="h-3 w-3 shrink-0" />
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          </Tabs.Content>
        ))}
      </Tabs.Root>
      {!!brief.openQuestions.length && (
        <section
          aria-label="Open research questions"
          className="mt-6 rounded-xl border border-border bg-surface-2 p-5"
        >
          <h3 className="flex items-center gap-2 font-display text-lg text-content">
            <CircleHelp aria-hidden className="h-4 w-4 text-primary" />
            What to investigate next
          </h3>
          <ul className="mt-3 space-y-3 text-sm leading-6 text-content">
            {brief.openQuestions.map((question, index) => (
              <li key={index} className="flex gap-3">
                <span aria-hidden className="font-mono text-xs text-muted">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 break-words">{question}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="mt-5 space-y-2 text-xs leading-5 text-muted">
        <p>
          Source links are leads, not verification. Captured text does not establish semantic
          support.
        </p>
        {!!brief.limitations.length && (
          <ul aria-label="Research limitations" className="list-disc space-y-1 pl-4">
            {brief.limitations.map((item, index) => (
              <li key={index} className="break-words">
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
