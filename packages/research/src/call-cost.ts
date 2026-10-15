/**
 * What one provider call cost, from the token counts Gemini reports back.
 *
 * The browser's usage meter (apps/web/src/lib/usage.ts) charges a flat guess per
 * call. That cannot say which part of a deck is expensive. This reads the real
 * `usageMetadata` of every response so a deck's cost is a measurement.
 *
 * Prices are the same deliberately HIGH list prices the API service budgets with
 * (services/stratemark-api/src/policy.ts, checked 2026-10-10): the highest price
 * in each model family, free allowances ignored. A deck's number here may be a
 * little above the invoice; it is never below it.
 */

/** Token counts as the provider reports them. Every field is optional on the wire. */
export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
}

/** USD per 1M tokens. */
export const PRICE_PER_M = {
  lite: { input: 0.30, output: 2.50 },
  flash: { input: 1.50, output: 7.50 },
  pro: { input: 4.00, output: 18.00 },
} as const;

/** Search grounding: $35 per 1,000 grounded prompts (2.5) or $14 per 1,000 queries (3.x); the higher applies. */
export const GROUNDED_PROMPT_USD = 0.035;
export const SEARCH_QUERY_USD = 0.014;

export function priceFamily(model: string): keyof typeof PRICE_PER_M {
  if (/lite/.test(model)) return 'lite';
  if (/flash/.test(model)) return 'flash';
  return 'pro'; // an unknown model is charged at the most expensive rate
}

/** The raw `usageMetadata` object of a Gemini response, read defensively. */
export function readUsage(meta: unknown): CallUsage | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const m = meta as Record<string, unknown>;
  const n = (key: string): number => (typeof m[key] === 'number' && Number.isFinite(m[key] as number) ? m[key] as number : 0);
  // Tool-use prompt tokens are the search results pasted back into the prompt; thinking tokens bill as output.
  const inputTokens = n('promptTokenCount') + n('toolUsePromptTokenCount');
  const outputTokens = n('candidatesTokenCount') + n('thoughtsTokenCount');
  return inputTokens + outputTokens > 0 ? { inputTokens, outputTokens } : undefined;
}

/** Estimated USD of one settled call. A call with no usage report costs only its search fee. */
export function callCostUsd(input: { model: string; grounded: boolean; usage?: CallUsage; searchQueries?: number }): number {
  const price = PRICE_PER_M[priceFamily(input.model)];
  const tokens = ((input.usage?.inputTokens ?? 0) * price.input + (input.usage?.outputTokens ?? 0) * price.output) / 1_000_000;
  const search = input.grounded ? Math.max(GROUNDED_PROMPT_USD, SEARCH_QUERY_USD * Math.max(1, input.searchQueries ?? 0)) : 0;
  return tokens + search;
}
