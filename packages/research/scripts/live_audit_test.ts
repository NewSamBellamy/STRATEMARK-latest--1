/**
 * Stratemark Live Multi-Agent Architecture Audit Test
 * Exercises the complete multi-agent pipeline against Gemini 3.7 Flash:
 * 1. MarketScoutAgent (Discovery)
 * 2. Parallel CompanyCardHydratorSubagents (5-Tier Provenance Waterfall)
 * 3. Signal Agents (Vice, Barrier, Insight, Culture)
 * 4. 8-Tab Company Dossier Hydrator
 * 5. FactCheck & Grounded Chat Agents
 */
import { GeminiRepository } from '../src/repository';
import type { ResearchProgress } from '@mi/contracts';
import { DASHBOARD_TABS } from '@mi/contracts';

const apiKey = (process.env.GEMINI_API_KEY ?? '').replace(/[^\x20-\x7E]/g, '').trim();
if (!apiKey) {
  console.error('Error: GEMINI_API_KEY is not set');
  process.exit(1);
}

// In-memory persistent snapshot store for this audit run
const mockStore = {
  data: null as any,
  read() { return this.data; },
  write(s: any) { this.data = s; }
};

const repo = new GeminiRepository({
  apiKey,
  store: mockStore,
  targetCompanies: 5,
  catalogMax: 10,
  catalogPasses: 1,
  concurrency: 3,
});

