import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createHttpSearchConnector } from './http-search';
import { createOpenAiCompatibleModel } from './openai-compatible';
import { fetchProviderJson } from './provider-http';
import { ResearchProviderError } from './types';
import { createResearchUsageMeter } from './usage-meter';

describe('provider HTTP boundary', () => {
  it('retries transient failures without exposing response bodies', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('private upstream detail', {
          status: 503,
          headers: { 'retry-after': '0' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await expect(
      fetchProviderJson({ provider: 'test', url: 'https://provider.example', fetchImpl }),
    ).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry authentication failures', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('secret detail', { status: 401 }));
    const error = await fetchProviderJson({
      provider: 'test',
      url: 'https://provider.example',
      fetchImpl,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ResearchProviderError);
    expect(error).toMatchObject({ code: 'AUTH', provider: 'test', retryable: false });
    expect((error as Error).message).not.toContain('secret detail');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('distinguishes exhausted provider credit from malformed responses', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('payment detail', { status: 402 }));

    await expect(
      fetchProviderJson({ provider: 'test', url: 'https://provider.example', fetchImpl }),
    ).rejects.toMatchObject({ code: 'QUOTA', provider: 'test', retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('honors caller cancellation before sending a request', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('cancelled', 'AbortError'));
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      fetchProviderJson({
        provider: 'test',
        url: 'https://provider.example',
        fetchImpl,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('charges every search retry and blocks an over-budget retry before fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('', { status: 503, headers: { 'retry-after': '0' } }),
    );
    const meter = createResearchUsageMeter({
      maxRequests: 1,
      maxInputTokens: 1,
      maxOutputTokens: 1,
    });

    await expect(
      fetchProviderJson({
        provider: 'test',
        url: 'https://provider.example',
        fetchImpl,
        usageMeter: meter,
      }),
    ).rejects.toThrow(/request limit/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('provider adapters', () => {
  it('normalizes parsed HTTP search results', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ items: [{ link: 'https://example.com/page#part', name: ' Example ' }] }),
          { status: 200 },
        ),
      );
    const connector = createHttpSearchConnector({
      id: 'search-test',
      request: (query, limit) => ({
        url: `https://search.example?q=${encodeURIComponent(query)}&limit=${limit}`,
      }),
      parse: (body) => {
        const record = body as { items: Array<{ link: string; name: string }> };
        return record.items.map((item) => ({
          url: item.link,
          title: item.name,
          snippet: ' result ',
        }));
      },
      fetchImpl,
    });

    await expect(connector.search('frontier labs', { limit: 5 })).resolves.toEqual([
      {
        url: 'https://example.com/page',
        title: 'Example',
        snippet: 'result',
        publishedAt: null,
      },
    ]);
  });

  it('uses an OpenAI-compatible endpoint for validated structured output', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '```json\n{"answer":"yes"}\n```' } }] }),
          { status: 200 },
        ),
      );
    const model = createOpenAiCompatibleModel({
      baseUrl: 'https://models.example/v1/',
      apiKey: 'test-key',
      model: 'test-model',
      jsonMode: true,
      fetchImpl,
    });

    await expect(
      model.structure('Return an answer.', z.object({ answer: z.string() }), {
        system: 'Use JSON.',
      }),
    ).resolves.toEqual({ answer: 'yes' });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://models.example/v1/chat/completions');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'test-model',
      response_format: { type: 'json_object' },
    });
  });

  it('caps and reconciles OpenAI-compatible model usage through the shared meter', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"answer":"yes"}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
        { status: 200 },
      ),
    );
    const meter = createResearchUsageMeter({
      maxRequests: 1,
      maxInputTokens: 10_000,
      maxOutputTokens: 6,
    });
    const model = createOpenAiCompatibleModel({
      baseUrl: 'https://models.example/v1',
      model: 'test-model',
      fetchImpl,
    });

    await model.structure('Return an answer.', z.object({ answer: z.string() }), {
      usageMeter: meter,
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      max_tokens?: number;
    };
    expect(body.max_tokens).toBe(6);
    expect(meter.snapshot()).toEqual({
      requests: 1,
      inputTokens: 10,
      outputTokens: 2,
      complete: true,
    });
  });
});
