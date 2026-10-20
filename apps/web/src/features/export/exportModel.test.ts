import { describe, expect, it } from 'vitest';
import type { CardWithCompany, Company, CompanyMetric, Ownership, ThreadMessage } from '@mi/contracts';
import { buildCardView, estimateHolds } from '@/features/card/card-view';
import { splitFollowUps } from '@/features/deepdive/followUps';
import {
  buildReportModel,
  companiesFromCards,
  csvCell,
  exportSource,
  metricRowsFor,
  metricsToCsv,
  transcriptToMarkdown,
  type ExportCompany,
} from './exportModel';

const m = (o: Partial<CompanyMetric>): CompanyMetric =>
  ({
    id: 'm', companyId: 'c', metricType: 'arr', value: null, confidence: 'unknown', source: null,
    citations: [], methodNote: null, capturedAt: '2026-01-02T00:00:00.000Z', ...o,
  }) as CompanyMetric;

const co = (metrics: CompanyMetric[]): ExportCompany => ({
  id: 'c', name: 'Acme, Inc.', oneLiner: 'Makes things', hq: 'Austin', website: null, logoUrl: null, tier: 3, metrics,
});

const sourced = m({
  metricType: 'arr', value: 120_000_000, confidence: 'verified',
  citations: [{ title: 'reuters.com', url: 'https://reuters.com/acme' }],
  passageSupport: { sourceUrl: 'https://reuters.com/acme', quote: 'q', asOf: '2025-03-01', basis: 'arr', unit: 'USD' },
});

describe('export model', () => {
  it('exports sources by publisher with a link that works, never an opaque redirect', () => {
    const redirect = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQabc';
    expect(exportSource({ url: redirect, title: 'techcrunch.com' })).toEqual({
      title: 'techcrunch.com', url: 'https://www.google.com/search?q=techcrunch.com', direct: false });
    expect(exportSource({ url: redirect, title: '' }).title).toBe('Publisher not recorded');
    expect(exportSource({ url: 'https://reuters.com/acme', title: '' })).toEqual({ title: 'reuters.com', url: 'https://reuters.com/acme', direct: true });
    const viaRedirect = m({ ...sourced, citations: [{ title: 'reuters.com', url: redirect }] });
    const csv = metricsToCsv('Widgets', [co([viaRedirect])]);
    expect(csv).not.toContain('vertexaisearch');
    // A search link is labelled as one; a publisher's own page is labelled as a page; no source is blank.
    const lines = (text: string) => text.replace('﻿', '').trim().split('\r\n');
    const rows = lines(csv);
    expect(rows[0]!.split(',').at(-1)).toBe('source_link');
    expect(rows.find((l) => l.includes(',ARR,'))!.split(',').at(-1)).toBe('search');
    const direct = lines(metricsToCsv('Widgets', [co([sourced])]));
    expect(direct.find((l) => l.includes(',ARR,'))!.split(',').at(-1)).toBe('page');
    expect(direct.find((l) => l.includes(',Employees,'))!.split(',').at(-1)).toBe('');
    const report = buildReportModel({ title: 'Widgets', kind: 'deck', companies: [co([viaRedirect])] });
    expect(report.companies[0]!.footnotes.every((f) => !f.url.includes('vertexaisearch') && f.direct === false)).toBe(true);
  });

  it('keeps sourced figures with as-of and marks the rest Unknown', () => {
    const rows = metricRowsFor(co([sourced]));
    const arr = rows.find((r) => r.type === 'arr')!;
    expect(arr.unknown).toBe(false);
    // The card face's own display ("$120M"); the old export-only formatter said "$120.0M".
    expect(arr.valueText).toBe('$120M');
    expect(arr.asOf).toBe('2025-03-01');
    const emp = rows.find((r) => r.type === 'employees')!;
    expect(emp.unknown).toBe(true);
    expect(emp.value).toBeNull();
    expect(emp.valueText).toBe('Unknown');
  });

  it('never shows a figure that has no usable source (downgraded to Unknown)', () => {
    const row = metricRowsFor(co([m({ metricType: 'valuation', value: 5e9, confidence: 'verified', citations: [] })]))
      .find((r) => r.type === 'valuation')!;
    expect(row.unknown).toBe(true);
    expect(row.value).toBeNull();
  });

  it('lets a human-verified figure stand without an external source', () => {
    const row = metricRowsFor(co([m({ metricType: 'employees', value: 40, confidence: 'user_verified' })]))
      .find((r) => r.type === 'employees')!;
    expect(row.unknown).toBe(false);
    expect(row.confidence).toBe('user_verified');
  });

  it('numbers citations as per-company footnotes, de-duplicated', () => {
    // Verified, not "estimated": an estimate with no retained support is Unknown on the card, so it is Unknown here.
    const second = m({
      metricType: 'employees', value: 300, confidence: 'verified',
      citations: [{ title: 'reuters.com', url: 'https://reuters.com/acme' }, { title: 'sec.gov', url: 'https://sec.gov/x' }],
    });
    const model = buildReportModel({ title: 'Mkt', kind: 'deck', companies: [co([sourced, second])] });
    const c = model.companies[0]!;
    expect(c.footnotes.map((f) => f.url)).toEqual(['https://reuters.com/acme', 'https://sec.gov/x']);
    expect(c.rows.find((r) => r.type === 'employees')!.footnotes).toEqual([1, 2]);
    expect(model.unknownCount).toBeGreaterThan(0);
    expect(model.figureCount).toBe(2);
  });

  it('CSV carries source URL and as-of, blanks unknown values, and escapes cells', () => {
    const csv = metricsToCsv('eVTOL', [co([sourced])]);
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toContain('source_url');
    const arr = lines.find((l) => l.includes(',ARR,'))!;
    expect(arr).toContain('"Acme, Inc."');
    expect(arr).toContain('120000000');
    expect(arr).toContain('2025-03-01');
    expect(arr).toContain('https://reuters.com/acme');
    const emp = lines.find((l) => l.includes(',Employees,'))!;
    expect(emp).toMatch(/,Employees,,Unknown,unknown,/);
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
  });

  it('transcript markdown drops the follow-up line and lists sources', () => {
    const messages: ThreadMessage[] = [
      { id: '1', role: 'user', text: 'Who leads?', citations: [], at: '' },
      {
        id: '2', role: 'assistant', at: '',
        text: 'Acme leads (verified, as of 2025-03).\n\nFollow-ups: Compare ARR | What are the risks?',
        citations: [{ title: 'Reuters', url: 'https://reuters.com/acme' }],
      },
    ];
    const md = transcriptToMarkdown({ title: 'Chat', messages, now: new Date('2026-10-10') });
    expect(md).toContain('**You:** Who leads?');
    expect(md).not.toContain('Follow-ups');
    expect(md).toContain('[Reuters](https://reuters.com/acme)');
    expect(md).toContain('Generated by Stratemark');
  });
});

