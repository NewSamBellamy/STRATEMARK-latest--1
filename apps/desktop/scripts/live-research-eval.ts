/** Explicit opt-in diagnostic. Uses an existing OS-encrypted key in memory; never copies it.
 * Build with esbuild for Electron; outputs go outside the source checkout.
 * Provider invoice is authoritative: recorded dollar costs are estimates, not a billing API.
 */
import { app, safeStorage } from 'electron';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createGeminiClient, DEFAULT_GROUNDED_MODEL, DEFAULT_STRUCTURE_MODEL } from '@mi/research';
import { NativeResearchService } from '../src/native-service';
import { openVault } from '../src/vault';

const [keyFile, output] = process.argv.slice(2);
if (!keyFile || !output || !path.isAbsolute(keyFile) || !path.isAbsolute(output))
  throw new Error('Explicit absolute encrypted-key and new output paths required.');
if (existsSync(output)) throw new Error('Refusing to overwrite an evaluation.');
app.setName('Stratemark');
app.setPath('userData', path.dirname(keyFile));
const receipts: Record<string, unknown>[] = [];
let service: NativeResearchService | undefined;
let credential = '';
let requests = 0;
let grounded = 0;
let costEstimate = 0;
let reserved = 0;
const startedAt = new Date().toISOString();
const redact = (value: string) => (credential ? value.replaceAll(credential, '[redacted]') : value);
const save = (file: string, value: unknown) =>
  writeFileSync(path.join(output, file), redact(JSON.stringify(value, null, 2)));
const checkedFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== 'https://generativelanguage.googleapis.com')
    throw new Error('Unexpected provider origin.');
  const body = JSON.parse(String(init?.body ?? '{}'));
  const isGrounded = Array.isArray(body.tools) && body.tools.length > 0;
  const model = url.pathname.split('/').pop()!.split(':')[0]!;
  const inputBound = Buffer.byteLength(String(init?.body ?? ''), 'utf8') + 1024;
  const outputLimit = body.generationConfig?.maxOutputTokens;
  if (
    !Number.isInteger(outputLimit) ||
    outputLimit < 1 ||
    outputLimit > 8192 ||
    inputBound > 200000
  )
    throw new Error('Evaluation request exceeds approved token ceiling.');
  // Oct 1 official standard prices; conservative search reservation is not a server-side query cap.
  const inputRate = model === DEFAULT_GROUNDED_MODEL ? 0.75 : 0.3;
  const outputRate = model === DEFAULT_GROUNDED_MODEL ? 3.75 : 2.5;
  const reservation =
    (inputBound * inputRate) / 1e6 + (outputLimit * outputRate) / 1e6 + (isGrounded ? 0.7 : 0);
  if (
    requests >= 12 ||
    (isGrounded && grounded >= 4) ||
    reserved + reservation > 3.2 ||
    costEstimate > 3
  )
    throw new Error('Live evaluation dispatch ceiling reached.');
  requests++;
  const requestNumber = requests;
  if (isGrounded) grounded++;
  reserved += reservation;
  const at = Date.now();
  const response = await fetch(input, {
    ...init,
    signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(90000)]),
  });
  const data = await response.clone().json();
  // Isolated diagnostic material only; the key is redacted by save(). Never commit responses.
  save(`provider-response-${requestNumber}.json`, data);
  const usage = data.usageMetadata ?? {};
  const queries = data.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? [];
  const estimate =
    ((usage.promptTokenCount ?? 0) * inputRate +
      ((usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)) * outputRate) /
      1e6 +
    queries.length * 0.014;
  costEstimate += estimate;
  receipts.push({
    model,
    status: response.status,
    elapsedMs: Date.now() - at,
    usage,
    queryCount: queries.length,
    estimatedUsd: estimate,
  });
  save('provider-receipts.json', receipts);
  console.log(
    JSON.stringify({
      request: requestNumber,
      model,
      status: response.status,
      estimatedTotalUsd: costEstimate,
    }),
  );
  return response;
};

app
  .whenReady()
  .then(async () => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure OS storage unavailable.');
    credential = safeStorage.decryptString(readFileSync(keyFile));
    mkdirSync(output, { recursive: false });
    const vault = openVault(path.join(output, 'vault.sqlite'), 'vault_native');
    const client = createGeminiClient({
      apiKey: credential,
      fetchImpl: checkedFetch,
      groundedRpm: 8,
      structureRpm: 8,
    });
    service = new NativeResearchService(
      vault,
      () => client,
      (run) =>
        console.log(
          JSON.stringify({
            status: run.status,
            completed: run.tasks?.filter((t) => t.status === 'completed').length ?? 0,
          }),
        ),
    );
    const run = service.start({
      requestKey: 'live-frontier-quality-2026-10-01',
      scope: {
        goal: 'Frontier AI labs developing general-purpose foundation models. Research the market and include OpenAI, Anthropic and Mistral AI. Distinguish model developers from infrastructure suppliers and distributors. Explain products, target customers, business model, market position, recent dated developments and important unknowns. Prefer primary sources. Do not invent revenue, adoption, market share or rankings.',
        inclusions: [],
        exclusions: ['AI application wrappers', 'consultancies'],
        region: null,
        depth: 'quick',
        seeds: [
          { name: 'OpenAI', domain: 'openai.com' },
          { name: 'Anthropic', domain: 'anthropic.com' },
          { name: 'Mistral AI', domain: 'mistral.ai' },
        ],
      },
      maxCompanies: 3,
      limits: {
        maxRequests: 12,
        maxInputTokens: 500000,
        maxOutputTokens: 100000,
        maxSourceRequests: 6,
      },
    });
    await service.waitForIdle();
    const final = vault.work.getRun(run.id);
    const cards = vault.work.listCards(run.deckId);
    save('result.json', {
      startedAt,
      finishedAt: new Date().toISOString(),
      liveResearch: true,
      models: [DEFAULT_GROUNDED_MODEL, DEFAULT_STRUCTURE_MODEL],
      costEstimate,
      reservationTotalUsd: reserved,
      priceSource: 'https://ai.google.dev/gemini-api/docs/pricing',
      invoiceVerified: false,
      run: final,
      cards,
      evidence: cards.map((card) => service!.getCardEvidence(card.card.id)),
    });
    console.log(
      JSON.stringify({
        result: final?.status,
        cards: cards.length,
        estimatedUsd: costEstimate,
        output,
      }),
    );
  })
  .catch((error) => {
    const message = redact(error instanceof Error ? error.message : 'Evaluation failed');
    if (existsSync(output)) save('failure.json', { message, startedAt, requests, costEstimate });
    console.log(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await service?.close();
    credential = '';
    app.quit();
  });
