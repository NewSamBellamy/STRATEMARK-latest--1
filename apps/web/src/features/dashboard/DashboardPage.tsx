import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useIsFetching } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, FileText, Search } from 'lucide-react';
import { DASHBOARD_TABS, DASHBOARD_TAB_LABELS, type DashboardTab } from '@mi/contracts';
import { useCard, useCompany, useReports, useRerunDashboardTab } from '@/hooks/data';
import { useAgentTrace } from '@/lib/agentic/agentTrace';
import { ReportButton, ThreadHistoryButton } from '@/features/research/ResearchControls';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { ContextRerun } from '@/components/ui/ContextRerun';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';
import { useApiKey } from '@/lib/settings/apiKey';
import { Logo } from '@/features/card/Logo';
import { useDeepDive } from '@/features/deepdive/DeepDive';
import { buildCardView } from '@/features/card/card-view';
import { OverviewTab } from './tabs/OverviewTab';
import { LiveIntelTab } from './tabs/LiveIntelTab';
import { TeamOrgTab } from './tabs/TeamOrgTab';
import { LiveLandingTab } from './tabs/LiveLandingTab';
import { MetricsTab } from './tabs/MetricsTab';
import { MissionGovernanceTab } from './tabs/MissionGovernanceTab';
import { HistoryTab } from './tabs/HistoryTab';
import { ProductsRoadmapTab } from './tabs/ProductsRoadmapTab';
import NotFoundPage from '@/features/NotFoundPage';

/**
 * "You're already halfway there" — free-text grounded research from inside the
 * company's context. Opens the sourced deep-dive sheet with whatever you ask.
 */