async function runLiveAudit() {
  console.log('================================================================');
  console.log('🏛️ STRATEMARK MULTI-AGENT BACKEND AUDIT (Gemini 3.7 Flash)');
  console.log('================================================================\n');

  const startTime = Date.now();
  const logs: string[] = [];

  const onProgress = (evt: ResearchProgress) => {
    if (evt.message) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const kindStr = (evt.kind ?? 'step').toUpperCase();
      logs.push(`[+${elapsed}s] [${kindStr}] ${evt.message}`);
      console.log(`[+${elapsed}s] [${kindStr}] ${evt.message}`);
    }
  };

  // --- PHASE 1, 2, 3: DECK RESEARCH ORCHESTRATION ---
  console.log('▶ [PHASE 1-3] Launching Deck Research: "AI Developer Tooling & Agent Coding Startups"...\n');
  const deckStartTime = Date.now();
  const { market } = await repo.createResearchedDeck(
    {
      prompt: 'AI Developer Tooling & Autonomous Agent Coding Startups — code generation, agentic IDEs, and code review infrastructure',
      region: 'United States',
    },
    { onProgress }
  );
  const deckDurationSec = ((Date.now() - deckStartTime) / 1000).toFixed(1);

  console.log(`\n✅ Deck Research Complete in ${deckDurationSec}s! Market ID: ${market.id}`);

  // Fetch all generated cards
  const deck = await repo.getDeckByMarket(market.id);
  const cards = deck ? await repo.listCards(deck.id) : [];

  console.log(`\n📊 Generated ${cards.length} Total Cards:`);
  const typeCounts: Record<string, number> = {};
  for (const c of cards) {
    typeCounts[c.card.cardType] = (typeCounts[c.card.cardType] || 0) + 1;
  }
  console.table(typeCounts);

  // Analyze Entity Cards (Companies)
  const entityCards = cards.filter(c => c.card.cardType === 'company');
  console.log(`\n🏢 Discovered Entities (${entityCards.length}):`);
  
  const entitySummary = entityCards.map(c => {
    const arrMetric = c.metrics.find(m => m.metricType === 'arr');
    const valMetric = c.metrics.find(m => m.metricType === 'valuation');
    const teamMetric = c.metrics.find(m => m.metricType === 'employees');
    return {
      Company: c.company?.name ?? c.card.title ?? '—',
      Tier: `T${c.card.tier} (${c.card.tierReason?.slice(0, 30)}...)`,
      ARR: arrMetric ? `${arrMetric.value} (${arrMetric.confidence})` : '—',
      Valuation: valMetric ? `${valMetric.value} (${valMetric.confidence})` : '—',
      Employees: teamMetric ? `${teamMetric.value} (${teamMetric.confidence})` : '—',
      Citations: c.card.citations.length,
    };
  });
  console.table(entitySummary);

  // Analyze Signal Cards (Vice, Barrier, Insight, Infrastructure, Distribution)
  const signalCards = cards.filter(c => c.card.cardType !== 'company');
  console.log(`\n📡 Signal & Market Cards (${signalCards.length}):`);
  for (const s of signalCards) {
    const summaryText = s.card.summary || s.card.keyPoints?.join('; ') || 'No summary';
    console.log(` • [${s.card.cardType.toUpperCase()}] ${s.card.title}: ${summaryText.slice(0, 90)}...`);
    if (s.card.citations.length > 0) {
      console.log(`   └─ Citations (${s.card.citations.length}): ${s.card.citations.map(c => c.title || c.url).slice(0, 2).join(', ')}`);
    }
  }

  // --- PHASE 4: 8-TAB COMPANY DOSSIER HYDRATION AUDIT ---
  const firstTarget = entityCards[0];
  if (firstTarget?.company) {
    const company = firstTarget.company;
    console.log(`\n▶ [PHASE 4] Testing 8-Tab Dossier Hydration for: ${company.name} (${company.id})...\n`);
    
    const tabAuditResults: Record<string, { status: string; keysFound: number; latencyMs: number }> = {};
    
    for (const tab of DASHBOARD_TABS) {
      const tabStart = Date.now();
      try {
        const result = await repo.getDashboardTab(company.id, tab, true);
        const tabLatency = Date.now() - tabStart;
        const keys = result && typeof result.content === 'object' && result.content !== null ? Object.keys(result.content).length : 1;
        tabAuditResults[tab] = { status: 'SUCCESS', keysFound: keys, latencyMs: tabLatency };
        console.log(`  ✓ Tab [${tab.padEnd(18)}]: Hydrated in ${tabLatency}ms (${keys} fields populated)`);
      } catch (err: any) {
        tabAuditResults[tab] = { status: `FAILED: ${err.message}`, keysFound: 0, latencyMs: Date.now() - tabStart };
        console.log(`  ✗ Tab [${tab.padEnd(18)}]: FAILED (${err.message})`);
      }
    }
    console.table(tabAuditResults);
  }

  // --- PHASE 5: FACT-CHECK & DEEP DIVE GROUNDED REASONING ---
  console.log('\n▶ [PHASE 5] Testing FactCheck & Grounded Deep Dive Agents...\n');
  
  if (firstTarget?.company) {
    const company = firstTarget.company;
    const firstMetric = firstTarget.metrics[0];
    if (firstMetric) {
      console.log(`• Fact-Checking ${company.name} ${firstMetric.metricType} (${firstMetric.value})...`);
      const fcStart = Date.now();
      const fcResult = await repo.factCheck({
        claim: `${company.name} has a ${firstMetric.metricType} of ${firstMetric.value}`,
        companyName: company.name,
      });
      console.log(`  └─ Verdict: [${fcResult.verdict.toUpperCase()}] in ${Date.now() - fcStart}ms`);
      console.log(`  └─ Rationale: ${(fcResult.rationale || 'No rationale').slice(0, 140)}...`);
      console.log(`  └─ Citations (${fcResult.citations.length}): ${fcResult.citations.map(s => s.title || s.url).join(', ')}`);
    }

    console.log(`\n• Deep Dive Grounded Question: "What are the competitive moats of ${company.name}?"...`);
    const ddStart = Date.now();
    const ddResult = await repo.deepDive({
      companyId: company.id,
      companyName: company.name,
      topic: 'competitive moats and advantages',
      context: `What are the primary competitive advantages and moats of ${company.name}?`,
    });
    console.log(`  └─ Answer in ${Date.now() - ddStart}ms:\n"${(ddResult.markdown || '').slice(0, 200)}..."`);
    console.log(`  └─ Cited Sources: ${ddResult.citations.length} sources`);
  }

  const totalTimeSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n================================================================');
  console.log(`🏆 MULTI-AGENT ARCHITECTURE AUDIT COMPLETE IN ${totalTimeSec}s`);
  console.log('================================================================\n');
}

runLiveAudit().catch(err => {
  console.error('Audit run failed with error:', err);
  process.exit(1);
});
