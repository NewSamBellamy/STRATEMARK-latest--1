import { afterEach, describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, loadWhenOnline } from './lazyRoute';

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
