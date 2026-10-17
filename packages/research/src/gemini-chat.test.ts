import { describe, expect, it, vi } from 'vitest';
import { createGeminiClient, DEFAULT_CHAT_MODEL, DEFAULT_GROUNDED_MODEL } from './gemini';
import { CHAT_SYSTEM, NOT_IN_RESEARCH_PHRASE } from './prompts';

const answer = () => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: 'hello' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/a', title: 'A' } }] } }],
}), { status: 200 });

const modelOf = (url: unknown) => /models\/([^:/]+):/.exec(String(url))?.[1];

function client(over: { chatModel?: string; respond?: (model: string) => Response } = {}) {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: unknown) => {
    urls.push(String(url));
    return (over.respond ?? answer)(modelOf(url) ?? '');
  });
  const c = createGeminiClient({ apiKey: 'test-placeholder', fetchImpl: fetchImpl as unknown as typeof fetch, groundedRpm: 0, structureRpm: 0, ...(over.chatModel !== undefined ? { chatModel: over.chatModel } : {}) });
  return { c, models: () => urls.map(modelOf) };
}

describe('the chat model', () => {
  it('runs conversation turns on the stronger line and everything else on the grounded model', async () => {
    const { c, models } = client();
    await c.ground('a question', { label: 'chat' });
    await c.ground('some research', { label: 'tab:history' });
    expect(models()).toEqual([DEFAULT_CHAT_MODEL, DEFAULT_GROUNDED_MODEL]);
  });

  it('can be pointed at another line, or switched off', async () => {
    const custom = client({ chatModel: 'my-chat-model' });
    await custom.c.ground('q', { label: 'chat' });
    expect(custom.models()).toEqual(['my-chat-model']);
    const off = client({ chatModel: '' });
    await off.c.ground('q', { label: 'chat' });
    expect(off.models()).toEqual([DEFAULT_GROUNDED_MODEL]);
  });

  it('never fails a conversation because the key cannot use the chat line', async () => {
    for (const status of [400, 403, 404]) {
      const { c, models } = client({ respond: (model) => (model === DEFAULT_CHAT_MODEL ? new Response('{}', { status }) : answer()) });
      const result = await c.ground('q', { label: 'chat' });
      expect(result.text).toBe('hello');
      expect(models()[0]).toBe(DEFAULT_CHAT_MODEL);
      expect(models().length).toBeGreaterThan(1);
      expect(models().at(-1)).not.toBe(DEFAULT_CHAT_MODEL);
    }
  });

  it('does not hide a bad request on the ordinary research lines', async () => {
    const { c } = client({ respond: () => new Response('{}', { status: 404 }) });
    await expect(c.ground('q', { label: 'tab:history' })).rejects.toThrow();
  });
});

describe('the analyst\'s voice', () => {
  it('is a friend with the inside scoop, in first person, and keeps every grounding rule', () => {
    expect(CHAT_SYSTEM).toMatch(/friend who always has the inside scoop/);
    expect(CHAT_SYSTEM).toMatch(/first person/);
    expect(CHAT_SYSTEM).toMatch(/never means rumour|never rumour/i);
    expect(CHAT_SYSTEM).toMatch(/do the steps and show the result/);
    expect(CHAT_SYSTEM).toContain(NOT_IN_RESEARCH_PHRASE);
    expect(CHAT_SYSTEM).toMatch(/NEVER invent or estimate a figure/);
    expect(CHAT_SYSTEM).toMatch(/NEVER answer from prior or training knowledge/);
    expect(CHAT_SYSTEM).toMatch(/markdown link on the publisher/);
    expect(CHAT_SYSTEM).toMatch(/Follow-ups:/);
  });

  it('has no emoji and no filler opener to imitate', () => {
    expect(CHAT_SYSTEM).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(CHAT_SYSTEM).toMatch(/No filler openers/);
  });
});
