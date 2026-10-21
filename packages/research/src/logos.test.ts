import { describe, expect, it } from 'vitest';
import { knownCompanyDomain } from './logos';

describe('knownCompanyDomain', () => {
  it.each([
    ['OpenAI, Inc.', 'openai.com'],
    ['Anthropic, PBC', 'anthropic.com'],
    ['Google DeepMind', 'deepmind.google'],
    ['Meta Platforms, Inc. (Meta AI)', 'meta.com'],
    ['xAI', 'x.ai'],
    ['Mistral AI', 'mistral.ai'],
    ['Cohere', 'cohere.com'],
    ['DeepSeek', 'deepseek.com'],
    ['Moonshot AI', 'moonshot.ai'],
    ['Safe Superintelligence Inc. (SSI)', 'ssi.inc'],
    ['Zhipu AI (Z.ai / Knowledge Atlas Tech)', 'z.ai'],
    ['MiniMax Group Inc.', 'minimax.io'],
  ])('maps %s to its reviewed official domain', (name, expected) => {
    expect(knownCompanyDomain(name)).toBe(expected);
  });
});
