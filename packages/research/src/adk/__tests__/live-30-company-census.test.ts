import { describe, it, expect } from 'vitest';
import { createGeminiClient } from '../../gemini';
import { mapMarketTopology } from '../discovery-agent';
import { createAdkTelemetry } from '../telemetry';
import { researchMarketSignals } from '../../signal-agents';
import { hydrateCompanyCard } from '../../company-agent';
import { mapWithConcurrency } from '../../util';
import fs from 'fs';

describe('Institutional 30-Company Market Census Live Benchmark', () => {
  it('executes a 30-company live census across 3 vectors with macro signals and proxy hydration', async () => {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey || process.env.LIVE_TESTS !== '1') {
      console.warn('Skipping live census test — no API key in environment.');
      return;
    }

    const client = createGeminiClient({ apiKey });
    const telemetry = createAdkTelemetry({ rootAuthor: 'institutional_census_run', rootBranch: 'root' });

    const plan = {
      marketName: 'Autonomous AI Coding Agents & Developer Intelligence Platforms',
      vertical: 'Developer Tools, Autonomous Engineering Agents & Code Intelligence',
      geography: 'Global',
      notes: 'AI-assisted code generation, autonomous coding agent CLIs, IDE extensions, repository-level multi-agent reasoning, and automated software engineering workflows.',
      searchThemes: [
        'Autonomous AI software engineer agents',
        'AI code generation IDE plugins and desktop apps',
        'Code intelligence LLM APIs and vector retrieval',
        'Developer tool marketplaces and enterprise deployment integrations'
      ]
    };

    console.log('\n================================================================');
    console.log('🚀 INITIATING INSTITUTIONAL 30-COMPANY LIVE MARKET CENSUS');
    console.log(`🎯 Market: "${plan.marketName}"`);
    console.log('================================================================\n');

    const totalStartTime = Date.now();

    // Stage 1: 3-Vector Deep Census Pass
    console.log('📡 [STAGE 1] Executing Parallel 3-Vector Deep Topology Pass...');
    const topologyStartTime = Date.now();

    const topology = await mapMarketTopology({
      client,
      plan,
      telemetry,
      targets: {
        core_operators: 18,
        infrastructure_supply: 8,
        distribution_channel: 6,
      }
    });

    const topologyDurationMs = Date.now() - topologyStartTime;
    console.log(`✅ [STAGE 1 COMPLETE] Discovered ${topology.candidates.length} REAL entities in ${(topologyDurationMs / 1000).toFixed(2)}s!`);
    console.log(`   • Core Operators: ${topology.byVector.core_operators?.length ?? 0}`);
    console.log(`   • Infrastructure Suppliers: ${topology.byVector.infrastructure_supply?.length ?? 0}`);
    console.log(`   • Distribution Channels: ${topology.byVector.distribution_channel?.length ?? 0}`);
    console.log(`   • Grounded Citations: ${topology.citations.length}`);

    // Stage 2: Macro Moats (Barriers), Insights & Risk Signals
    console.log('\n🏛️ [STAGE 2] Researching Macro Moats (Barriers), Trends (Insights) & Vices...');
    const signalsStartTime = Date.now();
    const signalsResult = await researchMarketSignals(client, plan, 'dck_coding_agents_census', {
      coverage: {
        barrier: { min: 3, target: 4, max: 6 },
        insight: { min: 3, target: 4, max: 6 },
      }
    });
    const signalsDurationMs = Date.now() - signalsStartTime;
    console.log(`✅ [STAGE 2 COMPLETE] Generated ${signalsResult.length} Macro Moat & Insight cards in ${(signalsDurationMs / 1000).toFixed(2)}s!`);

    // Stage 3: Parallel Streaming Hydration Pool (Top 8 Core Players)
    console.log('\n⚡ [STAGE 3] Hydrating Top Core Operating Companies via Parallel Worker Pool...');
    const hydrationStartTime = Date.now();
    const topCandidates = topology.candidates.slice(0, 8);

    const hydratedCards = await mapWithConcurrency(topCandidates, 4, async (candidate) => {
      const result = await hydrateCompanyCard({
        candidate,
        client,
        plan,
        deckId: 'dck_coding_agents_census',
      });
      console.log(`   ✓ Hydrated: ${candidate.name} | Tier: ${result.card.tier ?? 'T2'} | Metrics: ${result.metrics.length} | Citations: ${result.citations.length}`);
      return result;
    });

    const hydrationDurationMs = Date.now() - hydrationStartTime;
    const totalDurationMs = Date.now() - totalStartTime;

    console.log(`\n✅ [STAGE 3 COMPLETE] Hydrated ${hydratedCards.length} deep dossiers in ${(hydrationDurationMs / 1000).toFixed(2)}s!`);
    console.log('================================================================');
    console.log(`🎉 FULL INSTITUTIONAL RUN COMPLETED IN ${(totalDurationMs / 1000).toFixed(2)}s TOTAL!`);
    console.log('================================================================\n');

    console.log('📋 COMPLETE 3-TIER ENTITY CENSUS:');
    topology.candidates.forEach((c, i) => {
      console.log(`  [${(i + 1).toString().padStart(2, ' ')}] ${c.name.padEnd(28)} | Role: ${(c.primaryRole ?? 'unknown').padEnd(14)} | Domain: ${c.domain || 'none'}`);
    });

    const fullReceipt = {
      executedAt: new Date().toISOString(),
      market: plan.marketName,
      totalDurationSeconds: Number((totalDurationMs / 1000).toFixed(2)),
      topologyDurationSeconds: Number((topologyDurationMs / 1000).toFixed(2)),
      signalsDurationSeconds: Number((signalsDurationMs / 1000).toFixed(2)),
      hydrationDurationSeconds: Number((hydrationDurationMs / 1000).toFixed(2)),
      totalCensusCount: topology.candidates.length,
      breakdown: {
        operators: topology.byVector.core_operators?.length ?? 0,
        infrastructure: topology.byVector.infrastructure_supply?.length ?? 0,
        distribution: topology.byVector.distribution_channel?.length ?? 0,
        macroSignals: signalsResult.length,
        deepHydratedDossiers: hydratedCards.length,
      },
      candidates: topology.candidates,
      citationsCount: topology.citations.length,
      citations: topology.citations.slice(0, 20),
    };

    fs.mkdirSync('audit_artifacts', { recursive: true });
    fs.writeFileSync('audit_artifacts/live_30_company_census_receipt.json', JSON.stringify(fullReceipt, null, 2));

    expect(topology.candidates.length).toBeGreaterThanOrEqual(15);
  }, 120000);
});
