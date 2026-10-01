import type { ZodType, ZodTypeDef } from 'zod';
import { fetchProviderJson } from './provider-http';
import { normalizeHttpUrl } from './sources';
import { ResearchProviderError, type CallOptions, type IntelligenceModel } from './types';
import { extractJson } from './util';
import { inputTokenUpperBound } from './usage-meter';

export interface OpenAiCompatibleConfig {
  /** API root; `/chat/completions` is appended. */
  baseUrl: string;
  apiKey?: string;
  model: string;
  structureModel?: string;
  /** Opt in only when the endpoint supports OpenAI JSON-object mode. */
  jsonMode?: boolean;
  fetchImpl?: typeof fetch;
}

interface ChatCompletionsResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

const MAX_OUTPUT_TOKENS_PER_CALL = 8_192;

export function createOpenAiCompatibleModel(config: OpenAiCompatibleConfig): IntelligenceModel {
  const model = (config.structureModel ?? config.model).trim();
  if (!model) {
    throw new ResearchProviderError('OpenAI-compatible provider requires a model.', {
      code: 'CONFIG',
      provider: 'openai-compatible',
    });
  }

  let baseUrl: string;
  try {
    baseUrl = normalizeHttpUrl(config.baseUrl).replace(/\/$/, '');
  } catch {
    throw new ResearchProviderError('OpenAI-compatible provider has an invalid base URL.', {
      code: 'CONFIG',
      provider: 'openai-compatible',
    });
  }
  const provider = `openai-compatible:${model}`;

  return {
    id: provider,
    async structure<T>(
      prompt: string,
      schema: ZodType<T, ZodTypeDef, unknown>,
      opts?: CallOptions,
    ): Promise<T> {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const key = config.apiKey?.trim();
      if (key) headers.Authorization = `Bearer ${key}`;

      const body: Record<string, unknown> = {
        model,
        messages: [
          ...(opts?.system ? [{ role: 'system', content: opts.system }] : []),
          { role: 'user', content: prompt },
        ],
        temperature: 0,
      };
      if (config.jsonMode) body.response_format = { type: 'json_object' };

      const response = await fetchProviderJson<ChatCompletionsResponse>({
        provider,
        url: `${baseUrl}/chat/completions`,
        init: { method: 'POST', headers, body: JSON.stringify(body) },
        fetchImpl: config.fetchImpl,
        signal: opts?.signal,
        timeoutMs: 60_000,
        usageMeter: opts?.usageMeter,
        usage: {
          kind: 'model',
          estimatedInputTokens: inputTokenUpperBound(body),
          maxOutputTokens: MAX_OUTPUT_TOKENS_PER_CALL,
          bodyWithOutputLimit: (maxOutputTokens) =>
            JSON.stringify({ ...body, max_tokens: maxOutputTokens }),
          report: (value) =>
            typeof value.usage?.prompt_tokens === 'number' &&
            typeof value.usage?.completion_tokens === 'number'
              ? {
                  inputTokens: value.usage.prompt_tokens,
                  outputTokens: value.usage.completion_tokens,
                }
              : undefined,
        },
      });
      const content = response.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new ResearchProviderError(`${provider} returned no structured output.`, {
          code: 'BAD_RESPONSE',
          provider,
        });
      }
      try {
        return schema.parse(extractJson(content));
      } catch {
        throw new ResearchProviderError(`${provider} returned invalid structured output.`, {
          code: 'INVALID_OUTPUT',
          provider,
        });
      }
    },
  };
}
