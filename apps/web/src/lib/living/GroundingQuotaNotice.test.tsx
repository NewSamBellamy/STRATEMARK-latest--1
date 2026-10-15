import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { markGroundingSpent } from '@/lib/usage';
import { GroundingQuotaNotice, waitLabel } from './GroundingQuotaNotice';

const at = Date.parse('2026-10-15T04:46:00Z');

describe('waitLabel', () => {
  it.each([[30_000, 'about 1 minute'], [40 * 60_000, 'about 40 minutes'], [89 * 60_000, 'about 89 minutes'], [112 * 60_000, 'about 2 hours'], [600 * 60_000, 'about 10 hours']])(
    '%i ms -> %s', (ms, label) => expect(waitLabel(ms)).toBe(label));
});

describe('GroundingQuotaNotice', () => {
  beforeEach(() => localStorage.clear());

  it('shows nothing while Google Search has quota', () => {
    const { container } = render(<GroundingQuotaNotice now={() => at} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says plainly what is happening and when it should end, the moment research reports it', () => {
    render(<GroundingQuotaNotice now={() => at} />);
    act(() => markGroundingSpent(at));
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent('Google Search is out of quota for today');
    expect(note).toHaveTextContent('slower, with fewer sourced figures');
    expect(note).toHaveTextContent('about 2 hours from now');
    expect(note).toHaveTextContent('unfound figures stay Unknown');
  });

  it('is gone once the quota day has turned over', () => {
    markGroundingSpent(at);
    const { container } = render(<GroundingQuotaNotice now={() => Date.parse('2026-10-15T08:00:00Z')} />);
    expect(container).toBeEmptyDOMElement();
  });
});
