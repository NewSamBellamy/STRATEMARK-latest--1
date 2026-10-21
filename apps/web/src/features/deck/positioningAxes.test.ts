import { describe, expect, it } from 'vitest';
import { shareAxis, teamAxis } from './positioningAxes';

describe('positioning map axes', () => {
  it('leaves headroom above the largest share with round ticks from zero', () => {
    const a = shareAxis(2);
    expect(a.domain[0]).toBe(0);
    expect(a.domain[1]).toBeGreaterThan(2);
    expect(a.ticks[0]).toBe(0);
    expect(a.ticks[a.ticks.length - 1]).toBe(a.domain[1]);
  });
  it('pads a single point on the log axis and ticks inside the domain', () => {
    const a = teamAxis(350, 350);
    expect(a.domain[0]).toBeLessThan(350);
    expect(a.domain[1]).toBeGreaterThan(350);
    expect(a.ticks.every((t) => t >= a.domain[0] && t <= a.domain[1])).toBe(true);
    expect(a.ticks).toContain(500);
  });
});
