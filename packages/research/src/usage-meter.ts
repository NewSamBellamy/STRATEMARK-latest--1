import type {
  UsageAttemptGrant,
  UsageAttemptRequest,
  UsageMeter,
  UsageReport,
  UsageSnapshot,
} from './types';

export interface ResearchUsageLimits {
  maxRequests: number;
  maxInputTokens: number;
  maxOutputTokens: number;
}

type LimitName = 'request' | 'input token' | 'output token';

export class ResearchUsageLimitError extends Error {
  readonly code = 'BUDGET_EXCEEDED';

  constructor(readonly limit: LimitName) {
    super(`Research ${limit} limit would be exceeded before provider dispatch.`);
    this.name = 'ResearchUsageLimitError';
  }
}

interface Attempt {
  reservedInput: number;
  reservedOutput: number;
  settled: boolean;
  reported: boolean;
}

function count(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a count.`);
  return value;
}

/**
 * Conservative UTF-8 upper bound for provider input tokenization. JSON syntax,
 * system instructions and schemas are included by callers before dispatch.
 */
export function inputTokenUpperBound(value: unknown): number {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return new TextEncoder().encode(serialized ?? '').byteLength + 1_024;
}

export function createResearchUsageMeter(limits: ResearchUsageLimits): UsageMeter {
  const ceiling = {
    maxRequests: count(limits.maxRequests, 'maxRequests'),
    maxInputTokens: count(limits.maxInputTokens, 'maxInputTokens'),
    maxOutputTokens: count(limits.maxOutputTokens, 'maxOutputTokens'),
  };
  const attempts = new Map<number, Attempt>();
  let nextId = 1;
  let requests = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  return {
    beginAttempt(request: UsageAttemptRequest): UsageAttemptGrant {
      const estimatedInput = count(request.estimatedInputTokens, 'estimatedInputTokens');
      const requestedOutput = count(request.maxOutputTokens, 'maxOutputTokens');
      if (requests >= ceiling.maxRequests) throw new ResearchUsageLimitError('request');
      if (inputTokens + estimatedInput > ceiling.maxInputTokens) {
        throw new ResearchUsageLimitError('input token');
      }
      const remainingOutput = ceiling.maxOutputTokens - outputTokens;
      if (request.kind === 'model' && remainingOutput <= 0) {
        throw new ResearchUsageLimitError('output token');
      }
      const grantedOutput =
        request.kind === 'model' ? Math.min(requestedOutput, remainingOutput) : 0;
      const id = nextId++;
      attempts.set(id, {
        reservedInput: estimatedInput,
        reservedOutput: grantedOutput,
        settled: false,
        reported: false,
      });
      requests += 1;
      inputTokens += estimatedInput;
      outputTokens += grantedOutput;
      return { id, maxOutputTokens: grantedOutput };
    },

    settleAttempt(attemptId: number, usage?: UsageReport): void {
      const attempt = attempts.get(attemptId);
      if (!attempt || attempt.settled) throw new TypeError('Unknown or settled usage attempt.');
      attempt.settled = true;
      if (!usage) return;
      const actualInput = count(usage.inputTokens, 'inputTokens');
      const actualOutput = count(usage.outputTokens, 'outputTokens');
      const nextInput = inputTokens - attempt.reservedInput + actualInput;
      const nextOutput = outputTokens - attempt.reservedOutput + actualOutput;
      if (nextInput > ceiling.maxInputTokens) throw new ResearchUsageLimitError('input token');
      if (nextOutput > ceiling.maxOutputTokens || actualOutput > attempt.reservedOutput) {
        throw new ResearchUsageLimitError('output token');
      }
      inputTokens = nextInput;
      outputTokens = nextOutput;
      attempt.reported = true;
    },

    snapshot(): UsageSnapshot {
      const values = [...attempts.values()];
      return {
        requests,
        inputTokens,
        outputTokens,
        complete:
          values.length > 0 && values.every((attempt) => attempt.settled && attempt.reported),
      };
    },
  };
}
