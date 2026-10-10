import { describe, expect, it } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { CHAT_SYSTEM, NOT_IN_RESEARCH_PHRASE } from './prompts';
import { buildChatPrompt, buildDeckChatContext, formatMetricLine, formatConversation } from './chat-context';

const base = {
  id: 'm1', companyId: 'c1', source: null, methodNote: null, capturedAt: '2026-01-01T00:00:00.000Z',
} as const;
const metric = (o: Partial<CompanyMetric>): CompanyMetric => ({ ...base, metricType: 'arr', value: null, confidence: 'unknown', citations: [], ...o }) as CompanyMetric;

describe('chat context', () => {
  it('states sourced figures with confidence, as-of and source', () => {
    const line = formatMetricLine(metric({
      value: 120_000_000, confidence: 'estimated',
      citations: [{ title: 'reuters.com', url: 'https://reuters.com/a' }],
      reportedSupport: { asOf: '2025-03-01' } as CompanyMetric['reportedSupport'],
    }));
    expect(line).toContain('$120M');
    expect(line).toContain('[estimated]');
    expect(line).toContain('as of 2025-03-01');
    expect(line).toContain('https://reuters.com/a');
  });

  it('never prints a number for unknown or unsourced figures', () => {
    expect(formatMetricLine(metric({}))).toMatch(/Unknown/);
    // a value with no usable citation is downgraded to Unknown, not shown
    const line = formatMetricLine(metric({ value: 5e9, confidence: 'verified', citations: [] }));
    expect(line).toMatch(/Unknown/);
    expect(line).not.toContain('5B');
  });

  it('keeps the deck context within budget and says what it omitted', () => {
    const companies = Array.from({ length: 30 }, (_, i) => ({ name: `Co${i}`, metrics: [] }));
    const ctx = buildDeckChatContext({ marketName: 'eVTOL', companies, maxChars: 600 });
    expect(ctx.length).toBeLessThan(800);
    expect(ctx).toContain('MARKET: eVTOL');
    expect(ctx).toMatch(/\d+ more companies omitted/);
  });

  it('sends the whole multi-turn history and puts the new question last', () => {
    const prompt = buildChatPrompt({
      dataBlocks: ['DECK DATA'],
      history: [
        { role: 'user', text: 'Who leads?' },
        { role: 'assistant', text: 'Acme leads.' },
      ],
      question: 'And their ARR?',
    });
    expect(prompt).toContain('USER: Who leads?');
    expect(prompt).toContain('ASSISTANT: Acme leads.');
    expect(prompt.trim().endsWith('And their ARR?')).toBe(true);
    expect(formatConversation(Array.from({ length: 30 }, (_, i) => ({ role: 'user' as const, text: `t${i}` })), { maxTurns: 3 })).not.toContain('t0');
  });

  it('system prompt forbids inventing and requires the not-in-research answer', () => {
    expect(CHAT_SYSTEM).toContain(NOT_IN_RESEARCH_PHRASE);
    expect(CHAT_SYSTEM).toMatch(/NEVER invent or estimate a figure/);
    expect(CHAT_SYSTEM).toMatch(/NEVER answer from prior or training knowledge/);
    expect(CHAT_SYSTEM).toMatch(/Follow-ups:/);
  });
});
