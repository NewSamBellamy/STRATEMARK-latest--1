/**
 * SEC lanes for listed companies: who reportedly owns 5%+ (the holders' own
 * Schedule 13D/13G filings) and the company's own recent filings. The lanes
 * live in @mi/research; this only wires them to the server-side reader (dev
 * bridge or hosted Worker — the browser cannot read data.sec.gov JSON
 * directly) and caches per company. Both lanes start from the same ticker-map
 * and submissions reads, so reads are shared per URL.
 *
 * Any failure — not an SEC registrant, ambiguous name, reader unavailable, a
 * schedule that could not be read — is null: the section simply isn't shown.
 */
import { findCompanyFilings, findMajorShareholders, type CompanyFiling, type MajorShareholder, type OriginalSourceReceipt } from '@mi/research';
import { LruCache } from '@/lib/media/lookupCache';
import { readPreviewSource } from '@/lib/repository/local-source-reader';

export type { CompanyFiling, MajorShareholder };

const reads = new LruCache<string, Promise<OriginalSourceReceipt>>(200);
function read(url: string): Promise<OriginalSourceReceipt> {
  let pending = reads.get(url);
  if (!pending) {
    pending = readPreviewSource(url);
    reads.set(url, pending);
    // A failed read is not kept: the next lookup may succeed.
    pending.then((receipt) => { if (receipt.status !== 'retrieved') reads.delete(url); }, () => reads.delete(url));
  }
  return pending;
}

function cachedPerCompany<T>(find: (name: string) => Promise<T | null>) {
  const cache = new LruCache<string, Promise<T | null>>(100);
  /** Cached per company name; a failed lookup resolves to null (not retried this session). */
  return (companyName: string | null | undefined): Promise<T | null> => {
    const name = companyName?.trim();
    if (!name) return Promise.resolve(null);
    const key = name.toLowerCase();
    let pending = cache.get(key);
    if (!pending) {
      pending = find(name).catch(() => null);
      cache.set(key, pending);
    }
    return pending;
  };
}

export const lookupMajorShareholders = cachedPerCompany(async (name) => (await findMajorShareholders(name, read))?.holders ?? null);

export const lookupCompanyFilings = cachedPerCompany(async (name) => (await findCompanyFilings(name, read))?.filings ?? null);
