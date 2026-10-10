/** assets — provenance-first logo + headshot parsing against injected pages. */
import { describe, expect, it, vi } from 'vitest';
import type { OriginalSourceReceipt } from './original-source';
import { findTeamHeadshots, resolveCompanyLogo } from './assets';

const AT = '2026-10-08T12:00:00.000Z';
const HOME = 'https://acme.example/';

function htmlReceipt(html: string, url: string): OriginalSourceReceipt {
  return {
    requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200,
    retrievedAt: AT, contentHash: 'a'.repeat(64), text: html,
  };
}

/** Injected read fn backed by a fixture map; misses return unavailable. */
function readFrom(pages: Record<string, string>) {
  return vi.fn(async (url: string): Promise<OriginalSourceReceipt> => {
    const html = pages[url];
    return html === undefined
      ? { requestedUrl: url, status: 'unavailable' as const, retrievedAt: AT }
      : htmlReceipt(html, url);
  });
}

describe('resolveCompanyLogo', () => {
  it('prefers a declared SVG over og:logo and an .ico link', async () => {
    const read = readFrom({
      [HOME]: `<link rel="shortcut icon" href="/favicon.ico" sizes="any">
        <meta property="og:logo" content="https://cdn.acme.example/og.png">
        <link rel="icon" type="image/svg+xml" href="/static/mark.svg">`,
    });
    expect(await resolveCompanyLogo('https://acme.example', read)).toEqual({
      kind: 'logo', url: 'https://acme.example/static/mark.svg', sourceUrl: HOME, retrievedAt: AT,
    });
  });

  it('falls back to og:logo over twitter:image when no icon link declares a URL', async () => {
    const read = readFrom({
      [HOME]: `<meta name="twitter:image" content="/i/twitter.png">
        <meta property="og:logo" content="/img/og.png">`,
    });
    const logo = await resolveCompanyLogo('https://acme.example', read);
    expect(logo?.url).toBe('https://acme.example/img/og.png');
    expect(logo?.sourceUrl).toBe(HOME);
    // Reversed markup order: og:logo still outranks twitter:image.
    const reversed = await resolveCompanyLogo('https://acme.example', readFrom({
      [HOME]: `<meta property="og:logo" content="/img/og.png">
        <meta name="twitter:image" content="/i/twitter.png">`,
    }));
    expect(reversed?.url).toBe('https://acme.example/img/og.png');
  });

  it('ranks any declared icon link (step 1) above og:logo (step 2)', async () => {
    const read = readFrom({
      [HOME]: `<meta property="og:logo" content="/img/og.png">
        <link rel="shortcut icon" href="/favicon.ico">`,
    });
    expect((await resolveCompanyLogo('https://acme.example', read))?.url).toBe('https://acme.example/favicon.ico');
  });

  it('ranks rasters by declared size and defaults apple-touch-icons to 180px', async () => {
    const sized = await resolveCompanyLogo('https://acme.example', readFrom({
      [HOME]: `<link rel="icon" type="image/png" sizes="32x32" href="/fav-32.png">
        <link rel="apple-touch-icon" href="/apple.png">
        <link rel="icon" type="image/png" sizes="192x192" href="/fav-192.png">`,
    }));
    expect(sized?.url).toBe('https://acme.example/fav-192.png');
    const apple = await resolveCompanyLogo('https://acme.example', readFrom({
      [HOME]: `<link rel="icon" type="image/png" sizes="32x32" href="/fav-32.png">
        <link rel="apple-touch-icon" href="/apple.png">`,
    }));
    expect(apple?.url).toBe('https://acme.example/apple.png');
  });

  it('resolves relative and protocol-relative hrefs against the fetched page', async () => {
    const read = readFrom({ [HOME]: '<link rel="icon" href="//cdn.acme.example/i/mark.svg">' });
    expect((await resolveCompanyLogo('acme.example', read))?.url).toBe('https://cdn.acme.example/i/mark.svg');
    const deep = await resolveCompanyLogo('https://acme.example/about', readFrom({
      'https://acme.example/about': '<link rel="icon" href="../img/logo.svg">',
    }));
    expect(deep?.url).toBe('https://acme.example/img/logo.svg');
    expect(deep?.sourceUrl).toBe('https://acme.example/about');
  });

  it('skips data: URI icons in favor of a real declared one', async () => {
    const read = readFrom({
      [HOME]: `<link rel="icon" href="data:image/png;base64,AAAA">
        <link rel="icon" href="/real.png">`,
    });
    expect((await resolveCompanyLogo('https://acme.example', read))?.url).toBe('https://acme.example/real.png');
  });

  it('uses the root favicon only when a read proves it exists', async () => {
    const verified = readFrom({ [HOME]: '<html><body>plain</body></html>', 'https://acme.example/favicon.ico': 'bytes' });
    expect(await resolveCompanyLogo('https://acme.example', verified)).toEqual({
      kind: 'logo', url: 'https://acme.example/favicon.ico', sourceUrl: HOME, retrievedAt: AT,
    });
    const absent = readFrom({ [HOME]: '<html><body>plain</body></html>' });
    expect(await resolveCompanyLogo('https://acme.example', absent)).toBeNull();
    expect(absent).toHaveBeenCalledWith('https://acme.example/favicon.ico');
  });

  it('returns null honestly when the site never answers', async () => {
    expect(await resolveCompanyLogo('https://acme.example', readFrom({}))).toBeNull();
  });
});