// -- The export says what the card face says --------------------------------------------------

const reuters = [{ title: 'reuters.com', url: 'https://reuters.com/acme' }];
const verifiedRow = (o: Partial<CompanyMetric>) => m({ confidence: 'verified', citations: reuters, ...o });

const acmeCompany: Company = {
  id: 'c', name: 'Acme, Inc.', oneLiner: 'Makes things', logoUrl: null, hqLocation: 'Austin', websiteUrl: null,
  brandTheme: null, ownership: null,
};
function cardOf(metrics: CompanyMetric[], ownership: Ownership | null = null): CardWithCompany {
  return {
    card: { id: 'card_c', deckId: 'd', companyId: 'c', cardType: 'company', title: 'Acme', tier: 3, summary: null, keyPoints: [], citations: [] } as unknown as CardWithCompany['card'],
    company: { ...acmeCompany, ownership },
    metrics,
    viceClaims: [],
  };
}
/** The export subject as a deck hands it over, the card face for the same data, and the row/CSV for a metric type. */
function both(metrics: CompanyMetric[], ownership: Ownership | null = null) {
  const data = cardOf(metrics, ownership);
  const subject = companiesFromCards([data])[0]!;
  const rows = metricRowsFor(subject);
  const csvLine = (label: string) =>
    metricsToCsv('Mkt', [subject]).replace('﻿', '').trim().split('\r\n').find((l) => l.includes(`,${label},`))!;
  return {
    face: buildCardView(data),
    rows,
    row: (type: string) => rows.find((r) => r.type === type)!,
    csvLine,
    pdf: buildReportModel({ title: 'Mkt', kind: 'deck', companies: [subject] }),
  };
}
const asUnknown = { unknown: true, value: null, valueText: 'Unknown', confidence: 'unknown' } as const;

