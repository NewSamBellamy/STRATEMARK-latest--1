import { describe, expect, it, vi } from 'vitest';
import type { ZodType, ZodTypeDef } from 'zod';
import { createResearchClient } from './research-client';
import { GeminiRepository } from './repository';
import {
  ResearchProviderError,
  type IntelligenceModel,
  type LlmClient,
  type SearchConnector,
  type UsageMeter,
} from './types';
import { createResearchUsageMeter } from './usage-meter';

function queuedModel(
  outputs: unknown[],
): IntelligenceModel & { structureSpy: ReturnType<typeof vi.fn> } {
  const structureSpy = vi.fn();
  return {
    id: 'model-test',
    structureSpy,
    async structure<T>(
      _prompt: string,
      schema: ZodType<T, ZodTypeDef, unknown>,
      opts?: { usageMeter?: UsageMeter },
    ): Promise<T> {
      structureSpy(_prompt, schema, opts);
      const value = outputs.shift();
      return schema.parse(value);
    },
  };
}

describe('research client composition', () => {
  it('rejects an intelligence model with no research capability', () => {
    expect(() => createResearchClient({ model: queuedModel([]) })).toThrowError(
      expect.objectContaining({ code: 'CONFIG' }),
    );
  });

  it('uses native research when no external connector is selected', async () => {
    const model = queuedModel([]);
    const client = createResearchClient({
      model,
      nativeResearch: {
        id: 'google-search',
        ground: vi.fn(async () => ({
          text: ' Native result ',
          queries: [' alpha ', 'alpha'],
          citations: [{ title: 'Source', url: 'https://example.com/source#top' }],
        })),
      },
    });

    await expect(client.ground('Research alpha')).resolves.toMatchObject({
      text: 'Native result',
      queries: ['alpha'],
      citations: [{ title: 'Source', url: 'https://example.com/source' }],
    });
    expect(model.structureSpy).not.toHaveBeenCalled();
  });

  it('plans, searches, and synthesizes using only known evidence IDs', async () => {
    const model = queuedModel([
      { queries: ['alpha funding 2026', 'alpha products 2026'] },
      { text: 'Alpha has a sourced product update.', sourceIds: ['S2', 'S1'] },
    ]);
    const warnings: unknown[] = [];
    const first: SearchConnector = {
      id: 'first',
      search: vi.fn(async (query) => [
        {
          url: `https://first.example/${encodeURIComponent(query)}`,
          title: `First ${query}`,
          snippet: 'Evidence from the first connector.',
        },
      ]),
    };
    const second: SearchConnector = {
      id: 'second',
      search: vi.fn(async (query) => {
        if (query.includes('products')) {
          throw new ResearchProviderError('rate limited', {
            code: 'RATE_LIMIT',
            provider: 'second',
            retryable: true,
          });
        }
        return [
          {
            url: 'https://second.example/evidence',
            title: 'Second source',
            snippet: 'Independent evidence.',
          },
        ];
      }),
    };
    const client = createResearchClient({
      model,
      search: [first, second],
      onWarning: (warning) => warnings.push(warning),
    });

    const result = await client.ground('Research Alpha');
    expect(result.text).toBe('Alpha has a sourced product update.');
    expect(result.queries).toEqual(['alpha funding 2026', 'alpha products 2026']);
    expect(result.sources).toHaveLength(3);
    expect(result.citations.map((citation) => citation.url)).toEqual([
      'https://second.example/evidence',
      'https://first.example/alpha%20funding%202026',
    ]);
    expect(warnings).toEqual([
      { provider: 'second', query: 'alpha products 2026', code: 'RATE_LIMIT' },
    ]);
  });

  it('propagates one action meter through planning, searches, and synthesis', async () => {
    const meter = createResearchUsageMeter({
      maxRequests: 10,
      maxInputTokens: 100_000,
      maxOutputTokens: 10_000,
    });
    const model = queuedModel([
      { queries: ['alpha'] },
      { text: 'Supported.', sourceIds: ['S1'] },
    ]);
    const search = vi.fn(async () => [
      { url: 'https://example.com/alpha', title: 'Alpha', snippet: 'Supported fact.' },
    ]);
    const client = createResearchClient({
      model,
      search: [{ id: 'search', search }],
    });

    await client.ground('alpha', { usageMeter: meter });

    expect(model.structureSpy).toHaveBeenCalledTimes(2);
    expect(model.structureSpy.mock.calls.every((call) => call[2]?.usageMeter === meter)).toBe(true);
    expect(search).toHaveBeenCalledWith('alpha', { limit: 5, signal: undefined, usageMeter: meter });
  });

  it('repairs invented source IDs once and never accepts them as citations', async () => {
    const model = queuedModel([
      { queries: ['alpha'] },
      { text: 'Invented', sourceIds: ['S99'] },
      { text: 'Corrected', sourceIds: ['S1'] },
    ]);
    const client = createResearchClient({
      model,
      search: [
        {
          id: 'search',
          search: async () => [
            { url: 'https://example.com/alpha', title: 'Alpha', snippet: 'Supported fact.' },
          ],
        },
      ],
    });

    await expect(client.ground('alpha')).resolves.toMatchObject({
      text: 'Corrected',
      citations: [{ title: 'Alpha', url: 'https://example.com/alpha' }],
    });
    expect(model.structureSpy).toHaveBeenCalledTimes(3);
  });

  it('fails closed when connectors return no usable evidence', async () => {
    const client = createResearchClient({
      model: queuedModel([{ queries: ['alpha'] }]),
      search: [{ id: 'empty', search: async () => [] }],
    });

    await expect(client.ground('alpha')).rejects.toMatchObject({ code: 'NO_EVIDENCE' });
  });

  it('does not retry or relabel terminal model authentication errors', async () => {
    const structure = vi.fn(async () => {
      throw new ResearchProviderError('not authorized', {
        code: 'AUTH',
        provider: 'model-test',
      });
    });
    const client = createResearchClient({
      model: { id: 'model-test', structure },
      search: [{ id: 'search', search: async () => [] }],
    });

    await expect(client.ground('alpha')).rejects.toMatchObject({ code: 'AUTH' });
    expect(structure).toHaveBeenCalledTimes(1);
  });

  it('allows repository injection without a Gemini key', () => {
    const client: LlmClient = {
      ground: async () => ({ text: 'grounded', citations: [], queries: [] }),
      structure: async (_prompt, schema) => schema.parse({}),
    };
    expect(() => new GeminiRepository({ client })).not.toThrow();
  });
});
