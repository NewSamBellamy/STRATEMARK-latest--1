/**
 * Hunt A/B runner — skipped unless HUNT_AB is set. One frozen deck per market,
 * filled once per discovery variant (grounded, grounded + free news, and with
 * TAVILY_API_KEY + HUNT_AB_TAVILY_MAX also + Tavily). Needs GEMINI_API_KEY.
 *   HUNT_AB=1 HUNT_AB_MARKET="..." HUNT_AB_OUT=dir npx vitest run src/bench/hunt-ab.run.test.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatHuntAb, reportSlug, runHuntAb } from './bench';

describe.skipIf(!process.env.HUNT_AB)('hunt A/B', () => {
  it('fills one frozen deck once per discovery variant', async () => {
    const market = process.env.HUNT_AB_MARKET ?? 'venture capital fund management';
    const report = await runHuntAb({ market, tavilyMax: Number(process.env.HUNT_AB_TAVILY_MAX ?? 0),
      catalogMax: Number(process.env.HUNT_AB_COMPANIES ?? 10), attempts: 3 });
    console.log(formatHuntAb(report));
    if (process.env.HUNT_AB_OUT) {
      mkdirSync(process.env.HUNT_AB_OUT, { recursive: true });
      writeFileSync(join(process.env.HUNT_AB_OUT, `hunt-ab-${reportSlug(market)}.json`), `${JSON.stringify(report, null, 2)}\n`);
    }
    expect(report.variants.length).toBeGreaterThanOrEqual(2);
  }, 3_600_000);
});
