/**
 * Who reportedly owns 5%+ of a listed company, from the holders' own SEC
 * Schedule 13D/13G filings. The lane itself (ticker map → submissions feed →
 * structured schedules → one row per holder) lives in @mi/research; this only
 * wires it to the server-side reader (dev bridge or hosted Worker — the
 * browser cannot read data.sec.gov JSON directly) and caches per company.
 *
 * Any failure — not an SEC registrant, ambiguous name, reader unavailable, a
 * schedule that could not be read — is null: the section simply isn't shown.
 */
import { findMajorShareholders, type MajorShareholder } from '@mi/research';
import { LruCache } from '@/lib/media/lookupCache';
import { readPreviewSource } from '@/lib/repository/local-source-reader';

export type { MajorShareholder };

const cache = new LruCache<string, Promise<MajorShareholder[] | null>>(100);

async function lookup(companyName: string): Promise<MajorShareholder[] | null> {
  const result = await findMajorShareholders(companyName, (url) => readPreviewSource(url));
  return result ? result.holders : null;
}

/** Cached per company name; a failed lookup resolves to null (not retried this session). */
export function lookupMajorShareholders(companyName: string | null | undefined): Promise<MajorShareholder[] | null> {
  const name = companyName?.trim();
  if (!name) return Promise.resolve(null);
  const key = name.toLowerCase();
  let pending = cache.get(key);
  if (!pending) {
    pending = lookup(name).catch(() => null);
    cache.set(key, pending);
  }
  return pending;
}
