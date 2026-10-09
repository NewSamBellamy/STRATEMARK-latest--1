/**
 * Electron main process — the local-first back end host.
 *
 * SECURITY BOUNDARY: everything native lives here, never in the renderer. The
 * renderer is sandboxed (contextIsolation on, nodeIntegration off) and reaches
 * this process ONLY through the typed `window.mi` / `window.miSecure` bridges.
 * The Gemini key lives in the OS keychain (safeStorage); research state
 * persists to a JSON snapshot in userData. (SQLite/Drizzle remains the
 * documented upgrade path — same ResearchStore seam.)
 */
import { app, BrowserWindow, ipcMain as electronIpcMain, Menu, type MenuItemConstructorOptions, nativeImage, net, protocol, safeStorage, shell, dialog } from 'electron';
import { pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { IPC_CHANNELS, SECURE_CHANNELS, type MarketIntelRepository } from '@mi/contracts';
import { z } from 'zod';
import {
  createMarketInputSchema,
  deckResearchBriefSchema,
  cardFilterSchema,
  deepDiveInputSchema,
  factCheckInputSchema,
  verifyMetricInputSchema,
  reportRequestSchema,
  expandFocusSchema,
  overrideMetricInputSchema,
  askResearchInputSchema,
  listResearchThreadsFilterSchema,
  refreshCadenceSchema,
  dashboardTabSchema,
} from './ipc-schemas.js';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot } from '@mi/research';

// Unhandled main-process failures otherwise die silently (the Oct-6 audit:
// only startup was protected). Surface the first one honestly and keep
// running — research commits atomically to disk, so a crashed handler cannot
// corrupt saved data. No telemetry: the error stays on this machine.
let didReportCrash = false;
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in the main process:', error);
  if (didReportCrash) return;
  didReportCrash = true;
  try {
    dialog.showErrorBox('Stratemark hit an unexpected error',
      `${error.message || String(error)}\n\nThe app kept running and your saved research is safe on disk. If anything looks wrong, restart the app.`);
  } catch { /* headless failure — the log above is the record */ }
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in the main process:', reason);
});
import sampleSnapshot from '../../web/src/sample/frontier-snapshot.json';
import { createFileStore, parseResearchExport } from './storage.js';
import { createSqliteStore } from './sqlite.js';
import { createOriginalSourceServices } from './original-sources.js';
import { performGoogleOAuthFlow, loadDesktopEnv, type OAuthUser } from './oauth.js';

loadDesktopEnv();

const DESKTOP_DIST = path.join(app.getAppPath(), 'dist');
const WEB_DIST = app.isPackaged
  ? path.join(process.resourcesPath, 'web-dist')
  : path.join(DESKTOP_DIST, '../../web/dist');

app.name = 'Stratemark';
app.setName('Stratemark');
process.title = 'Stratemark';

// Development previews use a separate workspace so testing never touches a
// previously installed app's research or saved key. Ignored by packaged builds.
const previewData = process.argv.find((arg) => arg.startsWith('--preview-data-dir='));
if (!app.isPackaged && previewData) {
  const directory = path.resolve(previewData.slice('--preview-data-dir='.length));
  mkdirSync(directory, { recursive: true });
  app.setPath('userData', directory);
}

function createApplicationMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'Stratemark',
            submenu: [
              { role: 'about', label: 'About Stratemark' },
              { type: 'separator' },
              { role: 'hide', label: 'Hide Stratemark' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit', label: 'Quit Stratemark' },
            ] as MenuItemConstructorOptions[],
          },
        ]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }]),
      ] as MenuItemConstructorOptions[],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// ---------------------------------------------------------------------------
