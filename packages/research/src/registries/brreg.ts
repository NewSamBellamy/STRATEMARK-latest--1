/**
 * Norway — Brønnøysund Enhetsregisteret. Exact `antallAnsatte` (employees).
 * Runs only for country NO. A hit must pass name similarity AND either a
 * website-domain match (hjemmeside) or an exact normalized legal name.
 * The register states no as-of date for the count, so the fact is `undated`.
 */
import type { AdapterResult, EntityIdentity, RegistryContext, RegistryFact, RegistrySource } from './types';
import { noMatch } from './types';
import { asRecord, exactNameMatch, fetchJson, nameSimilarity, sameRegistrableDomain } from './shared';

const API = 'https://data.brreg.no/enhetsregisteret/api/enheter';
const HUMAN = 'https://virksomhet.brreg.no/nb/oppslag/enheter';
export const BRREG_MIN_NAME_SIMILARITY = 0.5;

export const brregSource: RegistrySource = {
  id: 'brreg',
  applies: (identity: EntityIdentity) => identity.country?.toUpperCase() === 'NO',
  async lookup(identity: EntityIdentity, ctx: RegistryContext): Promise<AdapterResult> {
    const url = identity.orgnr && /^\d{9}$/.test(identity.orgnr)
      ? null
      : `${API}?navn=${encodeURIComponent(identity.name)}&size=10`;
    const json = asRecord(await fetchJson(url ?? `${API}?organisasjonsnummer=${identity.orgnr}&size=1`, ctx));
    const embedded = asRecord(json?._embedded);
    const rows = Array.isArray(embedded?.enheter) ? (embedded!.enheter as unknown[]) : [];

    const matches: Array<{ row: Record<string, unknown>; evidence: RegistryFact['identity'] }> = [];
    for (const raw of rows) {
      const row = asRecord(raw);
      if (!row || typeof row.navn !== 'string' || typeof row.organisasjonsnummer !== 'string') continue;
      if (row.konkurs === true || row.underAvvikling === true || row.underTvangsavviklingEllerTvangsopplosning === true) continue;
      if (identity.orgnr && row.organisasjonsnummer === identity.orgnr) {
        matches.push({ row, evidence: { kind: 'exact-legal-name', legalName: row.navn } });
        continue;
      }
      if (nameSimilarity(identity.name, row.navn) < BRREG_MIN_NAME_SIMILARITY) continue;
      const site = typeof row.hjemmeside === 'string' ? row.hjemmeside : null;
      if (site && identity.domain && sameRegistrableDomain(site, identity.domain)) {
        matches.push({ row, evidence: { kind: 'name-and-domain', legalName: row.navn, domain: identity.domain } });
      } else if (exactNameMatch(identity.name, row.navn)) {
        matches.push({ row, evidence: { kind: 'exact-legal-name', legalName: row.navn } });
      }
    }
    const distinct = new Set(matches.map((m) => m.row.organisasjonsnummer));
    if (!distinct.size) return noMatch('no Brreg unit matches name + domain/legal name');
    if (distinct.size > 1) return noMatch('ambiguous: several Brreg units match');

    const { row, evidence } = matches[0]!;
    const orgnr = row.organisasjonsnummer as string;
    const facts: RegistryFact[] = [];
    const n = row.antallAnsatte;
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
      facts.push({
        registry: 'brreg',
        metric: 'employees',
        metricType: 'employees',
        value: n,
        band: null,
        unit: 'employees',
        asOf: null,
        undated: true,
        sourceUrl: `${HUMAN}/${orgnr}`,
        apiUrl: `${API}/${orgnr}`,
        cardFaceSafe: true,
        methodNote: `Brønnøysund Enhetsregisteret, org.nr ${orgnr} (${String(row.navn)}), antallAnsatte; register states no as-of date`,
        identity: evidence,
      });
    }
    const website = typeof row.hjemmeside === 'string' ? row.hjemmeside : undefined;
    return {
      status: 'matched',
      facts,
      enrichment: { orgnr, ...(website ? { website } : {}) },
    };
  },
};
