import { describe, expect, it } from 'vitest';
import { buildStubs, discoverySearchHints, isPlaceholderCompany, namedInNotes } from './pipeline';
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

describe('placeholder-shaped names', () => {
  it.each(['Company Two', 'company ten', 'Company 10', 'Company A', 'Competitor A', 'Example Corp', 'Example Inc.',
    'Foo Bar Inc', 'Dummy Corp', 'TBD', 'N/A', 'Unknown company', 'Another startup', 'Startup 3', 'Vendor #2', '[Company Name]',
    'Your Company', 'Sample Company'])('rejects %s', (name) => {
    expect(isPlaceholderCompany(name)).toBe(true);
  });

  it.each(['Company.com', 'Company Ventures', 'Vendr', 'Example Health', 'Locus Robotics', 'Symbotic', 'Acme Robotics', 'Acme Inc.', 'Acme',
    'Players Health', 'Test Gorilla', 'Brandwatch', 'Entity Labs Pharma'])('keeps %s', (name) => {
    expect(isPlaceholderCompany(name)).toBe(false);
  });

  it('buildStubs and the ADK and delta gates never store a template row', () => {
    const deck = { id: 'deck_1', marketId: 'm1', title: 'x' } as unknown as Parameters<typeof buildStubs>[1];
    const stubs = buildStubs([
      { name: 'Locus Robotics', domain: 'locusrobotics.com', descriptor: 'robots', cardTypes: ['company'] },
      { name: 'Company Two', domain: null, descriptor: '', cardTypes: ['company'] },
      { name: 'Company Three', domain: null, descriptor: '', cardTypes: ['company'] },
    ], deck);
    expect(stubs.map((s) => s.company?.name)).toEqual(['Locus Robotics']);
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
