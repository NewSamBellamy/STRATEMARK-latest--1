import { afterEach, describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, loadWhenOnline, recovery } from './lazyRoute';

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: /src/features/deck/NewDeckPage.tsx');

describe('route chunks opened offline', () => {
  afterEach(() => vi.restoreAllMocks());

  it('waits for the connection and loads the page then, instead of failing for good', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const load = vi.fn().mockRejectedValueOnce(chunkError()).mockResolvedValueOnce({ default: 'page' });
    const loaded = loadWhenOnline(load);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    await expect(loaded).resolves.toEqual({ default: 'page' });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reloads the window once when the browser remembers the failed fetch and the retry fails again', async () => {
    sessionStorage.clear();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const reload = vi.spyOn(recovery, 'reload').mockImplementation(() => {});
    const load = vi.fn().mockRejectedValue(chunkError());
    const loaded = vi.fn();
    void loadWhenOnline(load).then(loaded, loaded);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    // Waiting behind the loader for the reload, not showing an error.
    await Promise.resolve();
    expect(loaded).not.toHaveBeenCalled();
  });

  it('does not reload in a loop: a second failure soon after a reload is shown', async () => {
    sessionStorage.clear();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const reload = vi.spyOn(recovery, 'reload').mockImplementation(() => {});
    const load = vi.fn().mockRejectedValue(chunkError());
    for (const [round, outcome] of (['pending', 'rejected'] as const).entries()) {
      const settled = vi.fn();
      const p = loadWhenOnline(load);
      void p.then(settled, settled);
      // Each round: one failed try offline, then (after the online event) one more.
      await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(round * 2 + 1));
      await Promise.resolve();
      window.dispatchEvent(new Event('online'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(settled.mock.calls.length > 0, outcome).toBe(outcome === 'rejected');
    }
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reports a failure while online at once', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const load = vi.fn().mockRejectedValue(chunkError());
    await expect(loadWhenOnline(load)).rejects.toThrow('Failed to fetch dynamically imported module');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('tells a chunk failure from an ordinary render error', () => {
    expect(isChunkLoadError(chunkError())).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });
});
