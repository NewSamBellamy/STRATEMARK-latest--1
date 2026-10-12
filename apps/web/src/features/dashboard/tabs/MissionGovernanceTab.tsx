import { useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useCompany, useDashboardTab } from '@/hooks/data';
import { siteUrl } from '@/lib/siteUrl';
import { useRealCover } from '@/lib/media/realCover';
import { FundingChart } from './FundingChart';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { HydratingPanel } from './HydratingPanel';
import { DigDeeperMenu } from '@/features/deepdive/DeepDive';
import { InsightReader, type InsightTone } from '@/components/reader/InsightReader';
import { WikiAvatar } from './LeaderGrid';
import { ResearchMarkdown } from '@/components/ResearchMarkdown';
import { UnknownInline } from '@/features/card/UnknownValue';
import { EmptyNote, FieldLabel, FilterChip, SectionHeader } from './TabKit';

const INVESTOR_KIND_LABEL: Record<string, string> = {
  vc: 'Venture',
  corporate: 'Corporate',
  sovereign: 'Sovereign',
  angel: 'Angel',
  debt: 'Debt',
  other: 'Investor',
};

function fmtUsd(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${Math.round(value).toLocaleString()}`;
}

/** A labelled prose block; a missing one says what is missing, never goes blank. */
function ProseBlock({ label, text, missing }: { label: string; text: string; missing: string }) {
  const has = text.trim().length > 0;
  return (
    <div>
      <h4><FieldLabel>{label}</FieldLabel></h4>
      {has ? (
        <div className="markdown mt-1.5 text-sm leading-relaxed text-content/90"><ResearchMarkdown text={text} /></div>
      ) : (
        <p className="mt-1.5 text-sm text-faint">{missing}</p>
      )}
    </div>
  );
}

/** The image the company's own site publishes (og:image), credited. No image → nothing; never generated art. */
function IdentityCover({ url, name }: { url: string | null; name: string }) {
  const real = useRealCover(url);
  const [broken, setBroken] = useState(false);
  if (real.status !== 'ready' || !real.src || broken) return null;
  return (
    <div className="relative h-[96px] overflow-hidden rounded-xl border border-border bg-surface-2">
      <img
        src={real.src}
        alt={`${name} — image published by the company's site`}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="h-full w-full object-cover"
      />
      {real.publisher && (
        <span className="absolute bottom-0.5 right-1.5 max-w-[90%] truncate text-[9px] text-white/85 [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">
          Image: {real.publisher}
        </span>
      )}
    </div>
  );
}

