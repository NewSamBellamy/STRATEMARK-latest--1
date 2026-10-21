/**
 * The agentic nervous system — one store behind two founder asks:
 *
 * 1. A global, labeled stream of what every agent is doing right now
 *    ("sub-agent for this company card found X") — rendered by the floating
 *    STRATEMARK presence bubble. Events are REAL: they are emitted by the
 *    living-deck runtime, the dashboard warm loop, verifications, and hunts —
 *    never simulated.
 *
 * 2. The hunt queue: expand-deck hunts used to hard-block while one ran.
 *    Clicks now enqueue in order; a single runner drains the queue so the
 *    rate limiter still ever sees one hunt at a time.
 */
import { create } from 'zustand';
import type { CardType, MaturityTier } from '@mi/contracts';

export interface TraceEvent {
  id: number;
  at: number;
  /** Who acted — a labeled sub-agent ("OpenAI desk", "Hunt agent", "Verifier"). */
  agent: string;
  /** What happened, human-readable. */
  action: string;
  detail?: string | null;
}

export interface HuntFocus {
  tier?: MaturityTier;
  cardType?: CardType;
  /** One company the person confirmed from a link, instead of a hunt for unknown ones. */
  company?: { name: string; domain?: string | null; descriptor?: string | null };
}

export interface HuntJob {
  id: string;
  marketId: string;
  focus: HuntFocus;
  label: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  added: number | null;
  /** Put the named company on Today once it is in the deck. */
  followAfter?: boolean;
}

/** Where the presence bubble's "chat with the AI" should anchor. */
export interface TraceChatContext {
  kind: 'deck' | 'company';
  deckId?: string;
  companyId?: string;
  subject: string;
}

interface AgentTraceStore {
  events: TraceEvent[];
  trace: (agent: string, action: string, detail?: string | null) => void;

  jobs: HuntJob[];
  enqueueHunt: (job: { marketId: string; focus: HuntFocus; label: string; followAfter?: boolean }) => void;
  updateJob: (id: string, patch: Partial<Pick<HuntJob, 'status' | 'added'>>) => void;
  /** Drop finished jobs (keeps the queue list readable). */
  pruneJobs: () => void;

  chatContext: TraceChatContext | null;
  setChatContext: (ctx: TraceChatContext | null) => void;
}

const MAX_EVENTS = 80;
let eventSeq = 0;
let jobSeq = 0;

export const useAgentTrace = create<AgentTraceStore>((set) => ({
  events: [],
  trace: (agent, action, detail) =>
    set((s) => ({
      events: [
        { id: (eventSeq += 1), at: Date.now(), agent, action, detail: detail ?? null },
        ...s.events,
      ].slice(0, MAX_EVENTS),
    })),

  jobs: [],
  enqueueHunt: ({ marketId, focus, label, followAfter }) =>
    set((s) => {
      // The same hunt queued twice while pending is a double-click, not intent.
      const dupe = s.jobs.some(
        (j) =>
          (j.status === 'queued' || j.status === 'running') &&
          j.marketId === marketId &&
          j.focus.tier === focus.tier &&
          j.focus.cardType === focus.cardType &&
          j.focus.company?.name.toLowerCase() === focus.company?.name.toLowerCase(),
      );
      if (dupe) return s;
      return {
        jobs: [
          ...s.jobs,
          {
            id: `hunt_${(jobSeq += 1)}`,
            marketId,
            focus,
            label,
            status: 'queued' as const,
            added: null,
            ...(followAfter ? { followAfter } : {}),
          },
        ],
      };
    }),
  updateJob: (id, patch) =>
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) })),
  pruneJobs: () =>
    set((s) => ({
      jobs: s.jobs.filter((j) => j.status === 'queued' || j.status === 'running'),
    })),

  chatContext: null,
  setChatContext: (ctx) => set({ chatContext: ctx }),
}));

/** Convenience for non-hook call sites (mutation callbacks, effects). */
export const traceAgent = (agent: string, action: string, detail?: string | null): void =>
  useAgentTrace.getState().trace(agent, action, detail);
