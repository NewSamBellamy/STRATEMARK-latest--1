import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { MockRepository } from '@mi/mocks';
import { renderWithProviders } from '@/test/test-utils';
import { buildDeckShare } from '@/lib/share/codec';
import { unpackSnapshotText } from '@/lib/share/wire';
import type * as PackageModule from '@/lib/share/package';
import type * as HostedApiModule from '@/lib/hostedApi';
import { ShareDialog } from './ShareDialog';

const hosted = vi.hoisted(() => ({ on: true }));
// jsdom has no canvas: stand in for the drawn preview picture with a tiny PNG header.
vi.mock('@/lib/share/package', async (importActual) => ({
  ...(await importActual<typeof PackageModule>()),
  drawPreview: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]),
}));
vi.mock('@/lib/hostedApi', async (importActual) => ({
  ...(await importActual<typeof HostedApiModule>()),
  SHARE_API_URL: 'https://api.example.workers.dev',
  hasShareApi: () => hosted.on,
}));

const created = {
  id: 'abcdefghijklmnop', url: 'https://api.example.workers.dev/s/abcdefghijklmnop', imageUrl: 'https://api.example.workers.dev/s/abcdefghijklmnop/og.png',
  expiresAt: Date.now() + 90 * 86_400_000, deleteToken: 'tok_abcdefghijklmnopqrstuvwx',
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function setup() {
  const repository = new MockRepository({ latencyMs: 0 });
  const [market] = await repository.listMarkets();
  const deck = (await repository.getDeckByMarket(market!.id))!;
  const cards = await repository.listCards(deck.id);
  const build = vi.fn(async () => buildDeckShare(cards, market!.name));
  const ui = (open = true) => (
    <ShareDialog open={open} onOpenChange={() => undefined} title={market!.name} subtitle="Full deck" build={build} page={{ deckId: deck.id }} />
  );
  return { repository, deck, market: market!, build, ui };
}

describe('Share, where the Worker can store a link', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    hosted.on = true;
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('says what will be kept and uploads nothing until the button is pressed', async () => {
    const { repository, ui } = await setup();
    renderWithProviders(ui(), { repository });
    expect(await screen.findByRole('button', { name: 'Create link' })).toBeInTheDocument();
    expect(screen.getByText(/keeps a copy of this research on its servers for 90 days/)).toBeInTheDocument();
    expect(screen.getByText(/stop\s+sharing at any time/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Use a private link instead/ })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('makes the link, shows it with a preview and a copy button, and sends the snapshot of this deck', async () => {
    fetchMock.mockImplementation(async () => reply(201, created));
    const { repository, deck, market, build, ui } = await setup();
    const { user } = renderWithProviders(ui(), { repository });
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    const input = await screen.findByLabelText('Share link');
    expect(input).toHaveValue(created.url);
    expect(build).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.workers.dev/v1/share');
    const sent = JSON.parse(init.body as string) as { kind: string; title: string; data: string; viewer: string; og: string | null };
    expect(sent.og).toBe('iVBORw0KGgoBAgM=');
    expect(sent.kind).toBe('deck');
    expect(sent.title).toContain(market.name);
    expect(sent.viewer).toMatch(/\/share\.html$/);
    const snapshot = JSON.parse((await unpackSnapshotText(sent.data))!) as { decks: Array<{ id: string }> };
    expect(snapshot.decks[0]!.id).toBe(deck.id);
    expect(screen.getByAltText(/The preview chat apps show/)).toHaveAttribute('src', created.imageUrl);
    await user.click(screen.getByRole('button', { name: /Copy link/ }));
    expect(await navigator.clipboard.readText()).toBe(created.url);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Telegram' })).toHaveAttribute('href', expect.stringContaining(encodeURIComponent(created.url)));
    // A short link fits every one-tap destination, which a 29,000-character link never did.
    for (const name of ['Email', 'Telegram', 'WhatsApp', 'Post on X']) expect(screen.getByRole('link', { name })).toBeInTheDocument();
  });

  it('reuses the link for research that has not changed, instead of uploading it again', async () => {
    fetchMock.mockImplementation(async () => reply(201, created));
    const { repository, ui } = await setup();
    const first = renderWithProviders(ui(), { repository });
    await first.user.click(await screen.findByRole('button', { name: 'Create link' }));
    await screen.findByLabelText('Share link');
    first.unmount();
    const second = renderWithProviders(ui(), { repository });
    await second.user.click(await screen.findByRole('button', { name: 'Create link' }));
    expect(await screen.findByLabelText('Share link')).toHaveValue(created.url);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops sharing on request: the Worker is told, and the dialog says the link is dead', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => (init.method === 'DELETE' ? reply(200, { ok: true }) : reply(201, created)));
    const { repository, ui } = await setup();
    const { user } = renderWithProviders(ui(), { repository });
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    await screen.findByLabelText('Share link');
    await user.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(await screen.findByText(/Sharing stopped/)).toBeInTheDocument();
    const del = fetchMock.mock.calls.find(([, init]) => (init as RequestInit).method === 'DELETE') as [string, RequestInit];
    expect(del[0]).toBe(`https://api.example.workers.dev/v1/share/${created.id}`);
    expect((del[1].headers as Record<string, string>)['X-Share-Token']).toBe(created.deleteToken);
    expect(JSON.parse(localStorage.getItem('mi.shares') ?? '[]')).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Make a new link' }));
    expect(await screen.findByRole('button', { name: 'Create link' })).toBeInTheDocument();
  });

  it('keeps the link on screen and says so when stopping fails', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => (init.method === 'DELETE' ? reply(500, {}) : reply(201, created)));
    const { repository, ui } = await setup();
    const { user } = renderWithProviders(ui(), { repository });
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    await screen.findByLabelText('Share link');
    await user.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not stop sharing/);
    expect(screen.getByLabelText('Share link')).toHaveValue(created.url);
  });

  it('shows the Worker\'s own reason when it refuses, and offers another way', async () => {
    fetchMock.mockImplementation(async () => reply(429, { error: 'You have made today’s share links. Try again tomorrow, or copy a private link instead.' }));
    const { repository, ui } = await setup();
    const { user } = renderWithProviders(ui(), { repository });
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('You have made today’s share links');
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: /private link/ })).toBeInTheDocument();
  });

  it('says plainly when the service cannot be reached', async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
    const { repository, ui } = await setup();
    const { user } = renderWithProviders(ui(), { repository });
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not reach the sharing service/);
  });

  it('switches to the private link on request, which uploads nothing', async () => {
    const { repository, ui } = await setup();
    const { user } = renderWithProviders(ui(), { repository });
    await user.click(await screen.findByRole('button', { name: /Use a private link instead/ }));
    expect(((await screen.findByLabelText('Share link')) as HTMLInputElement).value).toContain('#/share/');
    expect(screen.getByRole('button', { name: /Create short link/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create link' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is the private link, as before, where no Worker is set up', async () => {
    hosted.on = false;
    const { repository, ui } = await setup();
    renderWithProviders(ui(), { repository });
    expect(((await screen.findByLabelText('Share link')) as HTMLInputElement).value).toContain('#/share/');
    expect(screen.queryByRole('button', { name: 'Create link' })).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });
});
