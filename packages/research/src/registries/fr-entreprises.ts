/**
 * France — recherche-entreprises.api.gouv.fr (SIRENE). Publishes a headcount
 * BAND (INSEE tranche d'effectif), never a point value: the fact carries
 * `band` + a label and `cardFaceSafe: false`. Runs only for country FR.
 * The API exposes no website, so identity requires an EXACT normalized legal
 * name (or the known SIREN). NN = unknown tranche -> no fact.
 */
import type { AdapterResult, EntityIdentity, RegistryContext, RegistryFact, RegistrySource } from './types';
import { noMatch } from './types';
import { asRecord, exactNameMatch, fetchJson } from './shared';

const API = 'https://recherche-entreprises.api.gouv.fr/search';
const HUMAN = 'https://annuaire-entreprises.data.gouv.fr/entreprise';

/** INSEE tranche_effectif_salarie -> inclusive salariés range (max null = open-ended). */
export const INSEE_BANDS: Record<string, { min: number; max: number | null }> = {
  '00': { min: 0, max: 0 },
  '01': { min: 1, max: 2 },
  '02': { min: 3, max: 5 },
  '03': { min: 6, max: 9 },
  '11': { min: 10, max: 19 },
  '12': { min: 20, max: 49 },
  '21': { min: 50, max: 99 },
  '22': { min: 100, max: 199 },
  '31': { min: 200, max: 249 },
  '32': { min: 250, max: 499 },
  '41': { min: 500, max: 999 },
  '42': { min: 1000, max: 1999 },
  '51': { min: 2000, max: 4999 },
  '52': { min: 5000, max: 9999 },
  '53': { min: 10000, max: null },
};

export function inseeBand(code: unknown): { min: number; max: number | null } | null {
  return typeof code === 'string' ? INSEE_BANDS[code] ?? null : null;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US').replace(/,/g, ' ');
}

export function inseeBandLabel(band: { min: number; max: number | null }, year: string | null): string {
  const range = band.max === null ? `${fmt(band.min)}+` : band.min === band.max ? `${band.min}` : `${fmt(band.min)}–${fmt(band.max)}`;
  return `${range} employees (INSEE band${year ? `, ${year}` : ''})`;
}

export const frEntreprisesSource: RegistrySource = {
  id: 'fr-entreprises',
  applies: (identity: EntityIdentity) => identity.country?.toUpperCase() === 'FR',
  async lookup(identity: EntityIdentity, ctx: RegistryContext): Promise<AdapterResult> {
    const q = identity.siren && /^\d{9}$/.test(identity.siren) ? identity.siren : identity.name;
    const json = asRecord(await fetchJson(`${API}?q=${encodeURIComponent(q)}&per_page=10`, ctx));
    const rows = Array.isArray(json?.results) ? (json!.results as unknown[]) : [];

    const hits: Array<{ row: Record<string, unknown>; legalName: string }> = [];
    for (const raw of rows) {
      const row = asRecord(raw);
      if (!row || typeof row.siren !== 'string') continue;
      if (row.etat_administratif && row.etat_administratif !== 'A') continue;
      if (identity.siren && row.siren === identity.siren) {
        hits.push({ row, legalName: String(row.nom_complet ?? identity.name) });
        continue;
      }
      const names = [row.nom_complet, row.nom_raison_sociale]
        .filter((n): n is string => typeof n === 'string' && n.length > 0);
      const legalName = names.find((n) => exactNameMatch(identity.name, n));
      if (legalName) hits.push({ row, legalName });
    }
    const distinct = new Set(hits.map((h) => h.row.siren));
    if (!distinct.size) return noMatch('no active French unit with exact legal name');
    if (distinct.size > 1) return noMatch('ambiguous: several French units share the name');

    const { row, legalName } = hits[0]!;
    const siren = row.siren as string;
    const facts: RegistryFact[] = [];
    const band = inseeBand(row.tranche_effectif_salarie);
    if (band) {
      const year = row.annee_tranche_effectif_salarie != null ? String(row.annee_tranche_effectif_salarie) : null;
      facts.push({
        registry: 'fr-entreprises',
        metric: 'employees',
        metricType: 'employees',
        value: null,
        band,
        unit: 'employees',
        asOf: year && /^\d{4}$/.test(year) ? year : null,
        undated: !(year && /^\d{4}$/.test(year)),
        sourceUrl: `${HUMAN}/${siren}`,
        apiUrl: `${API}?q=${siren}`,
        label: inseeBandLabel(band, year),
        cardFaceSafe: false,
        methodNote: `Annuaire des Entreprises / INSEE SIRENE, SIREN ${siren} (${legalName}), tranche d'effectif salarié ${String(row.tranche_effectif_salarie)} — a band, not a point count; legal unit only`,
        identity: { kind: 'exact-legal-name', legalName },
      });
    }
    return { status: 'matched', facts, enrichment: { siren } };
  },
};
