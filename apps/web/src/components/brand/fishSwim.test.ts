import { describe, expect, it } from 'vitest';
import { morphAt, SWIMS, swimFrame, type SwimVariant } from './fishSwim';
import { MARK_CENTRE, MARK_EDGE, MARK_OUTER } from './markChains';

const numbers = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
const points = (d: string) => { const n = numbers(d); const out: Array<[number, number]> = []; for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i]!, n[i + 1]!]); return out; };
const variants = Object.entries(SWIMS) as Array<[string, SwimVariant]>;

describe('the fish the logo becomes', () => {
  it('is the logo at the start and at the end of every swim, and two swimming fish in between', () => {
    for (const [, v] of variants) {
      expect(morphAt(v, 0)).toBe(0);
      expect(morphAt(v, v.seconds)).toBe(0);
      expect(morphAt(v, v.seconds / 2)).toBe(1);
      expect(swimFrame(v, 0).eyes.map((e) => e.r)).toEqual([0, 0]);
      expect(swimFrame(v, v.seconds / 2).eyes.every((e) => e.r > 0)).toBe(true);
    }
  });

  it('starts from the logo: at the start the outline passes through the very points the logo was measured at', () => {
    const anchors = (d: string) => [...d.matchAll(/C([-\d. ]+)/g)].map((m) => numbers(m[1]!).slice(-2) as [number, number]);
    const own = [...MARK_OUTER, ...MARK_EDGE];
    const reflected = own.map(([x, y]) => [2 * MARK_CENTRE[0] - x, 2 * MARK_CENTRE[1] - y] as const);
    for (const [, v] of variants) {
      const first = swimFrame(v, 0);
      for (const [d, set] of [[first.a, own], [first.b, reflected]] as const) {
        const miss = anchors(d).filter(([x, y]) => !set.some(([sx, sy]) => Math.hypot(sx - x, sy - y) < 0.03));
        expect(miss).toEqual([]);
      }
    }
  });

  it('is always a whole drawing: no broken numbers, and it stays near the logo\'s box', () => {
    for (const [name, v] of variants) {
      for (let i = 0; i <= 120; i += 1) {
        const f = swimFrame(v, (v.seconds * i) / 120);
        for (const d of [f.a, f.b]) {
          expect(d, `${name} ${i}`).toMatch(/^M[-\d. C]+Z$/);
          for (const [x, y] of points(d)) {
            expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
            expect(x).toBeGreaterThan(12);
            expect(x).toBeLessThan(63);
            expect(y).toBeGreaterThan(14);
            expect(y).toBeLessThan(73);
          }
        }
      }
    }
  });

  it('goes whole laps, so the pair ends where it began', () => {
    for (const [, v] of variants) {
      const end = swimFrame(v, v.seconds).turn;
      expect(end / (2 * Math.PI)).toBeCloseTo(v.laps, 6);
      expect(swimFrame(v, 0).turn).toBe(0);
    }
  });

  it('swims through the middle of the swim: the outline changes smoothly, with no jump between frames', () => {
    for (const [, v] of variants) {
      let previous = points(swimFrame(v, 0).a);
      for (let i = 1; i <= 300; i += 1) {
        const now = points(swimFrame(v, (v.seconds * i) / 300).a);
        expect(now.length).toBe(previous.length);
        // At 300 frames a swim a point moves a little each frame (the 1/60 s frame step is five times smaller), never across the mark.
        const jump = Math.max(...now.map(([x, y], k) => Math.hypot(x - previous[k]![0], y - previous[k]![1])));
        expect(jump).toBeLessThan(4.5);
        previous = now;
      }
    }
  });

  it('has a backbone that moves like a fish\'s: the wave is small at the head and large at the tail', () => {
    // The two outlines differ from a plain circle arc by the wave; compare the sideways swing near the head and near the tail by
    // measuring how much the body's width line wobbles: here, the span of each end's position over a swim.
    const v = SWIMS.orbit;
    const head: number[] = [];
    const tail: number[] = [];
    for (let i = 0; i <= 200; i += 1) {
      const t = 1.1 + ((v.seconds - 2.2) * i) / 200;
      const turnA = swimFrame(v, t).turn;
      const pts = points(swimFrame(v, t).a);
      // The head is the first outline point (the nose); the fin is mid-way along the loop. Both are measured from the circle round the mark's middle,
      // so the turning of the whole fish drops out.
      const radius = (p: [number, number]) => Math.hypot(p[0] - 37.3, p[1] - 43.5);
      head.push(radius(pts[0]!));
      tail.push(radius(pts[Math.floor(pts.length * 0.48)]!));
      expect(Number.isFinite(turnA)).toBe(true);
    }
    const span = (a: number[]) => Math.max(...a) - Math.min(...a);
    expect(span(tail)).toBeGreaterThan(span(head));
  });

  it('beats its tail at the pace of each swim, and the chase is quicker than the drift', () => {
    expect(SWIMS.chase.beat).toBeGreaterThan(SWIMS.orbit.beat);
    expect(SWIMS.orbit.beat).toBeGreaterThan(SWIMS.drift.beat);
    for (const [, v] of variants) expect(v.beat).toBeLessThan(2.5);
  });
});
