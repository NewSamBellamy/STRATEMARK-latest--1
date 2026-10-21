import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useIsFetching } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useCachedDashboardTab } from '../useCachedTab';
import { Section, useTabHref } from '../dashboardKit';
import { fundingSnapshot, leadershipSnapshot, newsMood, formatUsdCompact, peerTable } from '../snapshot';
import { formatMetricValue } from '@/lib/format';
import { shortCompanyName } from '../companyNames';
import { UnknownInline } from '@/features/card/UnknownValue';
import { Logo } from '@/features/card/Logo';
import { WikiAvatar } from './LeaderGrid';
import { usePeers } from '../usePeers';
import { storiesCaption } from '../overviewTruth';

/**
 * The people, the money and the mood around a company, taken from the Team,
 * Governance and Live Intel tabs once they have been researched. This never
 * starts research of its own: a panel appears when its tab has content, and
 * until then a single line says where the rest lives.
 */

// One column per panel, so panels fill the row instead of leaving a gap. On wide screens, when
// leadership sits with one other panel it takes two thirds (its list runs in two columns), which
// matches the 2:1 split of the summary above and keeps the shorter signals panel from
// floating beside a tall single-column list.
const COLUMNS: Record<number, string> = { 1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3' };
const LEADERS_WIDE = 'md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]';

function PanelHead({ title, to, label }: { title: string; to: string; label: string }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-2">
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</h3>
      <Link to={to} className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-primary-ink hover:underline">
        {label} <ArrowRight className="h-3 w-3" aria-hidden />
      </Link>
    </div>
  );
}

