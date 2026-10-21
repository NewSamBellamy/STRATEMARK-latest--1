/**
 * A thin company's Overview, designed instead of left empty: one line that says
 * which parts of the research exist and which do not yet, each a link to that
 * tab. It reads what is stored (never researching), and counts a part only when
 * it has real content. When a part is missing the page says so plainly and how
 * to get it; it never fills the space.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import type { DashboardTab, HistoryContent, LiveIntelContent, MissionGovernanceContent, OverviewContent, ProductsRoadmapContent, TeamOrgContent } from '@mi/contracts';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { cn } from '@/lib/cn';
import { useTabHref } from '../dashboardKit';

export interface CoverageItem {
  key: string;
  label: string;
  tab: DashboardTab;
  have: boolean;
  detail: string | null;
}

type Stored = Partial<Record<DashboardTab, unknown>>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What is stored for each part of the research, judged by real content and nothing else. */
export function coverageItems(figuresFound: number, figureSlots: number, stored: Stored): CoverageItem[] {
  const overview = stored.overview as OverviewContent | undefined;
  const team = stored.team_org as TeamOrgContent | undefined;
  const products = stored.products_roadmap as ProductsRoadmapContent | undefined;
  const history = stored.history as HistoryContent | undefined;
  const intel = stored.live_intel as LiveIntelContent | undefined;
  const mission = stored.mission_governance as MissionGovernanceContent | undefined;
  // Stored content can be of an older shape: count only what is really there.
  const count = (list: unknown): number => (Array.isArray(list) ? list.length : 0);
  const nodes = count((team as { nodes?: unknown } | undefined)?.nodes);
  const productCount = count(products?.products);
  const events = count(history?.timeline);
  const stories = count(intel?.items);
  return [
    { key: 'figures', label: 'Figures', tab: 'metrics', have: figuresFound > 0, detail: figureSlots > 0 ? `${figuresFound} of ${figureSlots} found` : null },
    { key: 'brief', label: 'Research brief', tab: 'overview', have: Boolean(overview?.markdown?.trim()), detail: null },
    { key: 'team', label: 'Team & org', tab: 'team_org', have: nodes > 0, detail: nodes > 0 ? plural(nodes, 'person', 'people') : null },
    { key: 'products', label: 'Products & roadmap', tab: 'products_roadmap', have: productCount > 0, detail: productCount > 0 ? plural(productCount, 'product') : null },
    { key: 'history', label: 'History', tab: 'history', have: events > 0 || Boolean(history?.founderStory?.trim()), detail: events > 0 ? plural(events, 'event') : null },
    { key: 'news', label: 'Live intel', tab: 'live_intel', have: stories > 0, detail: stories > 0 ? plural(stories, 'item') : null },
    { key: 'mission', label: 'Mission & governance', tab: 'mission_governance', have: Boolean(mission?.mission?.trim()) || count(mission?.board) > 0, detail: null },
  ];
}

const TABS: DashboardTab[] = ['overview', 'team_org', 'products_roadmap', 'history', 'live_intel', 'mission_governance'];

export function OverviewCoverage({ companyId, figuresFound, figureSlots }: { companyId: string; figuresFound: number; figureSlots: number }) {
  const repo = useRepository();
  const href = useTabHref(companyId);
  const stored = useQuery({
    queryKey: ['coverage', companyId],
    queryFn: async (): Promise<Stored> => {
      const out: Stored = {};
      await Promise.all(TABS.map(async (tab) => {
        const found = await repo.peekDashboardTab?.(companyId, tab).catch(() => null);
        if (found) out[tab] = found.content;
      }));
      return out;
    },
    enabled: typeof repo.peekDashboardTab === 'function',
  });
  if (!stored.data) return null;
  const items = coverageItems(figuresFound, figureSlots, stored.data);
  const have = items.filter((i) => i.have).length;
  if (have === items.length) return null;
  const missing = items.filter((i) => !i.have);
  return (
    <section aria-label="What has been researched" className="panel px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-content">What we have so far</h2>
        <p className="text-[12px] text-muted">
          {have === 0
            ? 'Only the card so far. Open a part below and it is researched from sources.'
            : `${have} of ${items.length} parts. ${missing.map((m) => m.label).join(', ')} ${missing.length === 1 ? 'is' : 'are'} not researched yet.`}
        </p>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              to={href(item.tab)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors',
                item.have ? 'border-primary/40 bg-primary/5 text-content hover:bg-primary/10' : 'border-dashed border-border text-muted hover:text-content',
              )}
              title={item.have ? 'Open this part' : 'Not researched yet. Open it to research it from sources.'}
            >
              {item.have && <Check className="h-3 w-3 text-primary" aria-hidden />}
              <span className="font-medium">{item.label}</span>
              <span className="text-faint">{item.have ? item.detail ?? '' : 'not yet'}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
