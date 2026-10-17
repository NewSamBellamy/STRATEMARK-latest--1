import { afterEach, describe, expect, it, vi } from 'vitest';
import { readAssetSource, readPreviewSource } from './local-source-reader';

const ok = (url: string) => new Response(JSON.stringify({ requestedUrl: url, status: 'retrieved', retrievedAt: 'now', text: 'page', contentHash: 'a'.repeat(64) }), { status: 200 });

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('relay reads under load', () => {
  it('waits out a busy relay (429) and retries instead of dropping the read', async () => {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)) return;
    const url = 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000310764/dei/EntityCommonStockSharesOutstanding.json';
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 429 })).mockResolvedValueOnce(ok(url));
    vi.stubGlobal('fetch', fetchMock);
    const receipt = await readPreviewSource(url);
    expect(receipt.status).toBe('retrieved');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('says why a read failed, so a busy relay is never mistaken for a missing page', async () => {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)) return;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    const receipt = await readAssetSource('https://example.com/');
    expect(receipt).toMatchObject({ status: 'unavailable', httpStatus: 503 });
  });

  it('never has more than eight reads in flight at once', async () => {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)) return;
    let active = 0; let peak = 0;
    vi.stubGlobal('fetch', vi.fn(async (_endpoint: string, init: RequestInit) => {
      active += 1; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return ok(JSON.parse(String(init.body)).url as string);
    }));
    await Promise.all(Array.from({ length: 20 }, (_, i) => readAssetSource(`https://example.com/${i}`)));
    expect(peak).toBeLessThanOrEqual(8);
  });
});
