// One-shot generator: turns the vault-dumped Equinix fixture into a TS module
// the regression tests can import verbatim. Run: node scripts/gen-equinix-fixture.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(here, 'equinix-live-fixture.json'), 'utf8'));
const initial = raw.initial;

const pick = (needle) => {
  const support = initial.supports.find((s) => s.text.includes(needle));
  if (!support) throw new Error(`fixture support not found: ${needle}`);
  return support;
};

const supports = [
  pick('holds a public market capitalization'),
  pick('generated total consolidated annual revenues'),
  pick('employed 13,716 employees'),
].map((support) => ({
  text: support.text,
  sources: support.sources.map((source) => ({ url: source.url, title: source.title })),
}));

const out = `/**
 * Verbatim Equinix profile answer + provider support spans, captured from a
 * real research run's committed vault (2026-10-08). The supports are the API's
 * own sub-sentence fragments — each metric sentence's subject ("Equinix,
 * Inc.") sits outside the span. This is the regression fixture for
 * sentence-expanded identity binding; do not reformat the strings.
 */
export const EQUINIX_ANSWER_TEXT = ${JSON.stringify(initial.answerText)};

export const EQUINIX_SUPPORTS = ${JSON.stringify(supports, null, 2)};
`;

writeFileSync(join(here, '..', 'packages', 'research', 'src', 'equinix-live-fixture.ts'), out);
console.log('written', supports.map((s) => s.text.slice(0, 40)));
