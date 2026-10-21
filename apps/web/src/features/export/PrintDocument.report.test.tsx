import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { PrintDocument } from './PrintDocument';
import { buildReportModel, type ExportCompany } from './exportModel';

const company = (oneLiner: string | null): ExportCompany => ({
  id: 'c', name: 'Acme', oneLiner, hq: 'Austin', website: null, logoUrl: null, tier: null, metrics: [],
});

function printed(oneLiner: string | null, kind: 'deck' | 'company') {
  const model = buildReportModel({ title: 'Mkt', kind, companies: [company(oneLiner)] });
  const { container } = render(<PrintDocument job={{ kind: 'report', model }} />);
  return { text: container.textContent ?? '', lede: container.querySelector('.sm-lede')?.textContent ?? null };
}

describe('the printed company report', () => {
  it.each(['deck', 'company'] as const)('does not print a figure the one-liner states without a source (%s report)', (kind) => {
    const { text, lede } = printed('Acme is a $5B robotics company with 12,000 employees and 3 million users.', kind);
    expect(lede).toBeNull();
    expect(text).not.toMatch(/robotics company|\$5B|12,000/);
    // The table beside it still says Unknown, which is now all the page says about value.
    expect(text).toContain('Valuation');
    expect(text).toContain('Unknown');
  });

  it('prints the one-liner sentences that state no figure', () => {
    expect(printed('Acme builds warehouse robots. It has 12,000 employees.', 'company').lede).toBe('Acme builds warehouse robots.');
  });
});
