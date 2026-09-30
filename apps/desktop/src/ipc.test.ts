import { describe, it, expect } from 'vitest';
import {
  createMarketInputSchema,
  deckResearchBriefSchema,
  cardFilterSchema,
  deepDiveInputSchema,
  factCheckInputSchema,
  reportRequestSchema,
  expandFocusSchema,
  overrideMetricInputSchema,
  verifyMetricInputSchema,
  askResearchInputSchema,
  listResearchThreadsFilterSchema,
  refreshCadenceSchema,
  dashboardTabSchema,
} from './ipc-schemas.js';

describe('Desktop IPC Schemas & Payload Validation', () => {
  describe('createMarketInputSchema', () => {
    it('accepts valid market creation input', () => {
      const valid = {
        name: 'AI Code Editors',
        scopeDefinition: {
          vertical: 'Developer Tools',
          geography: 'Global',
          notes: 'Focused on AI coding assistants',
        },
        refreshCadence: 'daily',
      };
      const parsed = createMarketInputSchema.parse(valid);
      expect(parsed.name).toBe('AI Code Editors');
      expect(parsed.refreshCadence).toBe('daily');
    });

    it('rejects empty or malformed market creation input', () => {
      expect(() => createMarketInputSchema.parse({})).toThrow();
      expect(() =>
        createMarketInputSchema.parse({
          name: '',
          scopeDefinition: { vertical: 'DevTools', geography: null, notes: null },
          refreshCadence: 'daily',
        }),
      ).toThrow();
    });
  });

  describe('deckResearchBriefSchema', () => {
    it('accepts valid research briefs and defaults region to null', () => {
      const parsed = deckResearchBriefSchema.parse({ prompt: 'Autonomous Agent Frameworks' });
      expect(parsed.prompt).toBe('Autonomous Agent Frameworks');
      expect(parsed.region).toBeNull();
    });

    it('rejects empty prompt briefs', () => {
      expect(() => deckResearchBriefSchema.parse({ prompt: '' })).toThrow();
    });
  });

  describe('cardFilterSchema', () => {
    it('accepts valid card filters', () => {
      expect(cardFilterSchema.parse({ cardType: 'company', tier: 5 })).toEqual({
        cardType: 'company',
        tier: 5,
      });
      expect(cardFilterSchema.parse(undefined)).toBeUndefined();
    });

    it('rejects invalid card types or tiers', () => {
      expect(() => cardFilterSchema.parse({ cardType: 'invalid_type' })).toThrow();
      expect(() => cardFilterSchema.parse({ tier: 99 })).toThrow();
    });
  });

  describe('deepDiveInputSchema & factCheckInputSchema', () => {
    it('accepts valid deep dive payloads', () => {
      const parsed = deepDiveInputSchema.parse({
        companyName: 'Anthropic',
        topic: 'Annual Recurring Revenue',
      });
      expect(parsed.companyName).toBe('Anthropic');
      expect(parsed.topic).toBe('Annual Recurring Revenue');
      expect(parsed.companyId).toBeNull();
      expect(parsed.context).toBeNull();
    });

    it('accepts valid fact check payloads', () => {
      const parsed = factCheckInputSchema.parse({
        claim: 'OpenAI reached $10B ARR in 2025',
        companyName: 'OpenAI',
        companyId: 'cmp_openai',
        metricType: 'users',
        userBasis: 'monthly_active_users',
        storedValue: 10_000,
      });
      expect(parsed.claim).toBe('OpenAI reached $10B ARR in 2025');
      expect(parsed.companyName).toBe('OpenAI');
      expect(parsed.userBasis).toBe('monthly_active_users');
      expect(parsed.storedValue).toBe(10_000);
    });

    it('rejects missing claims or topics', () => {
      expect(() => deepDiveInputSchema.parse({ companyName: 'Anthropic' })).toThrow();
      expect(() => factCheckInputSchema.parse({ claim: '' })).toThrow();
    });
  });

  describe('reportRequestSchema & expandFocusSchema', () => {
    it('validates report requests', () => {
      const parsed = reportRequestSchema.parse({
        kind: 'deck',
        subjectId: 'deck_123',
        focus: 'Valuation comparison',
      });
      expect(parsed.kind).toBe('deck');
      expect(parsed.subjectId).toBe('deck_123');
    });

    it('validates expand focus options', () => {
      expect(expandFocusSchema.parse({ tier: 4 })).toEqual({ tier: 4 });
      expect(expandFocusSchema.parse({ cardType: 'infrastructure' })).toEqual({
        cardType: 'infrastructure',
      });
    });
  });

  describe('overrideMetricInputSchema', () => {
    it('accepts valid metric overrides', () => {
      const parsed = overrideMetricInputSchema.parse({
        companyId: 'comp_1',
        metricType: 'arr',
        value: 50000000,
        note: 'Verified from 2026 press release',
      });
      expect(parsed.value).toBe(50000000);
      expect(parsed.metricType).toBe('arr');
    });

    it('accepts basis-specific user corrections and preserves the selected footprint', () => {
      const parsed = overrideMetricInputSchema.parse({
        companyId: 'comp_1',
        metricType: 'users',
        userBasis: 'paid_seats',
        value: 500,
        note: 'Confirmed in the company report',
      });
      expect(parsed.userBasis).toBe('paid_seats');
    });

    it('allows clearing metric with null value', () => {
      const parsed = overrideMetricInputSchema.parse({
        companyId: 'comp_1',
        metricType: 'arr',
        value: null,
      });
      expect(parsed.value).toBeNull();
    });
  });

  describe('verifyMetricInputSchema', () => {
    it('accepts a basis-targeted correction payload', () => {
      const parsed = verifyMetricInputSchema.parse({
        companyId: 'comp_1',
        metricType: 'users',
        userBasis: 'paid_seats',
        correction: {
          value: 500,
          citations: [{ title: 'Company report', url: 'https://company.example/report' }],
          rationale: 'The report states 500 paid seats.',
        },
      });
      expect(parsed.userBasis).toBe('paid_seats');
      expect(parsed.correction?.value).toBe(500);
    });
  });

  describe('askResearchInputSchema & listResearchThreadsFilterSchema', () => {
    it('accepts valid conversational research questions', () => {
      const parsed = askResearchInputSchema.parse({
        question: 'What are the main competitors to Cursor?',
        scope: {
          kind: 'deck',
          deckId: 'deck_1',
        },
      });
      expect(parsed.question).toBe('What are the main competitors to Cursor?');
      expect(parsed.scope?.deckId).toBe('deck_1');
    });

    it('validates thread filters', () => {
      expect(listResearchThreadsFilterSchema.parse({ deckId: 'deck_1' })).toEqual({
        deckId: 'deck_1',
      });
      expect(listResearchThreadsFilterSchema.parse(undefined)).toBeUndefined();
    });
  });

  describe('enums validation', () => {
    it('validates refresh cadence', () => {
      expect(refreshCadenceSchema.parse('daily')).toBe('daily');
      expect(refreshCadenceSchema.parse('twice_daily')).toBe('twice_daily');
      expect(refreshCadenceSchema.parse('weekly')).toBe('weekly');
      expect(() => refreshCadenceSchema.parse('monthly')).toThrow();
    });

    it('validates dashboard tabs', () => {
      expect(dashboardTabSchema.parse('overview')).toBe('overview');
      expect(dashboardTabSchema.parse('metrics')).toBe('metrics');
      expect(() => dashboardTabSchema.parse('invalid_tab')).toThrow();
    });
  });
});