const acquired: Ownership = {
  status: 'acquired', acquirer: 'PepsiCo', announcedOn: '2025-03-17', closedOn: '2025-05-01',
  price: { value: 1.95e9, currency: 'USD' }, confidence: 'verified', methodNote: null,
  citations: [{ title: 'reuters.com', url: 'https://reuters.com/acme-deal' }],
};
const supportedHeadcount = m({
  metricType: 'employees', value: 123, confidence: 'estimated', citations: reuters,
  reportedSupport: {
    provider: 'google-search', companyName: 'Acme, Inc.', basis: 'employees', value: 123, unit: 'count',
    definition: 'employees', asOf: '2026-10-01',
    support: { supportIndex: 0, text: 'Acme, Inc. reported 123 employees as of 2026-10-01.', sources: [{ chunkIndex: 0, title: 'reuters.com', url: 'https://reuters.com/acme' }] },
  },
});

describe('export matches the card face', () => {
  it('shows an acquired company\'s purchase price as Unknown valuation, in the CSV, the PDF and the table', () => {
    const valuation = verifiedRow({
      metricType: 'valuation', value: 1.95e9,
      passageSupport: { sourceUrl: 'https://reuters.com/acme', quote: 'Acme is valued at $1.95 billion.', asOf: '2025-03-01', basis: 'valuation', unit: 'USD' },
    });
    const x = both([valuation], acquired);
    // The face withholds it...
    expect(x.face.profileMetrics.find((s) => s.key === 'company_value')!.display).toBe('Unknown');
    expect(x.face.faceMetrics.some((s) => s.metric?.metricType === 'valuation')).toBe(false);
    // ...so every export does: no value, no figure, no confidence, no source, and the reason in plain words.
    expect(x.row('valuation')).toMatchObject({ ...asUnknown, sources: [] });
    expect(x.row('valuation').note).toMatch(/acquired/i);
    expect(x.csvLine('Valuation')).toMatch(/,Valuation,,Unknown,unknown,/);
    expect(x.csvLine('Valuation')).not.toMatch(/1950000000|1\.9B|\$2B|reuters/);
    expect(x.pdf.figureCount).toBe(0);
  });

  it.each([
    ['NaN', { metricType: 'arr', value: NaN }],
    ['a negative headcount', { metricType: 'employees', value: -5 }],
    ['a market share over 100%', { metricType: 'market_share', value: 340 }],
    ['a zero user count nobody established', { metricType: 'users', value: 0 }],
  ] as const)('exports %s as Unknown, never as verified', (_name, patch) => {
    const x = both([verifiedRow(patch)]);
    expect(x.face.metrics[0]!.display).toBe('Unknown');
    expect(x.row(patch.metricType)).toMatchObject(asUnknown);
    expect(x.csvLine(x.row(patch.metricType).label)).toMatch(/,Unknown,unknown,/);
    expect(x.csvLine(x.row(patch.metricType).label)).not.toMatch(/verified|NaN/);
  });

  it('does not let a source the card rejects make a figure verified', () => {
    const reddit = verifiedRow({ metricType: 'employees', value: 500, citations: [{ title: 'reddit.com', url: 'https://www.reddit.com/r/acme/comments/1' }] });
    const x = both([reddit]);
    expect(x.face.profileMetrics.find((s) => s.key === 'employees')!.display).toBe('Unknown');
    expect(x.row('employees')).toMatchObject(asUnknown);
    expect(x.csvLine('Employees')).not.toMatch(/,verified,/);
  });

  it('exports an estimate only when it holds on its own evidence, and calls it an estimate', () => {
    const held = both([supportedHeadcount]);
    expect(held.face.faceMetrics.find((s) => s.metric?.metricType === 'employees')).toMatchObject({ display: '123', confidence: 'Source reported' });
    expect(held.row('employees')).toMatchObject({ unknown: false, valueText: '123', confidence: 'estimated' });
    // Even on a user-generated source it is an estimate, never verified.
    const reddit = [{ title: 'reddit.com', url: 'https://www.reddit.com/r/acme/comments/1' }];
    expect(both([{ ...supportedHeadcount, citations: reddit }]).row('employees').confidence).toBe('estimated');
    // No retained support: Unknown on the card, Unknown in the export.
    const bare = both([{ ...supportedHeadcount, reportedSupport: null }]);
    expect(bare.face.profileMetrics.find((s) => s.key === 'employees')!.display).toBe('Unknown');
    expect(bare.row('employees')).toMatchObject(asUnknown);
    expect(estimateHolds(acmeCompany, supportedHeadcount)).toBe(true);
    expect(estimateHolds(acmeCompany, { ...supportedHeadcount, reportedSupport: null })).toBe(false);
    expect(estimateHolds(null, supportedHeadcount)).toBe(false);
  });

  it('withholds two conflicting current revisions instead of picking one and calling it verified', () => {
    const rows = [verifiedRow({ id: 'a', metricType: 'employees', value: 100 }), verifiedRow({ id: 'b', metricType: 'employees', value: 200 })];
    for (const input of [rows, [...rows].reverse()]) {
      const x = both(input);
      expect(x.face.profileMetrics.find((s) => s.key === 'employees')!.display).toBe('Unknown');
      expect(x.row('employees')).toMatchObject(asUnknown);
      expect(x.row('employees').note).toMatch(/conflicting/i);
    }
  });

  it('takes the newest record, as the card does, whatever order the rows arrive in', () => {
    const older = verifiedRow({ id: 'older', metricType: 'employees', value: 100, capturedAt: '2026-01-01T00:00:00.000Z' });
    const newer = verifiedRow({ id: 'newer', metricType: 'employees', value: 200, capturedAt: '2026-06-01T00:00:00.000Z' });
    for (const input of [[older, newer], [newer, older]]) {
      const x = both(input);
      expect(x.face.profileMetrics.find((s) => s.key === 'employees')!.display).toBe('200');
      expect(x.row('employees')).toMatchObject({ value: 200, valueText: '200', confidence: 'verified' });
    }
  });

  it.each([
    ['valuation', 1.95e9, '$2B'],
    ['valuation', 1.45e9, '$1.5B'],
    ['arr', 120_000_000, '$120M'],
    ['users', 1_449_999, '1.4M'],
    ['employees', 48_300, '48.3K'],
    ['market_share', 12.34, '12.3%'],
  ] as const)('writes %s %d the way the card writes it (%s)', (type, value, shown) => {
    const x = both([verifiedRow({ metricType: type, value })]);
    const onCard = x.face.metrics.find((v) => v.metric.metricType === type)!.display;
    expect(onCard).toBe(shown);
    expect(x.row(type).valueText).toBe(onCard);
    expect(x.csvLine(x.row(type).label)).toContain(`,${shown},`);
  });

  it('never shows another company\'s figure on this company', () => {
    const rival = verifiedRow({ id: 'rival', companyId: 'rival-co', metricType: 'valuation', value: 90e9 });
    const x = both([rival]);
    expect(x.row('valuation')).toMatchObject(asUnknown);
    expect(x.csvLine('Valuation')).not.toMatch(/90000000000|\$90B/);
    expect(x.pdf.figureCount).toBe(0);
    // Own rows beside a rival's: only the own row is read, even when the rival's is newer.
    const own = verifiedRow({ id: 'own', metricType: 'valuation', value: 5e9, capturedAt: '2026-01-01T00:00:00.000Z' });
    const mixed = both([{ ...rival, capturedAt: '2026-09-01T00:00:00.000Z' }, own]);
    expect(mixed.row('valuation')).toMatchObject({ value: 5e9, valueText: '$5B' });
  });
});

