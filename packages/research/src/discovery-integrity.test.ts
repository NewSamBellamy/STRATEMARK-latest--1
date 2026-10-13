import { describe, expect, it } from 'vitest';
import { discoverySearchHints, isPlaceholderCompany, namedInNotes } from './pipeline';
import { companyNameKey, parseTickerMatches } from './market-quote';

describe('discovery never turns padding into companies', () => {
  const notes = 'Locus Robotics leads flexible warehouse automation. Symbotic Inc. builds autonomous pallet robots.';

  it('keeps names the notes mention, with or without a trailing legal or category word', () => {
    expect(namedInNotes('Locus Robotics', notes)).toBe(true);
    expect(namedInNotes('Symbotic', notes)).toBe(true);
    expect(namedInNotes('Symbotic Corporation', notes)).toBe(true);
  });

  it('rejects names the notes never mention', () => {
    expect(namedInNotes('Company Ten', notes)).toBe(false);
    expect(namedInNotes('Geek+', notes)).toBe(false);
  });

  it('recognises count-filling rows by name or descriptor', () => {
    expect(isPlaceholderCompany('Company Two')).toBe(true);
    expect(isPlaceholderCompany('Company 7')).toBe(true);
    expect(isPlaceholderCompany('Acme Robotics', 'Placeholder company to satisfy minimum count.')).toBe(true);
    expect(isPlaceholderCompany('Company Ventures')).toBe(false);
    expect(isPlaceholderCompany('Locus Robotics', 'Warehouse robots')).toBe(false);
  });
});

describe('ticker identity strips legal words from the end only', () => {
  it('matches a brand to its filed legal name', () => {
    expect(companyNameKey('AEROVIRONMENT, INC.')).toBe(companyNameKey('AeroVironment'));
    expect(companyNameKey('Microsoft Corporation')).toBe('MICROSOFT');
  });
  it('never shrinks "Company Ten" to TEN Holdings', () => {
    expect(companyNameKey('Company Ten')).toBe('COMPANY TEN');
    const map = JSON.stringify({ 0: { cik_str: 2030954, ticker: 'XHLD', title: 'TEN Holdings, Inc.' } });
    expect(parseTickerMatches(map, 'Company Ten')).toEqual([]);
  });
});

describe('discovery search hints', () => {
  const plan = { marketName: 'Cybersecurity Market', vertical: 'Cybersecurity', geography: 'Global', notes: null, searchThemes: [] };
  it('starts from the category leaders', () => {
    expect(discoverySearchHints(plan, 'all', [])).toEqual(['top Cybersecurity companies', 'Cybersecurity Market key players', 'leading Cybersecurity startups']);
  });
  it('gives every later pass its own queries, so a pass can find someone new', () => {
    const first = discoverySearchHints(plan, 'all', []);
    const passes = [discoverySearchHints(plan, 'company', [], undefined, 5), discoverySearchHints(plan, 'infrastructure', [], undefined, 5),
      discoverySearchHints(plan, 'all', [], 'email security', 5)];
    for (const hints of passes) expect(hints.some((h) => first.includes(h))).toBe(false);
    expect(passes[2]![0]).toBe('email security companies');
  });
  it('searches the requested names for an exact-scope deck', () => {
    expect(discoverySearchHints(plan, 'all', ['CrowdStrike'])).toEqual(['CrowdStrike company']);
  });
});
