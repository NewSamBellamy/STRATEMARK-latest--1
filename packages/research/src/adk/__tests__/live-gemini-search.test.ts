import { describe, it, expect } from 'vitest';
import { createGeminiClient } from '../../gemini';
import { mapMarketTopology } from '../discovery-agent';
import { createAdkTelemetry } from '../telemetry';
import fs from 'fs';

describe('Live Google Grounded Search on Gemini API Benchmark', () => {
  it('executes a real search on Google Gemini API and captures timing + real candidates', async () => {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey || process.env.LIVE_TESTS !== '1') {
      console.warn('Skipping live Gemini search test — no API key in environment.');
      return;
    }

    const client = createGeminiClient({ apiKey });
    const telemetry = createAdkTelemetry({ rootAuthor: 'live_benchmark', rootBranch: 'root' });

    const plan = {
      marketName: 'Enterprise AI Search & Knowledge Discovery Platforms',
      vertical: 'Enterprise Software & Information Retrieval',
      geography: 'Global',
      notes: 'AI-native enterprise search engines, retrieval augmented generation, and workplace knowledge discovery.',
      searchThemes: ['Enterprise search RAG', 'AI workplace search platforms', 'Vector search enterprise software']
    };

    console.log('🚀 Executing REAL Google Grounded Search on Gemini API...');
    const startTime = Date.now();

    const topology = await mapMarketTopology({
      client,
      plan,
      telemetry,
      targets: { core_operators: 5, infrastructure_supply: 3, distribution_channel: 2 }
    });

    const durationMs = Date.now() - startTime;
    console.log(`\n✅ REAL Grounded Search Complete in ${(durationMs / 1000).toFixed(2)}s!`);
    console.log(`Discovered ${topology.candidates.length} REAL companies across 3 vectors:`);

    topology.candidates.forEach((c, i) => {
      console.log(`  [${i + 1}] ${c.name} (${c.domain || 'no domain'}) — Role: ${c.primaryRole} [${c.vectors.join(', ')}]`);
    });

    console.log(`\n📚 REAL Grounded Citations returned: ${topology.citations.length}`);
    topology.citations.slice(0, 5).forEach((cit, i) => {
      console.log(`  [Citation ${i + 1}] ${cit.title} -> ${cit.url}`);
    });

    const receipt = {
      executedAt: new Date().toISOString(),
      query: plan.marketName,
      durationSeconds: Number((durationMs / 1000).toFixed(2)),
      realCandidatesCount: topology.candidates.length,
      candidates: topology.candidates,
      citationsCount: topology.citations.length,
      citations: topology.citations
    };

    fs.mkdirSync('audit_artifacts', { recursive: true });
    fs.writeFileSync('audit_artifacts/live_real_gemini_search_receipt.json', JSON.stringify(receipt, null, 2));

    expect(topology.candidates.length).toBeGreaterThan(0);
    expect(durationMs).toBeLessThan(30000);
  }, 45000);
});
