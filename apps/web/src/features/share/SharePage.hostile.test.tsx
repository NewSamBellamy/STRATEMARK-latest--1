import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/test-utils';
import SharePage from './SharePage';

// A share link carries the whole snapshot in its URL, so anyone can author
// one. These tests open links built by a hostile sender.
const b64u = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const blobOf = (payload: unknown) => `j${b64u(JSON.stringify(payload))}`;

function open(payload: unknown) {
  return renderWithProviders(
    <Routes><Route path="/share/:blob" element={<SharePage />} /></Routes>,
    { route: `/share/${blobOf(payload)}` },
  );
}

// Outbound links only: the page's own masthead link goes to "/".
const hrefsIn = (root: ParentNode) => Array.from(root.querySelectorAll('a[target="_blank"][href]')).map((a) => a.getAttribute('href') ?? '');
const isWeb = (href: string) => /^https?:\/\//i.test(href);

const cardPayload = () => ({
  v: 1, kind: 'card', market: 'M', sharedAt: new Date().toISOString(),
  cards: [{
    type: 'company', title: 'T', summary: 'S', tier: null, keyPoints: ['k1'],
    citations: [{ t: 'Evil', u: 'javascript:alert(1)' }],
    claims: [{ text: 'bad claim', t: 'Pub', u: 'javascript:alert(2)' }],
    company: { name: 'Acme', oneLiner: 'x', website: 'javascript:alert(3)', hq: 'NY', logo: null },
    metrics: [],
  }],
});

describe('a share link authored by someone else', () => {
  it('never turns a javascript: source into a clickable link on a shared card', async () => {
    const { user } = open(cardPayload());
    await user.click(await screen.findByRole('button', { name: /Acme/ }));
    const dialog = await screen.findByRole('dialog');
    const hrefs = hrefsIn(dialog);
    expect(hrefs.filter((href) => !isWeb(href)), JSON.stringify(hrefs)).toEqual([]);
    // A risk whose only source is a script link is never a link. Depending on the rules a shared link is held to, the
    // claim is shown with its source named but not linked, or dropped altogether (an allegation with no usable source).
    const claim = within(dialog).queryByText('bad claim')?.closest('li');
    if (claim) {
      expect(within(claim).getByText('Pub')).toBeInTheDocument();
      expect(within(claim).queryByRole('link')).not.toBeInTheDocument();
    }
  });

  it('does not load an image, or link a script or protocol-relative address, from a shared report body', async () => {
    const md = [
      'Body text.',
      '![px](https://evil.example/pixel.gif?leak=1)',
      '![ref][r]',
      '[js](javascript:alert(1))',
      '[pr](//evil.example/x)',
      '[ok](https://www.sec.gov/fine)',
      '[r]: //evil.example/ref.png',
    ].join('\n\n');
    const { container } = open({
      v: 1, kind: 'report', market: 'M', sharedAt: new Date().toISOString(), cards: [],
      report: { t: 'R', k: 'company', at: new Date().toISOString(), md, c: [] },
    });
    await screen.findByText(/Company Report/);
    // Nothing from the body may ask a third party for a picture.
    expect(container.querySelectorAll('img[src*="evil.example"]')).toHaveLength(0);
    expect(hrefsIn(document.body)).toEqual(['https://www.sec.gov/fine']);
    // The image's words stay readable.
    expect(screen.getByText('px')).toBeInTheDocument();
  });

  it('never links a non-web source on a shared report', async () => {
    open({
      v: 1, kind: 'report', market: 'M', sharedAt: new Date().toISOString(), cards: [],
      report: {
        t: 'R', k: 'company', at: new Date().toISOString(), md: 'Body.',
        c: [{ t: 'Evil source', u: 'javascript:alert(9)' }, { t: 'Phish', u: '//evil.example/x' }, { t: 'Fine', u: 'https://www.sec.gov/ok' }],
      },
    });
    await screen.findByText(/Company Report/);
    const hrefs = hrefsIn(document.body);
    expect(hrefs.filter((href) => !isWeb(href)), JSON.stringify(hrefs)).toEqual([]);
    expect(hrefs).toContain('https://www.sec.gov/ok');
  });
});
