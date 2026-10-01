/** Development-only synthetic provider for actual desktop journey verification.
 * No credentials, network, real companies or live research are used.
 */
import type { CallOptions, LlmClient } from '@mi/research';

export function createNativeFixtureClient(): LlmClient {
  let birchFailed = false;
  const call = async (prompt: string, options?: CallOptions) => {
    options?.signal?.throwIfAborted();
    const grant = options?.usageMeter?.beginAttempt({
      kind: 'model',
      estimatedInputTokens: Math.ceil(prompt.length / 4),
      maxOutputTokens: 600,
    });
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new Error('Synthetic request was interrupted.'));
      };
      const timer = setTimeout(() => {
        options?.signal?.removeEventListener('abort', abort);
        resolve();
      }, 650);
      options?.signal?.addEventListener('abort', abort, { once: true });
    });
    if (grant)
      options?.usageMeter?.settleAttempt(grant.id, {
        inputTokens: Math.ceil(prompt.length / 4),
        outputTokens: 100,
      });
  };
  return {
    async ground(prompt, options) {
      await call(prompt, options);
      if (
        prompt.includes('Birch Works') &&
        !prompt.includes('identify the REAL companies') &&
        !birchFailed
      ) {
        birchFailed = true;
        throw new Error('Synthetic provider failure: retry the unfinished company.');
      }
      return {
        text: 'SYNTHETIC FIXTURE. Alder Works builds repair scheduling software. Birch Works supplies repair tooling. No financial figures or real-company research.',
        citations: [
          {
            title: 'Synthetic fixture source — not live research',
            url: 'https://research-fixture.invalid/repair',
          },
        ],
        queries: ['synthetic fixture — no search performed'],
      };
    },
    async structure(prompt, schema, options) {
      await call(prompt, options);
      if (prompt.includes('"companies"'))
        return schema.parse({
          companies: [
            {
              name: 'Alder Works',
              domain: 'alder-fixture.invalid',
              descriptor: 'Synthetic repair scheduling company.',
              primaryRole: 'company',
              cardTypes: ['company'],
            },
            {
              name: 'Birch Works',
              domain: 'birch-fixture.invalid',
              descriptor: 'Synthetic repair tooling supplier.',
              primaryRole: 'infrastructure',
              cardTypes: ['infrastructure'],
            },
          ],
        });
      return schema.parse({
        oneLiner: prompt.includes('Birch Works')
          ? 'Synthetic tooling for independent repair workshops.'
          : 'Synthetic scheduling software for independent repair workshops.',
        metrics: {},
        facts: {},
        viceClaims: [],
        cultureNote: null,
      });
    },
  };
}

/** Keeps logo resolution local during fixture runs; never used for live research. */
export const nativeFixtureFetch: typeof fetch = async () => new Response(null, { status: 404 });
