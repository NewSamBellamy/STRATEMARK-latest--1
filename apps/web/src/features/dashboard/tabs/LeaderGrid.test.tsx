import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { WikiAvatar } from './LeaderGrid';

/** Summary requests for one exact title, however they were issued. */
function summaryCalls(fetchMock: ReturnType<typeof vi.fn>, title: string): number {
  const path = `/page/summary/${encodeURIComponent(title)}`;
  return fetchMock.mock.calls.filter(([url]) => String(url).includes(path)).length;
}

function searchCalls(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes('list=search')).length;
}

/** Waits until `n` lookups have reached their last step (Wikidata) and let go of their in-flight slot. */
async function lookupsFinished(fetchMock: ReturnType<typeof vi.fn>, n: number): Promise<void> {
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('wikidata.org')).length).toBe(n));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('WikiAvatar headshot lookups', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  // Each case uses its own person: lookups are cached for the session.

  it('looks a person up once however many avatars show them at the same time', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes('/page/summary/') ? json({}, 404) : json({}));
    vi.stubGlobal('fetch', fetchMock);

    render(<>
      <WikiAvatar name="Dana Quill" companyName="Acme" />
      <WikiAvatar name="Dana Quill" companyName="Acme" size="sm" />
      <WikiAvatar name="Dana Quill" companyName="Acme" size="sm" />
    </>);

    await lookupsFinished(fetchMock, 1);
    expect(searchCalls(fetchMock)).toBe(1);
    expect(summaryCalls(fetchMock, 'Dana Quill')).toBe(1);
  });

  it('remembers an article that does not exist, even when the rest of the lookup must retry', async () => {
    // The search API is down, so the person's miss is not trusted and the
    // lookup runs again — but the 404 title is a known fact and is not re-asked.
    const fetchMock = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes('/page/summary/') ? json({}, 404)
        : String(url).includes('list=search') ? json({}, 503) : json({}));
    vi.stubGlobal('fetch', fetchMock);

    const first = render(<WikiAvatar name="Rory Vance" companyName="Acme" />);
    await lookupsFinished(fetchMock, 1);
    first.unmount();
    render(<WikiAvatar name="Rory Vance" companyName="Acme" />);
    await waitFor(() => expect(searchCalls(fetchMock)).toBe(2));
    expect(summaryCalls(fetchMock, 'Rory Vance')).toBe(1);
  });

  it('never caches a network failure as a missing article', async () => {
    let summaryAttempts = 0;
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/page/summary/')) {
        summaryAttempts += 1;
        if (summaryAttempts === 1) throw new TypeError('Failed to fetch');
        return json({}, 404);
      }
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = render(<WikiAvatar name="Sasha Ono" companyName="Acme" />);
    await lookupsFinished(fetchMock, 1);
    first.unmount();
    render(<WikiAvatar name="Sasha Ono" companyName="Acme" />);
    await waitFor(() => expect(summaryCalls(fetchMock, 'Sasha Ono')).toBe(2));
  });

  it("never shows the previous person's photo when an avatar is reused for someone else", async () => {
    const summary = (title: string) => json({
      title, extract: `${title} is the chief executive of Acme.`,
      thumbnail: { source: `https://img.example/${encodeURIComponent(title)}.jpg` },
      content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` } },
    });
    let releaseSecond: () => void = () => {};
    const secondGate = new Promise<void>((r) => { releaseSecond = r; });
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('/page/summary/Kit%20Marlow')) return summary('Kit Marlow');
      if (u.includes('/page/summary/')) { await secondGate; return json({}, 404); }
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const view = render(<WikiAvatar name="Kit Marlow" companyName="Acme" />);
    await waitFor(() => expect(view.getByRole('img')).toHaveAttribute('alt', 'Kit Marlow'));
    view.rerender(<WikiAvatar name="Lee Ashford" companyName="Acme" />);
    // Lee's lookup is still running: initials, not Kit's face under Lee's name.
    expect(view.queryByRole('img')).not.toBeInTheDocument();
    expect(view.getByText('LA')).toBeInTheDocument();
    releaseSecond();
  });
});
