/**
 * WS0 runner wrapper — a no-op in normal suites (skipped unless BENCH_MODE is
 * set). Run one market:
 *   cd packages/research
 *   BENCH_MODE=mock BENCH_MARKET="venture capital fund management" BENCH_OUT=../../bench-out npx vitest run src/bench/bench.run.test.ts
 * Live mode additionally needs GEMINI_API_KEY in the environment (runtime
 * read only — the harness never logs or persists it).
 */
import { describe, expect, it } from 'vitest';
import { BENCH_MARKETS, formatReport, runBench, writeReport } from './bench';

const mode = process.env.BENCH_MODE === 'live' ? 'live'
  : process.env.BENCH_MODE === 'mock' ? 'mock' : undefined;

describe.skipIf(!mode)('bench (WS0 harness)', () => {
  const market = process.env.BENCH_MARKET && process.env.BENCH_MARKET in BENCH_MARKETS
    ? process.env.BENCH_MARKET
    : 'venture capital fund management';

  it('runs the market end to end and records the report', async () => {
    // Before/after discovery comparison (live only):
    //   BENCH_READER=real          read actual pages instead of scripted ones
    //   BENCH_SEARCH=tavily        web-search discovery, key from TAVILY_API_KEY
    //   BENCH_SEARCH_MAX=150       hard cap on provider requests for this run
    //   BENCH_VARIANT=before|after report label (separate output files)
    const searchMax = Number(process.env.BENCH_SEARCH_MAX ?? 150);
    const report = await runBench({
      market, mode: mode!,
      reader: process.env.BENCH_READER === 'real' ? 'real' : 'mock',
      search: process.env.BENCH_SEARCH === 'tavily'
        ? { provider: 'tavily', max: Number.isFinite(searchMax) && searchMax >= 0 ? Math.floor(searchMax) : 150 } : null,
      ...(process.env.BENCH_VARIANT ? { variant: process.env.BENCH_VARIANT } : {}),
    });
    // The report exists to be read — print it in full for the run log.
    console.log(formatReport(report));
    expect(report.deckStatus).toBe('ready');
    expect(report.entities.length).toBeGreaterThanOrEqual(3);
    expect(report.calls.total).toBeGreaterThan(0);
    expect(report.rates.metrics).toBeGreaterThan(0);
    const outDir = process.env.BENCH_OUT;
    if (outDir) {
      const file = writeReport(report, outDir);
      console.log(`report written: ${file}`);
    }
  }, mode === 'live' ? 3_600_000 : 120_000);
});
