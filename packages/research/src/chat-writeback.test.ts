import { describe, expect, it } from 'vitest';
import { chatEvidenceFromAnswer, attributedSentences } from './chat-writeback';
import { recordResearchEvidence, type ResearchEvidence } from './research-evidence';
import type { LlmClient, ProviderGrounding } from './types';

const ACME_SRC = { chunkIndex: 0, url: 'https://www.reuters.com/acme-plant', title: 'Reuters' };
const BETA_SRC = { chunkIndex: 1, url: 'https://www.bloomberg.com/beta-raise', title: 'Bloomberg' };
const companies = [{ id: 'cmp_a', name: 'Acme', websiteUrl: 'https://acme.example' }, { id: 'cmp_b', name: 'Beta', websiteUrl: 'https://beta.example' }];

const S = {
  acme: 'Acme opened a second anvil plant in Austin in 2026.',
  beta: 'Beta raised a $40 million Series B round in March.',
  both: 'Acme and Beta both sell to the same construction customers.',
  unsourced: 'Acme employs about 450 people across three sites.',
  opinion: 'I think Beta is the stronger company overall.',
  hedge: 'Acme seems to be planning another plant next year.',
  question: 'Would you like me to compare Acme and Beta further?',
};

function grounded(sentences: string[], attributed: Record<string, Array<typeof ACME_SRC>>): { text: string; grounding: ProviderGrounding } {
  const text = sentences.join(' ');
  return {
    text,
    grounding: {
      provider: 'google-search', answerText: text,
      supports: Object.entries(attributed).map(([sentence, sources], supportIndex) => ({ supportIndex, text: sentence, sources })),
    },
  };
}

const answer = grounded(Object.values(S), {
  [S.acme]: [ACME_SRC], [S.beta]: [BETA_SRC], [S.both]: [ACME_SRC, BETA_SRC], [S.opinion]: [BETA_SRC], [S.hedge]: [ACME_SRC], [S.question]: [ACME_SRC],
});

describe('chatEvidenceFromAnswer', () => {
  const run = (over: Partial<Parameters<typeof chatEvidenceFromAnswer>[0]> = {}) =>
    chatEvidenceFromAnswer({ threadId: 'thr_1', answerText: answer.text, grounding: answer.grounding, companies, ...over });

  it('saves each attributed sentence for its own company, with its own sources and the chat topic', () => {
    const kept = run();
    expect(kept.map((e) => [e.companyId, e.text])).toEqual([['cmp_a', S.acme], ['cmp_b', S.beta]]);
    expect(kept[0]!.citations.map((c) => c.url)).toEqual([ACME_SRC.url]);
    expect(kept[1]!.citations.map((c) => c.url)).toEqual([BETA_SRC.url]);
    expect(kept.every((e) => e.topic === 'chat:thr_1')).toBe(true);
  });

  it('drops a sentence that names both compared companies, for both', () => {
    expect(run().some((e) => e.text === S.both)).toBe(false);
  });

  it('saves nothing for a sentence with no attributed source', () => {
    expect(run().some((e) => e.text === S.unsourced)).toBe(false);
    const bare = grounded([S.unsourced], {});
    expect(chatEvidenceFromAnswer({ threadId: 't', answerText: bare.text, grounding: bare.grounding, companies })).toEqual([]);
    expect(chatEvidenceFromAnswer({ threadId: 't', answerText: bare.text, grounding: undefined, companies })).toEqual([]);
  });

  it('never saves an opinion, a hedge or a question, even when the search attached a source', () => {
    const texts = run().map((e) => e.text);
    for (const dropped of [S.opinion, S.hedge, S.question]) expect(texts).not.toContain(dropped);
  });

  it('carries the card id when the company has one', () => {
    const kept = run({ cardIdFor: (id) => (id === 'cmp_a' ? 'card_acme' : undefined) });
    expect(kept.find((e) => e.companyId === 'cmp_a')!.cardId).toBe('card_acme');
    expect('cardId' in kept.find((e) => e.companyId === 'cmp_b')!).toBe(false);
  });

  it('keeps nothing when the grounding was made for a different answer text', () => {
    expect(run({ answerText: `${answer.text} Extra.` })).toEqual([]);
  });

  it('does not count "Acme" inside "Acme Labs" as a second company', () => {
    const roster = [...companies, { id: 'cmp_l', name: 'Acme Labs', websiteUrl: 'https://acmelabs.example' }];
    const sentence = 'Acme Labs published a new robotics paper in 2026.';
    const g = grounded([sentence], { [sentence]: [ACME_SRC] });
    const kept = chatEvidenceFromAnswer({ threadId: 't', answerText: g.text, grounding: g.grounding, companies: roster });
    expect(kept.map((e) => e.companyId)).toEqual(['cmp_l']);
  });

  it('a clause must cover most of a longer sentence to attribute it', () => {
    const long = 'Acme opened a plant in Austin and also its rival went bankrupt last winter after a failed merger.';
    const g = grounded([long], { 'Acme opened a plant in Austin': [ACME_SRC] });
    expect(attributedSentences(g.grounding)).toEqual([]);
  });
});

describe('the evidence recorder', () => {
  it('keeps a card id from the research context and never the attributedOnly flag', async () => {
    const kept: ResearchEvidence[] = [];
    const client = { structure: async () => { throw new Error('unused'); },
      ground: async () => ({ text: answer.text, citations: [ACME_SRC], queries: [], grounding: answer.grounding }) } as unknown as LlmClient;
    const wrapped = recordResearchEvidence(client, (e) => { kept.push(e); });
    await wrapped.ground('q', { researchContext: { companyId: 'cmp_a', companyName: 'Acme', topic: 'report:history', cardId: 'card_acme', attributedOnly: true } });
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ cardId: 'card_acme', topic: 'report:history' });
    expect('attributedOnly' in kept[0]!).toBe(false);
    expect(kept[0]!.text).not.toContain('employs about 450');
  });
});
