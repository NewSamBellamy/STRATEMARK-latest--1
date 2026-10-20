/**
 * What of an incoming `signalBriefs` map survives. A workspace file is untrusted: the map may be the wrong shape, huge,
 * hold rows that are not briefs, or carry keys that name `Object.prototype` members. Each row is checked with
 * `signalBriefSchema`, must sit under its own card id, and a bounded number are kept. Never throws.
 */
import { signalBriefSchema, type SignalBrief } from '@mi/contracts';

/** More briefs than this are not a real workspace's: the rest are dropped. */
export const MAX_IMPORTED_SIGNAL_BRIEFS = 2000;
const MAX_KEY_CHARS = 200;
const OBJECT_PROTOTYPE_NAMES = new Set(Object.getOwnPropertyNames(Object.prototype));

export function siftSignalBriefs(raw: unknown): Record<string, SignalBrief> {
  const out: Record<string, SignalBrief> = Object.create(null) as Record<string, SignalBrief>;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  let seen = 0;
  for (const cardId of Object.keys(raw)) {
    // A map that is mostly noise is not read to its end.
    if (++seen > MAX_IMPORTED_SIGNAL_BRIEFS * 2 || Object.keys(out).length >= MAX_IMPORTED_SIGNAL_BRIEFS) break;
    if (!cardId || cardId.length > MAX_KEY_CHARS || OBJECT_PROTOTYPE_NAMES.has(cardId)) continue;
    const parsed = signalBriefSchema.safeParse((raw as Record<string, unknown>)[cardId]);
    if (!parsed.success || parsed.data.cardId !== cardId) continue;
    out[cardId] = parsed.data;
  }
  return { ...out };
}
