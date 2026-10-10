import { usableCitations } from '@mi/contracts';
import type { ProviderGrounding } from './types';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const index = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Keep provider attribution intact. It must never be labelled an original quotation. */
export function extractProviderGrounding(answerText: string, metadata: unknown): ProviderGrounding | undefined {
  const raw = object(metadata);
  if (!Array.isArray(raw?.groundingSupports)) return undefined;
  const chunks = Array.isArray(raw.groundingChunks) ? raw.groundingChunks : [];
  const supports: ProviderGrounding['supports'] = [];
  for (const [supportIndex, value] of raw.groundingSupports.entries()) {
    const support = object(value);
    const segment = object(support?.segment);
    const text = segment?.text;
    const indices = support?.groundingChunkIndices;
    if (typeof text !== 'string' || !text.trim() || !answerText.includes(text) || !Array.isArray(indices) || !indices.length) continue;
    const sources: ProviderGrounding['supports'][number]['sources'] = [];
    let invalid = false;
    for (const chunkIndex of new Set(indices)) {
      if (!index(chunkIndex) || chunkIndex >= chunks.length) { invalid = true; break; }
      const web = object(object(chunks[chunkIndex])?.web);
      const url = typeof web?.uri === 'string' ? web.uri : '';
      const title = typeof web?.title === 'string' ? web.title : url;
      const citation = usableCitations([{ url, title }])[0];
      if (!citation) { invalid = true; break; }
      sources.push({ chunkIndex, url: citation.url, title: citation.title });
    }
    // Never compact indices then accidentally bind a statement to a different source.
    if (invalid || !sources.length) continue;
    supports.push({ supportIndex, text, sources,
      ...(index(segment?.startIndex) ? { startIndex: segment.startIndex } : {}),
      ...(index(segment?.endIndex) ? { endIndex: segment.endIndex } : {}),
      ...(index(segment?.partIndex) ? { partIndex: segment.partIndex } : {}),
    });
  }
  return { provider: 'google-search', answerText, supports };
}

/** Evidence retrieval must never expose mutable references into stored records. */
export function copyProviderGrounding(value: ProviderGrounding): ProviderGrounding {
  return { ...value, supports: value.supports.map((support) => ({ ...support,
    sources: support.sources.map((source) => ({ ...source })),
  })) };
}
