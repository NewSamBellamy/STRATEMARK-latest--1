import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createGeminiClient } from './gemini';

const DEADLINE = 120_000;
const response = (text = 'answer') => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text }] } }],
}), { status: 200 });
const hung = <T>() => new Promise<T>(() => undefined);

it('paces retry attempts within the same model quota', async () => {
  vi.useFakeTimers();
  const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('busy', {
    status: 429, headers: { 'retry-after': '1' },
  })).mockResolvedValueOnce(response());
  const client = createGeminiClient({ apiKey: 'test-placeholder', groundedRpm: 1, fetchImpl });
  const result = client.ground('prompt');
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60000);
  expect((await result).text).toBe('answer');
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it('reports where the time of a rate-limited call went', async () => {
  vi.useFakeTimers();
  const onCallMetrics = vi.fn();
  const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('busy', {
    status: 429, headers: { 'retry-after': '2' },
  })).mockResolvedValue(response());
  const client = createGeminiClient({ apiKey: 'test-placeholder', groundedRpm: 60, fetchImpl, onCallMetrics });
  const settled = client.ground('prompt');
  await vi.advanceTimersByTimeAsync(5000);
  await settled;
  const [metrics] = onCallMetrics.mock.calls.at(-1)!;
  expect(metrics.attempts).toBe(2);
  expect(metrics.retries).toBe(1);
  expect(metrics.retryWaitMs).toBeGreaterThanOrEqual(2000);
  expect(metrics.totalMs).toBeGreaterThanOrEqual(metrics.retryWaitMs);
  // The aggregate carries the same pain for the run-log summary.
  expect(client.metrics?.()).toMatchObject({ calls: 1, retries: 1 });
});

it('shares quota when grounding and extraction use the same model', async () => {
  vi.useFakeTimers();
  const fetchImpl = vi.fn(async () => response('{"name":"ok"}'));
  const client = createGeminiClient({ apiKey: 'test-placeholder', model: 'same-model',
    structureModel: 'same-model', groundedRpm: 1, structureRpm: 1, fetchImpl });
  await client.ground('first');
  const second = client.structure('second', z.object({ name: z.string() }));
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60000);
  expect(await second).toEqual({ name: 'ok' });
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('identifies a blocked response without echoing private provider details', async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'PRIVATE DETAIL' } })));
  await expect(createGeminiClient({ apiKey: 'test-placeholder', fetchImpl }).ground('prompt'))
    .rejects.toThrow('Gemini blocked this research request. Try a narrower research question.');
});

