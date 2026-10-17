import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import type { Market } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { useDeckRows } from './MarketsListPage';

describe('useDeckRows', () => {
  it('keeps the same rows across re-renders until deck data changes', async () => {
    const repository = makeRepo();
    const markets = await repository.listMarkets();
    expect(markets.length).toBeGreaterThan(0);
    const seen: Array<ReturnType<typeof useDeckRows>> = [];
    let bump: () => void = () => {};

    function Probe({ list }: { list: Market[] }) {
      const [tick, setTick] = useState(0);
      bump = () => setTick((t) => t + 1);
      seen.push(useDeckRows(list));
      return <span>{tick}</span>;
    }

    renderWithProviders(<Probe list={markets} />, { repository });
    await waitFor(() => expect(seen.at(-1)!.every((r) => r.size !== null)).toBe(true));

    const loaded = seen.at(-1)!;
    act(() => bump());
    act(() => bump());
    expect(seen.at(-1)).toBe(loaded);
    expect(loaded).toHaveLength(markets.length);
  });
});
