import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const probe = vi.fn();
vi.mock('@/lib/media/siteChallenge', async (orig) => ({ ...(await orig<object>()), probeSiteChallenge: (u: string) => probe(u) }));

import { CAPTURE_TIMEOUT_MS, SitePreview } from './LiveLandingTab';

const URL_ = 'https://openai.example.com';

describe('site preview unavailable states', () => {
  beforeEach(() => { vi.useFakeTimers(); probe.mockReset(); });
  afterEach(() => vi.useRealTimers());

  it('shows the fallback with a link, not the screenshot, when the site is a challenge page', async () => {
    probe.mockResolvedValue(true);
    render(<SitePreview url={URL_} fallbackShot="https://shots.example.com/captcha.png" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('Preview unavailable - site blocks automated capture')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open live site/i }).getAttribute('href')).toBe(URL_);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('keeps the capture when the page is readable and not a challenge', async () => {
    probe.mockResolvedValue(false);
    render(<SitePreview url={URL_} fallbackShot={null} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-unavailable')).toBeNull();
  });

  it('a capture stuck on "Capturing the live site" times out into the same fallback', async () => {
    probe.mockResolvedValue(null);
    render(<SitePreview url={URL_} fallbackShot={null} />);
    expect(screen.getByRole('img')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(CAPTURE_TIMEOUT_MS + 1));
    expect(screen.getByText('Preview unavailable - site blocks automated capture')).toBeInTheDocument();
  });
});
