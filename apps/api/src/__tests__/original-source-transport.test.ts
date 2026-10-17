import { beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from 'node:https';
import { retrieveOriginalSource } from '../lib/original-source';

const state = vi.hoisted(() => ({ oversized: false, reportSized: false }));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]) }));
vi.mock('node:https', async () => {
  const { EventEmitter } = await import('node:events');
  return { request: vi.fn((_options, callback) => {
    const req = new EventEmitter() as InstanceType<typeof EventEmitter> & { end(): void; destroy(error: Error): void };
    req.destroy = (error) => { req.emit('error', error); };
    req.end = () => {
      const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'text/plain' } });
      callback(res);
      queueMicrotask(() => {
        res.emit('data', Buffer.from(state.oversized ? 'a'.repeat(2 * 1024 * 1024 + 1)
          : state.reportSized ? 'Example company revenue '.repeat(25000) : 'Example company revenue'));
        res.emit('end');
      });
    };
    return req;
  }) };
});

beforeEach(() => { state.oversized = false; state.reportSized = false; vi.clearAllMocks(); });
describe('actual HTTPS transport configuration', () => {
  it('pins the socket while preserving Host and TLS identity without forwarding credentials', async () => {
    expect((await retrieveOriginalSource('https://sec.gov/Archives/report?year=2026')).status).toBe('retrieved');
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      hostname: '8.8.8.8', servername: 'sec.gov', port: 443, agent: false,
      path: '/Archives/report?year=2026',
      headers: { Host: 'sec.gov', Accept: 'text/html, text/plain, application/json', 'Accept-Encoding': 'identity', 'User-Agent': 'Stratemark-Research/1.0 (+https://getstratemark.com)' },
    }), expect.any(Function));
    const options = vi.mocked(request).mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(options).not.toHaveProperty('rejectUnauthorized'); // retain Node TLS verification default
    expect(options).not.toHaveProperty('auth');
  });

  it('fails during streaming overflow without retaining oversized content', async () => {
    state.oversized = true;
    const result = await retrieveOriginalSource('https://sec.gov/Archives/report');
    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('Source exceeds the 2 MB document limit');
    expect(result.text).toBeUndefined();
    expect(result.contentHash).toBeUndefined();
  });

  it('reads an annual-report-sized stream while keeping the retained excerpt bounded', async () => {
    state.reportSized = true;
    const result = await retrieveOriginalSource('https://sec.gov/Archives/report');
    expect(result).toMatchObject({ status: 'retrieved', truncated: true });
    expect(result.text).toHaveLength(4000);
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
