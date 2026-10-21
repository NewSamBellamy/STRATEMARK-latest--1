import { describe, expect, it } from 'vitest';
import { isContentFreeOneLiner, scrubOneLiner } from './oneliner-scrub';

describe('scrubOneLiner', () => {
  it('removes a modifier and keeps the grammar', () => {
    expect(scrubOneLiner('Seedlip Ltd. is a pioneering creator of distilled botanical non-alcoholic spirit alternatives.'))
      .toBe('Seedlip Ltd. is a creator of distilled botanical non-alcoholic spirit alternatives.');
    expect(scrubOneLiner('Givaudan SA is a world-leading flavor and taste engineering house in Switzerland.'))
      .toBe('Givaudan SA is a flavor and taste engineering house in Switzerland.');
    expect(scrubOneLiner('Döhler GmbH is a global technology-driven producer of ingredients.'))
      .toBe('Döhler GmbH is a producer of ingredients.');
  });

  it('turns "a category leader manufacturing X" into a plain verb', () => {
    expect(scrubOneLiner("Lyre's Spirit Co. is a global category leader manufacturing a comprehensive range of non-alcoholic classic spirits and RTDs."))
      .toBe("Lyre's Spirit Co. manufactures a range of non-alcoholic classic spirits and RTDs.");
  });

  it('rejects a sentence whose boast cannot be cleanly removed', () => {
    expect(scrubOneLiner('Athletic Brewing Company is a dominant non-alcoholic craft beverage pioneer scaling high-end alternative production.')).toBeNull();
    expect(scrubOneLiner('Acme is the leading maker of widgets.')).toBeNull();
    expect(scrubOneLiner("Acme is one of the world's largest makers of widgets.")).toBeNull();
    expect(scrubOneLiner('Acme is innovative.')).toBeNull();
  });

  it('rejects content-free location or founding lines', () => {
    expect(scrubOneLiner('Pentire Drinks is headquartered in Cornwall, United Kingdom.')).toBeNull();
    expect(isContentFreeOneLiner('Acme was founded in 2015.')).toBe(true);
    expect(isContentFreeOneLiner('Acme is a UK-based company.')).toBe(true);
    expect(isContentFreeOneLiner('Acme is headquartered in Leeds and makes tonic water.')).toBe(false);
  });

  it('keeps plain descriptions, fixes articles, and is idempotent', () => {
    const plain = 'Pentire Drinks makes botanical non-alcoholic spirits in Cornwall.';
    expect(scrubOneLiner(plain)).toBe(plain);
    const once = scrubOneLiner('Acme is an innovative firm that bottles tonic water.');
    expect(once).toBe('Acme is a firm that bottles tonic water.');
    expect(scrubOneLiner(once)).toBe(once);
  });

  it('drops only the bad sentence of several', () => {
    expect(scrubOneLiner('Acme is a dominant pioneer in tonics. Acme bottles tonic water in Leeds.')).toBe('Acme bottles tonic water in Leeds.');
  });
});

// ---- Where the scrubber is applied ----
import type { Card, Company, Deck } from '@mi/contracts';
import { UNSUPPORTED_COMPANY_SUMMARY, homepageCompanySummary } from './company-summary';
import { buildStubs } from './pipeline';
import { METRIC_GATE_VERSION, revalidateStoredMetrics } from './revalidate-stored';
import type { OriginalSourceReceipt } from './original-source';

const SEEDLIP = 'Seedlip Ltd. is a pioneering creator of distilled botanical non-alcoholic spirit alternatives.';
const ATHLETIC = 'Athletic Brewing Company is a dominant non-alcoholic craft beverage pioneer scaling high-end alternative production.';
const PENTIRE = 'Pentire Drinks is headquartered in Cornwall, United Kingdom.';

