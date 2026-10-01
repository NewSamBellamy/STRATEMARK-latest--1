import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { IPC_CHANNELS, SECURE_CHANNELS } from '@mi/contracts';
import { stageLegacySnapshot } from './vault-staging';
import { legacyRetentionFixture } from './legacy-retention-fixture';
import type * as Storage from './storage';

const host = vi.hoisted(() => ({
  temp: '',
  options: {} as Record<string, unknown>,
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  events: new Map<string, () => void>(),
  legacyStore: vi.fn(),
  loadEnv: vi.fn(),
  contents: {
    mainFrame: {},
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
    session: { setPermissionRequestHandler: vi.fn(), webRequest: { onBeforeRequest: vi.fn() } },
  },
}));
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    name: '',
    setName: vi.fn(),
    getAppPath: () => path.resolve('apps/desktop'),
    getPath: () => host.temp,
    setPath: vi.fn(),
    whenReady: () => Promise.resolve(),
    on: (name: string, callback: () => void) => host.events.set(name, callback),
    quit: vi.fn(),
  },
  BrowserWindow: class {
    webContents = host.contents;
    constructor(options: Record<string, unknown>) {
      host.options = options;
    }
    once() {}
    loadURL() {}
    isDestroyed() {
      return false;
    }
    static getAllWindows() {
      return [];
    }
  },
  ipcMain: {
    handle: (name: string, callback: (event: unknown, ...args: unknown[]) => unknown) =>
      host.handlers.set(name, callback),
  },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  nativeImage: { createFromPath: vi.fn() },
  net: { fetch: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  safeStorage: {},
  shell: {},
  dialog: { showErrorBox: vi.fn() },
}));
vi.mock('./storage.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Storage>()),
  createFileStore: host.legacyStore,
}));
vi.mock('./oauth.js', () => ({ loadDesktopEnv: host.loadEnv, performGoogleOAuthFlow: vi.fn() }));
const originalArgs = [...process.argv];
const originalTitle = process.title;
let root: string | undefined;
afterEach(() => {
  host.events.get('before-quit')?.();
  process.argv = originalArgs;
  process.title = originalTitle;
  if (root) rmSync(root, { recursive: true, force: true });
});
it('routes trusted preview IPC before legacy listeners and denies an untrusted frame', async () => {
  root = mkdtempSync(path.join(tmpdir(), 'stratemark-host-proof-'));
  host.temp = root;
  const candidate = stageLegacySnapshot(
    JSON.stringify(legacyRetentionFixture(2)),
    root,
    'vault_host',
  );
  const dbFile = path.join(candidate.directory, 'vault.sqlite');
  const before = readFileSync(dbFile);
  process.argv = [...originalArgs, `--staged-vault-dir=${candidate.directory}`];
  await import('./main');
  await vi.waitFor(() => expect(host.handlers.has(IPC_CHANNELS.listMarkets)).toBe(true));
  const event = { sender: host.contents, senderFrame: host.contents.mainFrame };
  const read = (channel: string, ...args: unknown[]) => host.handlers.get(channel)!(event, ...args);
  expect(read(IPC_CHANNELS.listMarkets) as unknown[]).toHaveLength(2);
  expect(() => read(IPC_CHANNELS.refreshDeck, 'mkt_a')).toThrow(/read-only/i);
  expect(() => read(SECURE_CHANNELS.getApiKeyStatus)).toThrow(/read-only/i);
  expect(() => read(SECURE_CHANNELS.importResearch, '{}')).toThrow(/read-only/i);
  expect(() =>
    host.handlers.get(IPC_CHANNELS.listMarkets)!({ sender: {}, senderFrame: {} }),
  ).toThrow(/untrusted/i);
  expect(host.legacyStore).not.toHaveBeenCalled();
  expect(host.loadEnv).not.toHaveBeenCalled();
  expect(host.contents.session.webRequest.onBeforeRequest).toHaveBeenCalled();
  expect((host.options.webPreferences as Record<string, unknown>).additionalArguments).toEqual([
    '--staged-research-readonly',
  ]);
  host.events.get('before-quit')?.();
  expect(readFileSync(dbFile)).toEqual(before);
});
