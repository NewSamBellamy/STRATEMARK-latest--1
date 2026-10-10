/**
 * Semantic Memory Distillation (Issue #56)
 *
 * Bounds long research conversations without replaying unbounded raw history.
 * After 20 user/assistant turns, structured semantic facts with usable citations
 * are extracted and used alongside a small recent message window for LLM context,
 * while the full raw audit record is preserved in the thread.
 */
import {
  type ResearchThread,
  type ThreadMessage,
  type DistilledSemanticFact,
  type SemanticMemory,
  type Citation,
  distillationExtractionSchema,
  usableCitations,
  isJunkSource,
} from '@mi/contracts';
import { createGenAiClient } from './genai';
import type { LlmClient } from './types';

export const DISTILLATION_TURN_THRESHOLD = 20;
export const RECENT_MESSAGE_WINDOW = 4;

export interface ExtractedFactInput {
  fact: string;
  category?: 'metric' | 'finding' | 'competitor' | 'trend' | 'risk' | 'general';
  companyId?: string | null;
  subject?: string | null;
  citations?: Citation[];
  userVerified?: boolean;
}

export type DistillationExtractor = (
  thread: ResearchThread,
  unprocessedMessages: ThreadMessage[],
) => Promise<{ facts: ExtractedFactInput[] }>;

export interface PromptContext {
  isDistilled: boolean;
  messages: ThreadMessage[];
  distilledFactsSummary: string | null;
  distilledFacts: DistilledSemanticFact[];
}

/**
 * Determines whether a research thread has accumulated enough turns to trigger
 * structured semantic memory distillation.
 */
export function shouldDistillThread(thread: ResearchThread): boolean {
  const messageCount = thread.messages?.length ?? 0;
  if (messageCount < DISTILLATION_TURN_THRESHOLD) {
    return false;
  }

  const lastDistilled = thread.semanticMemory?.lastDistilledTurnIndex ?? 0;
  return messageCount - lastDistilled >= DISTILLATION_TURN_THRESHOLD;
}

/**
 * Filter and validate citations for distilled facts:
 * - Must be valid http/https URLs.
 * - Must not be SEO junk/content-mill domains.
 * - Drops duplicates.
 */
export function cleanDistillationCitations(citations?: readonly Citation[]): Citation[] {
  if (!citations || citations.length === 0) return [];
  const usable = usableCitations(citations);
  return usable.filter((c) => !isJunkSource(c.url, c.title));
}

/**
 * Sanitize incoming distilled facts, merge with existing memory, and ensure:
 * - User-verified facts are never lost or overwritten.
 * - Citations are valid, deduplicated, and free of junk domains.
 * - Deterministic UUID/IDs are stamped.
 */
export function sanitizeDistilledFacts(
  newExtracted: ExtractedFactInput[],
  existingFacts: DistilledSemanticFact[] = [],
): DistilledSemanticFact[] {
  const now = new Date().toISOString();
  const sanitizedNew: DistilledSemanticFact[] = [];

  for (let i = 0; i < newExtracted.length; i++) {
    const raw = newExtracted[i];
    if (!raw || !raw.fact || typeof raw.fact !== 'string' || raw.fact.trim().length === 0) {
      continue;
    }

    const cleanCites = cleanDistillationCitations(raw.citations);
    // Facts without at least one usable citation are not established research facts
    if (cleanCites.length === 0) continue;

    const factId = `fact_${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 6)}`;

    sanitizedNew.push({
      id: factId,
      fact: raw.fact.trim(),
      category: raw.category ?? 'general',
      companyId: raw.companyId ?? null,
      subject: raw.subject ?? null,
      citations: cleanCites,
      extractedAt: now,
      // Only existing stored facts may retain userVerified; raw model extraction cannot assert it (AGENTS.md Rule 9)
      userVerified: false,
    });
  }

  // Preserve existing user-verified facts
  const preservedUserVerified = existingFacts.filter((f) => f.userVerified);
  const preservedExisting = existingFacts.filter((f) => !f.userVerified);

  // Combine: existing user-verified first, then new extracted, then remaining non-conflicting existing
  const seenFacts = new Set<string>();
  const combined: DistilledSemanticFact[] = [];

  for (const f of preservedUserVerified) {
    seenFacts.add(f.fact.toLowerCase().trim());
    combined.push(f);
  }

  for (const f of sanitizedNew) {
    const norm = f.fact.toLowerCase().trim();
    if (!seenFacts.has(norm)) {
      seenFacts.add(norm);
      combined.push(f);
    }
  }

  for (const f of preservedExisting) {
    const norm = f.fact.toLowerCase().trim();
    if (!seenFacts.has(norm)) {
      seenFacts.add(norm);
      combined.push(f);
    }
  }

  return combined;
}

/**
 * Format distilled facts into a structured string block to inject into LLM prompts.
 */
export function formatDistilledFactsForPrompt(facts: DistilledSemanticFact[]): string {
  if (!facts || facts.length === 0) return '';

  const lines: string[] = ['### Established Research Facts & Context:'];

  for (const f of facts) {
    const badge = f.userVerified
      ? `[${(f.category ?? 'FACT').toUpperCase()} - USER VERIFIED]`
      : `[${(f.category ?? 'FACT').toUpperCase()}]`;

    const subjectStr = f.subject ? ` (${f.subject})` : '';
    const citeStr =
      f.citations.length > 0
        ? ` | Sources: ${f.citations.map((c) => c.url).join(', ')}`
        : '';

    lines.push(`- ${badge}${subjectStr}: ${f.fact}${citeStr}`);
  }

  return lines.join('\n');
}