// Persistence + key management (main-process only)
// ---------------------------------------------------------------------------
const researchFile = () => path.join(app.getPath('userData'), 'research', 'repo.json');
// SQLite is the system of record when this runtime provides node:sqlite; the
// JSON file seeds the first import and stays on disk as a last-good backup.
// researchFile() keeps its name and location for exactly that reason.
const researchStore = () => createSqliteStore(researchFile()) ?? createFileStore(researchFile());
const encryptionAvailable = () => safeStorage.isEncryptionAvailable() &&
  (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');

const keyFile = (): string => path.join(app.getPath('userData'), 'gemini.key.enc');

/**
 * Thrown when the OS cannot encrypt at rest. Surfaced to the renderer so the
 * user is told plainly, rather than silently getting weaker storage than the
 * filename claims.
 */
export class SecureStorageUnavailableError extends Error {
  constructor() {
    super(
      'Secure storage is not available on this system, so the API key was not saved. ' +
        'Enter it again each session, or install an OS keyring (e.g. gnome-keyring) and retry.',
    );
    this.name = 'SecureStorageUnavailableError';
  }
}

function loadApiKey(): string {
  try {
    if (!existsSync(keyFile())) return '';
    // Only ever read back through the same encryption that wrote it. Reading a
    // file as plaintext when encryption is unavailable is how a key written by
    // the old code path would keep being honored.
    if (!encryptionAvailable()) return '';
    return safeStorage.decryptString(readFileSync(keyFile()));
  } catch {
    return '';
  }
}

/**
 * Persist the API key, encrypted, or refuse.
 *
 * This previously fell back to `Buffer.from(key, 'utf8')` when
 * `safeStorage.isEncryptionAvailable()` returned false — writing the raw key to
 * a file named `gemini.key.enc`. On any machine without an OS keyring (Linux
 * without gnome-keyring, headless sessions, CI) the `.enc` extension was a lie
 * and the credential sat in plaintext on disk. Refusing is the correct
 * behaviour: a key the user must retype each session is a minor inconvenience,
 * a leaked key is not.
 */
function saveApiKey(key: string): void {
  if (!key) {
    if (existsSync(keyFile())) rmSync(keyFile());
    return;
  }
  if (!encryptionAvailable()) {
    throw new SecureStorageUnavailableError();
  }
  mkdirSync(path.dirname(keyFile()), { recursive: true });
  writeFileSync(`${keyFile()}.tmp`, safeStorage.encryptString(key), { mode: 0o600, flush: true });
  renameSync(`${keyFile()}.tmp`, keyFile());
}

// ---------------------------------------------------------------------------
// Repository host — live GeminiRepository when a key exists, demo otherwise.
// Hot-swapped when the key changes; refresh events re-wired on swap.
// ---------------------------------------------------------------------------
let repository: MarketIntelRepository;
let unwireRefresh: (() => void) | null = null;
let mainWin: BrowserWindow | null = null;

// Every native method is restricted to our main frame, never an embedded website.
const ipcMain = {
  handle(channel: string, listener: Parameters<typeof electronIpcMain.handle>[1]) {
    electronIpcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!mainWin || event.sender !== mainWin.webContents || event.senderFrame !== mainWin.webContents.mainFrame) {
        throw new Error('Untrusted IPC sender.');
      }
      return listener(event, ...args);
    });
  },
};

function makeRepository(): MarketIntelRepository {
  const apiKey = loadApiKey();
  const store = researchStore();
  if (!store.read()) store.write(migrateSnapshot(sampleSnapshot as unknown as RepoSnapshot).snapshot);
  const requireKey = async (): Promise<never> => { throw new Error('Add your Gemini API key in Settings to run live research.'); };
  return new GeminiRepository({
    apiKey,
    ...(apiKey ? {} : { client: { ground: requireKey, structure: requireKey } }),
    store,
    targetCompanies: 10,
    originalSources: createOriginalSourceServices(path.join(app.getPath('userData'), 'original-sources')),
    // Match the bounded browser worker pool. Shared provider RPM limits below
    // still pace requests; one slow company no longer stalls every other card.
    concurrency: 3,
    groundedRpm: 8,
    structureRpm: 8,
  });
}

function wireRefreshForwarding(): void {
  unwireRefresh?.();
  unwireRefresh = repository.subscribeDeckRefresh((evt) => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send(IPC_CHANNELS.deckRefreshEvent, evt);
    }
  });
}