describe('stub cards', () => {
  it('never carry the model wording as the stored one-liner or card summary', () => {
    const deck = { id: 'deck_1', marketId: 'mkt_1', name: 'NA spirits' } as unknown as Deck;
    const stubs = buildStubs([
      { name: 'Seedlip Ltd.', domain: 'seedlipdrinks.com', descriptor: SEEDLIP, cardTypes: ['company'] },
      { name: 'Athletic Brewing Company', domain: 'athleticbrewing.com', descriptor: ATHLETIC, cardTypes: ['company'] },
      { name: 'Pentire Drinks', domain: 'pentiredrinks.com', descriptor: PENTIRE, cardTypes: ['company'] },
    ], deck);
    expect(stubs.map((s) => s.company!.oneLiner)).toEqual([
      'Seedlip Ltd. is a creator of distilled botanical non-alcoholic spirit alternatives.', '', '']);
    expect(stubs.map((s) => s.card.summary)).toEqual([
      'Seedlip Ltd. is a creator of distilled botanical non-alcoholic spirit alternatives.', null, null]);
  });
});

describe('revalidateStoredMetrics — v5 model one-liners', () => {
  const co = (id: string, name: string, oneLiner: string): Company =>
    ({ id, name, oneLiner, logoUrl: null, hqLocation: null, websiteUrl: null, brandTheme: null }) as Company;
  const card = (id: string, companyId: string, summary: string | null, cited: boolean): Card =>
    ({ id, deckId: 'd', companyId, cardType: 'company', title: null, summary, tier: null, tierReason: null,
      citations: cited ? [{ title: 'x.com', url: 'https://x.com/' }] : [] }) as Card;
  const snapshot = () => ({
    metricGateVersion: METRIC_GATE_VERSION - 1, metrics: [], dashboards: {},
    companies: [co('a', 'Seedlip Ltd.', SEEDLIP), co('b', 'Athletic Brewing Company', ATHLETIC), co('c', 'Pentire Drinks', PENTIRE),
      co('d', 'Cited Co', 'Cited Co is a pioneering maker of widgets.')],
    cards: [card('ca', 'a', SEEDLIP, false), card('cb', 'b', ATHLETIC, false), card('cc', 'c', PENTIRE, false),
      card('cd', 'd', 'Cited Co is a pioneering maker of widgets.', true)],
  });

  it('scrubs uncited model lines, restores the placeholder when unsalvageable, leaves cited ones, and is idempotent', () => {
    const snap = snapshot();
    const out = revalidateStoredMetrics(snap);
    expect(snap.companies.map((c) => c.oneLiner)).toEqual([
      'Seedlip Ltd. is a creator of distilled botanical non-alcoholic spirit alternatives.',
      UNSUPPORTED_COMPANY_SUMMARY, UNSUPPORTED_COMPANY_SUMMARY, 'Cited Co is a pioneering maker of widgets.']);
    expect(snap.cards!.map((c) => c.summary)).toEqual([
      'Seedlip Ltd. is a creator of distilled botanical non-alcoholic spirit alternatives.',
      UNSUPPORTED_COMPANY_SUMMARY, UNSUPPORTED_COMPANY_SUMMARY, 'Cited Co is a pioneering maker of widgets.']);
    expect(out.scrubbedSummaries.map((s) => s.companyId)).toEqual(['a', 'b', 'c']);
    snap.metricGateVersion = METRIC_GATE_VERSION - 1;
    expect(revalidateStoredMetrics(snap).scrubbedSummaries).toEqual([]);
  });
});

describe('homepage sentence for a company named with a legal suffix', () => {
  it('matches "Seedlip" on the site to "Seedlip Ltd."', () => {
    const homepage: OriginalSourceReceipt = { requestedUrl: 'https://seedlipdrinks.com', finalUrl: 'https://seedlipdrinks.com/', status: 'retrieved',
      httpStatus: 200, retrievedAt: '2026-10-13T00:00:00.000Z', contentHash: 'a'.repeat(64),
      text: '<p>Seedlip makes distilled non-alcoholic spirits from botanicals.</p>' };
    expect(homepageCompanySummary({ companyName: 'Seedlip Ltd.', websiteUrl: 'https://seedlipdrinks.com', homepage })?.summary)
      .toBe('Seedlip makes distilled non-alcoholic spirits from botanicals.');
  });
});
