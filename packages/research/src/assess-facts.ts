/**
 * Effects on read (PLAN-CRAAP 1.2): the last step of the read path. Every figure a
 * company shows is assessed afresh with an injected clock; any `assessment` already
 * on a row (from storage, a shared deck or transport) is DISCARDED, never trusted.
 * Stored rows are never rewritten: the effects apply to the displayed copy only.
 *
 *   user_verified, unknown ......... untouched (no assessment attached)
 *   verified, stale ................ ESTIMATED, value/citations/passageSupport kept,
 *                                    lastVerifiedAt null, dated note   (demoted_stale)
 *   verified, sponsored only (D5) .. ESTIMATED                          (demoted_authority)
 *   estimated, stale ............... unchanged, labelled with its date (labelled_stale)
 *   shown as aged-out estimate ..... unchanged (set by company-facts)   (shown_aged_out)
 *
 * Hunt-target and readiness decisions read the facts BEFORE this step, so hunt cost
 * is unchanged: demoted_stale counts as verified and shown_aged_out as not shown.
 * Never changes or drops a value; never zero-fills. Pure.
 */
import { auditDeckConsistency, type Company, type CompanyMetric, type MetricType } from '@mi/contracts';
import { implausibleScaleFigures } from './scale-plausibility';
import { assessFigure, staleNote } from './source-assessment';

export interface AssessFactsInput {
  company: Pick<Company, 'id' | 'name' | 'websiteUrl'> & { ownership?: Company['ownership'] };
  /** Websites of roster rivals (competitor purpose). */
  rivalWebsites?: readonly string[];
  now: Date;
}

/** Metric types of THIS company that the existing plausibility rules doubt (once per company). */
export function plausibilityFlags(company: AssessFactsInput['company'], facts: readonly CompanyMetric[]): Set<MetricType> {
  const flagged = new Set<MetricType>();
  try {
    for (const f of implausibleScaleFigures({ companies: [{ id: company.id, name: company.name }], metrics: facts })) {
      if (f.companyId === company.id) flagged.add(f.metricType);
    }
    for (const f of auditDeckConsistency([{ companyId: company.id, name: company.name, ownership: company.ownership ?? null, metrics: [...facts] }])) {
      if (f.companyIds.includes(company.id)) for (const t of f.metricTypes) flagged.add(t);
    }
  } catch { /* cannot tell: do not judge */ }
  return flagged;
}

const hostOnly = (site: string): string | null => {
  try { return new URL(site.includes('://') ? site : `https://${site}`).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
};

export function assessFacts(facts: readonly CompanyMetric[], input: AssessFactsInput): CompanyMetric[] {
  const flagged = plausibilityFlags(input.company, facts);
  const rivalHosts = (input.rivalWebsites ?? []).map(hostOnly).filter((h): h is string => !!h);
  return facts.map((fact) => {
    const row = structuredClone(fact);
    delete row.assessment; // never trusted from storage, shares or transport
    if (row.value == null || row.confidence === 'unknown' || row.confidence === 'user_verified') return row;
    const assessment = assessFigure(row, {
      now: input.now, companyWebsite: input.company.websiteUrl, ownership: input.company.ownership ?? null,
      rivalHosts, plausibilityFlagged: flagged,
    });
    if (!assessment) return row;
    if (assessment.effect === 'demoted_stale' || assessment.effect === 'demoted_authority') {
      const note = assessment.effect === 'demoted_stale' ? staleNote(assessment, row.metricType)
        : 'Sponsored or contributor content does not verify a figure.';
      row.confidence = 'estimated';
      row.lastVerifiedAt = null;
      row.methodNote = [note, row.methodNote].filter(Boolean).join(' ');
    }
    row.assessment = assessment;
    return row;
  });
}
