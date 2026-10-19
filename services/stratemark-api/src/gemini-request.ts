/**
 * What a hosted Gemini call may ask for. Pure, so it is unit tested in Node.
 *
 * The Worker holds a key that spends real money, and a dollar budget that is only as good as its meter. The meter used
 * to read the request as text (`/"google_search"/` on the raw body) and forward the body untouched, so a request could
 * say the same thing in a way the meter did not see (an escaped key, `google_search_retrieval`, `googleMaps`) and be
 * billed for a grounding charge it never paid, or point at media by address (`fileData.fileUri`, a video) whose cost the
 * body's length says nothing about. Found by a red team that ran the real Worker against a stand-in for Google.
 *
 * So the request is parsed, held to exactly the shapes the research client sends, and forwarded in a canonical form
 * rebuilt from what was accepted. Anything else is refused before a cent is held. What it forwards also bounds the
 * answer (output tokens and thinking budget are capped), so the hold taken before the call covers what the call can cost.
 */

/** Longest answer one call may ask for, in tokens. The client asks for nothing; Google's own default is up to 65,536. */
export const MAX_OUTPUT_TOKENS = 32_768;
/** Largest thinking budget one call may ask for, in tokens (thinking is billed as output). */
export const MAX_THINKING_BUDGET = 16_384;
const MAX_TURNS = 40;
const MAX_PARTS = 64;

export interface GeminiRequest {
  /** The JSON to send to Google, rebuilt from what was accepted. */
  body: string;
  /** Whether the call may ground on Google Search (and so owes the grounding charge). */
  grounded: boolean;
  /** Most output tokens the call can produce, answer and thinking together: what the hold is sized by. */
  worstOutputTokens: number;
}

export type GeminiInspection = { ok: true; request: GeminiRequest } | { ok: false; error: string };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const only = (value: Json, allowed: readonly string[]): string | null => Object.keys(value).find((key) => !allowed.includes(key)) ?? null;
const refuse = (error: string): GeminiInspection => ({ ok: false, error });

function textParts(value: unknown): Array<{ text: string }> | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PARTS) return null;
  const out: Array<{ text: string }> = [];
  for (const part of value) {
    if (!isObject(part) || only(part, ['text']) !== null || typeof part.text !== 'string') return null;
    out.push({ text: part.text });
  }
  return out;
}

function boundedNumber(value: unknown, min: number, max: number, integer = false): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)) ? value : null;
}

/** Hold sizes depend on whether a model thinks by default: the lite line does not, the others do. */
function defaultThinkingBudget(model: string): number {
  return /lite/.test(model) ? 0 : MAX_THINKING_BUDGET;
}

