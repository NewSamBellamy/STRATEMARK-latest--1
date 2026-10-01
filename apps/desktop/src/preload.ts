/**
 * Preload — the ONLY channel between the sandboxed renderer and main.
 *
 * It exposes a typed `window.mi` object (the PreloadRepositoryApi contract from
 * @mi/contracts). The renderer's IpcRepository forwards to it. No Node APIs, no
 * secrets, and no ipcRenderer are leaked to page scripts — only these methods.
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  SECURE_CHANNELS,
  type DeckRefreshEvent,
  type DeckRefreshListener,
  type PreloadRepositoryApi,
  type ResearchJob,
  type ResearchProgressEvent,
  type ResearchProgressListener,
  type SecureApi,
} from '@mi/contracts';

const api: PreloadRepositoryApi = {
  storageMode: process.argv.includes('--staged-research-readonly') ? 'staged_readonly' : 'legacy',
  listMarkets: () => ipcRenderer.invoke(IPC_CHANNELS.listMarkets),
  getMarket: (id) => ipcRenderer.invoke(IPC_CHANNELS.getMarket, id),
  createMarket: (input) => ipcRenderer.invoke(IPC_CHANNELS.createMarket, input),
  updateMarketCadence: (id, cadence) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateMarketCadence, id, cadence),
  getDeckByMarket: (marketId) => ipcRenderer.invoke(IPC_CHANNELS.getDeckByMarket, marketId),
  refreshDeck: (marketId) => ipcRenderer.invoke(IPC_CHANNELS.refreshDeck, marketId),
  // Progress handlers can't cross IPC; the renderer polls/receives events instead.
  createResearchedDeck: (brief, requestId) =>
    ipcRenderer.invoke(IPC_CHANNELS.createResearchedDeck, brief, requestId),
  listCards: (deckId, filter) => ipcRenderer.invoke(IPC_CHANNELS.listCards, deckId, filter),
  getCard: (cardId) => ipcRenderer.invoke(IPC_CHANNELS.getCard, cardId),
  listSavedCards: () => ipcRenderer.invoke(IPC_CHANNELS.listSavedCards),
  saveCard: (cardId) => ipcRenderer.invoke(IPC_CHANNELS.saveCard, cardId),
  unsaveCard: (cardId) => ipcRenderer.invoke(IPC_CHANNELS.unsaveCard, cardId),
  getCompany: (companyId) => ipcRenderer.invoke(IPC_CHANNELS.getCompany, companyId),
  getCompanyMetrics: (companyId) => ipcRenderer.invoke(IPC_CHANNELS.getCompanyMetrics, companyId),
  getViceClaims: (cardId) => ipcRenderer.invoke(IPC_CHANNELS.getViceClaims, cardId),
  getDashboardTab: (companyId, tab, force) =>
    ipcRenderer.invoke(IPC_CHANNELS.getDashboardTab, companyId, tab, force),
  deepDive: (input) => ipcRenderer.invoke(IPC_CHANNELS.deepDive, input),
  factCheck: (input) => ipcRenderer.invoke(IPC_CHANNELS.factCheck, input),
  verifyMetric: (input) => ipcRenderer.invoke(IPC_CHANNELS.verifyMetric, input),
  generateReport: (request) => ipcRenderer.invoke(IPC_CHANNELS.generateReport, request),
  listReports: () => ipcRenderer.invoke(IPC_CHANNELS.listReports),
  huntCompanyMetrics: (id) => ipcRenderer.invoke(IPC_CHANNELS.huntCompanyMetrics, id),
  generateDeckBriefing: (id, opts) =>
    ipcRenderer.invoke(IPC_CHANNELS.generateDeckBriefing, id, opts),
  listDeckBriefings: (id) => ipcRenderer.invoke(IPC_CHANNELS.listDeckBriefings, id),
  auditSite: (input) => ipcRenderer.invoke(IPC_CHANNELS.auditSite, input),
  getReport: (id) => ipcRenderer.invoke(IPC_CHANNELS.getReport, id),
  expandDeck: (marketId, focus) => ipcRenderer.invoke(IPC_CHANNELS.expandDeck, marketId, focus),
  overrideMetric: (input) => ipcRenderer.invoke(IPC_CHANNELS.overrideMetric, input),
  getMarketOpportunity: (marketId, force) =>
    ipcRenderer.invoke(IPC_CHANNELS.getMarketOpportunity, marketId, force),
  askResearch: (input) => ipcRenderer.invoke(IPC_CHANNELS.askResearch, input),
  listResearchThreads: (filter) => ipcRenderer.invoke(IPC_CHANNELS.listResearchThreads, filter),
  getResearchThread: (id) => ipcRenderer.invoke(IPC_CHANNELS.getResearchThread, id),
  saveThreadAsReport: (threadId, focus) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveThreadAsReport, threadId, focus),
  listResearchJobs: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listResearchJobs) as Promise<ResearchJob[]>,
  getResearchJob: (id) =>
    ipcRenderer.invoke(IPC_CHANNELS.getResearchJob, id) as Promise<ResearchJob | null>,
  cancelResearchJob: (id) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelResearchJob, id) as Promise<ResearchJob | null>,
  resumeResearchJob: (id) =>
    ipcRenderer.invoke(IPC_CHANNELS.resumeResearchJob, id) as Promise<ResearchJob | null>,
  googleSignIn: () => ipcRenderer.invoke(IPC_CHANNELS.googleSignIn),
  googleSignOut: () => ipcRenderer.invoke(IPC_CHANNELS.googleSignOut),
  onAuthCallback: (listener) => {
    const handler = (_event: unknown, data: { token?: string; user?: Record<string, unknown> }) =>
      listener(data);
    ipcRenderer.on(IPC_CHANNELS.authCallbackEvent, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.authCallbackEvent, handler);
    };
  },
  onDeckRefresh: (listener: DeckRefreshListener) => {
    const handler = (_event: unknown, evt: DeckRefreshEvent) => listener(evt);
    ipcRenderer.on(IPC_CHANNELS.deckRefreshEvent, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.deckRefreshEvent, handler);
    };
  },
  onResearchProgress: (listener: ResearchProgressListener) => {
    const handler = (_event: unknown, evt: ResearchProgressEvent) => listener(evt);
    ipcRenderer.on(IPC_CHANNELS.researchProgressEvent, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.researchProgressEvent, handler);
    };
  },
};

contextBridge.exposeInMainWorld('mi', api);

const secure: SecureApi = {
  getApiKey: () => ipcRenderer.invoke(SECURE_CHANNELS.getApiKey),
  setApiKey: (key) => ipcRenderer.invoke(SECURE_CHANNELS.setApiKey, key),
  exportResearch: () => ipcRenderer.invoke(SECURE_CHANNELS.exportResearch),
  importResearch: (json) => ipcRenderer.invoke(SECURE_CHANNELS.importResearch, json),
  getResearchStorageInfo: () => ipcRenderer.invoke(SECURE_CHANNELS.getResearchStorageInfo),
  googleSignIn: () => ipcRenderer.invoke(SECURE_CHANNELS.googleSignIn),
  googleSignOut: () => ipcRenderer.invoke(SECURE_CHANNELS.googleSignOut),
};
contextBridge.exposeInMainWorld('miSecure', secure);