// -- Labels, prose and signal cards ---------------------------------------------------------------------------------

const proof = (definition: NonNullable<CompanyMetric['passageSupport']>['definition'], basis: CompanyMetric['metricType'], quote = 'q') => ({
  sourceUrl: 'https://reuters.com/acme', quote, asOf: '2025-03-01', basis, unit: 'count' as const, definition,
});

describe('export labels are the card face\'s labels', () => {
  it.each([
    ['users', 12_000, { passageSupport: proof('paying_customers', 'users') }, 'Paying customers'],
    ['users', 12_000, { passageSupport: proof('monthly_active_users', 'users') }, 'Monthly active users'],
    ['users', 12_000, { methodNote: 'GitHub stars on the main repository' }, 'GitHub stars'],
    ['users', 12_000, { methodNote: 'App installs and downloads' }, 'Installs / downloads'],
    ['distribution', 600, { methodNote: 'Sold through 600 stockists' }, 'Stockists'],
    ['distribution', 40, { methodNote: 'Available in 40 countries' }, 'Countries'],
    ['arr', 9_000_000, { passageSupport: proof('annual_revenue', 'arr') }, 'Annual revenue'],
  ] as const)('a %s figure of %d is labelled by what its source measures', (type, value, patch, label) => {
    const x = both([verifiedRow({ metricType: type, value, ...patch })]);
    // What the card face prints for this figure...
    expect(x.face.faceMetrics.find((s) => s.metric?.metricType === type)!.label).toBe(label);
    // ...is what every export prints.
    expect(x.row(type).label).toBe(label);
    expect(x.csvLine(label)).toContain(`,${value},`);
    expect(x.pdf.companies[0]!.rows.find((r) => r.type === type)!.label).toBe(label);
  });

  it('keeps the type\'s own name when the face only has a slot-level label, and for a figure nobody reports', () => {
    // The face calls an undefined ARR figure "Revenue / ARR" (the slot's name); the export row IS ARR.
    const x = both([verifiedRow({ metricType: 'arr', value: 9_000_000 }), verifiedRow({ id: 'u', metricType: 'users', value: 500 })]);
    expect(x.row('arr').label).toBe('ARR');
    expect(x.row('users').label).toBe('Users');
    expect(x.row('employees').label).toBe('Employees');
    expect(x.row('market_share').label).toBe('Market share');
  });
});

