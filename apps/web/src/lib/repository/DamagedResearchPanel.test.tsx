import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { downloadBytes } from '@/lib/share/download';
import { useApiKey } from '@/lib/settings/apiKey';
import { RepositoryProvider } from './RepositoryProvider';
import { DAMAGED_BACKUP_PREFIX } from './browserResearchStore';

vi.mock('@/lib/share/download', () => ({ downloadBytes: vi.fn() }));

const KEY = 'mi.repo.v1';
const DAMAGED = '{"markets":[{"id":"mkt_precious"';
const CONFIRM = 'This replaces your saved research with an empty workspace. Have you downloaded a copy?';
const fakeKey = 'AIza-fake-test-key-not-real';

const backups = () => Object.keys(localStorage).filter((k) => k.startsWith(DAMAGED_BACKUP_PREFIX));

function open() {
  return render(<RepositoryProvider><p>workspace is open</p></RepositoryProvider>);
}

describe('the damaged saved workspace screen', () => {
  const initial = useApiKey.getState();
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    localStorage.clear();
    localStorage.setItem(KEY, DAMAGED);
    vi.mocked(downloadBytes).mockClear();
  });
  afterEach(() => {
    cleanup();
    act(() => useApiKey.setState(initial, true));
  });

  describe.each([
    ['own key', { apiKey: fakeKey, hosted: false, hasKey: true }],
    ['hosted beta', { apiKey: '', hosted: true, hasKey: true }],
  ])('with %s', (_name, state) => {
    beforeEach(() => { act(() => useApiKey.setState(state)); });

    it('says what happened, offers the three ways out, and touches nothing on load', async () => {
      open();
      expect(await screen.findByRole('alert')).toHaveTextContent('Your saved research is unreadable, so it was not opened.');
      expect(screen.getByRole('button', { name: /Download the damaged data/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Start with an empty workspace' })).toBeTruthy();
      expect(localStorage.getItem(KEY)).toBe(DAMAGED);
      expect(backups()).toEqual([]);
      expect(downloadBytes).not.toHaveBeenCalled();
    });

    it('downloads the damaged text intact and changes nothing', async () => {
      open();
      await userEvent.click(await screen.findByRole('button', { name: /Download the damaged data/ }));
      await waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
      const [name, bytes] = vi.mocked(downloadBytes).mock.calls[0]!;
      expect(name).toMatch(/^stratemark-damaged-research-\d{4}-\d{2}-\d{2}\.txt$/);
      expect(new TextDecoder().decode(bytes)).toBe(DAMAGED);
      expect(localStorage.getItem(KEY)).toBe(DAMAGED);
    });

    it('asks first, and does nothing when the person goes back', async () => {
      open();
      await userEvent.click(await screen.findByRole('button', { name: 'Start with an empty workspace' }));
      expect(screen.getByText(CONFIRM)).toBeTruthy();
      expect(localStorage.getItem(KEY)).toBe(DAMAGED);
      expect(backups()).toEqual([]);
      await userEvent.click(screen.getByRole('button', { name: 'No, go back' }));
      expect(screen.queryByText(CONFIRM)).toBeNull();
      expect(localStorage.getItem(KEY)).toBe(DAMAGED);
      expect(backups()).toEqual([]);
      expect(screen.queryByText('workspace is open')).toBeNull();
    });

    it('on confirm keeps the damaged text under a backup key and opens an empty workspace', async () => {
      open();
      await userEvent.click(await screen.findByRole('button', { name: 'Start with an empty workspace' }));
      await userEvent.click(screen.getByRole('button', { name: /^Yes, start/ }));
      expect(await screen.findByText('workspace is open')).toBeTruthy();
      expect(backups()).toHaveLength(1);
      expect(localStorage.getItem(backups()[0]!)).toBe(DAMAGED);
      expect(localStorage.getItem(KEY)).toBeNull();
    });
  });

  it('offers the intact previous save for download when there is one (red-team M4), and nothing when there is none', async () => {
    act(() => useApiKey.setState({ apiKey: fakeKey, hosted: false, hasKey: true }));
    const view = open();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Download the last good save/ })).toBeNull();
    view.unmount();

    const GOOD = '{"schemaVersion":1,"markets":[]}';
    localStorage.setItem(`${KEY}.backup`, GOOD);
    open();
    await userEvent.click(await screen.findByRole('button', { name: /Download the last good save/ }));
    expect(downloadBytes).toHaveBeenCalledTimes(1);
    const [name, bytes] = vi.mocked(downloadBytes).mock.calls[0]!;
    expect(name).toMatch(/^stratemark-last-good-research-\d{4}-\d{2}-\d{2}\.json$/);
    expect(new TextDecoder().decode(bytes)).toBe(GOOD);
    expect(localStorage.getItem(KEY)).toBe(DAMAGED);
    expect(localStorage.getItem(`${KEY}.backup`)).toBe(GOOD);
  });

  it('Try again reloads the page', async () => {
    act(() => useApiKey.setState({ apiKey: fakeKey, hosted: false, hasKey: true }));
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