export function MissionGovernanceTab({ companyId }: { companyId: string }) {
  const query = useDashboardTab(companyId, 'mission_governance');
  const companyQ = useCompany(companyId).data;
  const name = companyQ?.name ?? 'this company';
  // Click a signal → it opens as its own readable card (the deck-of-cards gist).
  const [openSignal, setOpenSignal] = useState<{ tone: InsightTone; text: string } | null>(null);
  const [kind, setKind] = useState<string>('all');
  return (
    <QueryBoundary query={query} loading={<HydratingPanel label="Mission & Governance" />}>
      {(result) => {
        const c = result.content;
        // Model-authored arrays are untrusted data: a section the model omitted
        // must render as an honest empty, never crash the tab (taste-test found
        // 'Cannot read properties of undefined (reading length)' here).
        const board = c.board ?? [];
        const fundingRounds = c.fundingRounds ?? [];
        const investors = c.investors ?? [];
        const positives = c.positives ?? [];
        const negatives = c.negatives ?? [];
        const kinds = [...new Set(investors.map((i) => i.kind))];
        const shownInvestors = investors.filter((i) => kind === 'all' || i.kind === kind);
        return (
          <div className="space-y-8 cascade">
            <section aria-label="Mission and governance">
              <SectionHeader
                title="Mission & governance"
                description="What the company says it is for, how it is controlled, and who funds it, as reported by sources."
                actions={
                  <DigDeeperMenu
                    topics={[
                      'Governance, ownership & control',
                      'Controversies & regulatory scrutiny',
                      'Funding rounds & the investor board',
                    ]}
                    companyId={companyId}
                    companyName={name}
                  />
                }
              />
              <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <div className="panel space-y-5 p-5">
                  <ProseBlock label="Mission" text={c.mission ?? ''} missing="No mission statement sourced yet." />
                  <ProseBlock label="Ethos" text={c.ethos ?? ''} missing="No stated values or ethos sourced yet." />
                  <ProseBlock
                    label="Governance"
                    text={c.governanceStructure ?? ''}
                    missing="Ownership and control structure not sourced yet."
                  />
                </div>

                <div className="space-y-4">
                  <div className="panel p-5">
                    <h3 className="font-display text-sm font-semibold text-content">
                      Board <span className="ml-1 text-xs font-normal tabular-nums text-muted">{board.length || ''}</span>
                    </h3>
                    {/* The same framed-portrait treatment as the leadership grid. */}
                    <ul className="mt-3 divide-y divide-border">
                      {board.map((b) => (
                        <li key={b.name} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                          <WikiAvatar name={b.name} companyName={name} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-content">{b.name}</p>
                            <p className="truncate text-xs text-muted">
                              {b.affiliation?.trim() || 'Affiliation not yet sourced'}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {board.length === 0 && (
                      <p className="mt-3 text-sm text-muted">No board members surfaced yet.</p>
                    )}
                  </div>
                  <IdentityCover url={siteUrl(companyQ?.websiteUrl)} name={name} />
                </div>
              </div>
            </section>

            {/* Funding & the investor board: whose money is in, and when. */}
            <section aria-label="Funding and investors">
              <SectionHeader
                title="Funding & investors"
                description="Rounds and backers exactly as reported. Undisclosed amounts stay unknown; nothing is estimated."
              />
              {fundingRounds.length === 0 && investors.length === 0 ? (
                <EmptyNote compact title="No funding rounds or investors sourced">
                  Research fills this from press releases, filings and funding databases. Private
                  companies often disclose little; public companies show offerings instead.
                </EmptyNote>
              ) : (
                <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
                  <div className="space-y-4">
                  <FundingChart rounds={fundingRounds} />
                  <div className="panel overflow-hidden">
                    <div className="border-b border-border bg-surface-2/60 px-4 py-2">
                      <FieldLabel>Rounds · {fundingRounds.length}</FieldLabel>
                    </div>
                    {fundingRounds.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="text-[11px] text-muted">
                            <tr className="border-b border-border">
                              <th scope="col" className="px-4 py-2 font-medium">Date</th>
                              <th scope="col" className="px-2 py-2 font-medium">Round</th>
                              <th scope="col" className="px-2 py-2 text-right font-medium">Amount</th>
                              <th scope="col" className="px-4 py-2 font-medium">Led by</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {fundingRounds.map((r, i) => {
                              const leads = r.leadInvestors ?? [];
                              return (
                                <tr key={i}>
                                  <td className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold tabular-nums text-primary-ink">
                                    {r.date || <span className="font-normal text-faint">Not reported</span>}
                                  </td>
                                  <td className="px-2 py-2.5 font-medium text-content">{r.round}</td>
                                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-content">
                                    {r.amountUsd != null ? fmtUsd(r.amountUsd) : <UnknownInline />}
                                  </td>
                                  <td className="px-4 py-2.5 text-muted">
                                    {leads.length > 0 ? leads.join(', ') : <span className="text-faint">Not reported</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="px-4 py-4 text-sm text-muted">No reported rounds surfaced yet.</p>
                    )}
                  </div>
                  </div>

                  <div className="panel p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-1.5">
                      <FieldLabel>Investors · {investors.length}</FieldLabel>
                      {kinds.length > 1 && (
                        <span className="ml-auto flex flex-wrap gap-1" role="group" aria-label="Filter investors by type">
                          <FilterChip active={kind === 'all'} onClick={() => setKind('all')}>All</FilterChip>
                          {kinds.map((k) => (
                            <FilterChip key={k} active={kind === k} onClick={() => setKind(k)}>
                              {INVESTOR_KIND_LABEL[k] ?? 'Investor'}
                            </FilterChip>
                          ))}
                        </span>
                      )}
                    </div>
                    <ul className="space-y-2.5">
                      {shownInvestors.slice(0, 12).map((inv) => (
                        <li key={inv.name} className="flex items-start gap-2.5">
                          <WikiAvatar name={inv.name} companyName={name} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-content">
                              {inv.name}
                              <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-px text-[10px] font-medium text-muted">
                                {INVESTOR_KIND_LABEL[inv.kind] ?? 'Investor'}
                              </span>
                            </p>
                            {inv.note?.trim() && <p className="line-clamp-2 text-xs text-muted">{inv.note}</p>}
                          </div>
                        </li>
                      ))}
                    </ul>
                    {investors.length === 0 && (
                      <p className="text-sm text-muted">No named investors surfaced yet.</p>
                    )}
                    {shownInvestors.length > 12 && (
                      <p className="mt-2 text-[11px] text-faint">Showing 12 of {shownInvestors.length}.</p>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* Balanced view of positive and negative actions (spec §8).
                Every signal opens as its own readable card — click to expand. */}
            <section aria-label="Signals">
              <SectionHeader
                title="Signals"
                description="Reported positives and concerns. Open one to read the whole story and verify it."
              />
              <div className="grid gap-4 md:grid-cols-2">
                <div className="panel p-5">
                  <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-positive">
                    <ThumbsUp className="h-4 w-4" /> Positive signals
                    <span className="text-xs font-normal tabular-nums text-muted">{positives.length || ''}</span>
                  </h3>
                  <ul className="mt-2 space-y-1">
                    {positives.map((p, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted transition-colors hover:bg-surface-2 hover:text-content"
                          title="Open as a card — full text + grounded research"
                          onClick={() => setOpenSignal({ tone: 'positive', text: p })}
                        >
                          <span className="mr-1.5 text-positive">•</span>
                          {p}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {positives.length === 0 && (
                    <p className="mt-2 text-sm text-muted">No sourced positives retained yet.</p>
                  )}
                </div>
                <div className="panel p-5">
                  <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-negative">
                    <ThumbsDown className="h-4 w-4" /> Concerns
                    <span className="text-xs font-normal tabular-nums text-muted">{negatives.length || ''}</span>
                  </h3>
                  <ul className="mt-2 space-y-1">
                    {negatives.map((n, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted transition-colors hover:bg-surface-2 hover:text-content"
                          title="Open as a card — full text + grounded research"
                          onClick={() => setOpenSignal({ tone: 'negative', text: n })}
                        >
                          <span className="mr-1.5 text-negative">•</span>
                          {n}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {negatives.length === 0 && (
                    <p className="mt-2 text-sm text-muted">
                      No sourced concerns retained. Unsourced claims are dropped, not displayed.
                    </p>
                  )}
                </div>
              </div>
            </section>

            {openSignal && (
              <InsightReader
                open
                onClose={() => setOpenSignal(null)}
                tone={openSignal.tone}
                title={openSignal.text.length > 90 ? `${openSignal.text.slice(0, 90)}…` : openSignal.text}
                body={openSignal.text}
                companyId={companyId}
                companyName={name}
                researchSeed={`Reported ${openSignal.tone === 'positive' ? 'positive signal' : 'concern'} about ${name}: "${openSignal.text}". Verify it with grounded current sources, expand the full story behind it (what happened, when, who reported it), and assess how material it is.`}
              />
            )}
          </div>
        );
      }}
    </QueryBoundary>
  );
}
