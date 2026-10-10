/**
 * The Deck Sentinel — the honest client-side cron.
 *
 * A browser app can't wake itself at 6 AM, but it CAN settle its debts on
 * arrival: when the app opens (and once an hour while it stays open), the
 * Sentinel checks every deck's refresh cadence and runs the ONE most overdue
 * Daily Briefing. True background delivery (Telegram, email) ships with the
 * Pro cloud tier; this is the same schedule honored the moment you show up.
 *
 * Consent + cost rules:
 *  - A deck only auto-briefs after its FIRST briefing was run by hand — the
 *    manual unboxing is the opt-in for that deck's schedule.
 *  - At most one auto-briefing per check (gentle on the rate limiter).
 *  - LOW POWER MODE (spending cap) pauses the Sentinel entirely.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { REFRESH_CADENCE_HOURS } from '@mi/contracts';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { useApiKey } from '@/lib/settings/apiKey';
import { isCommunityDesktop } from '@/lib/settings/runtime';
import { isLowPower } from '@/lib/usage';
import { traceAgent } from './agentTrace';
import { useResearchControl } from '@/lib/living/researchControl';

const CHECK_EVERY_MS = 60 * 60 * 1000; // re-check hourly while the app is open

export function useSentinel(): void {
  const repo = useRepository();
  const hasKey = useApiKey((state) => state.hasKey);
  const paused = useResearchControl(state => state.paused);
  const qc = useQueryClient();
  const handled = useRef(new Set<string>());
  const busy = useRef(false);

  useEffect(() => {
    if (paused || (isCommunityDesktop() && !hasKey)) return;
    let disposed = false;
    const allowed = () => !disposed && !useResearchControl.getState().paused && !isLowPower();
    if (
      typeof repo.generateDeckBriefing !== 'function' ||
      typeof repo.listDeckBriefings !== 'function'
    ) {
      return;
    }

    const check = async (): Promise<void> => {
      if (busy.current || !allowed()) return;
      busy.current = true;
      try {
        const markets = await repo.listMarkets();
        for (const m of markets) {
          if (!allowed()) break;
          const hours = REFRESH_CADENCE_HOURS[m.refreshCadence];
          if (!hours || handled.current.has(m.id)) continue;
          const briefings = await repo.listDeckBriefings!(m.id);
          if (!allowed()) break;
          // Opt-in rule: the first briefing is always run by hand.
          if (briefings.length === 0) continue;
          const lastAt = new Date(briefings[0]!.generatedAt).getTime();
          if (Date.now() - lastAt < hours * 3_600_000) continue;

          handled.current.add(m.id);
          traceAgent(
            'Sentinel',
            `Scheduled briefing due — ${m.name}`,
            `${m.refreshCadence} cadence; generating now`,
          );
          try {
            const b = await repo.generateDeckBriefing!(m.id, {
              windowHours: Math.min(hours, 24 * 7),
            });
            qc.invalidateQueries({ queryKey: ['briefings', m.id] });
            traceAgent(
              'Sentinel',
              `Briefing ready — ${m.name}`,
              `${b.updates.length} sourced update${b.updates.length === 1 ? '' : 's'}`,
            );
          } catch (err) {
            traceAgent(
              'Sentinel',
              `Briefing deferred — ${m.name}`,
              err instanceof Error ? err.message : null,
            );
          }
          break; // one auto-briefing per check
        }
      } finally {
        busy.current = false;
      }
    };

    // First check shortly after open (let the app settle), then hourly.
    const kickoff = setTimeout(() => void check(), 8_000);
    const interval = setInterval(() => void check(), CHECK_EVERY_MS);
    return () => {
      disposed = true;
      clearTimeout(kickoff);
      clearInterval(interval);
    };
  }, [repo, qc, hasKey, paused]);
}
