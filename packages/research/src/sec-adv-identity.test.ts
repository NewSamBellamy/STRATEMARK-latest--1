/**
 * sec-adv identity — brand names vs registered adviser names, from REAL IAPD
 * search answers and Form ADV reports (fixtures under __fixtures__/sec-adv:
 * the reader's retained slices of the actual 2026 filings; search answers
 * trimmed to the fields selection reads, values verbatim).
 *
 * The live failure: a "US private credit asset managers" deck got AUM for one
 * of ten firms. Antares Capital's exact-name hit was its exempt reporting
 * adviser (no Item 5); Golub, Apollo and Antares file under adviser names that
 * are not the brand. Rule: the single adviser identified by BOTH a search for
 * the company AND its filed website — never a sum, never a guess.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { OriginalSourceReceipt } from './original-source';
import { acceptedMetricPassage } from './metric-support';
import {
  MAX_SEC_ADV_SEARCH_TEXT,
  secAdvAumObservation,
  secAdvEmployeesObservation,
  secAdvFirmCandidates,
  secAdvFirmMatch,
  secAdvReportUrl,
  secAdvSearchUrl,
  selectSecAdvSearchSlice,
} from './sec-adv';

// The reader retains LF text; a CRLF checkout (core.autocrlf) must not change that.
const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/sec-adv/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function report(crd: string, text: string): OriginalSourceReceipt {
  return {
    requestedUrl: secAdvReportUrl(crd), finalUrl: secAdvReportUrl(crd),
    status: 'retrieved', httpStatus: 200, retrievedAt: '2026-10-09T00:00:00.000Z',
    contentHash: 'a'.repeat(64), text, truncated: false, format: 'sec-adv',
  };
}

function search(companyName: string, rawJson: string): OriginalSourceReceipt {
  const url = secAdvSearchUrl(companyName);
  return {
    requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200,
    retrievedAt: '2026-10-09T00:00:00.000Z', contentHash: 'b'.repeat(64),
    text: selectSecAdvSearchSlice(rawJson, url)!, truncated: false,
  };
}

const NOW = Date.parse('2026-10-10T00:00:00.000Z');
const crds = (matches: Array<{ crd: string }>) => matches.map((m) => m.crd);

describe('selectSecAdvSearchSlice', () => {
  it('keeps every firm row, drops relying-adviser rosters and unrelated DBAs, and fits the receipt bound', () => {
    const golub = selectSecAdvSearchSlice(fixture('golub.search.json'), secAdvSearchUrl('Golub Capital'))!;
    expect(golub.length).toBeLessThanOrEqual(MAX_SEC_ADV_SEARCH_TEXT);
    expect(golub).toContain('"crd":"145488"');
    expect(golub).toContain('"GOLUB CAPITAL"');
    expect(golub).not.toContain('RELYING');
    expect(golub).not.toContain('THORNHILL FINANCIAL');
    expect(selectSecAdvSearchSlice('<html>blocked</html>', secAdvSearchUrl('Golub Capital'))).toBeNull();
    expect(selectSecAdvSearchSlice(fixture('golub.search.json'), 'https://example.com/?query=Golub')).toBeNull();
  });
});

describe('secAdvFirmCandidates', () => {
  it('skips an exempt reporting adviser even when its name is the exact match (Antares)', () => {
    // ANTARES CAPITAL CORPORATION is 802-76311: it files no Item 5. The
    // registered adviser is ANTARES CAPITAL ADVISERS LLC; the CREDIT adviser is
    // a sibling registration, not the brand's own.
    const text = search('Antares Capital', fixture('antares.search.json')).text!;
    expect(secAdvFirmCandidates(text, 'Antares Capital')).toEqual([
      expect.objectContaining({ crd: '281998', matchedBy: 'brand' }),
    ]);
    expect(secAdvFirmMatch(text, 'Antares Capital')).toBeNull();
  });

  it('skips inactive registrations and ignores relying-adviser aliases (Apollo)', () => {
    const text = search('Apollo Global Management', fixture('apollo.search.json')).text!;
    expect(crds(secAdvFirmCandidates(text, 'Apollo Global Management'))).toEqual(['143161']);
  });

  it('keeps a wealth adviser\'s DBA as a candidate only — the filing decides (Golub)', () => {
    const text = search('Golub Capital', fixture('golub.search.json')).text!;
    const candidates = secAdvFirmCandidates(text, 'Golub Capital');
    expect(candidates).toEqual([
      expect.objectContaining({ crd: '145488', matchedBy: 'name' }),
      expect.objectContaining({ crd: '148687', matchedBy: 'brand' }),
    ]);
  });

  it('lets a unique firm-name match stand alone, and refuses broker-only and multi-adviser brands', () => {
    const ares = fixture('ares.search.json');
    expect(secAdvFirmCandidates(ares, 'Ares Management')).toEqual([expect.objectContaining({ crd: '130074', matchedBy: 'name' })]);
    // Blue Owl's advisers are Credit, GPSC and Real Estate — none is the brand.
    expect(secAdvFirmCandidates(fixture('blue-owl.search.json'), 'Blue Owl Capital')).toEqual([]);
    const many = JSON.stringify({ hits: { total: 4, hits: ['1', '2', '3', '4'].map((crd) => ({
      _source: { firm_source_id: crd, firm_name: `ZENITH ${['CAPITAL', 'ADVISERS', 'PARTNERS', 'MANAGEMENT'][Number(crd) - 1]!} LLC`,
        firm_ia_full_sec_number: `801-${crd}`, firm_ia_scope: 'ACTIVE' },
    })) } });
    expect(secAdvFirmCandidates(many, 'Zenith Global')).toEqual([]);
  });
});

describe('brand identity: search candidate AND filed website', () => {
  const antares = () => [search('Antares Capital', fixture('antares.search.json')),
    report('163334', fixture('antares-capital-corporation-era.retained.txt')),
    report('281998', fixture('antares-capital-advisers.retained.txt'))];

  it('lands the identified adviser\'s own total, naming the adviser (Antares)', () => {
    const observation = secAdvAumObservation('Antares Capital', antares(), NOW, 'https://www.antares.com/')!;
    expect(observation.value).toBe(47_394_478_494);
    expect(observation.passageSupport.sourceUrl).toBe(secAdvReportUrl('281998'));
    expect(observation.methodNote).toContain('ANTARES CAPITAL ADVISERS LLC');
    expect(observation.methodNote).toContain('not a sum across affiliated advisers');
  });

  it('refuses without the official website, with a different website, or without the search', () => {
    expect(secAdvAumObservation('Antares Capital', antares(), NOW)).toBeNull();
    expect(secAdvAumObservation('Antares Capital', antares(), NOW, 'https://antarescapital-partners.com')).toBeNull();
    expect(secAdvAumObservation('Antares Capital', antares().slice(1), NOW, 'antares.com')).toBeNull();
  });

  it('never lands an adviser entity\'s headcount as the brand\'s headcount', () => {
    expect(secAdvEmployeesObservation('Antares Capital', antares(), NOW, 'antares.com')).toBeNull();
  });

  it('picks the adviser whose filing lists the site over a DBA namesake (Golub)', () => {
    const receipts = [search('Golub Capital', fixture('golub.search.json')),
      report('145488', fixture('arete-wealth-advisors.retained.txt')), report('148687', fixture('gc-advisors.retained.txt'))];
    expect(secAdvAumObservation('Golub Capital', receipts, NOW, 'golubcapital.com')?.value).toBe(177_850_378_131);
    // If a second candidate also listed the site, that is ambiguity: no figure.
    const doctored = fixture('arete-wealth-advisors.retained.txt')
      .concat('\nAddress of Website/Account on Publicly Available Social Media Platform: https://golubcapital.com/');
    expect(secAdvAumObservation('Golub Capital', [receipts[0]!, report('145488', doctored), receipts[2]!], NOW, 'golubcapital.com')).toBeNull();
  });

  it('identifies Apollo\'s registered adviser through apollo.com', () => {
    const receipts = [search('Apollo Global Management', fixture('apollo.search.json')),
      report('143161', fixture('apollo-capital-management.retained.txt'))];
    expect(secAdvAumObservation('Apollo Global Management', receipts, NOW, 'https://www.apollo.com')?.value).toBe(718_476_737_320);
  });

  it('lets a filing in the company\'s own name outrank a brand-identified adviser', () => {
    const own = fixture('hps-investment-partners.retained.txt')
      .replace(/HPS INVESTMENT PARTNERS, LLC/g, 'APOLLO GLOBAL MANAGEMENT, INC.').replace('CRD Number: 282125', 'CRD Number: 900001');
    const receipts = [search('Apollo Global Management', fixture('apollo.search.json')),
      report('143161', fixture('apollo-capital-management.retained.txt')), report('900001', own)];
    expect(secAdvAumObservation('Apollo Global Management', receipts, NOW, 'apollo.com')?.value).toBe(175_724_114_956);
  });

  it('still lands a name match without any website (HPS), employees included', () => {
    const receipts = [report('282125', fixture('hps-investment-partners.retained.txt'))];
    expect(secAdvAumObservation('HPS Investment Partners', receipts, NOW)?.value).toBe(175_724_114_956);
    expect(secAdvEmployeesObservation('HPS Investment Partners', receipts, NOW)?.value).toBe(826);
  });
});

describe('metric-support passage gate for brand-identified ADV figures', () => {
  it('accepts only the exact re-derivation from the same report, with the website in hand', () => {
    const originals = [search('Antares Capital', fixture('antares.search.json')),
      report('163334', fixture('antares-capital-corporation-era.retained.txt')),
      report('281998', fixture('antares-capital-advisers.retained.txt'))];
    const observed = secAdvAumObservation('Antares Capital', originals, NOW, 'antares.com')!;
    const input = { companyName: 'Antares Capital', officialWebsite: 'antares.com', nowMs: NOW, metricType: 'aum' as const,
      value: observed.value, support: observed.passageSupport, originals };
    expect(acceptedMetricPassage(input)).toHaveLength(1);
    expect(acceptedMetricPassage({ ...input, officialWebsite: null })).toEqual([]);
    expect(acceptedMetricPassage({ ...input, support: { ...observed.passageSupport, sourceUrl: secAdvReportUrl('163334') } })).toEqual([]);
    expect(acceptedMetricPassage({ ...input, value: observed.value + 1 })).toEqual([]);
  });
});
