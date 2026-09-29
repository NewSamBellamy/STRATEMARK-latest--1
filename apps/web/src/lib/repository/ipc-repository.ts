/**
 * IpcRepository — the drop-in back end for the Electron shell.
 *
 * It forwards every repository call to `window.mi` (exposed by the Electron
 * preload via contextBridge; see @mi/contracts `PreloadRepositoryApi`). Today,
 * in the plain web build, `window.mi` is undefined and the app uses
 * MockRepository instead — so this class is the wiring that makes the eventual
 * back end a zero-UI-change swap. It is intentionally a thin pass-through.
 */
import type {
  CardFilter,
  CardWithCompany,
  Company,
  CompanyMetric,
  CreateMarketInput,
  DashboardTab,
  DashboardTabResult,
  DeepDiveInput,
  DeepDiveResult,
  ExpandFocus,
  FactCheckInput,
  FactCheckResult,
  VerifyMetricInput,
  VerifyMetricResult,
  OverrideMetricInput,
  Report,
  ReportRequest,
  SavedCard,
  Deck,
  DeckRefreshListener,
  DeckResearchBrief,
  AskResearchInput,
  ResearchThread,
  Market,
  MarketIntelRepository,
  PreloadRepositoryApi,
  ResearchJob,
  RefreshCadence,
  ResearchHandlers,
  Unsubscribe,
  ViceClaim,
  HuntMetricsResult,
  DeckBriefing,
  SiteAuditInput,
} from '@mi/contracts';

export function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.mi !== 'undefined';
}

export class IpcRepository implements MarketIntelRepository {
  constructor(private readonly api: PreloadRepositoryApi) {}

  listMarkets(): Promise<Market[]> {
    return this.api.listMarkets();
  }
  getMarket(id: string): Promise<Market | null> {
    return this.api.getMarket(id);
  }
  createMarket(input: CreateMarketInput): Promise<Market> {
    return this.api.createMarket(input);
  }
  updateMarketCadence(id: string, cadence: RefreshCadence): Promise<Market> {
    return this.api.updateMarketCadence(id, cadence);
  }
  getDeckByMarket(marketId: string): Promise<Deck | null> {
    return this.api.getDeckByMarket(marketId);
  }
  refreshDeck(marketId: string): Promise<Deck> {
    return this.api.refreshDeck(marketId);
  }
  createResearchedDeck(
    brief: DeckResearchBrief,
    handlers?: ResearchHandlers,
  ): Promise<{ market: Market; deck: Deck }> {
    const requestId = `research_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const unsubscribe = this.api.onResearchProgress((event) => {
      if (event.requestId === requestId) handlers?.onProgress?.(event.progress);
    });
    return this.api.createResearchedDeck(brief, requestId).finally(unsubscribe);
  }
  listCards(deckId: string, filter?: CardFilter): Promise<CardWithCompany[]> {
    return this.api.listCards(deckId, filter);
  }
  getCard(cardId: string): Promise<CardWithCompany | null> {
    return this.api.getCard(cardId);
  }
  listSavedCards(): Promise<CardWithCompany[]> {
    return this.api.listSavedCards();
  }
  saveCard(cardId: string): Promise<SavedCard> {
    return this.api.saveCard(cardId);
  }
  unsaveCard(cardId: string): Promise<void> {
    return this.api.unsaveCard(cardId);
  }
  getCompany(companyId: string): Promise<Company | null> {
    return this.api.getCompany(companyId);
  }
  getCompanyMetrics(companyId: string): Promise<CompanyMetric[]> {
    return this.api.getCompanyMetrics(companyId);
  }
  getViceClaims(cardId: string): Promise<ViceClaim[]> {
    return this.api.getViceClaims(cardId);
  }
  getDashboardTab<T extends DashboardTab>(
    companyId: string,
    tab: T,
    force?: boolean,
  ): Promise<DashboardTabResult<T> | null> {
    return this.api.getDashboardTab(companyId, tab, force);
  }
  deepDive(input: DeepDiveInput): Promise<DeepDiveResult> {
    return this.api.deepDive(input);
  }
  factCheck(input: FactCheckInput): Promise<FactCheckResult> {
    return this.api.factCheck(input);
  }
  verifyMetric(input: VerifyMetricInput): Promise<VerifyMetricResult> {
    if (!this.api.verifyMetric) {
      return Promise.reject(new Error('Live verification requires an updated desktop shell.'));
    }
    return this.api.verifyMetric.call(this.api, input);
  }
  expandDeck(marketId: string, focus: ExpandFocus): Promise<{ added: number }> {
    return this.api.expandDeck(marketId, focus);
  }
  overrideMetric(input: OverrideMetricInput): Promise<CompanyMetric> {
    return this.api.overrideMetric(input);
  }
  getMarketOpportunity(marketId: string, force?: boolean): Promise<DeepDiveResult> {
    return this.api.getMarketOpportunity(marketId, force);
  }
  askResearch(input: AskResearchInput): Promise<ResearchThread> {
    return this.api.askResearch!.call(this.api, input);
  }
  listResearchThreads(filter?: { deckId?: string; companyId?: string }): Promise<ResearchThread[]> {
    return this.api.listResearchThreads!.call(this.api, filter);
  }
  getResearchThread(id: string): Promise<ResearchThread | null> {
    return this.api.getResearchThread!.call(this.api, id);
  }
  saveThreadAsReport(threadId: string, focus?: string | null): Promise<Report> {
    return this.api.saveThreadAsReport!.call(this.api, threadId, focus);
  }
  listResearchJobs(): Promise<ResearchJob[]> {
    return this.api.listResearchJobs?.() ?? Promise.resolve([]);
  }
  getResearchJob(id: string): Promise<ResearchJob | null> {
    return this.api.getResearchJob?.(id) ?? Promise.resolve(null);
  }
  cancelResearchJob(id: string): Promise<ResearchJob | null> {
    return this.api.cancelResearchJob?.(id) ?? Promise.resolve(null);
  }
  resumeResearchJob(id: string): Promise<ResearchJob | null> {
    return this.api.resumeResearchJob?.(id) ?? Promise.resolve(null);
  }
  generateReport(request: ReportRequest): Promise<Report> {
    return this.api.generateReport(request);
  }
  listReports(): Promise<Report[]> {
    return this.api.listReports();
  }
  huntCompanyMetrics(id: string): Promise<HuntMetricsResult> {
    if (!this.api.huntCompanyMetrics) return Promise.reject(new Error('Update the desktop shell to hunt metrics.'));
    return this.api.huntCompanyMetrics(id);
  }
  generateDeckBriefing(id: string, opts?: { windowHours?: number }): Promise<DeckBriefing> {
    if (!this.api.generateDeckBriefing) return Promise.reject(new Error('Update the desktop shell to generate briefings.'));
    return this.api.generateDeckBriefing(id, opts);
  }
  listDeckBriefings(id: string): Promise<DeckBriefing[]> {
    return this.api.listDeckBriefings?.(id) ?? Promise.resolve([]);
  }
  auditSite(input: SiteAuditInput): Promise<Report> {
    if (!this.api.auditSite) return Promise.reject(new Error('Update the desktop shell to audit sites.'));
    return this.api.auditSite(input);
  }
  getReport(id: string): Promise<Report | null> {
    return this.api.getReport(id);
  }
  subscribeDeckRefresh(listener: DeckRefreshListener): Unsubscribe {
    return this.api.onDeckRefresh(listener);
  }
}