export function inspectGeminiRequest(text: string, model: string): GeminiInspection {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return refuse('The request is not valid JSON.'); }
  if (!isObject(parsed)) return refuse('The request must be a JSON object.');
  const extra = only(parsed, ['contents', 'systemInstruction', 'tools', 'generationConfig']);
  if (extra !== null) return refuse(`This field is not allowed: ${extra.slice(0, 40)}.`);

  const contents = parsed.contents;
  if (!Array.isArray(contents) || contents.length === 0 || contents.length > MAX_TURNS) return refuse('The request needs between 1 and 40 turns.');
  const turns: Json[] = [];
  for (const turn of contents) {
    if (!isObject(turn) || only(turn, ['role', 'parts']) !== null) return refuse('A turn may only have a role and text parts.');
    if (turn.role !== undefined && turn.role !== 'user' && turn.role !== 'model') return refuse('A turn’s role must be user or model.');
    const parts = textParts(turn.parts);
    if (!parts) return refuse('Only text parts are allowed.');
    turns.push({ ...(turn.role ? { role: turn.role } : {}), parts });
  }

  const out: Json = { contents: turns };
  if (parsed.systemInstruction !== undefined) {
    const system = parsed.systemInstruction;
    if (!isObject(system) || only(system, ['role', 'parts']) !== null) return refuse('The system instruction may only have text parts.');
    const parts = textParts(system.parts);
    if (!parts) return refuse('Only text parts are allowed.');
    out.systemInstruction = { parts };
  }

  let grounded = false;
  if (parsed.tools !== undefined) {
    const tools = parsed.tools;
    if (!Array.isArray(tools) || tools.length > 1) return refuse('At most one tool is allowed.');
    for (const tool of tools) {
      if (!isObject(tool) || only(tool, ['google_search', 'googleSearch']) !== null || Object.keys(tool).length !== 1) return refuse('Only Google Search grounding is allowed as a tool.');
      const options = Object.values(tool)[0];
      if (!isObject(options) || Object.keys(options).length > 0) return refuse('Google Search grounding takes no options.');
      grounded = true;
    }
    if (grounded) out.tools = [{ google_search: {} }];
  }

  const config: Json = {};
  const asked = parsed.generationConfig;
  let maxOutput = MAX_OUTPUT_TOKENS;
  let thinking = defaultThinkingBudget(model);
  if (asked !== undefined) {
    if (!isObject(asked)) return refuse('generationConfig must be an object.');
    const bad = only(asked, ['temperature', 'topP', 'topK', 'maxOutputTokens', 'responseMimeType', 'responseSchema', 'thinkingConfig', 'candidateCount']);
    if (bad !== null) return refuse(`This generation setting is not allowed: ${bad.slice(0, 40)}.`);
    if (asked.temperature !== undefined) { const v = boundedNumber(asked.temperature, 0, 2); if (v === null) return refuse('temperature must be between 0 and 2.'); config.temperature = v; }
    if (asked.topP !== undefined) { const v = boundedNumber(asked.topP, 0, 1); if (v === null) return refuse('topP must be between 0 and 1.'); config.topP = v; }
    if (asked.topK !== undefined) { const v = boundedNumber(asked.topK, 1, 100, true); if (v === null) return refuse('topK must be a whole number from 1 to 100.'); config.topK = v; }
    // More than one candidate would multiply the answer's cost.
    if (asked.candidateCount !== undefined && asked.candidateCount !== 1) return refuse('Only one candidate is allowed.');
    if (asked.responseMimeType !== undefined) {
      if (asked.responseMimeType !== 'application/json' && asked.responseMimeType !== 'text/plain') return refuse('responseMimeType must be application/json or text/plain.');
      config.responseMimeType = asked.responseMimeType;
    }
    if (asked.responseSchema !== undefined) {
      if (!isObject(asked.responseSchema)) return refuse('responseSchema must be an object.');
      config.responseSchema = asked.responseSchema;
    }
    if (asked.maxOutputTokens !== undefined) {
      const v = boundedNumber(asked.maxOutputTokens, 1, Number.MAX_SAFE_INTEGER, true);
      if (v === null) return refuse('maxOutputTokens must be a positive whole number.');
      maxOutput = Math.min(v, MAX_OUTPUT_TOKENS);
    }
    if (asked.thinkingConfig !== undefined) {
      const cfg = asked.thinkingConfig;
      if (!isObject(cfg) || only(cfg, ['thinkingBudget', 'includeThoughts']) !== null) return refuse('thinkingConfig may only set a budget and includeThoughts.');
      const kept: Json = {};
      if (cfg.thinkingBudget !== undefined) {
        // -1 asks for dynamic thinking: it is held at the cap. Anything else is capped.
        const v = boundedNumber(cfg.thinkingBudget, -1, Number.MAX_SAFE_INTEGER, true);
        if (v === null) return refuse('thinkingBudget must be a whole number, or -1.');
        thinking = v === -1 ? MAX_THINKING_BUDGET : Math.min(v, MAX_THINKING_BUDGET);
        kept.thinkingBudget = v === -1 ? -1 : thinking;
      }
      if (cfg.includeThoughts !== undefined) {
        if (typeof cfg.includeThoughts !== 'boolean') return refuse('includeThoughts must be true or false.');
        kept.includeThoughts = cfg.includeThoughts;
      }
      config.thinkingConfig = kept;
    }
  }
  config.maxOutputTokens = maxOutput;
  out.generationConfig = config;

  return { ok: true, request: { body: JSON.stringify(out), grounded, worstOutputTokens: maxOutput + thinking } };
}