export function OverviewSnapshot({ companyId, companyName }: { companyId: string; companyName: string }) {
  const href = useTabHref(companyId);
  // The dashboard warms its tabs in the background: say so while that is happening.
  const gathering = useIsFetching({ queryKey: ['dashboard', companyId] }) > 0;
  const team = useCachedDashboardTab(companyId, 'team_org').data;
  const governance = useCachedDashboardTab(companyId, 'mission_governance').data;
  const intel = useCachedDashboardTab(companyId, 'live_intel').data;

  const leaders = useMemo(() => leadershipSnapshot(team?.content.nodes ?? []), [team]);
  const funding = useMemo(
    () => fundingSnapshot(governance?.content.fundingRounds ?? [], governance?.content.investors ?? []),
    [governance],
  );
  const mood = useMemo(() => newsMood(intel?.content.items ?? []), [intel]);
  const positive = governance?.content.positives?.[0];
  const concern = governance?.content.negatives?.[0];
  const hasSignals = mood.total > 0 || Boolean(positive || concern);
  const panels = [leaders.length > 0, Boolean(funding), hasSignals].filter(Boolean).length;
  const leadersWide = leaders.length > 1 && panels === 2;

  if (leaders.length === 0 && !funding && !hasSignals) {
    return (
      <Section title="Leadership, funding & signals">
        <p className="panel px-4 py-3.5 text-[12.5px] leading-snug text-muted">
          {gathering
            ? `Gathering who runs ${companyName}, who funded it and what is being said about it from live sources. This fills in as each finishes.`
            : <>
              Who runs {companyName}, who funded it and what is being said about it show up here once those tabs are
              researched:{' '}
              <Link to={href('team_org')} className="text-primary-ink hover:underline">Team &amp; org</Link>{' · '}
              <Link to={href('mission_governance')} className="text-primary-ink hover:underline">Mission &amp; governance</Link>.
            </>}
        </p>
      </Section>
    );
  }

  return (
    <Section title="Leadership, funding & signals">
      <div className={cn('grid gap-4', leadersWide ? LEADERS_WIDE : COLUMNS[panels])}>
        {leaders.length > 0 && (
          <div className="panel min-w-0 p-5">
            <PanelHead title="Leadership" to={href('team_org')} label="Team & org" />
            <ul className={cn('grid gap-x-6 gap-y-2.5', leadersWide && 'xl:grid-cols-2')}>
              {leaders.map((person) => (
                <li key={person.id} className="flex min-w-0 items-center gap-2.5">
                  <WikiAvatar name={person.name} companyName={companyName} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-content" title={person.name}>{person.name}</p>
                    <p className="truncate text-[11.5px] text-muted" title={person.role}>{person.role}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {funding && (
          <div className="panel min-w-0 p-5">
            <PanelHead title="Funding" to={href('mission_governance')} label="All rounds" />
            <p className="font-display text-[22px] font-semibold leading-none tabular-nums text-content">
              {funding.latest.amountUsd != null ? formatUsdCompact(funding.latest.amountUsd) : <UnknownInline />}
            </p>
            <p className="mt-1.5 text-[12.5px] text-content">
              {funding.latest.round}
              <span className="text-muted"> · {funding.latest.date?.trim() || 'date not reported'}</span>
            </p>
            {funding.leads.length > 0 && (
              <p className="mt-2 line-clamp-2 text-[11.5px] leading-snug text-muted">
                {funding.latest.leadInvestors.length > 0 ? 'Led by ' : 'Backers: '}
                {(funding.latest.leadInvestors.length > 0 ? funding.latest.leadInvestors : funding.leads).slice(0, 4).join(', ')}
              </p>
            )}
            <p className="mt-2 text-[11px] text-faint">
              Latest of {funding.roundCount} reported {funding.roundCount === 1 ? 'round' : 'rounds'}
            </p>
          </div>
        )}

        {hasSignals && (
          <div className="panel min-w-0 p-5">
            <PanelHead title="Signals" to={href(mood.total > 0 ? 'live_intel' : 'mission_governance')} label={mood.total > 0 ? 'Live intel' : 'Governance'} />
            {mood.total > 0 && (
              <div>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-2" role="img"
                  aria-label={`${mood.positive} positive, ${mood.neutral} neutral, ${mood.negative} negative of ${storiesCaption(intel?.content.items ?? [])}`}>
                  <span className="bg-positive" style={{ width: `${(mood.positive / mood.total) * 100}%` }} />
                  <span className="bg-border" style={{ width: `${(mood.neutral / mood.total) * 100}%` }} />
                  <span className="bg-negative" style={{ width: `${(mood.negative / mood.total) * 100}%` }} />
                </div>
                <p className="mt-1.5 text-[11.5px] tabular-nums text-muted">
                  {storiesCaption(intel?.content.items ?? [])}: {mood.positive} positive · {mood.neutral} neutral · {mood.negative} negative
                </p>
              </div>
            )}
            {positive && (
              <p className="mt-2.5 line-clamp-2 text-[12px] leading-snug text-content">
                <span className="mr-1 text-positive" aria-hidden>+</span>{positive}
              </p>
            )}
            {concern && (
              <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-content">
                <span className="mr-1 text-negative" aria-hidden>−</span>{concern}
              </p>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

const PEER_COLUMNS = [['valuation', 'Valuation'], ['arr', 'Revenue / ARR'], ['employees', 'Employees']] as const;

/**
 * The deck this dashboard was opened from, side by side on a few headline
 * figures (known ones only; estimates are marked), or, when too little is
 * known to compare, just the other companies, one click away.
 */
export function MarketPeers({ companyId }: { companyId: string }) {
  const [params] = useSearchParams();
  const peers = usePeers();
  const table = useMemo(
    () => peerTable(companyId, peers.peers, PEER_COLUMNS.map(([type]) => type)),
    [companyId, peers.peers],
  );
  const others = peers.peers.filter((peer) => peer.companyId !== companyId);
  if (peers.status !== 'ready' || others.length === 0) return null;
  const to = (peerId: string) => {
    const next = new URLSearchParams(params);
    next.delete('metric');
    return `/company/${peerId}/dashboard/overview?${next.toString()}`;
  };
  if (table) {
    return (
      <Section title="How they compare" hint="This deck on three headline figures. A dash means no sourced figure yet, never zero.">
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-[13px]">
            <caption className="sr-only">Companies in this deck compared on valuation, revenue and employees</caption>
            <thead>
              <tr className="border-b border-border bg-surface-2/50 text-left text-[10.5px] uppercase tracking-[0.1em] text-muted">
                <th scope="col" className="px-3 py-2 font-semibold">Company</th>
                {PEER_COLUMNS.map(([type, label]) => <th key={type} scope="col" className="px-3 py-2 text-right font-semibold">{label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {table.slice(0, 12).map((row) => (
                <tr key={row.companyId} className={cn(row.isSelf && 'bg-primary/5')} aria-current={row.isSelf ? 'true' : undefined}>
                  <th scope="row" className="px-3 py-2 text-left font-medium text-content">
                    {row.isSelf
                      ? <span className="inline-flex items-center gap-2"><Logo name={row.name} website={row.websiteUrl} logoUrl={row.logoUrl} bare className="h-4 w-4" />{shortCompanyName(row.name)} <span className="text-[11px] font-normal text-faint">(this company)</span></span>
                      : <Link to={to(row.companyId)} className="inline-flex items-center gap-2 hover:text-primary-ink hover:underline"><Logo name={row.name} website={row.websiteUrl} logoUrl={row.logoUrl} bare className="h-4 w-4" />{shortCompanyName(row.name)}</Link>}
                  </th>
                  {row.cells.map((cell, i) => (
                    <td key={PEER_COLUMNS[i]![0]} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {cell
                        ? <>{formatMetricValue(PEER_COLUMNS[i]![0], cell.value)}{cell.confidence === 'estimated' && <span className="ml-1 text-[10px] text-faint">est.</span>}</>
                        : <span className="text-faint" aria-label="not found yet">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {table.length > 12 && <p className="mt-1.5 text-[11.5px] text-faint">Showing 12 of {table.length}. All figures and peers are on the Metrics tab.</p>}
      </Section>
    );
  }
  return (
    <Section title="In this market" hint="The rest of this deck. Open one to see its dashboard.">
      <ul className="flex flex-wrap gap-2">
        {others.slice(0, 12).map((peer) => (
          <li key={peer.companyId}>
            <Link to={to(peer.companyId)} className="chip inline-flex items-center gap-2 border-border text-muted hover:border-primary/50 hover:text-content">
              <Logo name={peer.name} website={peer.websiteUrl} logoUrl={peer.logoUrl} bare className="h-4 w-4" />
              <span className="max-w-[160px] truncate">{shortCompanyName(peer.name)}</span>
            </Link>
          </li>
        ))}
        {others.length > 12 && <li className="self-center text-[11.5px] text-faint">+{others.length - 12} more</li>}
      </ul>
    </Section>
  );
}