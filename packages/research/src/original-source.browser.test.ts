import { describe, expect, it, vi } from 'vitest';
import { retrieveBrowserOriginalSource } from './original-source.browser';

const url = 'https://www.sec.gov/Archives/acme';
const text = 'Acme Inc. reported 45 employees as of 2026-10-01.';
const response = (body = text, headers: Record<string, string> = { 'content-type': 'text/plain' }) => new Response(body, { status: 200, headers });

describe('bounded browser original retrieval', () => {
  it('passes company and metric scope through the browser reader without extra fetches', async () => {
    const quote = 'Acme Inc. reported 45 employees as of 2026-10-01.';
    const body = `Other Inc. reported 900 employees, USD 50 million ARR and 100 active users.${' filler '.repeat(1100)}${quote}${' appendix '.repeat(600)}`;
    const fetchImpl = vi.fn(async () => response(body));
    const receipt = await retrieveBrowserOriginalSource(url, fetchImpl, { companyId: 'acme', companyName: 'Acme Inc.', metricType: 'employees' });
    expect(receipt.text).toContain(quote);
    expect(receipt.text).not.toContain('Other Inc.');
    expect(body.replace(/\s+/g, ' ').trim()).toContain(receipt.text);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('retains an unchanged excerpt and SHA-256 receipt without credentials or a proxy', async () => {
    const fetchImpl = vi.fn(async () => response());
    const receipt = await retrieveBrowserOriginalSource(url, fetchImpl);
    expect(receipt).toMatchObject({ status: 'retrieved', requestedUrl: url, finalUrl: url, text, httpStatus: 200 });
    expect(receipt.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fetchImpl).toHaveBeenCalledWith(url, expect.objectContaining({ credentials: 'omit', redirect: 'error', mode: 'cors', referrerPolicy: 'no-referrer' }));
  });
  it.each(['http://sec.gov/a', 'https://sec.gov.evil.example/a', 'https://127.0.0.1/a', 'https://user:password@sec.gov/a', 'https://sec.gov:444/a', 'https://unresolved-company.example/a'])('blocks unsupported or unsafe URLs before fetching: %s', async (target) => {
    const fetchImpl = vi.fn();
    expect((await retrieveBrowserOriginalSource(target, fetchImpl)).status).toBe('blocked');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('does not invent content when CORS or transport fails', async () => {
    const receipt = await retrieveBrowserOriginalSource(url, vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(receipt).toMatchObject({ status: 'unavailable' });
    expect(receipt.text).toBeUndefined();
  });
  it.each([
    response('x'.repeat(262145)),
    response(text, { 'content-type': 'application/pdf' }),
    response(text, { 'content-type': 'text/plain', 'x-robots-tag': 'nosnippet' }),
    response('<meta name="robots" content="noarchive"><p>private extract</p>', { 'content-type': 'text/html' }),
    new Response('login', { status: 403 }),
  ])('does not retain oversized, restricted or unreadable documents', async (source) => {
    const receipt = await retrieveBrowserOriginalSource(url, async () => source);
    expect(receipt.status).not.toBe('retrieved');
    expect(receipt.text).toBeUndefined();
  });
  it('removes executable/hidden script text and uses the same bounded excerpt selection', async () => {
    const source = response(`<script>False figure</script><!-- comment --><style>hidden</style><p>${text}</p>${' filler'.repeat(1000)}`, { 'content-type': 'text/html' });
    const receipt = await retrieveBrowserOriginalSource(url, async () => source);
    expect(receipt.text).toContain(text);
    expect(receipt.text).not.toMatch(/False figure|comment|hidden/);
    expect(receipt.text!.length).toBeLessThanOrEqual(4000);
    expect(receipt.truncated).toBe(true);
  });
});
