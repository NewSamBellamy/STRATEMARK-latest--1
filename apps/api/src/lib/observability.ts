import type { AdkTraceEvent } from '@mi/contracts';

export interface TraceContext {
  traceId: string;
  spanId: string;
  traceSampled?: boolean;
}

/**
 * Parse Google Cloud Trace context from request headers:
 * 1. `X-Cloud-Trace-Context`: `TRACE_ID/SPAN_ID;o=TRACE_TRUE`
 * 2. `traceparent` (W3C standard): `00-TRACE_ID-SPAN_ID-FLAGS`
 */
export function parseTraceContext(raw?: string | null): TraceContext | null {
  if (!raw || typeof raw !== 'string') return null;

  const trimmed = raw.trim();

  // W3C Trace Context: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
  const w3cMatch = trimmed.match(/^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/i);
  if (w3cMatch && w3cMatch[1] && w3cMatch[2]) {
    return {
      traceId: w3cMatch[1].toLowerCase(),
      spanId: w3cMatch[2].toLowerCase(),
      traceSampled: (parseInt(w3cMatch[3] || '0', 16) & 1) === 1,
    };
  }

  // Google Cloud Trace Header: TRACE_ID/SPAN_ID;o=TRACE_TRUE
  const cloudTraceMatch = trimmed.match(/^([a-f0-9]{32})(?:\/([0-9]+|[a-f0-9]+))?(?:;o=([01]))?/i);
  if (cloudTraceMatch && cloudTraceMatch[1]) {
    const traceId = cloudTraceMatch[1].toLowerCase();
    let spanId = cloudTraceMatch[2] || '0000000000000001';

    if (/^\d+$/.test(spanId)) {
      try {
        spanId = BigInt(spanId).toString(16).padStart(16, '0').slice(-16);
      } catch {
        spanId = spanId.padStart(16, '0').slice(-16);
      }
    } else {
      spanId = spanId.padStart(16, '0').slice(-16);
    }

    const traceSampled = cloudTraceMatch[3] === '1';
    return { traceId, spanId, traceSampled };
  }

  return null;
}

