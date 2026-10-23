import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useIsFetching } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useCachedDashboardTab } from '../useCachedTab';
import { useTabHref } from '../dashboardKit';
import { TabSection } from './TabKit';
import { fundingSnapshot, leadershipSnapshot, newsMood, formatUsdCompact, peerTable, type PeerCell, type PeerRow } from '../snapshot';
import { barPercent } from '../dashboardModel';
import { shortCompanyName } from '../companyNames';
import { deriveInvestors } from '@mi/contracts';
import { unifyFunding } from '../funding';
import { UnknownInline } from '@/features/card/UnknownValue';
import { Logo } from '@/features/card/Logo';
import { initialsOf, photoCredit, useWikiHeadshotResult } from './LeaderGrid';
import { useImageSlot } from '@/lib/media/useImageSlot';
import { safeHttpUrl } from '@/lib/sourceHref';
import type { OrgNode } from '@mi/contracts';
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

/**
 * A leader's face: the photo the research stored with the person, else a Wikipedia
 * portrait verified against the person and company, else their initials. Never a stock
 * or generated picture.
 */
export function LeaderFace({ person, companyName }: { person: Pick<OrgNode, 'name' | 'photoUrl'>; companyName: string }) {
  const supplied = safeHttpUrl(person.photoUrl);
  const [suppliedFailed, setSuppliedFailed] = useState(false);
  const { shot: wiki, settled } = useWikiHeadshotResult(person.name, companyName);
  const [wikiFailed, setWikiFailed] = useState(false);
  const src = supplied && !suppliedFailed ? supplied : wiki && !wikiFailed ? wiki.thumb : null;
  const audit = useImageSlot('person');
  useEffect(() => {
    if (!src && settled) audit.report('fallback', supplied ?? wiki?.thumb ?? null, person.name);
  }, [audit, src, settled, supplied, wiki, person.name]);
  return (
    <span className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-surface-2">
      {src ? (
        <img src={src} alt="" title={src === supplied ? undefined : wiki ? photoCredit(wiki) : undefined} loading="lazy" decoding="async"
          referrerPolicy="no-referrer" className="h-full w-full object-cover"
          onLoad={() => audit.report('loaded', src, person.name)}
          onError={() => (src === supplied ? setSuppliedFailed(true) : setWikiFailed(true))} />
      ) : (
        <span className="font-display text-[13px] font-semibold tracking-wide text-muted" aria-hidden>{initialsOf(person.name)}</span>
      )}
    </span>
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
  const history = useCachedDashboardTab(companyId, 'history').data;
  // The same rounds the Funding and History tabs list: governance rounds plus the timeline's funding events.
  const funding = useMemo(() => {
    const rounds = unifyFunding(governance?.content.fundingRounds, history?.content.timeline);
    return fundingSnapshot(rounds, deriveInvestors({
      companyName,
      board: governance?.content.board,
      fundingRounds: rounds,
      investors: governance?.content.investors,
    }));
  }, [governance, history, companyName]);
  const mood = useMemo(() => newsMood(intel?.content.items ?? []), [intel]);
  const positive = governance?.content.positives?.[0];
  const concern = governance?.content.negatives?.[0];
  const hasSignals = mood.total > 0 || Boolean(positive || concern);
  const panels = [leaders.length > 0, Boolean(funding), hasSignals].filter(Boolean).length;
  const leadersWide = leaders.length > 1 && panels === 2;
  // Name only the panels actually shown, so the heading never promises funding that is absent.
  const parts = [leaders.length > 0 && 'Leadership', Boolean(funding) && 'funding', hasSignals && 'signals'].filter(Boolean) as string[];
  const sectionTitle = parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}`
    : (parts[0] ?? 'Leadership, funding & signals');

  if (leaders.length === 0 && !funding && !hasSignals) {
    return (
      <TabSection title="Leadership, funding & signals">
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
      </TabSection>
    );
  }

  return (
    <TabSection title={sectionTitle}>
      <div className={cn('grid gap-4', leadersWide ? LEADERS_WIDE : COLUMNS[panels])}>
        {leaders.length > 0 && (
          <div className="panel min-w-0 p-5">
            <PanelHead title="Leadership" to={href('team_org')} label="Team & org" />
            <ul className={cn('grid gap-x-6 gap-y-3', leadersWide && 'xl:grid-cols-2')}>
              {leaders.map((person) => (
                <li key={person.id} className="flex min-w-0 items-center gap-3">
                  <LeaderFace person={person} companyName={companyName} />
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
              {funding.latest.amountUsd != null ? formatUsdCompact(funding.latest.amountUsd) : funding.latest.amountNote ?? <UnknownInline />}
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
    </TabSection>
  );
}

const PEER_COLUMNS = [['valuation', 'Valuation'], ['arr', 'Revenue / ARR'], ['employees', 'Employees']] as const;

export interface ColumnScale { max: number; count: number; rankOf: (cell: PeerCell | null | undefined) => number | null }

/**
 * Per column: the largest comparable figure (for the bars) and each figure's place among
 * the comparable ones. Only known figures on the same basis take part; a figure in another
 * currency and a missing one get no bar and no place. `lead` is the column the table is
 * ordered by (the first with a comparable figure).
 */
export function columnScales(table: readonly PeerRow[]): ColumnScale[] & { lead: number } {
  const width = table[0]?.cells.length ?? 0;
  const scales = Array.from({ length: width }, (_, i): ColumnScale => {
    const values = table.flatMap((row) => {
      const cell = row.cells[i];
      return cell && !cell.currency ? [cell.value] : [];
    });
    return {
      max: values.length ? Math.max(...values) : 0,
      count: values.length,
      rankOf: (cell) => (cell && !cell.currency ? values.filter((v) => v > cell.value).length + 1 : null),
    };
  });
  const lead = Math.max(0, scales.findIndex((scale) => scale.count > 0));
  return Object.assign(scales, { lead });
}

/**
 * The deck this dashboard was opened from, side by side on a few headline
 * figures (known ones only; estimates are marked), or, when too little is
 * known to compare, just the other companies, one click away.
 */
export function MarketPeers({ companyId }: { companyId: string }) {
  const [params] = useSearchParams();
  const href = useTabHref(companyId);
  const peers = usePeers();
  const table = useMemo(
    () => peerTable(companyId, peers.peers, PEER_COLUMNS.map(([type]) => type)),
    [companyId, peers.peers],
  );
  const others = peers.peers.filter((peer) => peer.companyId !== companyId);
  const metricsHref = href('metrics');
  if (peers.status !== 'ready' || others.length === 0) return null;
  const to = (peerId: string) => {
    const next = new URLSearchParams(params);
    next.delete('metric');
    return `/company/${peerId}/dashboard/overview?${next.toString()}`;
  };
  if (table) {
    const columns = columnScales(table);
    const selfRow = table.find((row) => row.isSelf);
    // The first rows by size, and always this company's own row (marked) wherever it falls.
    const shown = table.slice(0, 12);
    if (selfRow && !shown.includes(selfRow)) shown.push(selfRow);
    const standing = PEER_COLUMNS.flatMap(([type, label], i) => {
      const scale = columns[i]!;
      const rank = selfRow ? scale.rankOf(selfRow.cells[i]) : null;
      return rank && scale.count > 1 ? [{ type, label: label.toLowerCase(), rank, of: scale.count }] : [];
    });
    const leadLabel = PEER_COLUMNS[columns.lead]![1].toLowerCase();
    return (
      <TabSection title="How they compare" hint="This deck on three headline figures. Bars are drawn against the largest sourced figure in the deck. A dash means no sourced figure yet, never zero. A figure in another currency is shown as reported and left out of the order."
        action={<Link to={metricsHref} className="inline-flex items-center gap-1 text-[12px] text-primary-ink hover:underline">All figures and peers <ArrowRight className="h-3 w-3" aria-hidden /></Link>}>
        {standing.length > 0 && (
          <ul className="mb-3 flex flex-wrap gap-2" aria-label="Where this company places in the deck">
            {standing.map((place) => (
              <li key={place.type} className="inline-flex items-baseline gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12.5px] text-muted">
                <span className="font-display text-[15px] font-semibold tabular-nums text-content">#{place.rank}</span>
                of {place.of} by {place.label}
              </li>
            ))}
          </ul>
        )}
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-[13px]">
            <caption className="sr-only">Companies in this deck compared on valuation, revenue and employees</caption>
            <thead>
              <tr className="border-b border-border bg-surface-2/50 text-left text-[11px] text-muted">
                <th scope="col" className="w-10 px-3 py-2 text-right font-medium"><span className="sr-only">Place by {leadLabel}</span><span aria-hidden>#</span></th>
                <th scope="col" className="px-3 py-2 font-medium">Company</th>
                {PEER_COLUMNS.map(([type, label]) => <th key={type} scope="col" className="px-3 py-2 text-right font-medium">{label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((row) => {
                const place = columns[columns.lead]!.rankOf(row.cells[columns.lead]);
                return (
                  <tr key={row.companyId} className={cn(row.isSelf && 'bg-primary/5')} aria-current={row.isSelf ? 'true' : undefined}>
                    <td className="px-3 py-2 text-right text-[12px] tabular-nums text-faint">{place ?? <span aria-label="not placed">—</span>}</td>
                    <th scope="row" className="px-3 py-2 text-left font-medium text-content">
                      {row.isSelf
                        ? <span className="inline-flex items-center gap-2">{shortCompanyName(row.name)} <span className="text-[11px] font-normal text-faint">(this company)</span></span>
                        : <Link to={to(row.companyId)} className="inline-flex items-center gap-2 hover:text-primary-ink hover:underline">{shortCompanyName(row.name)}</Link>}
                    </th>
                    {row.cells.map((cell, i) => {
                      const scale = columns[i]!;
                      const bar = cell && !cell.currency && scale.max > 0 ? barPercent(cell.value, scale.max) : null;
                      const rank = scale.rankOf(cell);
                      return (
                        <td key={PEER_COLUMNS[i]![0]} className="whitespace-nowrap px-3 py-2 text-right tabular-nums"
                          title={rank ? `#${rank} of ${scale.count} by ${PEER_COLUMNS[i]![1].toLowerCase()} in this deck` : undefined}>
                          {cell
                            ? <>{cell.display}
                              {cell.confidence === 'estimated' && <span className="ml-1 text-[10px] text-faint">est.</span>}
                              {cell.currency && (
                                <abbr className="ml-1 text-[10px] text-faint no-underline" title={cell.converted ? `Converted from ${cell.currency}; rate date not recorded. Not ranked.` : `Reported in ${cell.currency}; not converted to US dollars. Not ranked.`}>
                                  {cell.converted ? `from ${cell.currency}` : cell.currency}
                                </abbr>
                              )}
                              {bar != null && (
                                <span className="ml-auto mt-1 flex h-[3px] w-full max-w-[120px] justify-end overflow-hidden rounded-full bg-border/50" aria-hidden data-testid="peer-bar">
                                  <span className={cn('block h-full rounded-full', row.isSelf ? 'bg-primary' : 'bg-content/30', cell.confidence === 'estimated' && 'opacity-60')} style={{ width: `${bar}%` }} />
                                </span>
                              )}</>
                            : <span className="text-faint" aria-label="not found yet">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {table.length > shown.length && <p className="mt-1.5 text-[11.5px] text-faint">Showing {shown.length} of {table.length}. All figures and peers are on the Metrics tab.</p>}
      </TabSection>
    );
  }
  return (
    <TabSection title="In this market" hint="The rest of this deck. Open one to see its dashboard.">
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
    </TabSection>
  );
}