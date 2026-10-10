/**
 * Auto-refresh scheduler — resolves the PRD's open question for a desktop app
 * that isn't running 24/7: refresh happens (a) shortly after launch when a
 * deck's cadence interval has elapsed, and (b) on a 15-minute check while the
 * app is open. One deck per tick (quota-friendly); failures are logged, never
 * fatal. Works identically in web and Electron because it runs through the
 * repository seam.
 */
import { useEffect } from 'react';
import { REFRESH_CADENCE_HOURS } from '@mi/contracts';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { useApiKey } from '@/lib/settings/apiKey';
import { isCommunityDesktop } from '@/lib/settings/runtime';
import { useResearchControl } from '@/lib/living/researchControl';
import { isLowPower } from '@/lib/usage';

const TICK_MS = 15 * 60 * 1000;
const BOOT_DELAY_MS = 8 * 1000;

export function nextDueAt(lastRefreshedAt: string | null, cadenceHours: number): number | null {
  if (!lastRefreshedAt) return null; // never researched → nothing to auto-refresh
  const last = Date.parse(lastRefreshedAt);
  if (Number.isNaN(last)) return null;
  return last + cadenceHours * 3600 * 1000;
}

export function useAutoRefresh(): void {
  const repo = useRepository();
  const hasKey = useApiKey((state) => state.hasKey);
  const paused = useResearchControl(state => state.paused);

  useEffect(() => {
    if (paused || (isCommunityDesktop() && !hasKey)) return;
    let disposed = false;
    let running = false;
    const allowed = () => !disposed && !useResearchControl.getState().paused && !isLowPower();

    const tick = async (): Promise<void> => {
      if (!allowed() || running) return;
      running = true;
      try {
        const markets = await repo.listMarkets();
        const now = Date.now();
        for (const market of markets) {
          if (!allowed()) break;
          const deck = await repo.getDeckByMarket(market.id);
          if (!allowed()) break;
          if (!deck) continue;
          const due = nextDueAt(deck.lastRefreshedAt, REFRESH_CADENCE_HOURS[market.refreshCadence]);
          if (due !== null && now >= due) {
            await repo.refreshDeck(market.id); // events invalidate caches
            break; // one refresh per tick — protects free-tier quota
          }
        }
      } catch (err) {
        console.warn('[auto-refresh] skipped:', err);
      } finally {
        running = false;
      }
    };

    const boot = setTimeout(() => void tick(), BOOT_DELAY_MS);
    const interval = setInterval(() => void tick(), TICK_MS);
    return () => {
      disposed = true;
      clearTimeout(boot);
      clearInterval(interval);
    };
  }, [repo, hasKey, paused]);
}
