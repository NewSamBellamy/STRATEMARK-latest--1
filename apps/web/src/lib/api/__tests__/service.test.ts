import { describe, it, expect, vi } from 'vitest';
import { captureSite, renderReportPdf, checkHealth, isServiceConfigured } from '../service';

const BASE = 'https://stratemark-agent-142700126606.us-central1.run.app';

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('isServiceConfigured', () => {
  it('is false without a base URL — the app must work standalone', () => {
    expect(isServiceConfigured(undefined)).toBe(false);
    expect(isServiceConfigured('')).toBe(false);
    expect(isServiceConfigured(BASE)).toBe(true);
  });
});

describe('captureSite', () => {
  it('explains why capture is impossible when no service is configured', async () => {
    const out = await captureSite('https://example.com', { baseUrl: undefined });
    expect(out.ok).toBe(false);
    expect(out).toMatchObject({ unavailable: true });
    // The reason must be actionable, not "something went wrong".
    if ('reason' in out) expect(out.reason).toMatch(/browsers block reading other origins/);
  });

  it('sends the user key so a subscriber can spend their own quota', async () => {
    const fetchImpl = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) =>
      jsonRes({ ok: true, receipt: {}, verdict: {}, screenshot: 'data:image/png;base64,x' }),
    );
    await captureSite('https://example.com', { baseUrl: BASE, apiKey: 'user-key', fetchImpl: fetchImpl as never });

    const init = fetchImpl.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)['X-Gemini-Key']).toBe('user-key');
  });

  it('omits the key header entirely when the user has none', async () => {
    const fetchImpl = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => jsonRes({ ok: true }));
    await captureSite('https://example.com', { baseUrl: BASE, fetchImpl: fetchImpl as never });

    const init = fetchImpl.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)['X-Gemini-Key']).toBeUndefined();
  });

  it('passes through a blocked verdict without dressing it up as success', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonRes({
        ok: false,
        receipt: { httpStatus: 403 },
        verdict: { isRealPage: false, blockKind: 'forbidden' },
        fallbackSvg: '<svg/>',
        caption: 'Screenshot unavailable',
      }),
    );
    const out = await captureSite('https://x.com', { baseUrl: BASE, fetchImpl: fetchImpl as never });
    expect(out.ok).toBe(false);
    expect(out).not.toHaveProperty('unavailable');
    if ('fallbackSvg' in out) expect(out.fallbackSvg).toBe('<svg/>');
  });

  it('distinguishes a service error from a blocked page', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ error: 'Refusing to capture a private address' }, 403));
    const out = await captureSite('http://10.0.0.1', { baseUrl: BASE, fetchImpl: fetchImpl as never });
    expect(out).toMatchObject({ unavailable: true });
    if ('reason' in out) expect(out.reason).toMatch(/Refusing to capture/);
  });

  it('never throws when the network is down', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    const out = await captureSite('https://example.com', { baseUrl: BASE, fetchImpl: fetchImpl as never });
    expect(out).toMatchObject({ unavailable: true });
  });
});

describe('renderReportPdf', () => {
  it('returns null with no service so the caller can offer HTML instead', async () => {
    expect(await renderReportPdf('<html></html>', { baseUrl: undefined })).toBeNull();
  });

  it('returns the document bytes on success', async () => {
    // Body given as a string, not a Blob: under jsdom the global Blob is
    // jsdom's, which Node's Response does not accept as a body — it coerces it
    // to "[object Blob]" instead of erroring, which makes for a confusing test.
    const fetchImpl = vi.fn(
      async () =>
        new Response('%PDF-1.7 body', {
          status: 200,
          headers: { 'Content-Type': 'application/pdf' },
        }),
    );
    const blob = await renderReportPdf('<html></html>', { baseUrl: BASE, fetchImpl: fetchImpl as never });

    // Asserting on the CONTENT rather than `toBeInstanceOf(Blob)`: under jsdom
    // the global Blob and the one Node's Response hands back are different
    // classes, so an identity check passes or fails depending on the Node
    // version rather than on whether the code works.
    expect(blob).not.toBeNull();
    expect(await blob?.text()).toBe('%PDF-1.7 body');
  });

  it('returns null rather than throwing when the service errors', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ error: 'boom' }, 500));
    expect(await renderReportPdf('<html></html>', { baseUrl: BASE, fetchImpl: fetchImpl as never })).toBeNull();
  });
});

describe('checkHealth', () => {
  it('returns null when unconfigured or unreachable', async () => {
    expect(await checkHealth({ baseUrl: undefined })).toBeNull();
    const fetchImpl = vi.fn(async () => {
      throw new Error('dns');
    });
    expect(await checkHealth({ baseUrl: BASE, fetchImpl: fetchImpl as never })).toBeNull();
  });

  it('reports capabilities so the UI can hide what is unavailable', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonRes({ status: 'ok', credentials: 'vertex-ai-adc', capabilities: { research: true, capture: true, pdf: true, scheduledRefresh: false } }),
    );
    const health = await checkHealth({ baseUrl: BASE, fetchImpl: fetchImpl as never });
    expect(health?.capabilities.scheduledRefresh).toBe(false);
    expect(health?.credentials).toBe('vertex-ai-adc');
  });
});
