import { describe, expect, it } from 'vitest';
import { MAX_OUTPUT_TOKENS, MAX_SCHEMA_DEPTH, MAX_SCHEMA_NODES, MAX_THINKING_BUDGET, inspectGeminiRequest } from './gemini-request';

const GROUNDED = { contents: [{ parts: [{ text: 'research this market' }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.2 } };
const STRUCTURED = { contents: [{ parts: [{ text: 'make json' }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 }, systemInstruction: { parts: [{ text: 'be exact' }] } };
const check = (body: unknown, model = 'gemini-flash-lite-latest') => inspectGeminiRequest(typeof body === 'string' ? body : JSON.stringify(body), model);
const ok = (body: unknown, model?: string) => { const r = check(body, model); if (!r.ok) throw new Error(r.error); return r.request; };
const refused = (body: unknown, model?: string) => { const r = check(body, model); expect(r.ok, JSON.stringify(body)).toBe(false); return r.ok ? '' : r.error; };

describe('what the research client sends is accepted', () => {
  it('a grounded call is grounded, and is forwarded as the same request with the answer capped', () => {
    const request = ok(GROUNDED);
    expect(request.grounded).toBe(true);
    expect(JSON.parse(request.body)).toEqual({
      contents: [{ parts: [{ text: 'research this market' }] }], tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS },
    });
  });

  it('a structured call with a system instruction is accepted and is not grounded', () => {
    const request = ok(STRUCTURED);
    expect(request.grounded).toBe(false);
    expect(JSON.parse(request.body)).toMatchObject({ systemInstruction: { parts: [{ text: 'be exact' }] }, generationConfig: { responseMimeType: 'application/json', temperature: 0 } });
  });

  it('accepts a conversation, and the camelCase tool name too', () => {
    const request = ok({ contents: [{ role: 'user', parts: [{ text: 'a' }] }, { role: 'model', parts: [{ text: 'b' }] }, { role: 'user', parts: [{ text: 'c' }] }], tools: [{ googleSearch: {} }] });
    expect(request.grounded).toBe(true);
    expect(JSON.parse(request.body).tools).toEqual([{ google_search: {} }]);
  });
});

describe('a request may not hide what it costs', () => {
  it('refuses every way of asking for a billed feature the meter would miss', () => {
    for (const tools of [
      [{ google_search_retrieval: {} }], [{ googleSearchRetrieval: {} }], [{ googleMaps: {} }], [{ google_maps: {} }], [{ codeExecution: {} }],
      [{ urlContext: {} }], [{ url_context: {} }], [{ fileSearch: {} }], [{ functionDeclarations: [] }],
      [{ google_search: {}, googleMaps: {} }], [{ google_search: { dynamicRetrievalConfig: { mode: 'MODE_DYNAMIC' } } }], [{ google_search: {} }, { google_search: {} }],
    ]) refused({ ...GROUNDED, tools });
  });

  it('reads a key written with an escape the same as any other, because it parses instead of searching the text', () => {
    // Same request as GROUNDED, with the tool name spelled with escapes: the old text match missed it, and so did the bill.
    const spelled = '{"contents":[{"parts":[{"text":"x"}]}],"tools":[{"google\\u005fsearch":{}}]}';
    expect(ok(spelled).grounded).toBe(true);
    // And the same spelling of a feature that is not allowed is refused, not metered as free.
    refused('{"contents":[{"parts":[{"text":"x"}]}],"tools":[{"google\\u005fmaps":{}}]}');
  });

  it('refuses media by address, cached content and any field it does not know', () => {
    refused({ contents: [{ parts: [{ fileData: { fileUri: 'https://www.youtube.com/watch?v=abc', mimeType: 'video/mp4' } }] }] });
    refused({ contents: [{ parts: [{ file_data: { file_uri: 'gs://bucket/x.mp4' } }] }] });
    refused({ contents: [{ parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] }] });
    refused({ contents: [{ parts: [{ text: 'x', videoMetadata: { startOffset: '0s' } }] }] });
    refused({ ...STRUCTURED, cachedContent: 'cachedContents/abc' });
    refused({ ...STRUCTURED, safetySettings: [] });
    refused({ ...STRUCTURED, model: 'gemini-pro' });
    refused({ ...STRUCTURED, toolConfig: {} });
    refused({ ...STRUCTURED, generationConfig: { responseModalities: ['IMAGE'] } });
    refused({ ...STRUCTURED, generationConfig: { speechConfig: {} } });
  });

  it('refuses requests that are not requests', () => {
    for (const bad of ['', 'not json', '[]', '7', 'null', '{}', '{"contents":[]}', '{"contents":"hi"}', { contents: [{ parts: [] }] }, { contents: [{ parts: 'x' }] }, { contents: [{ role: 'system', parts: [{ text: 'x' }] }] }, { contents: [{ parts: [{ text: 5 }] }] }]) refused(bad);
    refused({ contents: Array.from({ length: 41 }, () => ({ parts: [{ text: 'x' }] })) });
    refused({ contents: [{ parts: Array.from({ length: 65 }, () => ({ text: 'x' })) }] });
  });

  it('refuses more than one candidate, which would multiply the answer', () => {
    refused({ ...STRUCTURED, generationConfig: { candidateCount: 8 } });
    expect(ok({ ...STRUCTURED, generationConfig: { candidateCount: 1 } }).body).not.toContain('candidateCount');
  });
});

describe('what the answer may cost is bounded by what is forwarded', () => {
  it('caps the answer length, whatever was asked, and fills it in when nothing was', () => {
    expect(JSON.parse(ok({ ...STRUCTURED, generationConfig: { maxOutputTokens: 5_000_000 } }).body).generationConfig.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
    expect(JSON.parse(ok({ ...STRUCTURED, generationConfig: { maxOutputTokens: 800 } }).body).generationConfig.maxOutputTokens).toBe(800);
    expect(JSON.parse(ok({ contents: STRUCTURED.contents }).body).generationConfig.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
    refused({ ...STRUCTURED, generationConfig: { maxOutputTokens: 0 } });
    refused({ ...STRUCTURED, generationConfig: { maxOutputTokens: 1.5 } });
    refused({ ...STRUCTURED, generationConfig: { maxOutputTokens: '9' } });
  });

  it('caps thinking, treats dynamic thinking as the cap, and sizes the worst case for the model', () => {
    const asked = (budget: number) => JSON.parse(ok({ ...STRUCTURED, generationConfig: { thinkingConfig: { thinkingBudget: budget } } }, 'gemini-flash-latest').body).generationConfig.thinkingConfig.thinkingBudget;
    expect(asked(1_000_000)).toBe(MAX_THINKING_BUDGET);
    expect(asked(2_000)).toBe(2_000);
    expect(asked(-1)).toBe(-1);
    expect(ok({ ...STRUCTURED, generationConfig: { thinkingConfig: { thinkingBudget: -1 } } }, 'gemini-flash-latest').worstOutputTokens).toBe(MAX_OUTPUT_TOKENS + MAX_THINKING_BUDGET);
    // The lite line does not think unless asked: its default worst case is the answer alone. Other lines may think by default.
    expect(ok(STRUCTURED, 'gemini-flash-lite-latest').worstOutputTokens).toBe(MAX_OUTPUT_TOKENS);
    expect(ok(STRUCTURED, 'gemini-3.1-pro-preview').worstOutputTokens).toBe(MAX_OUTPUT_TOKENS + MAX_THINKING_BUDGET);
    expect(ok({ ...STRUCTURED, generationConfig: { maxOutputTokens: 1000, thinkingConfig: { thinkingBudget: 0 } } }, 'gemini-3.1-pro-preview').worstOutputTokens).toBe(1000);
    refused({ ...STRUCTURED, generationConfig: { thinkingConfig: { thinkingBudget: 1.5 } } });
    refused({ ...STRUCTURED, generationConfig: { thinkingConfig: { thinkingBudget: -5 } } });
    refused({ ...STRUCTURED, generationConfig: { thinkingConfig: { thinkingLevel: 'high' } } });
  });

  it('keeps temperature and sampling inside their ranges', () => {
    refused({ ...STRUCTURED, generationConfig: { temperature: 5 } });
    refused({ ...STRUCTURED, generationConfig: { temperature: -1 } });
    refused({ ...STRUCTURED, generationConfig: { topP: 2 } });
    refused({ ...STRUCTURED, generationConfig: { topK: 0 } });
    refused({ ...STRUCTURED, generationConfig: { responseMimeType: 'image/png' } });
  });
});

describe('a response schema nested or large beyond what a request needs', () => {
  const MODEL = 'gemini-flash-lite-latest';
  const withSchema = (schema: string) => `{"contents":[{"parts":[{"text":"x"}]}],"generationConfig":{"responseMimeType":"application/json","responseSchema":${schema}}}`;
  const nest = (depth: number) => '{"a":'.repeat(depth) + '1' + '}'.repeat(depth);

  it('is refused with a reason, not thrown (a schema 120,000 levels deep passes JSON.parse and used to overflow JSON.stringify)', () => {
    const inspected = inspectGeminiRequest(withSchema(nest(120_000)), MODEL);
    expect(inspected).toEqual({ ok: false, error: expect.stringContaining('responseSchema') });
  });

  it('is refused by depth just past the limit and allowed at it', () => {
    expect(inspectGeminiRequest(withSchema(nest(MAX_SCHEMA_DEPTH)), MODEL).ok).toBe(true);
    expect(inspectGeminiRequest(withSchema(nest(MAX_SCHEMA_DEPTH + 1)), MODEL).ok).toBe(false);
    // Arrays count as levels too.
    expect(inspectGeminiRequest(withSchema('['.repeat(MAX_SCHEMA_DEPTH + 1) + ']'.repeat(MAX_SCHEMA_DEPTH + 1)), MODEL).ok).toBe(false);
  });

  it('is refused by the number of nodes, and a real-sized schema passes untouched', () => {
    const wide = `{"properties":[${Array.from({ length: MAX_SCHEMA_NODES + 1 }, () => '{}').join(',')}]}`;
    expect(inspectGeminiRequest(withSchema(wide), MODEL).ok).toBe(false);
    const real = JSON.stringify({ type: 'OBJECT', properties: { name: { type: 'STRING' }, rounds: { type: 'ARRAY', items: { type: 'OBJECT', properties: { amount: { type: 'NUMBER', nullable: true }, kind: { type: 'STRING', enum: ['seed', 'a', 'b'] } } } } }, required: ['name'] });
    const inspected = inspectGeminiRequest(withSchema(real), MODEL);
    expect(inspected.ok).toBe(true);
    if (inspected.ok) expect(JSON.parse(inspected.request.body).generationConfig.responseSchema).toEqual(JSON.parse(real));
  });
});

describe('the rebuilt request reports its size in UTF-8 bytes', () => {
  it('equals the characters for ASCII and counts three bytes for a private-use character', () => {
    const asciiBody = ok(GROUNDED);
    expect(asciiBody.bodyBytes).toBe(asciiBody.body.length);
    const wide = ok({ contents: [{ parts: [{ text: String.fromCharCode(0xe000).repeat(1_000) }] }] });
    expect(wide.bodyBytes).toBe(new TextEncoder().encode(wide.body).length);
    expect(wide.bodyBytes).toBeGreaterThan(wide.body.length + 1_999);
  });
});
