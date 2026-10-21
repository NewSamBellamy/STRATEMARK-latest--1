/**
 * A picture the Worker's image reader serves is requested by an <img> tag, which sends no Origin header, so the Worker
 * names the asking page from its Referer. `referrerPolicy="no-referrer"` sends neither, and the Worker answered 403 for
 * every story, cover and company picture in a real browser (found by running Chromium against the real Worker; a unit test
 * that fakes a Referer header could not see it). These tests render the real components with the Worker configured and
 * assert the attribute the browser actually acts on: `origin` for a picture through the Worker, `no-referrer` for one
 * loaded straight from a publisher's host.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import type * as RealCoverModule from '@/lib/media/realCover';

// The build is configured with a Worker address before any module reads it.
vi.hoisted(() => { vi.stubEnv('VITE_STRATEMARK_API_URL', 'https://worker.example'); });

const cover = vi.hoisted(() => ({ state: { status: 'none' } as { status: string; src?: string | null; publisher?: string | null } }));
vi.mock('@/lib/media/realCover', async (importActual) => ({
  ...(await importActual<typeof RealCoverModule>()),
  useRealCover: () => cover.state,
}));
vi.mock('@/lib/ownership/secMajorShareholders', () => ({ lookupMajorShareholders: vi.fn().mockResolvedValue(null) }));

import { AiCover } from './AiCover';
import { StoryImage } from './StoryMedia';
import { MissionGovernanceTab } from '@/features/dashboard/tabs/MissionGovernanceTab';
import { imageReferrerPolicy } from '@/lib/hostedApi';

const WORKER_IMAGE = 'https://worker.example/v1/image?url=https%3A%2F%2Fcdn.example%2Fa.jpg';

describe('the policy for a picture', () => {
  it('is origin for the Worker image reader and no-referrer for anything else', () => {
    expect(imageReferrerPolicy(WORKER_IMAGE)).toBe('origin');
    expect(imageReferrerPolicy('https://cdn.example/a.jpg')).toBe('no-referrer');
    expect(imageReferrerPolicy('https://i.ytimg.com/vi/x/hqdefault.jpg')).toBe('no-referrer');
    // Only the image reader: another Worker route, or a look-alike host, is not it.
    expect(imageReferrerPolicy('https://worker.example/v1/preview?url=x')).toBe('no-referrer');
    expect(imageReferrerPolicy('https://worker.example.evil.example/v1/image?url=x')).toBe('no-referrer');
    expect(imageReferrerPolicy('data:image/png;base64,AAAA')).toBe('no-referrer');
  });

  it('is no-referrer when no Worker is configured (a local dev build loads straight from the publisher)', () => {
    expect(imageReferrerPolicy('https://cdn.example/a.jpg', '')).toBe('no-referrer');
    expect(imageReferrerPolicy('/v1/image?url=x', '')).toBe('no-referrer');
  });
});

describe('a story picture shown through the Worker', () => {
  it('asks the browser to send the app’s origin, not nothing', () => {
    const { container } = render(<StoryImage pageUrl="https://news.example/story" imageUrl="https://cdn.example/a.jpg" />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toMatch(/^https:\/\/worker\.example\/v1\/image\?url=/);
    expect(img.getAttribute('referrerpolicy')).toBe('origin');
  });
});

describe('a cover shown through the Worker', () => {
  beforeEach(() => { cover.state = { status: 'none' }; });

  it('AiCover asks for origin for a proxied picture and keeps no-referrer for a direct one', () => {
    cover.state = { status: 'ready', src: WORKER_IMAGE, publisher: 'cdn.example' };
    const proxied = render(<AiCover cacheKey="k" title="A story" context={null} url="https://news.example/story" source="news" />);
    expect(proxied.container.querySelector('img')!.getAttribute('referrerpolicy')).toBe('origin');
    proxied.unmount();
    cover.state = { status: 'ready', src: 'https://cdn.example/direct.jpg', publisher: 'cdn.example' };
    const direct = render(<AiCover cacheKey="k" title="A story" context={null} url="https://news.example/story" source="news" />);
    expect(direct.container.querySelector('img')!.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('the Mission tab no longer shows a company-site picture at all (it is not governance evidence)', async () => {
    cover.state = { status: 'ready', src: WORKER_IMAGE, publisher: 'cdn.example' };
    const getDashboardTab = vi.fn().mockResolvedValue({
      companyId: 'cmp', tab: 'mission_governance', lastRefreshedAt: '2026-10-01T00:00:00.000Z',
      content: { mission: 'Build safe AI.', ethos: null, governanceStructure: null, board: [], fundingRounds: [], investors: [], positives: [] },
    });
    const getCompany = vi.fn().mockResolvedValue({ id: 'cmp', name: 'Acme', websiteUrl: 'https://acme.example' });
    renderWithProviders(<MissionGovernanceTab companyId="cmp" />, { repository: Object.assign(makeRepo(), { getDashboardTab, getCompany }) });
    expect(await screen.findByText(/Build safe AI/)).toBeInTheDocument();
    expect(screen.queryByAltText(/image published by the company/i)).toBeNull();
  });
});
