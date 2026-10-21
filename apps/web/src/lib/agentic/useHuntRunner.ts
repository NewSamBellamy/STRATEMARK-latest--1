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
import { qk } from '@/lib/query/keys';
import { isLowPower } from '@/lib/usage';

let lowPowerAnnounced = false;

/** Put a company the person confirmed from a link on Today, once it is a card in the deck. */
async function followNamedCompany(
  repo: ReturnType<typeof useRepository>,
  marketId: string,
  named: { name: string; domain?: string | null },
  qc: ReturnType<typeof useQueryClient>,
): Promise<void> {
  try {
    const deck = await repo.getDeckByMarket(marketId);
    const cards = deck ? await repo.listCards(deck.id) : [];
    const key = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const match = cards.find((c) => c.company && key(c.company.name) === key(named.name));
    if (!match?.company || !repo.followCompanies) return;
    await repo.followCompanies([match.company.id]);
    await Promise.all([qc.invalidateQueries({ queryKey: qk.follows }), qc.invalidateQueries({ queryKey: qk.moves })]);
  } catch (err) {
    useAgentTrace.getState().trace('Hunt agent', `Could not add ${named.name} to Today`, err instanceof Error ? err.message : null);
  }
}

export function useHuntRunner(): void {
  const repo = useRepository();
  const qc = useQueryClient();
  const jobs = useAgentTrace((s) => s.jobs);

  useEffect(() => {
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
          .trace('Sentinel', 'Low power mode — spending cap reached; queued hunts are paused', 'Raise or clear the cap in Settings → Usage & billing to resume.');
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
        if (next.followAfter && next.focus.company) void followNamedCompany(repo, next.marketId, next.focus.company, qc);
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