describe('the company one-liner in exports', () => {
  const liner = (oneLiner: string | null) => ({ ...co([]), oneLiner });

  it('does not print a figure nobody source-checked, beside rows that say Unknown', () => {
    const model = buildReportModel({ title: 'Mkt', kind: 'deck', companies: [
      liner('Acme is a $5B robotics company with 12,000 employees and 3 million users.'),
    ] });
    expect(model.companies[0]!.oneLiner).toBeNull();
    expect(model.companies[0]!.rows.find((r) => r.type === 'valuation')).toMatchObject({ unknown: true, valueText: 'Unknown' });
  });

  it('keeps the sentences that state no figure, as stored', () => {
    const model = buildReportModel({ title: 'Mkt', kind: 'company', companies: [liner('Acme builds warehouse robots. It has 12,000 employees.')] });
    expect(model.companies[0]!.oneLiner).toBe('Acme builds warehouse robots.');
    expect(buildReportModel({ title: 'Mkt', kind: 'company', companies: [liner(null)] }).companies[0]!.oneLiner).toBeNull();
  });
});

describe('signal cards never add a company to an export', () => {
  const entity = cardOf([verifiedRow({ metricType: 'employees', value: 40 })]);
  const rival = { ...acmeCompany, id: 'rival-co', name: 'Rival Corp' };
  const signal = (cardType: 'barrier' | 'insight' | 'vice' | 'culture') => ({
    ...entity,
    card: { ...entity.card, id: `sig_${cardType}`, cardType, companyId: 'rival-co' },
    company: rival,
    metrics: [],
  }) as CardWithCompany;

  it.each(['barrier', 'insight', 'vice', 'culture'] as const)('a company-bearing %s card adds no company', (cardType) => {
    const subjects = companiesFromCards([entity, signal(cardType)]);
    expect(subjects.map((c) => c.name)).toEqual(['Acme, Inc.']);
  });
});

describe('splitFollowUps', () => {
  it('extracts up to three chips', () => {
    const r = splitFollowUps('Answer.\n\nFollow-ups: One thing? | Two thing? | Three thing? | Four thing?');
    expect(r.body).toBe('Answer.');
    expect(r.followUps).toEqual(['One thing?', 'Two thing?', 'Three thing?']);
  });
  it('leaves plain answers untouched', () => {
    expect(splitFollowUps('Just an answer.')).toEqual({ body: 'Just an answer.', followUps: [] });
  });
});