it('identifies invalid structured output without exposing the research notes', async () => {
  const fetchImpl = vi.fn(async () => response('PRIVATE INVALID OUTPUT'));
  await expect(createGeminiClient({ apiKey: 'test-placeholder', fetchImpl }).structure('prompt', z.object({ name: z.string() })))
    .rejects.toThrow('Gemini returned invalid research data after two attempts. No guessed data was saved.');
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it('identifies browser transport failures without disclosing their raw message', async () => {
  const fetchImpl = vi.fn().mockRejectedValue(new TypeError('PRIVATE NETWORK DETAIL'));
  await expect(createGeminiClient({ apiKey: 'test-placeholder', fetchImpl }).ground('prompt'))
    .rejects.toThrow('Could not reach Gemini. Check your connection and try again.');
});

it('bounds a hung fetch that ignores abort: the ladder walks the lines, the deadline holds', async () => {
  vi.useFakeTimers();
  const fetchImpl = vi.fn(() => hung<Response>());
  const client = createGeminiClient({ apiKey: 'test-placeholder', fetchImpl });
  let settled = false;
  const result = client.ground('prompt').catch(error => { settled = true; return error; });
  // The primary line gets a 45s attempt window, the first fallback most of the
  // rest — a hung everything settles through the ladder before the 120s cap.
  await vi.advanceTimersByTimeAsync(DEADLINE - 2000);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(2000);
  expect(settled).toBe(true);
  expect(await result).toMatchObject({ name: 'TimeoutError' });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['json', 'text'] as const)('bounds hung %s response-body reading', async method => {
  vi.useFakeTimers();
  const res = response();
  if (method === 'text') Object.defineProperty(res, 'ok', { value: false });
  vi.spyOn(res, method).mockImplementation(() => hung());
  const fetchImpl = vi.fn().mockResolvedValue(res);
  let error: Error | undefined;
  void createGeminiClient({ apiKey: 'test-placeholder', fetchImpl }).ground('prompt').catch(value => { error = value; });
  await vi.advanceTimersByTimeAsync(DEADLINE);
  expect(error).toMatchObject({ name: 'TimeoutError' });
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['fetch', 'body', 'backoff'] as const)('preserves external abort during %s without exposing its reason', async phase => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const res = phase === 'backoff' ? new Response('ignored', { status: 503, headers: { 'retry-after': '10' } }) : response();
  if (phase === 'body') vi.spyOn(res, 'json').mockImplementation(() => hung());
  const fetchImpl = vi.fn(() => phase === 'fetch' ? hung<Response>() : Promise.resolve(res));
  let error: Error | undefined;
  void createGeminiClient({ apiKey: 'test-placeholder', fetchImpl })
    .ground('prompt', { signal: controller.signal }).catch(value => { error = value; });
  await vi.advanceTimersByTimeAsync(10);
  controller.abort(new Error('private abort detail'));
  await vi.advanceTimersByTimeAsync(0);
  expect(error).toMatchObject({ name: 'AbortError', message: 'aborted' });
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('does not dispatch, count or expose the reason of an already aborted call', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  controller.abort(Object.assign(new Error('private abort/credential detail'), { status: 503 }));
  const fetchImpl = vi.fn(); const onCall = vi.fn();
  await expect(createGeminiClient({ apiKey: 'test-placeholder', fetchImpl, onCall })
    .ground('prompt', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError', message: 'aborted' });
  expect(fetchImpl).not.toHaveBeenCalled(); expect(onCall).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([400, 401, 403, 429, 500, 503, 599])('preserves safe HTTP status %s on sanitized errors for callers', async status => {
  vi.useFakeTimers();
  const privateError = Object.assign(new Error('private transport/credential detail'), {
    status, retryAfterMs: 90000, privateMetadata: 'private detail',
  });
  const fetchImpl = vi.fn().mockRejectedValue(privateError);
  const result = createGeminiClient({ apiKey: 'test-placeholder', fetchImpl }).ground('prompt').catch(error => error);
  await vi.advanceTimersByTimeAsync(90000);
  const error = await result;
  expect(error).toMatchObject({ status, message: `Gemini ${status}: request failed.` });
  expect(error).not.toBe(privateError);
  expect(error.cause).toBeUndefined();
  expect(error.privateMetadata).toBeUndefined();
  expect(error.retryAfterMs).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([undefined, '503', 399, 600, 503.5, NaN, Infinity])('does not copy invalid status %s or raw details', async status => {
  vi.useFakeTimers();
  const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error('private detail'), { status, retryAfterMs: 90000 }));
  const result = createGeminiClient({ apiKey: 'test-placeholder', fetchImpl }).ground('prompt').catch(error => error);
  await vi.advanceTimersByTimeAsync(90000);
  const error = await result;
  expect(error.message).toBe('Gemini request failed.');
  expect(error.status).toBeUndefined();
  expect(error.cause).toBeUndefined();
});

it('cleans the deadline and external listener after success', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, 'addEventListener');
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  let signal!: AbortSignal;
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => { signal = init!.signal!; return response(); });
  expect((await createGeminiClient({ apiKey: 'test-placeholder', fetchImpl })
    .ground('prompt', { signal: controller.signal })).text).toBe('answer');
  expect(add).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
  expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(DEADLINE);
  controller.abort();
  expect(signal.aborted).toBe(false);
});

it('shares the deadline across outbound retries and counts each dispatch', async () => {
  vi.useFakeTimers();
  const onCall = vi.fn();
  const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('ignored', {
    status: 503, headers: { 'retry-after': '90' },
  })).mockImplementation(() => hung<Response>());
  let error: Error | undefined;
  void createGeminiClient({ apiKey: 'test-placeholder', fetchImpl, onCall }).ground('prompt').catch(value => { error = value; });
  await vi.advanceTimersByTimeAsync(90000);
  // The primary's 45s retry budget declines the 90s Retry-After wait and hands
  // off to the ladder; the first fallback is inside its own retry backoff now.
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(onCall).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(30000);
  expect(error).toMatchObject({ name: 'TimeoutError' });
  expect(vi.getTimerCount()).toBe(0);
});

it('shares the deadline across structured-output repair attempts', async () => {
  vi.useFakeTimers();
  const fetchImpl = vi.fn().mockImplementationOnce(async () => {
    await new Promise(resolve => setTimeout(resolve, 90000)); return response('{}');
  }).mockImplementation(() => hung<Response>());
  let error: Error | undefined;
  void createGeminiClient({ apiKey: 'test-placeholder', fetchImpl })
    .structure('prompt', z.object({ required: z.string() })).catch(value => { error = value; });
  await vi.advanceTimersByTimeAsync(DEADLINE);
  expect(error).toMatchObject({ name: 'TimeoutError' });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it('cleans timers and listeners after a failed call', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, 'addEventListener');
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const fetchImpl = vi.fn().mockRejectedValue(new Error('private detail'));
  await expect(createGeminiClient({ apiKey: 'test-placeholder', fetchImpl })
    .ground('prompt', { signal: controller.signal })).rejects.toThrow('Gemini request failed.');
  expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not retry a transport that completes after the deadline', async () => {
  vi.useFakeTimers();
  let finish!: (value: Response) => void;
  const fetchImpl = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  const onCall = vi.fn();
  let error: Error | undefined;
  void createGeminiClient({ apiKey: 'test-placeholder', fetchImpl, onCall }).ground('prompt').catch(value => { error = value; });
  await vi.advanceTimersByTimeAsync(DEADLINE);
  expect(error).toMatchObject({ name: 'TimeoutError' });
  finish(new Response('ignored', { status: 503 }));
  await vi.advanceTimersByTimeAsync(DEADLINE);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(onCall).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('counts each request in a successful retry and leaves no deadline timer', async () => {
  vi.useFakeTimers();
  const onCall = vi.fn();
  const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('ignored', {
    status: 429, headers: { 'retry-after': '1' },
  })).mockResolvedValueOnce(response());
  const result = createGeminiClient({ apiKey: 'test-placeholder', fetchImpl, onCall }).ground('prompt');
  await vi.advanceTimersByTimeAsync(1000);
  expect((await result).text).toBe('answer');
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(onCall.mock.calls).toEqual([
    [{ model: 'gemini-3.7-flash', kind: 'ground' }],
    [{ model: 'gemini-3.7-flash', kind: 'ground' }],
  ]);
  expect(vi.getTimerCount()).toBe(0);
});

it('includes queued rate-limit pacing in the deadline without counting unsent requests', async () => {
  vi.useFakeTimers();
  const onCall = vi.fn(); const fetchImpl = vi.fn(async () => response());
  const client = createGeminiClient({ apiKey: 'test-placeholder', groundedRpm: 1, fetchImpl, onCall });
  await client.ground('first');
  const second = client.ground('second');
  let thirdError: Error | undefined;
  void client.ground('third').catch(error => { thirdError = error; });
  await vi.advanceTimersByTimeAsync(DEADLINE);
  expect((await second).text).toBe('answer');
  expect(thirdError).toMatchObject({ name: 'TimeoutError' });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(onCall).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['transport', 'provider'] as const)('does not expose %s error details', async kind => {
  const detail = 'private provider/credential detail';
  const fetchImpl = vi.fn().mockImplementation(() => kind === 'transport'
    ? Promise.reject(new Error(detail)) : Promise.resolve(new Response(detail, { status: 400 })));
  await expect(createGeminiClient({ apiKey: 'test-placeholder', fetchImpl }).ground('prompt'))
    .rejects.toThrow(kind === 'provider' ? 'Gemini 400: request failed.' : 'Gemini request failed.');
});

// The 2026-10-08 incident: gemini-3.7-flash + google_search answered a metrics
// hunt in 235s while gemini-2.5-flash answered the same question in 2.7s.
// Every call pinned to the sick line burned the 120s deadline and the run
// degraded into timeouts and "nothing met the sourcing bar".
describe('grounded model-line fallback', () => {
  const modelOf = (call: unknown[]) => String(call[0]).match(/models\/([^:]+):/)![1];

  it('falls back to a healthy line when the primary fails, then prefers it', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (modelOf([url]) === 'gemini-3.7-flash') return new Response('busy', { status: 503 });
      return response('fallback-answer');
    });
    const client = createGeminiClient({ apiKey: 'test-placeholder', fetchImpl });
    const settled = client.ground('prompt');
    await vi.advanceTimersByTimeAsync(20000);
    expect((await settled).text).toBe('fallback-answer');
    const models = fetchImpl.mock.calls.map(modelOf);
    // The primary gets its own bounded retry loop (1 + 4 retries), then the ladder.
    expect(models.filter(m => m === 'gemini-3.7-flash')).toHaveLength(5);
    expect(models.at(-1)).toBe('gemini-flash-latest');
    expect(client.metrics?.()).toMatchObject({ fallbacks: 1 });
    // While the primary is sick, the next call asks the healthy line first.
    await client.ground('second');
    expect(modelOf(fetchImpl.mock.calls.at(-1)!)).toBe('gemini-flash-latest');
  });

  it('routes around a hung primary line via the per-attempt timeout', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (modelOf([url]) === 'gemini-3.7-flash') return hung<Response>();
      return response('quick-answer');
    });
    const client = createGeminiClient({ apiKey: 'test-placeholder', fetchImpl,
      groundedAttemptTimeoutMs: 120, groundedAttemptBudgetMs: 150 });
    const result = await client.ground('prompt');
    expect(result.text).toBe('quick-answer');
    const models = fetchImpl.mock.calls.map(modelOf);
    expect(models[0]).toBe('gemini-3.7-flash');
    expect(models.at(-1)).toBe('gemini-flash-latest');
  });

  it('does not fall back when the request itself is blocked', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })));
    const client = createGeminiClient({ apiKey: 'test-placeholder', fetchImpl });
    await expect(client.ground('prompt')).rejects.toThrow('Gemini blocked this research request.');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(client.metrics?.()).toMatchObject({ fallbacks: 0 });
  });

  it('does not fall back when the network itself is down', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('PRIVATE NETWORK DETAIL'); });
    const client = createGeminiClient({ apiKey: 'test-placeholder', fetchImpl });
    await expect(client.ground('prompt')).rejects.toThrow('Could not reach Gemini. Check your connection and try again.');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