export function generateTraceId(): string {
  const chars = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function generateSpanId(): string {
  const chars = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export interface LoggerContext {
  projectId?: string;
  traceContext?: TraceContext | null;
  deckId?: string;
  userId?: string;
}

export interface GcpStructuredLog {
  severity: 'DEBUG' | 'INFO' | 'NOTICE' | 'WARNING' | 'ERROR' | 'CRITICAL';
  message: string;
  'logging.googleapis.com/trace'?: string;
  'logging.googleapis.com/spanId'?: string;
  'logging.googleapis.com/trace_sampled'?: boolean;
  'logging.googleapis.com/operation'?: {
    id: string;
    producer: string;
    first?: boolean;
    last?: boolean;
  };
  'logging.googleapis.com/labels'?: Record<string, string>;
  agent?: {
    name: string;
    kind: string;
    phase: string;
    branch?: string;
    durationMs?: number;
    delta?: unknown;
    error?: unknown;
  };
  deckId?: string;
  userId?: string;
  attributes?: Record<string, unknown>;
  timestamp?: string;
  [key: string]: unknown;
}

/**
 * Transforms an internal ADK Trace Event into a Google Cloud Observability
 * structured log format with trace correlation and indexable analytics fields.
 */
export function formatAdkEventForGcp(
  event: AdkTraceEvent,
  context: LoggerContext = {}
): GcpStructuredLog {
  const projectId =
    context.projectId ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    'stratemark-agentic';

  let traceId = context.traceContext?.traceId;
  if (!traceId && event.invocationId) {
    const hexOnly = event.invocationId.replace(/[^a-f0-9]/gi, '').toLowerCase();
    traceId = hexOnly.padEnd(32, '0').slice(0, 32);
  }
  if (!traceId) {
    traceId = generateTraceId();
  }

  const spanId = context.traceContext?.spanId || generateSpanId();

  let severity: GcpStructuredLog['severity'] = 'INFO';
  if (event.severity === 'error' || event.phase === 'error' || event.error) {
    severity = 'ERROR';
  } else if (event.severity === 'warn') {
    severity = 'WARNING';
  } else if (event.severity === 'debug') {
    severity = 'DEBUG';
  } else if (event.phase === 'agent_end' || event.phase === 'invocation_end') {
    severity = 'NOTICE';
  }

  const durationStr = typeof event.durationMs === 'number' ? ` (${event.durationMs}ms)` : '';
  const message = `[Agent: ${event.author}] [Phase: ${event.phase}] ${event.message}${durationStr}`;

  const labels: Record<string, string> = {
    agent_name: event.author,
    agent_kind: event.agentKind,
    phase: event.phase,
    branch: event.branch,
  };
  if (context.deckId) labels.deck_id = context.deckId;
  if (context.userId) labels.user_id = context.userId;

  const log: GcpStructuredLog = {
    severity,
    message,
    'logging.googleapis.com/trace': `projects/${projectId}/traces/${traceId}`,
    'logging.googleapis.com/spanId': spanId,
    'logging.googleapis.com/trace_sampled': true,
    'logging.googleapis.com/labels': labels,
    agent: {
      name: event.author,
      kind: event.agentKind,
      phase: event.phase,
      branch: event.branch,
      durationMs: event.durationMs ?? undefined,
      delta: event.stateDelta ?? undefined,
      error: event.error ?? undefined,
    },
    deckId: context.deckId,
    userId: context.userId,
    attributes: event.attributes,
    timestamp: new Date(event.timestamp).toISOString(),
  };

  if (event.invocationId) {
    log['logging.googleapis.com/operation'] = {
      id: event.invocationId,
      producer: 'stratemark-adk-engine',
      first: event.phase === 'invocation_start',
      last: event.phase === 'invocation_end',
    };
  }

  return log;
}

export class AgentObservabilityLogger {
  constructor(private context: LoggerContext = {}) {}

  logAdkTrace(event: AdkTraceEvent): void {
    const formatted = formatAdkEventForGcp(event, this.context);
    console.log(JSON.stringify(formatted));
  }

  logInfo(message: string, extra?: Record<string, unknown>): void {
    this.log('INFO', message, extra);
  }

  logNotice(message: string, extra?: Record<string, unknown>): void {
    this.log('NOTICE', message, extra);
  }

  logWarn(message: string, extra?: Record<string, unknown>): void {
    this.log('WARNING', message, extra);
  }

  logError(message: string, err?: unknown, extra?: Record<string, unknown>): void {
    const errObj =
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : err
          ? { message: String(err) }
          : undefined;
    this.log('ERROR', message, { ...extra, error: errObj });
  }

  private log(
    severity: GcpStructuredLog['severity'],
    message: string,
    extra?: Record<string, unknown>
  ): void {
    const projectId =
      this.context.projectId ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCP_PROJECT ||
      'stratemark-agentic';
    const traceId = this.context.traceContext?.traceId || generateTraceId();
    const spanId = this.context.traceContext?.spanId || generateSpanId();

    const labels: Record<string, string> = {};
    if (this.context.deckId) labels.deck_id = this.context.deckId;
    if (this.context.userId) labels.user_id = this.context.userId;

    const payload: GcpStructuredLog = {
      severity,
      message,
      'logging.googleapis.com/trace': `projects/${projectId}/traces/${traceId}`,
      'logging.googleapis.com/spanId': spanId,
      'logging.googleapis.com/trace_sampled': true,
      'logging.googleapis.com/labels': labels,
      deckId: this.context.deckId,
      userId: this.context.userId,
      timestamp: new Date().toISOString(),
      ...extra,
    };
    console.log(JSON.stringify(payload));
  }
}
