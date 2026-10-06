import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createGeminiClient } from './gemini';

const DEADLINE = 120_000;
const response = (text = 'answer') => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text }] } }],
}), { status: 200 });
const hung = <T>() => new Promise<T>(() => undefined);

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('bounds a hung fetch that ignores abort at the default deadline', async () => {
  vi.useFakeTimers();
  let signal!: AbortSignal;
  const fetchImpl = vi.fn((_url: unknown, init?: RequestInit) => {
    signal = init!.signal!; return hung<Response>();
  });
  const client = createGeminiClient({ apiKey: 'test-placeholder', fetchImpl });
  let settled = false;
  const result = client.ground('prompt').catch(error => { settled = true; return error; });
  await vi.advanceTimersByTimeAsync(DEADLINE - 1);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(settled).toBe(true);
  expect(await result).toMatchObject({ name: 'TimeoutError', message: 'Gemini request timed out after 120 seconds.' });
  expect(signal.aborted).toBe(true);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
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
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(onCall).toHaveBeenCalledTimes(1);
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