/**
 * Build the bounded prompt context for subsequent turns:
 * - If thread is below threshold and has no memory: returns all messages verbatim.
 * - If distilled: returns distilled facts summary + last RECENT_MESSAGE_WINDOW turns.
 * - Thread's own raw messages are never mutated (preserving the complete audit record).
 */
export function buildPromptContext(
  thread: ResearchThread,
  windowSize = RECENT_MESSAGE_WINDOW,
): PromptContext {
  const memory = thread.semanticMemory;
  const hasMemory = memory && memory.distilledFacts && memory.distilledFacts.length > 0;

  if (!hasMemory && (!thread.messages || thread.messages.length < DISTILLATION_TURN_THRESHOLD)) {
    return {
      isDistilled: false,
      messages: thread.messages ?? [],
      distilledFactsSummary: null,
      distilledFacts: [],
    };
  }

  const allMessages = thread.messages ?? [];
  const boundedWindow = allMessages.slice(-windowSize);
  const facts = memory?.distilledFacts ?? [];
  const summary = formatDistilledFactsForPrompt(facts);

  return {
    isDistilled: true,
    messages: boundedWindow,
    distilledFactsSummary: summary,
    distilledFacts: facts,
  };
}

/**
 * Extract distilled facts from thread history using Gemini structured output or a custom extractor.
 */
export async function distillThreadMemory(
  thread: ResearchThread,
  options?: {
    extractor?: DistillationExtractor;
    llm?: LlmClient;
    apiKey?: string;
  },
): Promise<SemanticMemory> {
  const currentTotalTurns = thread.messages?.length ?? 0;
  const lastIndex = thread.semanticMemory?.lastDistilledTurnIndex ?? 0;
  const existingFacts = thread.semanticMemory?.distilledFacts ?? [];

  if (options?.extractor) {
    try {
      const unprocessed = (thread.messages ?? []).slice(lastIndex);
      const rawResult = await options.extractor(thread, unprocessed);
      const parsed = distillationExtractionSchema.safeParse(rawResult);

      if (!parsed.success) {
        // Fall back gracefully to existing memory
        return (
          thread.semanticMemory ?? {
            threadId: thread.id,
            distilledFacts: existingFacts,
            lastDistilledTurnIndex: lastIndex,
            totalTurnsDistilled: lastIndex,
            distilledAt: new Date().toISOString(),
          }
        );
      }

      const mergedFacts = sanitizeDistilledFacts(parsed.data.facts, existingFacts);
      return {
        threadId: thread.id,
        distilledFacts: mergedFacts,
        lastDistilledTurnIndex: currentTotalTurns,
        totalTurnsDistilled: currentTotalTurns,
        distilledAt: new Date().toISOString(),
      };
    } catch {
      return (
        thread.semanticMemory ?? {
          threadId: thread.id,
          distilledFacts: existingFacts,
          lastDistilledTurnIndex: lastIndex,
          totalTurnsDistilled: lastIndex,
          distilledAt: new Date().toISOString(),
        }
      );
    }
  }

  // Live Gemini structured distillation
  try {
    const llm =
      options?.llm ??
      (options?.apiKey ? createGenAiClient({ apiKey: options.apiKey }) : null);

    if (!llm) {
      return (
        thread.semanticMemory ?? {
          threadId: thread.id,
          distilledFacts: existingFacts,
          lastDistilledTurnIndex: lastIndex,
          totalTurnsDistilled: lastIndex,
          distilledAt: new Date().toISOString(),
        }
      );
    }

    const messagesToDistill = thread.messages ?? [];
    
    // Format conversation transcript
    const transcript = messagesToDistill
      .map(
        (m, idx) =>
          `Turn ${idx + 1} [${m.role.toUpperCase()}]: ${m.text}\nCitations: ${JSON.stringify(
            m.citations ?? [],
          )}`,
      )
      .join('\n\n');

    const prompt = `Analyze this research conversation transcript and extract durable, high-signal semantic facts (metrics, key findings, competitor facts, market trends, risks).
Preserve exact figures, numbers, and attach matching citation URLs found in the assistant responses.
Never invent citations or unsupported claims.

Transcript:
${transcript}`;

    const validated = await llm.structure(prompt, distillationExtractionSchema);
    const merged = sanitizeDistilledFacts(validated.facts, existingFacts);

    return {
      threadId: thread.id,
      distilledFacts: merged,
      lastDistilledTurnIndex: currentTotalTurns,
      totalTurnsDistilled: currentTotalTurns,
      distilledAt: new Date().toISOString(),
    };
  } catch {
    return (
      thread.semanticMemory ?? {
        threadId: thread.id,
        distilledFacts: existingFacts,
        lastDistilledTurnIndex: lastIndex,
        totalTurnsDistilled: lastIndex,
        distilledAt: new Date().toISOString(),
      }
    );
  }
}
