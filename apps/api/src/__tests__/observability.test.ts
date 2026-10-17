import { describe, it, expect, vi } from 'vitest';
import type { AdkTraceEvent } from '@mi/contracts';
import {
  parseTraceContext,
  formatAdkEventForGcp,
  AgentObservabilityLogger,
  generateTraceId,
  generateSpanId,
} from '../lib/observability';

describe('Observability & Google Cloud Trace Logging', () => {
  describe('parseTraceContext', () => {
    it('parses Google Cloud Trace header (TRACE_ID/SPAN_ID;o=1)', () => {
      const parsed = parseTraceContext('105445aa7843bc8bf206b12000100000/123456789;o=1');
      expect(parsed).not.toBeNull();
      expect(parsed?.traceId).toBe('105445aa7843bc8bf206b12000100000');
      expect(parsed?.traceSampled).toBe(true);
      expect(parsed?.spanId).toBe('00000000075bcd15'); // 123456789 in hex padded to 16
    });

    it('parses Google Cloud Trace header without sampled bit', () => {
      const parsed = parseTraceContext('abcdef1234567890abcdef1234567890/1');
      expect(parsed).not.toBeNull();
      expect(parsed?.traceId).toBe('abcdef1234567890abcdef1234567890');
      expect(parsed?.traceSampled).toBe(false);
    });

    it('parses W3C traceparent header', () => {
      const parsed = parseTraceContext('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
      expect(parsed).not.toBeNull();
      expect(parsed?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(parsed?.spanId).toBe('00f067aa0ba902b7');
      expect(parsed?.traceSampled).toBe(true);
    });

    it('returns null for null, empty or invalid strings', () => {
      expect(parseTraceContext(null)).toBeNull();
      expect(parseTraceContext(undefined)).toBeNull();
      expect(parseTraceContext('')).toBeNull();
      expect(parseTraceContext('not-a-trace-context')).toBeNull();
    });
  });

  describe('ID Generators', () => {
    it('generates 32-character hex trace ID', () => {
      const traceId = generateTraceId();
      expect(traceId).toHaveLength(32);
      expect(/^[0-9a-f]{32}$/.test(traceId)).toBe(true);
    });

    it('generates 16-character hex span ID', () => {
      const spanId = generateSpanId();
      expect(spanId).toHaveLength(16);
      expect(/^[0-9a-f]{16}$/.test(spanId)).toBe(true);
    });
  });

  describe('formatAdkEventForGcp', () => {
    const mockEvent: AdkTraceEvent = {
      id: 'evt-1',
      invocationId: 'inv-1234567890abcdef',
      spanId: 'span-001',
      parentSpanId: null,
      branch: 'root.discovery.vector_direct',
      author: 'DiscoveryAgent',
      agentKind: 'llm',
      phase: 'agent_end',
      severity: 'info',
      message: 'Completed market topology discovery with 12 candidates',
      durationMs: 1450,
      timestamp: Date.now(),
      stateDelta: null,
      error: null,
      escalate: false,
      attributes: {
        candidate_count: 12,
        citations_count: 35,
      },
    };

    it('formats ADK event into GCP structured log format with trace correlation', () => {
      const formatted = formatAdkEventForGcp(mockEvent, {
        projectId: 'stratemark-agentic',
        deckId: 'deck-ai-infra',
        userId: 'user-pro-123',
        traceContext: {
          traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
          spanId: '00f067aa0ba902b7',
          traceSampled: true,
        },
      });

      expect(formatted.severity).toBe('NOTICE');
      expect(formatted['logging.googleapis.com/trace']).toBe(
        'projects/stratemark-agentic/traces/4bf92f3577b34da6a3ce929d0e0e4736'
      );
      expect(formatted['logging.googleapis.com/spanId']).toBe('00f067aa0ba902b7');
      expect(formatted['logging.googleapis.com/trace_sampled']).toBe(true);
      expect(formatted['logging.googleapis.com/labels']?.agent_name).toBe('DiscoveryAgent');
      expect(formatted['logging.googleapis.com/labels']?.deck_id).toBe('deck-ai-infra');
      expect(formatted.agent?.name).toBe('DiscoveryAgent');
      expect(formatted.agent?.durationMs).toBe(1450);
      expect(formatted.deckId).toBe('deck-ai-infra');
      expect(formatted.userId).toBe('user-pro-123');
      expect(formatted.message).toContain('[Agent: DiscoveryAgent] [Phase: agent_end]');
      expect(formatted.message).toContain('(1450ms)');
    });

    it('maps error phases to ERROR severity in GCP log', () => {
      const errorEvent: AdkTraceEvent = {
        ...mockEvent,
        phase: 'error',
        severity: 'error',
        error: { name: 'RateLimitError', message: 'Quota exhausted', retryable: true },
      };

      const formatted = formatAdkEventForGcp(errorEvent, { projectId: 'stratemark-agentic' });
      expect(formatted.severity).toBe('ERROR');
      expect(formatted.agent?.error).toBeDefined();
    });
  });

  describe('AgentObservabilityLogger', () => {
    it('emits formatted JSON string to console.log', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new AgentObservabilityLogger({
        projectId: 'stratemark-agentic',
        deckId: 'deck-123',
        userId: 'user-456',
      });

      logger.logInfo('Agent worker started', { workerId: 'worker-1' });

      expect(spy).toHaveBeenCalled();
      const rawCall = spy.mock.calls[0]?.[0];
      const parsed = JSON.parse(rawCall as string);

      expect(parsed.severity).toBe('INFO');
      expect(parsed.message).toBe('Agent worker started');
      expect(parsed.workerId).toBe('worker-1');
      expect(parsed.deckId).toBe('deck-123');
      expect(parsed.userId).toBe('user-456');
      expect(parsed['logging.googleapis.com/trace']).toMatch(/^projects\/stratemark-agentic\/traces\/[a-f0-9]{32}$/);

      spy.mockRestore();
    });
  });
});
