/**
 * Drains the hunt queue — ONE hunt in flight at a time (the free-tier rate
 * limiter never sees a burst), in exactly the order the user clicked.
 * Mounted once in the app shell so queued hunts keep running across
 * navigation.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { useAgentTrace } from './agentTrace';
import { isLowPower } from '@/lib/usage';
import { isReadOnlyResearch } from '@/lib/settings/runtime';

let lowPowerAnnounced = false;

export function useHuntRunner(): void {
  const repo = useRepository();
  const qc = useQueryClient();
  const jobs = useAgentTrace((s) => s.jobs);

  useEffect(() => {
    if (isReadOnlyResearch()) return;
    if (jobs.some((j) => j.status === 'running')) return;
    const next = jobs.find((j) => j.status === 'queued');
    if (!next) return;
    // LOW POWER MODE: the spending cap is hit — autonomous hunts stay queued
    // (never silently dropped) until the cap is raised or the month rolls.
    if (isLowPower()) {
      if (!lowPowerAnnounced) {
        lowPowerAnnounced = true;
        useAgentTrace
          .getState()
          .trace(
            'Sentinel',
            'Low power mode — spending cap reached; queued hunts are paused',
            'Raise or clear the cap in Settings → Usage & billing to resume.',
          );
      }
      return;
    }
    lowPowerAnnounced = false;

    // No cleanup/cancellation here on purpose: marking the job "running"
    // re-fires this effect (jobs changed), and an effect-local cancel flag
    // would trip on that re-run and orphan the result. The status guard above
    // is the single-flight lock; the promise writes straight into the store.
    const { trace, updateJob } = useAgentTrace.getState();
    updateJob(next.id, { status: 'running' });
    trace('Hunt agent', `Hunting: ${next.label}`);
    void repo
      .expandDeck(next.marketId, next.focus)
      .then((r) => {
        useAgentTrace.getState().updateJob(next.id, { status: 'done', added: r.added });
        useAgentTrace
          .getState()
          .trace(
            'Hunt agent',
            r.added > 0
              ? `Found ${r.added} new card${r.added === 1 ? '' : 's'} — ${next.label}`
              : `Nothing credible found — ${next.label} (that's honest)`,
          );
        qc.invalidateQueries({ queryKey: ['cards'] });
      })
      .catch((err: unknown) => {
        useAgentTrace.getState().updateJob(next.id, { status: 'failed' });
        useAgentTrace
          .getState()
          .trace(
            'Hunt agent',
            `Hunt failed — ${next.label}`,
            err instanceof Error ? err.message : null,
          );
      });
  }, [jobs, repo, qc]);
}
