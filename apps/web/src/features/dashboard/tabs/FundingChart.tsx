/**
 * Funding history: one bar per round that has BOTH a reported amount and a
 * parseable date. Rounds missing either stay in the table only — never
 * zero-filled, never imputed. Shown only with at least two real points.
 */
import { Bar, BarChart, CartesianGrid, Tooltip as ReTooltip, XAxis, YAxis } from 'recharts';
import type { MissionGovernanceContent } from '@mi/contracts';
import { chartTheme, tint } from '@/lib/theme';
import { useTheme } from '@/lib/settings/theme';
import { useWidth } from './metricViz';
import { formatUsdCompact } from '../snapshot';

type Round = NonNullable<MissionGovernanceContent['fundingRounds']>[number];

export interface FundingPoint {
  label: string;
  round: string;
  amountUsd: number;
  date: string;
  leads: string[];
  t: number;
}

/** Only rounds with a real positive amount AND a valid date, in time order. */
export function fundingPoints(rounds: readonly Round[] | undefined): FundingPoint[] {
  const out: FundingPoint[] = [];
  for (const r of rounds ?? []) {
    if (r.amountUsd == null || !Number.isFinite(r.amountUsd) || r.amountUsd <= 0) continue;
    const date = r.date?.trim();
    if (!date) continue;
    const t = Date.parse(date);
    if (!Number.isFinite(t)) continue;
    out.push({
      label: `${r.round} · ${date.slice(0, 7)}`,
      round: r.round,
      amountUsd: r.amountUsd,
      date,
      leads: r.leadInvestors ?? [],
      t,
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

const fmt = formatUsdCompact;

export function FundingChart({ rounds }: { rounds: readonly Round[] | undefined }) {
  const points = fundingPoints(rounds);
  const c = chartTheme(useTheme((s) => s.resolved) === 'dark');
  const [ref, width] = useWidth();
  if (points.length < 2) return null;
  const color = '#F15A24';
  return (
    <div className="panel p-4" data-testid="funding-chart">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
        Capital raised per round
      </p>
      <div ref={ref} className="w-full">
        {width > 0 && (
          <BarChart width={width} height={180} data={points} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="round" stroke={c.axis} fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke={c.axis} fontSize={10} tickLine={false} axisLine={false} width={52} tickFormatter={fmt} />
            <ReTooltip
              cursor={{ fill: tint(color, 0.06) }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as FundingPoint | undefined) : undefined;
                if (!p) return null;
                return (
                  <div
                    style={{
                      background: c.tooltipBg,
                      border: `1px solid ${c.tooltipBorder}`,
                      borderRadius: 10,
                      color: c.tooltipText,
                      fontSize: 12,
                      padding: '8px 12px',
                    }}
                  >
                    <p className="font-semibold">{p.round}</p>
                    <p>{fmt(p.amountUsd)} · {p.date}</p>
                    {p.leads.length > 0 && <p>Led by {p.leads.join(', ')}</p>}
                  </div>
                );
              }}
            />
            <Bar dataKey="amountUsd" fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={32} />
          </BarChart>
        )}
      </div>
      <p className="mt-1 text-[10px] text-faint">
        Only rounds with a reported amount and date are plotted; the rest are in the table.
      </p>
    </div>
  );
}
