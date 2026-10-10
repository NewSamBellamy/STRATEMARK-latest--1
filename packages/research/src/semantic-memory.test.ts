import { describe, it, expect, vi } from 'vitest';
import type { ResearchThread, ThreadMessage, Citation } from '@mi/contracts';
import {
  RECENT_MESSAGE_WINDOW,
  shouldDistillThread,
  distillThreadMemory,
  buildPromptContext,
  formatDistilledFactsForPrompt,
  sanitizeDistilledFacts,
} from './semantic-memory';

function makeMessage(
  index: number,
  role: 'user' | 'assistant',
  text?: string,
  citations: Citation[] = [],
): ThreadMessage {
  return {
    id: `msg_${index}`,
    role,
    text: text ?? (role === 'user' ? `User question ${index}` : `Assistant answer ${index} with facts.`),
    citations,
    at: new Date(Date.now() + index * 1000).toISOString(),
  };
}

function makeThread(messageCount: number, citationsPerAssistant: Citation[] = []): ResearchThread {
  const messages: ThreadMessage[] = [];
  for (let i = 1; i <= messageCount; i++) {
    const role = i % 2 === 1 ? 'user' : 'assistant';
    messages.push(
      makeMessage(
        i,
        role,
        undefined,
        role === 'assistant' ? citationsPerAssistant : [],
      ),
    );
  }
  return {
    id: 'thread_test_1',
    scope: { kind: 'company', deckId: 'deck_1', companyId: 'comp_1', subject: 'Anthropic' },
    title: 'Research on Anthropic',
    messages,
    reportId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const mockCite: Citation = {
  title: 'reuters.com',
  url: 'https://www.reuters.com/technology/anthropic-valuation-2026',
  credibility: 'reputable_secondary',
};

describe('Semantic Memory Distillation (Issue #56)', () => {
  describe('Threshold Gate', () => {
    it('does not trigger distillation below threshold (e.g. 10 or 19 turns)', () => {
      const thread10 = makeThread(10);
      expect(shouldDistillThread(thread10)).toBe(false);

      const thread19 = makeThread(19);
      expect(shouldDistillThread(thread19)).toBe(false);
    });

    it('triggers distillation at or above 20 turns when never distilled', () => {
      const thread20 = makeThread(20);
      expect(shouldDistillThread(thread20)).toBe(true);

      const thread25 = makeThread(25);
      expect(shouldDistillThread(thread25)).toBe(true);
    });

    it('does not re-trigger distillation until another threshold window has passed', () => {
      const thread25 = makeThread(25);
      thread25.semanticMemory = {
        threadId: thread25.id,
        distilledFacts: [],
        lastDistilledTurnIndex: 20,
        totalTurnsDistilled: 20,
        distilledAt: new Date().toISOString(),
      };
      // Only 5 new turns since turn 20
      expect(shouldDistillThread(thread25)).toBe(false);

      // Now 41 turns total (21 new turns since turn 20)
      const thread41 = makeThread(41);
      thread41.semanticMemory = {
        threadId: thread41.id,
        distilledFacts: [],
        lastDistilledTurnIndex: 20,
        totalTurnsDistilled: 20,
        distilledAt: new Date().toISOString(),
      };
      expect(shouldDistillThread(thread41)).toBe(true);
    });
  });

  describe('Structured Fact Extraction & Provenance Preservation', () => {
    it('extracts structured facts and attaches valid citations from conversation', async () => {
      const thread = makeThread(20, [mockCite]);
      const mockExtractor = vi.fn().mockResolvedValue({
        facts: [
          {
            fact: 'Anthropic raised $4B at a $60B valuation in late 2025.',
            category: 'metric',
            companyId: 'comp_1',
            citations: [mockCite],
          },
          {
            fact: 'Claude 3.7 Sonnet introduced hybrid reasoning.',
            category: 'finding',
            companyId: 'comp_1',
            citations: [mockCite],
          },
        ],
      });

      const memory = await distillThreadMemory(thread, { extractor: mockExtractor });
      expect(mockExtractor).toHaveBeenCalledOnce();
      expect(memory.distilledFacts).toHaveLength(2);
      expect(memory.distilledFacts[0]?.fact).toContain('Anthropic raised $4B');
      expect(memory.distilledFacts[0]?.citations).toHaveLength(1);
      expect(memory.distilledFacts[0]?.citations[0]?.url).toBe(mockCite.url);
      expect(memory.totalTurnsDistilled).toBe(20);
      expect(memory.lastDistilledTurnIndex).toBe(20);
    });

    it('rejects malformed extraction outputs and preserves previous valid memory', async () => {
      const thread = makeThread(20);
      const existingFact = {
        id: 'fact_pre',
        fact: 'Existing durable fact.',
        category: 'general' as const,
        citations: [],
        extractedAt: new Date().toISOString(),
      };
      thread.semanticMemory = {
        threadId: thread.id,
        distilledFacts: [existingFact],
        lastDistilledTurnIndex: 10,
        totalTurnsDistilled: 10,
        distilledAt: new Date().toISOString(),
      };

      // Mock extractor returns malformed payload missing 'fact' string
      const badExtractor = vi.fn().mockResolvedValue({
        facts: [{ invalidField: 123 }],
      });

      const memory = await distillThreadMemory(thread, { extractor: badExtractor });
      // Should fall back to existing memory without crashing
      expect(memory.distilledFacts).toEqual([existingFact]);
    });

    it('sanitizes and preserves user-verified facts across distillations', () => {
      const existingFacts = [
        {
          id: 'fact_user_verified',
          fact: 'Human confirmed ARR is $1.2B in 2026.',
          category: 'metric' as const,
          citations: [mockCite],
          extractedAt: new Date().toISOString(),
          userVerified: true,
        },
      ];

      const newExtractedFacts = [
        {
          fact: 'Model claims ARR is $800M in 2026.',
          category: 'metric' as const,
          citations: [mockCite],
        },
      ];

      const merged = sanitizeDistilledFacts(newExtractedFacts, existingFacts);
      // User verified fact must be preserved and never overwritten
      const userFact = merged.find((f) => f.id === 'fact_user_verified');
      expect(userFact).toBeDefined();
      expect(userFact?.userVerified).toBe(true);
      expect(userFact?.fact).toBe('Human confirmed ARR is $1.2B in 2026.');
    });

    it('cleans unusable and junk citations on distilled facts', () => {
      const extracted = [
        {
          fact: 'Some claim.',
          citations: [
            { title: 'bad', url: 'not-a-valid-url' },
            { title: 'fatjoe.com', url: 'https://fatjoe.com/spam' },
            mockCite,
          ],
        },
      ];

      const sanitized = sanitizeDistilledFacts(extracted, []);
      expect(sanitized[0]?.citations).toHaveLength(1);
      expect(sanitized[0]?.citations[0]?.url).toBe(mockCite.url);
    });
  });

  describe('Prompt Context Construction', () => {
    it('returns raw messages below threshold', () => {
      const thread = makeThread(10);
      const context = buildPromptContext(thread);
      expect(context.isDistilled).toBe(false);
      expect(context.messages).toHaveLength(10);
      expect(context.distilledFactsSummary).toBeNull();
    });

    it('returns distilled facts summary and bounded recent message window at/above threshold', () => {
      const thread = makeThread(24);
      thread.semanticMemory = {
        threadId: thread.id,
        distilledFacts: [
          {
            id: 'f1',
            fact: 'Anthropic was founded by former OpenAI VP Dario Amodei.',
            category: 'finding',
            citations: [mockCite],
            extractedAt: new Date().toISOString(),
          },
        ],
        lastDistilledTurnIndex: 20,
        totalTurnsDistilled: 20,
        distilledAt: new Date().toISOString(),
      };

      const context = buildPromptContext(thread);
      expect(context.isDistilled).toBe(true);
      // Recent window must be small (RECENT_MESSAGE_WINDOW, e.g. 4 messages)
      expect(context.messages).toHaveLength(RECENT_MESSAGE_WINDOW);
      expect(context.messages[0]?.id).toBe('msg_21');
      expect(context.messages[3]?.id).toBe('msg_24');
      // Distilled facts summary is provided
      expect(context.distilledFactsSummary).toContain('Anthropic was founded by');
      expect(context.distilledFactsSummary).toContain('https://www.reuters.com');
      // Raw audit record in thread.messages is completely preserved
      expect(thread.messages).toHaveLength(24);
    });

    it('formats distilled facts with categories and citations clearly for LLM context', () => {
      const formatted = formatDistilledFactsForPrompt([
        {
          id: 'f1',
          fact: 'Core valuation is $60B.',
          category: 'metric',
          subject: 'Valuation',
          citations: [mockCite],
          extractedAt: new Date().toISOString(),
          userVerified: true,
        },
      ]);

      expect(formatted).toContain('[METRIC - USER VERIFIED]');
      expect(formatted).toContain('Core valuation is $60B');
      expect(formatted).toContain('Sources: https://www.reuters.com');
    });
  });
});
