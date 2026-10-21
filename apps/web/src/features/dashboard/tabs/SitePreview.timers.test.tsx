import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
vi.mock('@/lib/media/siteChallenge', () => ({ probeSiteChallenge: async () => null }));

import { SitePreview } from './LiveLandingTab';
import { PageShot } from '@/components/media/PageShot';
import { SHOT_RETRY_MS, pageShotUrl } from '@/lib/screenshot';

const A = 'https://a.example.com';
const B = 'https://b.example.com';

describe('screenshot retry timers', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('SitePreview: two failures before the retry fires schedule one retry, not two', () => {
    render(<SitePreview url={A} fallbackShot={null} />);
    const img = screen.getByRole('img');
    fireEvent.error(img);
    fireEvent.error(img);
    act(() => void vi.advanceTimersByTime(SHOT_RETRY_MS));
    expect(screen.getByRole('img').getAttribute('src')).toBe(pageShotUrl(A, 1));
  });

  it('SitePreview: a retry queued for the old url does not fire after the url changes', () => {
    const { rerender } = render(<SitePreview url={A} fallbackShot={null} />);
    fireEvent.error(screen.getByRole('img'));
    rerender(<SitePreview url={B} fallbackShot={null} />);
    act(() => void vi.advanceTimersByTime(SHOT_RETRY_MS * 2));
    expect(screen.getByRole('img').getAttribute('src')).toBe(pageShotUrl(B, 0));
  });

  it('SitePreview: unmounting cancels the pending retry', () => {
    const { unmount } = render(<SitePreview url={A} fallbackShot={null} />);
    fireEvent.error(screen.getByRole('img'));
    expect(vi.getTimerCount()).toBeGreaterThan(0); // the retry, and the capture timeout
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('PageShot: a retry queued for the old url does not fire after the url changes', () => {
    const { container, rerender } = render(<PageShot url={A} />);
    fireEvent.error(container.querySelector('img')!);
    rerender(<PageShot url={B} />);
    act(() => void vi.advanceTimersByTime(SHOT_RETRY_MS * 2));
    expect(container.querySelector('img')!.getAttribute('src')).toBe(pageShotUrl(B, 0));
  });
});
