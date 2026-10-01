/** Development-only synthetic provider for actual desktop journey verification.
 * No credentials, network, real companies or live research are used.
 */
import type { CallOptions, LlmClient } from '@mi/research';
import type { retrievePublicSource } from './native-source-retrieval';

const fixtureSourceText =
  'Synthetic source text — not live research. Alder Works schedules repairs. Birch Works supplies repair tooling. This page is a fictional retained source for recovery tests, not evidence of real companies or numeric claims. ' +
  'Alder Works brings appointment booking, repair intake and job status into one workflow for independent workshops. Its described offering includes a shared calendar, intake forms and customer status messages. Named customers, pricing and integration support are not documented. A fictional September 2026 pilot announcement described testing customer status messages; general availability was not established. ' +
  'Birch Works supplies diagnostic tooling and repair guides for independent workshops. Its described capabilities include device diagnostics and compatibility guidance. Supported device coverage, equipment pricing and maintenance terms are not documented. A fictional September 2026 workshop trial described expanded diagnostic guides; rollout availability was not established.';

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
        text: `SYNTHETIC FIXTURE. ${fixtureSourceText}`,
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
      // Only the requested target identifies this fixture; shared source text mentions both.
      const infrastructure = prompt.split('\n', 1)[0]!.includes('Birch Works');
      const note = (text: string, kind = 'reported', timeWindow: string | null = null) => ({
        text,
        kind,
        timeWindow,
        sourceIndices: [0],
      });
      return schema.parse({
        oneLiner: infrastructure
          ? 'Synthetic tooling for independent repair workshops.'
          : 'Synthetic scheduling software for independent repair workshops.',
        metrics: {},
        facts: {},
        viceClaims: [],
        cultureNote: null,
        researchBrief: {
          sections: [
            {
              section: 'overview',
              blocks: [
                note(
                  infrastructure
                    ? 'Birch Works supplies diagnostic tooling and repair guides for independent workshops.'
                    : 'Alder Works brings appointment booking, repair intake and job status into one workflow for independent workshops.',
                ),
              ],
            },
            {
              section: 'offering',
              blocks: [
                note(
                  infrastructure
                    ? 'The described capabilities include device diagnostics and compatibility guidance. Supported device coverage and maintenance terms are not documented.'
                    : 'The described offering includes a shared calendar, intake forms and customer status messages. Pricing and integration support are not documented.',
                ),
              ],
            },
            {
              section: 'position',
              blocks: [
                note(
                  infrastructure
                    ? 'This is an enabling supplier rather than a booking system. Its usefulness depends on device coverage and the workshop’s existing equipment.'
                    : 'Alder addresses workshop coordination rather than the physical repair itself. It may complement diagnostic suppliers, but the source does not establish a commercial partnership.',
                  'analysis',
                ),
              ],
            },
            {
              section: 'updates',
              blocks: [
                note(
                  infrastructure
                    ? 'A fictional workshop trial described expanded diagnostic guides. Rollout availability was not established.'
                    : 'A fictional pilot announcement described testing customer status messages. General availability was not established.',
                  'reported',
                  'September 2026',
                ),
              ],
            },
          ],
          openQuestions: infrastructure
            ? [
                'Which device families are supported?',
                'What are the equipment and maintenance costs?',
              ]
            : [
                'Which workshop systems can it integrate with?',
                'Are there named paying customers or published prices?',
              ],
          limitations: [
            'Synthetic fixture material for interface and persistence testing, not live market research.',
            'Source links and notes remain unreviewed.',
          ],
        },
      });
    },
  };
}

/** Keeps logo resolution local during fixture runs; never used for live research. */
export const nativeFixtureFetch: typeof fetch = async () => new Response(null, { status: 404 });

/** Explicit synthetic source adapter; never resolves DNS or reaches a public endpoint. */
export const nativeFixtureRetrieveSource: typeof retrievePublicSource = async (url, options) => {
  options.signal.throwIfAborted();
  if (url !== 'https://research-fixture.invalid/repair')
    return {
      originalUrl: url,
      canonicalUrl: url,
      text: null,
      retrievalStatus: 'blocked',
      reason: 'Not an explicit fixture source.',
    };
  options.beforeRequest?.();
  return {
    originalUrl: url,
    canonicalUrl: url,
    retrievalStatus: 'retrieved',
    reason: null,
    text: fixtureSourceText,
  };
};
