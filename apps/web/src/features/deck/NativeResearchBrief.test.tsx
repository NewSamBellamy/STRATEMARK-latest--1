import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ResearchBrief } from '@mi/contracts';
import { NativeResearchBrief } from './NativeResearchBrief';

function brief(): ResearchBrief {
  return {
    sections: [
      {
        section: 'overview',
        blocks: [
          {
            id: 'overview-note',
            text: 'Fictional repair scheduling software.',
            kind: 'reported',
            support: 'unreviewed',
            timeWindow: null,
            citations: [{ title: 'Overview source lead', url: 'https://fixture.invalid/overview' }],
          },
        ],
      },
      {
        section: 'offering',
        blocks: [
          {
            id: 'offering-note',
            text: 'A scheduling tool offered to repair teams.',
            kind: 'reported',
            support: 'unreviewed',
            timeWindow: 'September 2026',
            citations: [{ title: 'Offering source lead', url: 'https://fixture.invalid/offering' }],
          },
        ],
      },
      {
        section: 'position',
        blocks: [
          {
            id: 'position-note',
            text: 'Small repair teams may be the intended audience.',
            kind: 'analysis',
            support: 'unreviewed',
            timeWindow: null,
            citations: [{ title: 'Position source lead', url: 'https://fixture.invalid/position' }],
          },
        ],
      },
      {
        section: 'updates',
        blocks: [
          {
            id: 'updates-note',
            text: 'The fictional company described a pilot.',
            kind: 'reported',
            support: 'unreviewed',
            timeWindow: '2026 pilot announcement',
            citations: [{ title: 'Update source lead', url: 'https://fixture.invalid/update' }],
          },
        ],
      },
    ],
    openQuestions: ['Which teams actually use the product?'],
    limitations: ['Public source links have not been semantically reviewed.'],
  };
}
beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Brief rendering must not fetch');
    }),
  ),
);
afterEach(() => {
  cleanup();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('retained native research brief', () => {
  it.each([
    ['company', 'Products & business'],
    ['infrastructure', 'Capabilities'],
    ['distribution', 'Channels'],
  ] as const)(
    'renders four useful sections for %s with its role-specific offering label',
    async (cardType, offeringLabel) => {
      const user = userEvent.setup();
      render(<NativeResearchBrief brief={brief()} cardType={cardType} />);
      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
        'Overview',
        offeringLabel,
        'Market position',
        'Updates',
      ]);
      const overview = screen.getByRole('tabpanel');
      expect(within(overview).getByText('Fictional repair scheduling software.')).toBeVisible();
      expect(within(overview).getByText('Reported draft · unreviewed')).toBeVisible();
      expect(within(overview).getByText('Period unknown')).toBeVisible();
      expect(within(overview).getByRole('link', { name: 'Overview source lead' })).toHaveAttribute(
        'href',
        'https://fixture.invalid/overview',
      );
      expect(
        within(overview).queryByRole('link', { name: 'Offering source lead' }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole('tab', { name: offeringLabel }));
      expect(screen.getByText('A scheduling tool offered to repair teams.')).toBeVisible();
      expect(screen.getByText('Period: September 2026')).toBeVisible();
      expect(screen.getByRole('link', { name: 'Offering source lead' })).toHaveAttribute(
        'rel',
        'noopener noreferrer',
      );
      await user.click(screen.getByRole('tab', { name: 'Market position' }));
      expect(screen.getByText('Small repair teams may be the intended audience.')).toBeVisible();
      expect(screen.getByText('Analysis · unreviewed')).toBeVisible();
      await user.click(screen.getByRole('tab', { name: 'Updates' }));
      expect(screen.getByText('The fictional company described a pilot.')).toBeVisible();
      expect(screen.getByRole('link', { name: 'Update source lead' })).toHaveAttribute(
        'href',
        'https://fixture.invalid/update',
      );
      expect(screen.getByText('Which teams actually use the product?')).toBeVisible();
      expect(
        screen.getByText('Public source links have not been semantically reviewed.'),
      ).toBeVisible();
    },
  );

  it('omits empty/missing tabs and selects the first retained section when available sections change', () => {
    const retained = brief();
    retained.sections = [retained.sections[2]!, { section: 'offering', blocks: [] }];
    const rendered = render(<NativeResearchBrief brief={retained} cardType="company" />);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Market position']);
    expect(screen.getByText('Small repair teams may be the intended audience.')).toBeVisible();
    rendered.rerender(
      <NativeResearchBrief
        brief={{ ...retained, sections: [brief().sections[3]!] }}
        cardType="company"
      />,
    );
    expect(screen.getByRole('tab', { name: 'Updates' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('The fictional company described a pilot.')).toBeVisible();
  });

  it('keeps estimated numbers in plain unreviewed notes with method/assumptions and literal hostile text', () => {
    const retained: ResearchBrief = {
      sections: [
        {
          section: 'position',
          blocks: [
            {
              id: 'estimate-note',
              text: '<script>paidCall()</script> [Launch](javascript:paidCall()) — $1M is a model estimate, not a headline.',
              kind: 'estimate',
              support: 'unreviewed',
              timeWindow: null,
              citations: [
                { title: 'Safe estimate lead', url: 'https://fixture.invalid/estimate' },
                { title: 'Unsafe lead', url: 'javascript:paidCall()' },
                { title: 'Credential lead', url: 'https://name:secret@fixture.invalid/' },
              ],
              method: 'Illustrative customer count × assumed price.',
              assumptions: ['Ten fictional customers.', 'Pricing is not observed.'],
            },
          ],
        },
      ],
      openQuestions: [],
      limitations: [],
    };
    const { container } = render(<NativeResearchBrief brief={retained} cardType="company" />);
    const note = screen.getByRole('article');
    expect(within(note).getByText(retained.sections[0]!.blocks[0]!.text)).toBeVisible();
    expect(within(note).getByText('Estimate · unreviewed')).toBeVisible();
    expect(within(note).getByText('Period unknown')).toBeVisible();
    expect(within(note).getByText(/Illustrative customer count × assumed price/)).toBeVisible();
    expect(within(note).getByText('Ten fictional customers.')).toBeVisible();
    expect(within(note).getByText('Pricing is not observed.')).toBeVisible();
    expect(within(note).getByRole('link', { name: 'Safe estimate lead' })).toHaveAttribute(
      'target',
      '_blank',
    );
    expect(
      within(note).queryByRole('link', { name: /Unsafe lead|Credential lead|Launch/ }),
    ).not.toBeInTheDocument();
    expect(container.querySelector('script, img, iframe')).toBeNull();
    expect(
      screen
        .getAllByRole('heading')
        .some((heading) => /\$1M|verified|facts/i.test(heading.textContent ?? '')),
    ).toBe(false);
    expect(
      screen.getByText(/Source links are leads.*Captured text does not establish semantic support/),
    ).toBeVisible();
  });

  it('labels older absent briefs without claiming to generate or backfill them', () => {
    render(<NativeResearchBrief cardType="company" />);
    expect(screen.getByText('Research brief not retained')).toBeVisible();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByText(/Opening this reader does not backfill/)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('supports keyboard tab navigation through the retained sections', async () => {
    const user = userEvent.setup();
    render(<NativeResearchBrief brief={brief()} cardType="infrastructure" />);
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Capabilities' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Capabilities' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Updates' })).toHaveFocus();
    expect(screen.getByText('The fictional company described a pilot.')).toBeVisible();
  });
});
