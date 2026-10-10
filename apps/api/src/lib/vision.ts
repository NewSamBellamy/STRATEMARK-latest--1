/**
 * The vision half of capture verification.
 *
 * Kept apart from `verify.ts` on purpose: that module holds the decision logic
 * and stays pure and fully testable, while this one owns the network call. The
 * seam between them is the `VisionJudge` function type.
 */
import { GoogleGenAI } from '@google/genai';
import { zodToGenAiSchema } from '@mi/research';
import type { ServiceEnv } from '../env';
import { visionVerdictSchema, type VisionJudge } from './verify';

/**
 * The verdict contract as a native `responseSchema` (issue #48). Derived from
 * the same Zod schema `parseVisionVerdict` validates against, so what the model
 * is constrained to emit and what we accept cannot drift apart. Asking for
 * `application/json` alone left the shape entirely up to the model.
 */
const VISION_RESPONSE_SCHEMA = zodToGenAiSchema(visionVerdictSchema);

/**
 * Flash-Lite is the right tier here. The question is "is this a real page or a
 * wall" — a coarse visual judgement that does not need the frontier model, and
 * one that runs on every blocked capture, so cost per call matters.
 */
export const VISION_MODEL = 'gemini-3.5-flash-lite';

export interface VisionOptions {
  env: ServiceEnv;
  /** A BYOK caller's key, when the request supplied one. */
  callerKey?: string | undefined;
  model?: string;
}

/**
 * Builds a judge, or returns undefined when no credentials are available.
 * Undefined is meaningful: `verifyCapture` then fails closed rather than
 * silently declaring an unverified capture to be genuine.
 */
export function createVisionJudge(opts: VisionOptions): VisionJudge | undefined {
  const key = opts.callerKey ?? opts.env.geminiApiKey;
  if (!key && !opts.env.vertex) return undefined;

  const ai = new GoogleGenAI(
    !opts.callerKey && opts.env.vertex
      ? { vertexai: true, project: opts.env.vertex.project, location: opts.env.vertex.location }
      : { apiKey: key ?? '' },
  );

  return async ({ screenshot, prompt }) => {
    const result = await ai.models.generateContent({
      model: opts.model ?? VISION_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/png', data: screenshot.toString('base64') } },
            { text: prompt },
          ],
        },
      ],
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: VISION_RESPONSE_SCHEMA,
      },
    });
    return result.text ?? '';
  };
}
