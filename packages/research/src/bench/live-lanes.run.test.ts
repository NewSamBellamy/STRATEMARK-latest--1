/**
 * WS7 live verification of the free structured lanes — no provider key and no
 * Gemini call: these lanes are plain HTTPS against official endpoints, the
 * exact flows the repository's fillFromStructuredSources runs. Skipped unless
 * LIVE_LANES=1:
 *   cd packages/research
 *   LIVE_LANES=1 npx vitest run src/bench/live-lanes.run.test.ts
 */
import { describe, expect, it } from 'vitest';
import { retrieveOriginalSource } from '../original-source.node';
import { secAdvFirmMatch, secAdvObservationFor, secAdvReportUrl, secAdvSearchUrl } from '../sec-adv';
import { marketCapEstimate, secTickerMapUrl, secSharesConceptUrl, yahooChartUrl } from '../market-quote';
import { getSearxngLane } from '../searxng';

const live = process.env.LIVE_LANES === '1';

describe.skipIf(!live)('live structured lanes (WS7)', () => {
  it('fills a financial firm from the official SEC Form ADV — zero provider calls', async () => {
    const companyName = 'Andreessen Horowitz';
    const search = await retrieveOriginalSource(secAdvSearchUrl(companyName));
    expect(search.status).toBe('retrieved');
    const match = search.text ? secAdvFirmMatch(search.text, companyName) : null;
    expect(match, `IAPD search returned no confident firm match for ${companyName}`).not.toBeNull();
    expect(Number(match!.crd)).toBeGreaterThan(0);

    const report = await retrieveOriginalSource(secAdvReportUrl(match!.crd));
    expect(report.status).toBe('retrieved');
    const originals = [search, report].filter((r) => r.status === 'retrieved' && r.text);

    const employees = secAdvObservationFor('employees', companyName, originals);
    const aum = secAdvObservationFor('aum', companyName, originals);
    expect(employees?.value).toBeGreaterThan(0);
    expect(aum?.value).toBeGreaterThan(0);
    // Every figure must quote the retained original — no free-floating numbers.
    expect(aum!.passageSupport.quote.length).toBeGreaterThan(0);
    console.log(
      `[ADV lane] ${companyName} CRD ${match!.crd}: employees ${employees!.value}, ` +
      `AUM $${aum!.value.toLocaleString('en-US')} as of ${aum!.asOf}`,
    );
  }, 180_000);

  it('estimates a public-company market cap from Yahoo price × SEC shares — zero provider calls', async () => {
    const companyName = 'Apple Inc.';
    const map = await retrieveOriginalSource(`${secTickerMapUrl()}?lookup=${encodeURIComponent(companyName)}`);
    expect(map.status).toBe('retrieved');
    const parsed = map.text ? JSON.parse(map.text) as { matches?: Array<{ cik: string; ticker: string; title: string }> } : null;
    const match = parsed?.matches?.length === 1 ? parsed.matches[0]! : null;
    expect(match, 'ticker map did not resolve exactly one match for Apple Inc.').not.toBeNull();

    const [chart, shares] = await Promise.all([
      retrieveOriginalSource(yahooChartUrl(match!.ticker)),
      retrieveOriginalSource(secSharesConceptUrl(match!.cik)),
    ]);
    const estimate = marketCapEstimate(companyName, [chart, shares], match!.title);
    expect(estimate, 'quote lane declined to produce an estimate — check lane health').not.toBeNull();
    expect(estimate!.value).toBeGreaterThan(0);
    expect(estimate!.citations.length).toBeGreaterThan(0);
    console.log(
      `[Quote lane] ${companyName} (${match!.ticker}): $${estimate!.price}/share × ` +
      `${estimate!.shares.toLocaleString('en-US')} shares = $${estimate!.value.toLocaleString('en-US', { notation: 'compact' })} ` +
      `${estimate!.currency} (${estimate!.methodNote})`,
    );
  }, 120_000);

  it('reports the optional discovery lane honestly — absent SearXNG falls back gracefully', async () => {
    const lane = await getSearxngLane();
    // Either state is honest; the assertion is that probing never throws and
    // the result is explicit, so the fallback path is a decision, not a crash.
    expect([true, false]).toContain(lane?.healthy ?? false);
    console.log(`[Discovery lane] SearXNG healthy: ${lane?.healthy ?? false}`);
  }, 30_000);
});