function swapRepository(): void {
  repository = makeRepository();
  wireRefreshForwarding();
}

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.listMarkets, () => repository.listMarkets());
  ipcMain.handle(IPC_CHANNELS.getMarket, (_e, id: unknown) =>
    repository.getMarket(z.string().min(1).parse(id)),
  );
  ipcMain.handle(IPC_CHANNELS.createMarket, (_e, input: unknown) =>
    repository.createMarket(createMarketInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.updateMarketCadence, (_e, id: unknown, cadence: unknown) =>
    repository.updateMarketCadence(
      z.string().min(1).parse(id),
      refreshCadenceSchema.parse(cadence),
    ),
  );
  ipcMain.handle(IPC_CHANNELS.getDeckByMarket, (_e, marketId: unknown) =>
    repository.getDeckByMarket(z.string().min(1).parse(marketId)),
  );
  ipcMain.handle(IPC_CHANNELS.refreshDeck, (_e, marketId: unknown) =>
    repository.refreshDeck(z.string().min(1).parse(marketId)),
  );
  ipcMain.handle(IPC_CHANNELS.createResearchedDeck, (_e, brief: unknown, requestId: unknown) => {
    const validatedBrief = deckResearchBriefSchema.parse(brief);
    const validatedReqId = z.string().min(1).parse(requestId);
    return repository.createResearchedDeck(validatedBrief, {
      onProgress: (progress) => {
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send(IPC_CHANNELS.researchProgressEvent, {
            requestId: validatedReqId,
            progress,
          });
        }
      },
    });
  });
  ipcMain.handle(IPC_CHANNELS.listCards, (_e, deckId: unknown, filter: unknown) =>
    repository.listCards(z.string().min(1).parse(deckId), cardFilterSchema.parse(filter)),
  );
  ipcMain.handle(IPC_CHANNELS.getCard, (_e, cardId: unknown) =>
    repository.getCard(z.string().min(1).parse(cardId)),
  );
  ipcMain.handle(IPC_CHANNELS.listSavedCards, () => repository.listSavedCards());
  ipcMain.handle(IPC_CHANNELS.saveCard, (_e, cardId: unknown) =>
    repository.saveCard(z.string().min(1).parse(cardId)),
  );
  ipcMain.handle(IPC_CHANNELS.unsaveCard, (_e, cardId: unknown) =>
    repository.unsaveCard(z.string().min(1).parse(cardId)),
  );
  ipcMain.handle(IPC_CHANNELS.getCompany, (_e, companyId: unknown) =>
    repository.getCompany(z.string().min(1).parse(companyId)),
  );
  ipcMain.handle(IPC_CHANNELS.getCompanyMetrics, (_e, companyId: unknown) =>
    repository.getCompanyMetrics(z.string().min(1).parse(companyId)),
  );
  ipcMain.handle(IPC_CHANNELS.getCompanyFacts, (_e, companyId: unknown) => {
    const id = z.string().min(1).max(200).parse(companyId);
    if (!repository.getCompanyFacts) throw new Error('Accepted company facts are unavailable. Restart the updated desktop app.');
    return repository.getCompanyFacts(id);
  });
  ipcMain.handle(IPC_CHANNELS.getViceClaims, (_e, cardId: unknown) =>
    repository.getViceClaims(z.string().min(1).parse(cardId)),
  );
  ipcMain.handle(IPC_CHANNELS.getDashboardTab, (_e, companyId: unknown, tab: unknown, force?: unknown) =>
    repository.getDashboardTab(
      z.string().min(1).parse(companyId),
      dashboardTabSchema.parse(tab),
      z.boolean().optional().parse(force),
    ),
  );
  ipcMain.handle(IPC_CHANNELS.deepDive, (_e, input: unknown) =>
    repository.deepDive(deepDiveInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.factCheck, (_e, input: unknown) =>
    repository.factCheck(factCheckInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.verifyMetric, (_e, input: unknown) => {
    if (!repository.verifyMetric) throw new Error('verifyMetric unavailable on this backend');
    return repository.verifyMetric(verifyMetricInputSchema.parse(input));
  });
  ipcMain.handle(IPC_CHANNELS.generateReport, (_e, request: unknown) =>
    repository.generateReport(reportRequestSchema.parse(request)),
  );
  ipcMain.handle(IPC_CHANNELS.listReports, () => repository.listReports());
  ipcMain.handle(IPC_CHANNELS.huntCompanyMetrics, (_e, id: unknown) => {
    if (!repository.huntCompanyMetrics) throw new Error('Metric hunting is unavailable.');
    return repository.huntCompanyMetrics(z.string().min(1).parse(id));
  });
  ipcMain.handle(IPC_CHANNELS.generateDeckBriefing, (_e, id: unknown, opts: unknown) => {
    if (!repository.generateDeckBriefing) throw new Error('Briefings are unavailable.');
    return repository.generateDeckBriefing(z.string().min(1).parse(id), z.object({ windowHours: z.number().int().min(1).max(720).optional() }).optional().parse(opts));
  });
  ipcMain.handle(IPC_CHANNELS.listDeckBriefings, (_e, id: unknown) => repository.listDeckBriefings?.(z.string().min(1).parse(id)) ?? []);
  ipcMain.handle(IPC_CHANNELS.auditSite, (_e, input: unknown) => {
    if (!repository.auditSite) throw new Error('Site audits are unavailable.');
    return repository.auditSite(z.object({ url: z.string().url().refine((url) => /^https?:\/\//.test(url)), siteName: z.string().nullable().optional(), companyId: z.string().nullable().optional() }).parse(input));
  });
  ipcMain.handle(IPC_CHANNELS.getReport, (_e, id: unknown) =>
    repository.getReport(z.string().min(1).parse(id)),
  );
  ipcMain.handle(IPC_CHANNELS.expandDeck, (_e, marketId: unknown, focus: unknown) =>
    repository.expandDeck(
      z.string().min(1).parse(marketId),
      expandFocusSchema.parse(focus),
    ),
  );
  ipcMain.handle(IPC_CHANNELS.overrideMetric, (_e, input: unknown) =>
    repository.overrideMetric(overrideMetricInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.getMarketOpportunity, (_e, marketId: unknown, force?: unknown) =>
    repository.getMarketOpportunity(
      z.string().min(1).parse(marketId),
      z.boolean().optional().parse(force),
    ),
  );
  ipcMain.handle(IPC_CHANNELS.askResearch, (_e, input: unknown) =>
    repository.askResearch?.(askResearchInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.listResearchThreads, (_e, filter: unknown) =>
    repository.listResearchThreads?.(listResearchThreadsFilterSchema.parse(filter)) ?? [],
  );
  ipcMain.handle(IPC_CHANNELS.getResearchThread, (_e, id: unknown) =>
    repository.getResearchThread?.(z.string().min(1).parse(id)) ?? null,
  );
  ipcMain.handle(IPC_CHANNELS.saveThreadAsReport, (_e, threadId: unknown, focus?: unknown) =>
    repository.saveThreadAsReport?.(
      z.string().min(1).parse(threadId),
      z.string().nullable().optional().parse(focus),
    ),
  );
  ipcMain.handle(IPC_CHANNELS.listResearchJobs, () => repository.listResearchJobs?.() ?? []);
  ipcMain.handle(IPC_CHANNELS.addResearchNote, (_e, input: unknown) =>
    repository.addResearchNote?.(z.object({
      companyId: z.string().min(1), companyName: z.string().min(1),
      text: z.string().min(1).max(20000), sourceUrl: z.string().url().optional(),
    }).parse(input)) ?? null);
  ipcMain.handle(IPC_CHANNELS.verifyCompanyMetrics, (_e, input: unknown) => {
    const parsed = z.object({ companyId: z.string().min(1) }).parse(input);
    const verifier = repository as MarketIntelRepository & {
      verifyCompanyMetrics?: (companyId: string) => unknown;
    };
    return verifier.verifyCompanyMetrics?.(parsed.companyId) ?? null;
  });
  ipcMain.handle(IPC_CHANNELS.searchResearchCorpus, (_e, input: unknown) => {
    const parsed = z.object({
      query: z.string().max(500), companyIds: z.array(z.string().min(1)).max(60).optional(),
      topics: z.array(z.string().min(1)).max(20).optional(), limit: z.number().int().min(1).max(25).optional(),
    }).parse(input);
    const searcher = repository as MarketIntelRepository & {
      searchResearchCorpus?: (query: { query: string; companyIds?: string[]; topics?: string[]; limit?: number }) => unknown[];
    };
    return searcher.searchResearchCorpus?.(parsed) ?? [];
  });
  ipcMain.handle(IPC_CHANNELS.saveReport, (_e, input: unknown) => {
    const parsed = z.object({
      kind: z.enum(['company', 'deck', 'site_audit']), subjectId: z.string().min(1),
      title: z.string().min(1).max(200), markdown: z.string().min(1).max(500_000),
      citations: z.array(z.object({ title: z.string(), url: z.string().url() })).max(100),
    }).parse(input);
    const saver = repository as MarketIntelRepository & {
      saveReport?: (input: { kind: 'company' | 'deck' | 'site_audit'; subjectId: string; title: string; markdown: string; citations: { title: string; url: string }[] }) => Promise<unknown>;
    };
    return saver.saveReport?.(parsed) ?? null;
  });
  ipcMain.handle(IPC_CHANNELS.getResearchEvidence, (_e, input: unknown) => {
    const parsed = z.object({ companyId: z.string().optional(), limit: z.number().int().optional() }).parse(input);
    const evidenceReader = repository as MarketIntelRepository & { getResearchEvidence?: (input: { companyId?: string; limit?: number }) => unknown[] };
    return evidenceReader.getResearchEvidence?.(parsed) ?? [];
  });
  ipcMain.handle(IPC_CHANNELS.getResearchJob, (_e, id: unknown) =>
    repository.getResearchJob?.(z.string().min(1).parse(id)) ?? null,
  );
  ipcMain.handle(IPC_CHANNELS.cancelResearchJob, (_e, id: unknown) =>
    repository.cancelResearchJob?.(z.string().min(1).parse(id)) ?? null,
  );
  ipcMain.handle(IPC_CHANNELS.resumeResearchJob, (_e, id: unknown) =>
    repository.resumeResearchJob?.(z.string().min(1).parse(id)) ?? null,
  );

  // Secure key storage — persists to the OS keychain and hot-swaps the backend.
  ipcMain.handle(SECURE_CHANNELS.getApiKey, (): string => loadApiKey());
  ipcMain.handle(SECURE_CHANNELS.setApiKey, (_e, key: unknown): void => {
    const validatedKey = z.string().max(256).regex(/^[\x20-\x7E]*$/).parse(key).trim();
    saveApiKey(validatedKey);
    swapRepository();
  });
  ipcMain.handle(SECURE_CHANNELS.exportResearch, () => {
    const snapshot = researchStore().read();
    return snapshot ? JSON.stringify(snapshot) : null;
  });
  ipcMain.handle(SECURE_CHANNELS.getResearchStorageInfo, () => {
    const snapshot = researchStore().read();
    return { marketCount: snapshot?.markets.length ?? 0, sizeBytes: snapshot ? Buffer.byteLength(JSON.stringify(snapshot)) : 0, hasBackup: existsSync(`${researchFile()}.bak`) };
  });
  ipcMain.handle(SECURE_CHANNELS.importResearch, async (_e, json: unknown) => {
    const jobs = await repository.listResearchJobs?.() ?? [];
    if (jobs.some((job) => job.status === 'running' || job.status === 'queued')) throw new Error('Finish or cancel active research before importing.');
    researchStore().write(parseResearchExport(z.string().max(50 * 1024 * 1024).parse(json)));
    swapRepository();
  });

  // Google Auth IPC handlers for Electron desktop shell
  let desktopUser: OAuthUser | null = null;

  const handleGoogleSignIn = async () => {
    try {
      const user = await performGoogleOAuthFlow();
      desktopUser = user;
      return desktopUser;
    } catch (err) {
      console.error('[main] Google sign-in failed:', err);
      throw err;
    }
  };

  const handleGoogleSignOut = async () => {
    desktopUser = null;
  };

  ipcMain.handle(IPC_CHANNELS.googleSignIn, handleGoogleSignIn);
  ipcMain.handle(IPC_CHANNELS.googleSignOut, handleGoogleSignOut);
  ipcMain.handle(SECURE_CHANNELS.googleSignIn, handleGoogleSignIn);
  ipcMain.handle(SECURE_CHANNELS.googleSignOut, handleGoogleSignOut);
}

function createWindow(): void {
  const iconPath = path.join(DESKTOP_DIST, '../build/icon.png');
  const appIcon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;

  mainWin = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    title: 'Stratemark',
    icon: appIcon,
    backgroundColor: '#EDECE8',
    webPreferences: {
      preload: path.join(DESKTOP_DIST, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (event) => { event.preventDefault(); });
  mainWin.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

  mainWin.once('ready-to-show', () => {
    mainWin?.show();
    mainWin?.focus();
    if (process.platform === 'darwin') {
      if (appIcon) {
        try {
          app.dock?.setIcon(appIcon);
        } catch {
          // ignore
        }
      }
      app.dock?.show();
      app.focus({ steal: true });
    }
  });

  wireRefreshForwarding();

  const devUrl = !app.isPackaged ? (process.env.VITE_DEV_SERVER_URL ?? (process.argv.includes('--dev-server') ? 'http://localhost:5173' : undefined)) : undefined;
  if (devUrl) void mainWin.loadURL(devUrl);
  else void mainWin.loadURL('app://bundle/index.html');
}

void app.whenReady().then(() => {
  // Serve the web build under app:// (raw file:// blocks ES modules).
  protocol.handle('app', (request) => {
    const { pathname, hostname } = new URL(request.url);
    if (hostname !== 'bundle') return new Response('Not found', { status: 404 });
    const rel = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.resolve(WEB_DIST, `.${decodeURIComponent(rel)}`);
    const relative = path.relative(WEB_DIST, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(filePath).toString());
  });

  repository = makeRepository();
  createApplicationMenu();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(() => {
  dialog.showErrorBox('Stratemark could not start', 'Your saved research could not be opened. No data was deleted. Restore a valid backup or upgrade to the version that saved it.');
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
