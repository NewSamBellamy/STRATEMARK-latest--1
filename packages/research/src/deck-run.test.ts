import { describe, expect, it } from 'vitest';
import { applyMilestone, deckRunTimes, formatDeckRun, formatDeckRunTopics, usageSince, type DeckRun } from './deck-run';

const counters = (n: number) => ({ calls: n, retries: 0, rateLimitedMs: 0, fallbacks: 0, inputTokens: n * 1000, outputTokens: n * 100, searchQueries: n, estCostUsd: n * 0.05 });

describe('usageSince', () => {
  it('is the client counters now minus at submission', () => {
    expect(usageSince(counters(30), counters(10))).toEqual({ calls: 20, inputTokens: 20_000, outputTokens: 2000, searchQueries: 20, estCostUsd: expect.closeTo(1, 6) });
  });
  it('is unknown, not zero, for a client that keeps no counters', () => {
    expect(usageSince(undefined, counters(1))).toBeUndefined();
    expect(usageSince(counters(1), undefined)).toBeUndefined();
  });
  it('treats counters a client did not report as zero and never goes negative', () => {
    expect(usageSince({ calls: 5, retries: 0, rateLimitedMs: 0, fallbacks: 0 }, { calls: 7, retries: 0, rateLimitedMs: 0, fallbacks: 0 })?.calls).toBe(0);
  });
});

describe('applyMilestone', () => {
  const run: DeckRun = { submittedAt: '2026-10-14T20:00:00.000Z' };
  it('stamps each milestone once: a resumed warm-up never rewrites history', () => {
    const lead = applyMilestone(run, 'leadCardAt', '2026-10-14T20:00:41.000Z');
    expect(applyMilestone(lead, 'leadCardAt', '2026-10-14T21:00:00.000Z').leadCardAt).toBe('2026-10-14T20:00:41.000Z');
  });
  it('keeps the usage seen at "deck ready" separate from the final usage', () => {
    const u1 = usageSince(counters(30), counters(0))!;
    const u2 = usageSince(counters(90), counters(0))!;
    const done = applyMilestone(applyMilestone(run, 'deckReadyAt', '2026-10-14T20:03:00.000Z', u1), 'warmupDoneAt', '2026-10-14T20:25:00.000Z', u2);
    expect(done.usageAtDeckReady?.calls).toBe(30);
    expect(done.usage?.calls).toBe(90);
  });
  it('leaves the earlier usage in place when a milestone has none to add', () => {
    const u = usageSince(counters(30), counters(0))!;
    const done = applyMilestone(applyMilestone(run, 'deckReadyAt', '2026-10-14T20:03:00.000Z', u), 'warmupDoneAt', '2026-10-14T20:25:00.000Z');
    expect(done.usage?.calls).toBe(30);
  });
});

describe('formatDeckRun', () => {
  it('reads as one line with time and spend', () => {
    const run: DeckRun = { submittedAt: '2026-10-14T20:00:00.000Z', leadCardAt: '2026-10-14T20:00:41.000Z', deckReadyAt: '2026-10-14T20:03:10.000Z',
      warmupDoneAt: '2026-10-14T20:24:12.000Z', usage: { calls: 212, inputTokens: 1_900_000, outputTokens: 400_000, searchQueries: 96, estCostUsd: 2.314 } };
    expect(deckRunTimes(run)).toEqual({ toFirstCardSec: 41, toDeckSec: 190, toWarmupSec: 1452 });
    expect(formatDeckRun(run)).toBe('first card 41s · deck 3m10s · warm-up 24m12s · 212 calls · 1.9M in / 400k out tokens · 96 searches · est $2.31');
  });
  it('says so plainly when a milestone or the usage was never measured', () => {
    expect(formatDeckRun({ submittedAt: '2026-10-14T20:00:00.000Z', leadCardAt: '2026-10-14T20:00:41.000Z' }))
      .toBe('first card 41s · deck n/a · warm-up n/a · usage not measured');
  });
});

describe('per-topic usage', () => {
  const withTopics = (n: number, team: number, hist: number) => ({ ...counters(n),
    byTopic: { team_org: { calls: team, estCostUsd: team * 0.04, totalMs: team * 3000 }, history: { calls: hist, estCostUsd: hist * 0.04, totalMs: hist * 2000 } } });
  it('is the per-topic difference, leaving out topics the deck never touched', () => {
    const u = usageSince(withTopics(30, 20, 10), { ...counters(10), byTopic: { history: { calls: 10, estCostUsd: 0.4, totalMs: 20000 } } })!;
    expect(u.byTopic).toEqual({ team_org: { calls: 20, estCostUsd: expect.closeTo(0.8, 6), totalMs: 60000 } });
  });
  it('lists the costliest topics first with their share of the deck', () => {
    const usage = { ...usageSince(withTopics(30, 20, 10), counters(0))!, estCostUsd: 1.2 };
    const lines = formatDeckRunTopics({ submittedAt: '2026-10-14T20:00:00.000Z', usage });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^team_org\s+20 calls\s+\$\s*0\.80\s+67%\s+60s of model time$/);
    expect(lines[1]).toMatch(/^history\s+10 calls/);
  });
  it('lists nothing for a deck with no usage', () => {
    expect(formatDeckRunTopics({ submittedAt: '2026-10-14T20:00:00.000Z' })).toEqual([]);
  });
});
