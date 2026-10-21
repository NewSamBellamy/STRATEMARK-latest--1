/** Plot-axis maths for the positioning map: padded domains and round ticks, so no bubble sits on an edge. */

/** Linear axis from 0 up to a round maximum that leaves headroom above `max`. */
export function shareAxis(max: number): { domain: [number, number]; ticks: number[] } {
  const target = max * 1.35;
  const mag = 10 ** Math.floor(Math.log10(target / 4));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => target / s <= 5) ?? 10 * mag;
  const top = Math.ceil(target / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top + step / 1e6; t += step) ticks.push(Number(t.toPrecision(12)));
  return { domain: [0, top], ticks };
}

/** Log axis padded a factor either side of the data, with 1-2-5 ticks inside the domain. */
export function teamAxis(min: number, max: number): { domain: [number, number]; ticks: number[] } {
  const lo = Math.max(1, min / 3);
  const hi = max * 3;
  const ticks: number[] = [];
  for (let mag = 10 ** Math.floor(Math.log10(lo)); mag <= hi; mag *= 10) {
    for (const m of [1, 2, 5]) {
      const t = m * mag;
      if (t >= lo && t <= hi) ticks.push(t);
    }
  }
  return { domain: [lo, hi], ticks };
}
