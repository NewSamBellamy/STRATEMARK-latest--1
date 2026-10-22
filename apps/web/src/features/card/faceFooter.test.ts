import { describe, expect, it } from 'vitest';
import { buildDataset } from '@mi/mocks';
import type { CardWithCompany } from '@mi/contracts';
import { cardUpdatedAt, faceFooter, shortDate } from './faceFooter';

const dataset = buildDataset();
const card = dataset.cards.find((c) => c.cardType === 'company' && c.companyId)!;
const company = dataset.companies.find((c) => c.id === card.companyId)!;
const base: CardWithCompany = {
  card: { ...card, createdAt: '2026-07-30T10:00:00.000Z' },
  company: { ...company, founded: null },
  metrics: [],
  viceClaims: [],
};
const now = new Date('2026-10-22T12:00:00.000Z');

describe('the card face footer', () => {
  it('says when the card last changed, from the newest timestamp its research carries', () => {
    const seed = dataset.metrics.find((m) => m.companyId === company.id)!;
    const data = { ...base, metrics: [{ ...seed, capturedAt: '2026-10-01T00:00:00.000Z', lastVerifiedAt: '2026-10-20T08:00:00.000Z' }] };
    expect(cardUpdatedAt(data)?.toISOString()).toBe('2026-10-20T08:00:00.000Z');
    expect(faceFooter(data, now).updated).toBe('Updated 20 Oct');
  });

  it('adds the year for another year, and says nothing when there is no timestamp', () => {
    expect(shortDate(new Date('2025-07-30T12:00:00.000Z'), now)).toBe('30 Jul 2025');
    const undated = { ...base, card: { ...base.card, createdAt: 'not a date' } };
    expect(faceFooter(undated, now).updated).toBeNull();
  });

  it('shows the founding year only when it has a source', () => {
    const founded = { year: 1960, source: 'wikidata' as const, citations: [{ title: 'Wikidata', url: 'https://www.wikidata.org/wiki/Q1' }], capturedAt: '2026-07-01T00:00:00.000Z' };
    expect(faceFooter({ ...base, company: { ...company, founded } }, now).lead).toBe('Founded 1960');
    const unsourced = { ...founded, citations: [{ title: 'x', url: 'javascript:alert(1)' }] };
    expect(faceFooter({ ...base, company: { ...company, founded: unsourced } }, now).lead).toBeNull();
    expect(faceFooter(base, now).lead).toBeNull();
    expect(faceFooter({ ...base, company: null }, now).lead).toBeNull();
  });
});