function ResearchComposer({ companyId, companyName }: { companyId: string; companyName: string }) {
  const { chat } = useDeepDive();
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const question = q.trim();
    if (!question) return;
    // A question here starts a CONVERSATION anchored to this company — the
    // answer arrives in the Dig sheet, follow-ups continue the same thread,
    // and the whole exchange lands in the company's research history.
    chat({ kind: 'company', deckId: null, companyId, subject: companyName }, { seed: question });
    setQ('');
  };
  return (
    <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
        <input
          className="input py-2 pl-8 text-[13px]"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Ask a grounded question about ${companyName}…`}
          aria-label={`Research anything about ${companyName}`}
        />
      </div>
      <button type="submit" className="btn-ghost shrink-0 px-3 py-2 text-xs" disabled={!q.trim()}>
        Ask
      </button>
    </form>
  );
}

/** The company's intel file: every report generated about it, attached here. */
function IntelFile({ companyId }: { companyId: string }) {
  const reports = useReports();
  const mine = (reports.data ?? []).filter(
    (r) => r.kind === 'company' && r.subjectId === companyId,
  );
  if (mine.length === 0) return null;
  return (
    <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-faint">
        Intel file
      </span>
      {mine.slice(0, 4).map((r) => (
        <Link
          key={r.id}
          to={`/reports/${r.id}`}
          className="chip shrink-0 border-border text-muted hover:border-primary/50 hover:text-content"
          title={r.title}
        >
          <FileText className="h-3 w-3" />
          <span className="max-w-[180px] truncate">
            {r.title.replace(/ — Company Report.*$/, '')}
          </span>
          <span className="text-faint">{formatRelative(r.createdAt)}</span>
        </Link>
      ))}
      {mine.length > 4 && (
        <Link to="/reports" className="shrink-0 text-[11px] text-primary-ink hover:underline">
          +{mine.length - 4} more
        </Link>
      )}
    </div>
  );
}

function TabView({ tab, companyId }: { tab: DashboardTab; companyId: string }) {
  switch (tab) {
    case 'overview':
      return <OverviewTab companyId={companyId} />;
    case 'live_intel':
      return <LiveIntelTab companyId={companyId} />;
    case 'team_org':
      return <TeamOrgTab companyId={companyId} />;
    case 'live_landing':
      return <LiveLandingTab companyId={companyId} />;
    case 'metrics':
      return <MetricsTab companyId={companyId} />;
    case 'mission_governance':
      return <MissionGovernanceTab companyId={companyId} />;
    case 'history':
      return <HistoryTab companyId={companyId} />;
    case 'products_roadmap':
      return <ProductsRoadmapTab companyId={companyId} />;
  }
}

const PRIMARY_TABS: DashboardTab[] = ['overview', 'metrics', 'live_intel'];
const MORE_TABS: DashboardTab[] = [
  'products_roadmap',
  'team_org',
  'history',
  'mission_governance',
  'live_landing',
];

/**
 * A quiet, honest signal for the view the user explicitly opened.
 */
function AgentWorkingPill({
  companyId,
  activeTab,
}: {
  companyId: string;
  activeTab: DashboardTab;
}) {
  const inFlight = useIsFetching({ queryKey: ['dashboard', companyId, activeTab], exact: true });
  if (inFlight === 0) return null;
  return (
    <span
      className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap pb-1 text-[11px] font-medium text-muted"
      title="Researching this company view from live sources"
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
      Researching this view…
    </span>
  );
}

function DashboardTabNav({
  companyId,
  activeTab,
  fromMarketId,
  fromCardId,
  fromDeckView,
}: {
  companyId: string;
  activeTab: DashboardTab;
  fromMarketId: string | null;
  fromCardId: string | null;
  fromDeckView: string | null;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [moreOpen]);

  const activeInOverflow = MORE_TABS.includes(activeTab);

  const qs = fromMarketId
    ? `?${new URLSearchParams({ deck: fromMarketId, ...(fromCardId ? { card: fromCardId } : {}), ...(fromDeckView ? { view: fromDeckView } : {}) })}`
    : '';

  return (
    <nav
      className="mb-6 flex items-center gap-1 border-b border-border"
      aria-label="Company dashboard tabs"
    >
      {PRIMARY_TABS.map((t) => (
        <NavLink
          key={t}
          to={`/company/${companyId}/dashboard/${t}${qs}`}
          className={({ isActive }) =>
            cn(
              'whitespace-nowrap border-b-2 px-3.5 py-2 text-[13px] font-medium transition-colors',
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-content',
            )
          }
        >
          {DASHBOARD_TAB_LABELS[t]}
        </NavLink>
      ))}
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setMoreOpen(!moreOpen)}
          className={cn(
            'flex items-center gap-1 whitespace-nowrap border-b-2 px-3.5 py-2 text-[13px] font-medium transition-colors',
            activeInOverflow
              ? 'border-primary text-primary'
              : 'border-transparent text-muted hover:text-content',
          )}
        >
          {activeInOverflow ? DASHBOARD_TAB_LABELS[activeTab] : 'More'}
          <ChevronDown className={cn('h-3 w-3 transition-transform', moreOpen && 'rotate-180')} />
        </button>
        {moreOpen && (
          <div className="absolute left-0 top-full z-30 mt-1 w-48 rounded-lg border border-border bg-surface p-1 shadow-card">
            {MORE_TABS.map((t) => (
              <NavLink
                key={t}
                to={`/company/${companyId}/dashboard/${t}${qs}`}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'block rounded-md px-3 py-1.5 text-[13px] transition-colors',
                    isActive
                      ? 'bg-surface-2 font-medium text-content'
                      : 'text-muted hover:bg-surface-2 hover:text-content',
                  )
                }
              >
                {DASHBOARD_TAB_LABELS[t]}
              </NavLink>
            ))}
          </div>
        )}
      </div>
      <AgentWorkingPill companyId={companyId} activeTab={activeTab} />
    </nav>
  );
}

export default function DashboardPage() {
  const { companyId, tab } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromMarketId = params.get('deck');
  const fromCardId = params.get('card');
  const fromDeckView = params.get('view');
  const returnToDeck = () => {
    if (!fromMarketId) return navigate(-1);
    const deckParams = new URLSearchParams(fromDeckView ?? '');
    if (fromCardId) deckParams.set('card', fromCardId);
    navigate(`/markets/${fromMarketId}/deck${deckParams.size ? `?${deckParams}` : ''}`);
  };
  const company = useCompany(companyId);
  const hasKey = useApiKey((s) => s.hasKey);
  const activeTab = tab as DashboardTab;
  const rerunTab = useRerunDashboardTab(companyId, activeTab);
  const sourceCard = useCard(fromCardId ?? undefined);
  const sourceView = sourceCard.data ? buildCardView(sourceCard.data) : null;

  // Anchor the floating presence's "Chat" to THIS company's research context.
  const setChatContext = useAgentTrace((s) => s.setChatContext);
  const companyName = company.data?.name;
  useEffect(() => {
    if (companyId && companyName) {
      setChatContext({ kind: 'company', companyId, subject: companyName });
    }
    return () => setChatContext(null);
  }, [companyId, companyName, setChatContext]);

  if (!companyId || !DASHBOARD_TABS.includes(activeTab)) return <NotFoundPage />;

  return (
    <div className="mx-auto max-w-6xl">
      {/* Breadcrumbs: back to where you came from, and — always — a way home
          to the decks (audit 6:35: "it doesn't take you back to your decks"
          when a card was opened from Saved Cards or a report). */}
      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          // A real route back to the deck. History fallback only when the
          // dashboard was reached without deck context. NOTE: the deck lives
          // at /markets/:id/deck — /markets/:id alone is a 404.
          onClick={returnToDeck}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-content"
        >
          <ArrowLeft className="h-4 w-4" />
          {fromMarketId ? (fromCardId ? 'Back to card' : 'Back to deck') : 'Back'}
        </button>
        <span className="text-faint">·</span>
        <Link
          to="/history"
          className="text-sm text-muted transition-colors hover:text-content"
          title="All your decks"
        >
          All decks
        </Link>
      </div>

      <QueryBoundary query={company}>
        {(c) => (
          <>
            <header className="mb-6 rounded-2xl border border-[#bfd8cf] bg-[#edf6f1] p-5 sm:p-6">
              <div className="flex flex-wrap items-start gap-4">
                <Logo
                  name={c.name}
                  website={c.websiteUrl}
                  logoUrl={c.logoUrl}
                  className="h-16 w-16 border border-[#bfd8cf] bg-white"
                />
                <div className="min-w-[240px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                      Company research
                    </span>
                    {sourceView && (
                      <>
                        <span className="rounded-full border border-[#c7ddd5] bg-white/70 px-2 py-0.5 text-[10px] font-medium text-muted">
                          {sourceView.position}
                        </span>
                        <span className="rounded-full border border-[#c7ddd5] bg-white/70 px-2 py-0.5 text-[10px] font-medium text-muted">
                          {sourceView.sourcedCount} sourced{' '}
                          {sourceView.sourcedCount === 1 ? 'figure' : 'figures'}
                        </span>
                      </>
                    )}
                  </div>
                  <h1 className="mt-1 font-display text-[32px] font-semibold tracking-[-0.03em] text-content">
                    {c.name}
                  </h1>
                  <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{c.oneLiner}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ThreadHistoryButton companyId={c.id} />
                  <ReportButton kind="company" subjectId={c.id} />
                </div>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[#cbded7] pt-4">
                <ResearchComposer companyId={companyId} companyName={c.name} />
                <IntelFile companyId={companyId} />
              </div>
            </header>

            <DashboardTabNav
              companyId={companyId}
              activeTab={activeTab}
              fromMarketId={fromMarketId}
              fromCardId={fromCardId}
              fromDeckView={fromDeckView}
            />
            {/* Right-click any tab's content → rerun just that research. */}
            <ContextRerun
              label={`the ${DASHBOARD_TAB_LABELS[activeTab]} tab`}
              onRerun={() => rerunTab.mutate()}
              running={rerunTab.isPending}
              disabled={!hasKey}
            >
              <TabView tab={activeTab} companyId={companyId} />
            </ContextRerun>
          </>
        )}
      </QueryBoundary>
    </div>
  );
}
