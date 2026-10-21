/**
 * How often one visitor may use the readers (page, image, preview, news and search relays).
 *
 * These routes fetch whatever public address a caller names, from the Worker, with the Worker's own user agent: an
 * anonymous, unlimited fetch proxy, with abuse reports landing on the owner. The origin check does not stop that (a
 * script forges Origin). They spend no Gemini money, so they sit outside the dollar budget; this limits how fast and how
 * much one visitor can use them instead. One Durable Object per visitor (named by a hash of the address, an IPv6 /64
 * counted as one visitor) keeps the counting exact without any single object being a hotspot.
 *
 * Generous on purpose: a deck of 18 companies makes a few hundred reads in three minutes. This stops a loop, not a person.
 */
import { DurableObject } from 'cloudflare:workers';

export interface ReaderLimits { perMinute: number; perDay: number }
export const READER_LIMITS_DEFAULT: ReaderLimits = { perMinute: 240, perDay: 6_000 };

export interface ReaderState { minute: number; inMinute: number; day: string; inDay: number }
export type ReaderResult = { ok: true; state: ReaderState } | { ok: false; state: ReaderState; retryAfterSeconds: number };

/** Pure step: may this visitor read now? A refused read is not counted. */
export function takeReaderQuota(state: ReaderState | undefined, nowMs: number, limits: ReaderLimits): ReaderResult {
  const minute = Math.floor(nowMs / 60_000);
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const current: ReaderState = {
    minute, inMinute: state?.minute === minute ? state.inMinute : 0,
    day, inDay: state?.day === day ? state.inDay : 0,
  };
  if (current.inDay + 1 > limits.perDay) {
    const midnight = Date.parse(`${day}T00:00:00.000Z`) + 86_400_000;
    return { ok: false, state: current, retryAfterSeconds: Math.max(1, Math.ceil((midnight - nowMs) / 1000)) };
  }
  if (current.inMinute + 1 > limits.perMinute) {
    return { ok: false, state: current, retryAfterSeconds: Math.max(1, Math.ceil(((minute + 1) * 60_000 - nowMs) / 1000)) };
  }
  return { ok: true, state: { ...current, inMinute: current.inMinute + 1, inDay: current.inDay + 1 } };
}

const STATE = 'state';
/** The object deletes itself when a visitor has been gone this long. */
const IDLE_DELETE_MS = 2 * 86_400_000;

export class ReaderQuota extends DurableObject {
  async take(nowMs: number, limits: ReaderLimits): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
    const result = takeReaderQuota(await this.ctx.storage.get<ReaderState>(STATE), nowMs, limits);
    await this.ctx.storage.put(STATE, result.state);
    await this.ctx.storage.setAlarm(nowMs + IDLE_DELETE_MS);
    return result.ok ? { ok: true } : { ok: false, retryAfterSeconds: result.retryAfterSeconds };
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
