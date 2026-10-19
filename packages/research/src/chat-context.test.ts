import { describe, expect, it } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { CHAT_SYSTEM, NOT_IN_RESEARCH_PHRASE } from './prompts';
import { buildChatPrompt, buildDeckChatContext, formatDeckRankings, formatMetricLine, formatConversation } from './chat-context';

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

  it('ranks every statable figure per metric, highest first, and counts the gaps', () => {
    const sourced = (value: number, type: CompanyMetric['metricType'] = 'valuation') =>
      metric({ metricType: type, value, confidence: 'verified', citations: [{ title: 'r', url: 'https://r.com/a' }] });
    const text = formatDeckRankings([
      { name: 'FloQast', metrics: [sourced(1.6e9)] },
      { name: 'Plaid', metrics: [sourced(8e9)] },
      { name: 'Ghost', metrics: [metric({ metricType: 'valuation', value: 9e12, confidence: 'verified', citations: [] })] },
      { name: 'Human', metrics: [metric({ metricType: 'valuation', value: 2e9, confidence: 'user_verified', citations: [] })] },
    ]);
    expect(text).toBe('Valuation (highest first): Plaid $8B [verified]; Human $2B [user_verified]; FloQast $1.6B [verified]; 1 company has no sourced figure');
    expect(formatDeckRankings([{ name: 'X', metrics: [] }])).toBe('No sourced figures in this deck yet.');
  });

  it('states a human-checked figure without a link instead of hiding it', () => {
    const line = formatMetricLine(metric({ metricType: 'employees', value: 37, confidence: 'user_verified', citations: [] }));
    expect(line).toContain('37');
    expect(line).toContain('human-checked');
  });

  it('keeps the deck context within budget and says what it omitted', () => {
    const companies = Array.from({ length: 30 }, (_, i) => ({ name: `Co${i}`, metrics: [] }));
    const ctx = buildDeckChatContext({ marketName: 'eVTOL', companies, maxChars: 600 });
    expect(ctx.length).toBeLessThan(800);
    expect(ctx).toContain('MARKET: eVTOL');
    expect(ctx).toMatch(/\d+ more companies omitted/);
  });

  it('names what a figure measures, as the card does: a public company\'s "arr" slot holds annual revenue', () => {
    const cite = [{ title: 'sec.gov', url: 'https://www.sec.gov/x' }];
    const revenue = metric({ value: 21_950_000_000, confidence: 'verified', citations: cite,
      passageSupport: { definition: 'annual_revenue', asOf: '2026-06-30' } as CompanyMetric['passageSupport'] });
    const arr = metric({ value: 1_000_000_000, confidence: 'estimated', citations: cite,
      reportedSupport: { definition: 'arr', asOf: '2026-04-30' } as CompanyMetric['reportedSupport'] });
    expect(formatMetricLine(revenue)).toMatch(/^- Annual revenue: \$21\.95B \[verified\]/);
    expect(formatMetricLine(revenue)).not.toContain('ARR');
    expect(formatMetricLine(arr)).toMatch(/^- ARR: \$1B \[estimated\]/);
    // A figure with no stated definition keeps its slot name, as before.
    expect(formatMetricLine(metric({ value: 5e8, confidence: 'estimated', citations: cite }))).toMatch(/^- ARR: \$500M/);
  });

  it('ranks annual revenue and ARR separately, and counts gaps per slot, not per measurement', () => {
    const cite = [{ title: 'r', url: 'https://r.com/a' }];
    const text = formatDeckRankings([
      { name: 'ADP', metrics: [metric({ value: 21.95e9, confidence: 'verified', citations: cite, passageSupport: { definition: 'annual_revenue' } as CompanyMetric['passageSupport'] })] },
      { name: 'Rippling', metrics: [metric({ value: 1e9, confidence: 'estimated', citations: cite, reportedSupport: { definition: 'arr' } as CompanyMetric['reportedSupport'] })] },
      { name: 'Gusto', metrics: [metric({ value: 1e9, confidence: 'estimated', citations: cite, reportedSupport: { definition: 'annual_revenue' } as CompanyMetric['reportedSupport'] })] },
      { name: 'Ghost', metrics: [] },
    ]);
    const lines = text.split('\n');
    expect(lines).toContain('Annual revenue (highest first): ADP $21.95B [verified]; Gusto $1B [estimated]; 1 company has no sourced figure');
    expect(lines).toContain('ARR (highest first): Rippling $1B [estimated]; 1 company has no sourced figure');
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