describe('findTeamHeadshots', () => {
  it('matches names from img alt text and stops the ladder on the first HTML hit', async () => {
    const read = readFrom({
      'https://acme.example/team': '<img src="/img/jane-smith.jpg" alt="Jane Smith, Chief Executive Officer">',
      'https://acme.example/about': '<img src="/img/never.jpg" alt="Never Fetched">',
    });
    expect(await findTeamHeadshots('Acme', 'https://acme.example', read)).toEqual([
      { personName: 'Jane Smith', imageUrl: 'https://acme.example/img/jane-smith.jpg', sourceUrl: 'https://acme.example/team', retrievedAt: AT },
    ]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalledWith('https://acme.example/about');
  });

  it('derives the name from the filename slug when the alt is empty', async () => {
    const read = readFrom({
      'https://acme.example/leadership': '<img src="/headshots/bob-jones_2.jpg" alt="">',
    });
    const shots = await findTeamHeadshots('Acme', 'https://acme.example', read);
    expect(shots).toHaveLength(1);
    expect(shots[0]?.personName).toBe('Bob Jones');
  });

  it('reads the name from text adjacent to an alt-less photo', async () => {
    const read = readFrom({
      'https://acme.example/team': '<li><img src="/p/a.jpg" alt="" width="200"><span>Ada Lovelace</span></li>',
    });
    const shots = await findTeamHeadshots('Acme', 'https://acme.example', read);
    expect(shots[0]?.personName).toBe('Ada Lovelace');
  });

  it('rejects logo, sprite and team-photo chrome plus company-name marks', async () => {
    const read = readFrom({
      'https://acme.example/team': `<img src="/static/logo.png" alt="Acme">
        <img src="/img/sprite.png" alt="">
        <img src="/uploads/team-photo.jpg" alt="The crew">
        <img src="/img/acme-mark.png" alt="Acme Inc.">
        <img src="/img/jane-smith.jpg" alt="Jane Smith">`,
    });
    const shots = await findTeamHeadshots('Acme', 'https://acme.example', read);
    expect(shots).toHaveLength(1);
    expect(shots[0]?.personName).toBe('Jane Smith');
  });

  it('returns an honest empty array when no photo names a person', async () => {
    const read = readFrom({
      'https://acme.example/team': '<img src="/img/1.png" alt="photo"><p>No portraits here.</p>',
    });
    expect(await findTeamHeadshots('Acme', 'https://acme.example', read)).toEqual([]);
  });

  it('bounds the path ladder to four attempts and never guesses beyond it', async () => {
    const read = readFrom({ [HOME]: '<html><body><a href="/company/people">Our people</a></body></html>' });
    expect(await findTeamHeadshots('Acme', 'https://acme.example', read)).toEqual([]);
    for (const path of ['/team', '/about', '/leadership', '/management']) {
      expect(read).toHaveBeenCalledWith(`https://acme.example${path}`);
    }
    expect(read).not.toHaveBeenCalledWith('https://acme.example/people');
    expect(read).toHaveBeenCalledTimes(6); // 4 path attempts + homepage + discovery link
  });

  it('discovers the team page from a homepage link when the fixed paths miss', async () => {
    const read = readFrom({
      [HOME]: '<a href="/company/leadership">Leadership</a>',
      'https://acme.example/company/leadership': '<img src="/img/grace-hopper.jpg" alt="Grace Hopper">',
    });
    const shots = await findTeamHeadshots('Acme', 'https://acme.example', read);
    expect(shots).toEqual([
      { personName: 'Grace Hopper', imageUrl: 'https://acme.example/img/grace-hopper.jpg', sourceUrl: 'https://acme.example/company/leadership', retrievedAt: AT },
    ]);
  });
});
