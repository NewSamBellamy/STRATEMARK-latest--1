/**
 * Where shares live: one Durable Object per share (named by its id), and one
 * small ledger object that limits how many a visitor may make in a day.
 *
 * A Durable Object is used instead of KV so a share is readable the moment it is
 * made (KV can lag for a minute across regions), so "stop sharing" takes effect
 * at once, and so the feature needs no extra resource to create before deploying.
 * Each share is written in pieces first and its record last, so a half-written
 * share is never visible, and it deletes itself when it expires.
 */
import { DurableObject } from 'cloudflare:workers';
import { chunkText, sameSecret, takeShareQuota, type QuotaDay, type QuotaLimits, type QuotaResult } from './share-policy';

export interface ShareRecordMeta {
  kind: 'card' | 'deck';
  title: string;
  description: string;
  viewer: string;
  createdAt: number;
  expiresAt: number;
  chunks: number;
  hasOg: boolean;
  /** Characters stored (data plus picture), for the day's limits. */
  bytes: number;
}

const META = 'meta';
const TOKEN = 'token';
const OG = 'og';
const piece = (i: number) => `d${i}`;
/** Durable Object storage takes at most 128 keys per call. */
const BATCH = 100;

export class ShareVault extends DurableObject {
  /** Write a new share. False when this id is already taken (never overwrites). */
  async put(input: { meta: ShareRecordMeta; data: string; og: string | null; tokenHash: string }): Promise<boolean> {
    if (await this.ctx.storage.get(META)) return false;
    const pieces = chunkText(input.data);
    for (let i = 0; i < pieces.length; i += BATCH) {
      const entries: Record<string, string> = {};
      pieces.slice(i, i + BATCH).forEach((text, j) => { entries[piece(i + j)] = text; });
      await this.ctx.storage.put(entries);
    }
    await this.ctx.storage.put({ [TOKEN]: input.tokenHash, ...(input.og ? { [OG]: input.og } : {}) });
    // The record goes last: until it exists, the share does not.
    await this.ctx.storage.put(META, { ...input.meta, chunks: pieces.length, hasOg: input.og !== null });
    await this.ctx.storage.setAlarm(input.meta.expiresAt);
    return true;
  }

  /** The record, or null when there is none or it has expired (an expired share is deleted on the way). */
  async meta(): Promise<ShareRecordMeta | null> {
    const meta = await this.ctx.storage.get<ShareRecordMeta>(META);
    if (!meta) return null;
    if (meta.expiresAt <= Date.now()) {
      await this.ctx.storage.deleteAll();
      return null;
    }
    return meta;
  }

  async data(): Promise<string | null> {
    const meta = await this.meta();
    if (!meta) return null;
    const keys = Array.from({ length: meta.chunks }, (_unused, i) => piece(i));
    let out = '';
    for (let i = 0; i < keys.length; i += BATCH) {
      const got = await this.ctx.storage.get<string>(keys.slice(i, i + BATCH));
      for (const key of keys.slice(i, i + BATCH)) {
        const text = got.get(key);
        if (text === undefined) return null; // a missing piece is a broken share, never a short one
        out += text;
      }
    }
    return out;
  }

  async og(): Promise<string | null> {
    const meta = await this.meta();
    if (!meta?.hasOg) return null;
    return (await this.ctx.storage.get<string>(OG)) ?? null;
  }

  /** Stop sharing: only the holder of the token made at creation can. */
  async remove(tokenHash: string): Promise<'removed' | 'forbidden' | 'missing'> {
    const meta = await this.meta();
    if (!meta) return 'missing';
    const stored = await this.ctx.storage.get<string>(TOKEN);
    if (!stored || !sameSecret(stored, tokenHash)) return 'forbidden';
    await this.ctx.storage.deleteAll();
    return 'removed';
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

const LEDGER = 'quota';

/** One instance counts today's shares: per visitor and in all. */
export class ShareQuota extends DurableObject {
  async take(day: string, visitor: string, bytes: number, limits: QuotaLimits): Promise<{ ok: true } | { ok: false; reason: 'visitor' | 'global' }> {
    const current = await this.ctx.storage.get<QuotaDay>(LEDGER);
    const result: QuotaResult = takeShareQuota(current, day, visitor, bytes, limits);
    await this.ctx.storage.put(LEDGER, result.ledger);
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  }

  /** Give back a hold when the share could not be stored after all. */
  async give(day: string, visitor: string, bytes: number): Promise<void> {
    const current = await this.ctx.storage.get<QuotaDay>(LEDGER);
    if (!current || current.day !== day) return;
    const mine = current.visitors[visitor];
    if (!mine) return;
    await this.ctx.storage.put(LEDGER, {
      day,
      global: { n: Math.max(0, current.global.n - 1), bytes: Math.max(0, current.global.bytes - bytes) },
      visitors: { ...current.visitors, [visitor]: { n: Math.max(0, mine.n - 1), bytes: Math.max(0, mine.bytes - bytes) } },
    });
  }
}
