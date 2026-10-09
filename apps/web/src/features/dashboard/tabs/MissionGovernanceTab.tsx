import { useState } from 'react';
import { Banknote, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useCompany, useDashboardTab } from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { HydratingPanel } from './HydratingPanel';
import { DigDeeperMenu } from '@/features/deepdive/DeepDive';
import { InsightReader, type InsightTone } from '@/components/reader/InsightReader';
import { AiCover } from '@/components/media/AiCover';
import { WikiAvatar } from './LeaderGrid';
import { ResearchMarkdown } from '@/components/ResearchMarkdown';
import { UnknownInline } from '@/features/card/UnknownValue';

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

export function MissionGovernanceTab({ companyId }: { companyId: string }) {
  const query = useDashboardTab(companyId, 'mission_governance');
  const name = useCompany(companyId).data?.name ?? 'this company';
  // Click a signal → it opens as its own readable card (the deck-of-cards gist).
  const [openSignal, setOpenSignal] = useState<{ tone: InsightTone; text: string } | null>(null);
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
        return (
          <div className="grid gap-4 cascade lg:grid-cols-2">
            <div className="panel p-5">
              <h3 className="font-display text-sm font-semibold text-content">Mission</h3>
              <div className="markdown mt-2 text-sm text-muted"><ResearchMarkdown text={c.mission ?? ''} /></div>
              <h3 className="mt-4 font-display text-sm font-semibold text-content">Ethos</h3>
              <div className="markdown mt-2 text-sm text-muted"><ResearchMarkdown text={c.ethos ?? ''} /></div>
              <h3 className="mt-4 font-display text-sm font-semibold text-content">Governance</h3>
              <div className="markdown mt-2 text-sm text-muted"><ResearchMarkdown text={c.governanceStructure ?? ''} /></div>
              {/* The identity, illustrated: generated from THIS company's
                  mission + governance so every company's panel is unique. */}
              <div className="mt-4 h-[130px] overflow-hidden rounded-xl border border-border">
                <AiCover
                  cacheKey={`mission:${companyId}`}
                  title={`${name} — organizational identity`}
                  context={`Abstract editorial illustration of this organization's identity and governance structure. Mission: ${c.mission?.slice(0, 200) ?? ''} Governance: ${c.governanceStructure?.slice(0, 200) ?? ''} Depict the structure and ethos conceptually — clean geometric diagram-like abstraction, unique to this company.`}
                  url=""
                  source="news"
                />
              </div>
              <div className="mt-3 flex justify-end">
                <DigDeeperMenu
                  topics={[
                    'Governance, ownership & control',
                    'Controversies & regulatory scrutiny',
                    'Funding rounds & the investor board',
                  ]}
                  companyId={companyId}
                  companyName={name}
                />
              </div>
            </div>

            <div className="panel p-5">
              <h3 className="font-display text-sm font-semibold text-content">Board</h3>
              {/* The same framed-portrait treatment as the leadership grid —
                  a board of famous names deserves faces, not a text list. */}
              <ul className="mt-3 space-y-3">
                {board.map((b) => (
                  <li key={b.name} className="flex items-center gap-3">
                    <WikiAvatar name={b.name} companyName={name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-content">{b.name}</p>
                      <p className="truncate text-xs text-muted">
                        {b.affiliation?.trim() || 'Affiliation not yet sourced'}
                      </p>
                    </div>
                  </li>
                ))}
                {board.length === 0 && (
                  <li className="text-sm text-muted">No board members surfaced yet.</li>
                )}
              </ul>
            </div>

            {/* Funding & the investor board — whose money is in, and when. */}
            {(fundingRounds.length > 0 || investors.length > 0) && (
              <div className="panel p-5 lg:col-span-2">
                <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-content">
                  <Banknote className="h-4 w-4 text-primary-ink" /> Funding & investors
                </h3>
                <div className="mt-3 grid gap-5 lg:grid-cols-[1fr_320px]">
                  <div>
                    {fundingRounds.length > 0 ? (
                      <ol className="space-y-2.5">
                        {fundingRounds.map((r, i) => (
                          <li key={i} className="flex items-baseline gap-3">
                            <span className="w-20 shrink-0 text-xs font-bold tabular-nums text-primary-ink">
                              {r.date ?? '—'}
                            </span>
                            <div className="min-w-0">
                              <span className="text-sm font-medium text-content">{r.round}</span>
                              <span className="text-sm text-muted">
                                {' · '}
                                {r.amountUsd != null ? fmtUsd(r.amountUsd) : <UnknownInline />}
                                {(r.leadInvestors ?? []).length > 0 && ` · led by ${(r.leadInvestors ?? []).join(', ')}`}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-sm text-muted">No reported rounds surfaced yet.</p>
                    )}
                  </div>
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
                      Investor board
                    </p>
                    <ul className="space-y-2">
                      {investors.slice(0, 10).map((inv) => (
                        <li key={inv.name} className="flex items-start gap-2.5">
                          <WikiAvatar name={inv.name} companyName={name} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-content">
                              {inv.name}
                              <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-px text-[10px] font-medium text-muted">
                                {INVESTOR_KIND_LABEL[inv.kind] ?? 'Investor'}
                              </span>
                            </p>
                            {inv.note?.trim() && (
                              <p className="truncate text-xs text-muted">{inv.note}</p>
                            )}
                          </div>
                        </li>
                      ))}
                      {investors.length === 0 && (
                        <li className="text-sm text-muted">No named investors surfaced yet.</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Balanced view of positive and negative actions (spec §8).
                Every signal opens as its own readable card — click to expand. */}
            <div className="panel p-5">
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-positive">
                <ThumbsUp className="h-4 w-4" /> Positive signals
              </h3>
              <ul className="mt-2 space-y-1">
                {positives.map((p, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className="w-full rounded-md px-2 py-1 text-left text-sm text-muted transition-colors hover:bg-emerald-50/60 hover:text-content dark:hover:bg-emerald-950/30"
                      title="Open as a card — full text + grounded research"
                      onClick={() => setOpenSignal({ tone: 'positive', text: p })}
                    >
                      <span className="mr-1.5 text-positive">•</span>
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="panel p-5">
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-negative">
                <ThumbsDown className="h-4 w-4" /> Concerns
              </h3>
              <ul className="mt-2 space-y-1">
                {negatives.map((n, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className="w-full rounded-md px-2 py-1 text-left text-sm text-muted transition-colors hover:bg-rose-50/60 hover:text-content dark:hover:bg-rose-950/30"
                      title="Open as a card — full text + grounded research"
                      onClick={() => setOpenSignal({ tone: 'negative', text: n })}
                    >
                      <span className="mr-1.5 text-negative">•</span>
                      {n}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

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
