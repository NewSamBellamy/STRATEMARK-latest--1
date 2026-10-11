import { describe, expect, it } from 'vitest';
import type { CompanyMetric, ThreadMessage } from '@mi/contracts';
import { splitFollowUps } from '@/features/deepdive/followUps';
import {
  buildReportModel,
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
    const report = buildReportModel({ title: 'Widgets', kind: 'deck', companies: [co([viaRedirect])] });
    expect(report.companies[0]!.footnotes.every((f) => !f.url.includes('vertexaisearch') && f.direct === false)).toBe(true);
  });

  it('keeps sourced figures with as-of and marks the rest Unknown', () => {
    const rows = metricRowsFor(co([sourced]));
    const arr = rows.find((r) => r.type === 'arr')!;
    expect(arr.unknown).toBe(false);
    expect(arr.valueText).toBe('$120.0M');
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
    const second = m({
      metricType: 'employees', value: 300, confidence: 'estimated',
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
