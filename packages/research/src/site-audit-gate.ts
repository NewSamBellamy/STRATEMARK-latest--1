/**
 * The deterministic post-gate for the site audit. The model proposes; this
 * decides what is allowed to reach the owner.
 *
 *  - A finding survives only if its quote is found in the evidence that was
 *    actually supplied (page facts/text first, then the grounded web context).
 *    "Not observable" findings carry no quote by design and are kept.
 *  - Scores are clamped 1-10; a model score for a checks-scored category is
 *    ignored; fixed rules put hard ceilings on judged scores.
 *  - Categories are deduplicated and merged; unobserved categories stay null,
 *    never imputed. The overall is the weight-normalised mean of what WAS
 *    scored, and carries a coverage figure: a partial audit says so.
 */
import type {
  SiteAuditArea, SiteAuditCheck, SiteAuditConfidence, SiteAuditContent, SiteAuditCriterion, SiteAuditFinding, SiteAuditFix,
} from '@mi/contracts';
import type { SiteAuditV2Out } from './schemas';
import { evidenceCorpus, type AuditEvidence } from './site-audit-evidence';
import { CHECK_FIXES, RUBRIC, scoreCeiling, scoreFromChecks } from './site-audit-rubric';

export type PageStatus = 'read' | 'js_only' | 'unavailable';

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Discrete evidence items that a one-word quote may legitimately match in full. */
function discreteItems(e: AuditEvidence | null): Set<string> {
  const items = new Set<string>();
  if (!e) return items;
  for (const h of e.headings) items.add(normalise(h.text));
  for (const c of e.ctas) items.add(normalise(c.label));
  for (const f of e.forms) {
    if (f.submitLabel) items.add(normalise(f.submitLabel));
    for (const x of f.fields) if (x.label) items.add(normalise(x.label));
  }
  if (e.title) items.add(normalise(e.title));
  return items;
}

/**
 * Where a quote is found: 'page' (page facts/text), 'search' (grounded web
 * context) or null (nowhere: the quote is invented or paraphrased).
 * Fragments joined by an ellipsis are each checked.
 */
export function quoteSource(quote: string | null | undefined, evidence: AuditEvidence | null, groundedText: string): 'page' | 'search' | null {
  if (!quote) return null;
  const fragments = quote.split(/…|\.{3}/).map(normalise).filter((f) => f.length >= 4);
  if (!fragments.length) return null;
  const total = fragments.join(' ').length;
  if (total < 6 && !fragments.every((f) => discreteItems(evidence).has(f))) return null;
  const inText = (hay: string): boolean => {
    const padded = ` ${normalise(hay)} `;
    return fragments.every((f) => padded.includes(` ${f} `));
  };
  if (evidence && inText(evidenceCorpus(evidence))) return 'page';
  if (groundedText && inText(groundedText)) return 'search';
  return null;
}

const clamp = (n: number): number => Math.min(10, Math.max(1, Math.round(n)));
const IMPACT_RANK = { high: 3, medium: 2, low: 1 } as const;
const EFFORT_RANK = { low: 3, medium: 2, high: 1 } as const;

export interface ComposeInput {
  url: string;
  siteName: string;
  evidence: AuditEvidence | null;
  pageStatus: PageStatus;
  pageReason?: string | null;
  finalUrl?: string | null;
  checklist: SiteAuditCheck[];
  groundedText: string;
  /** False when the grounded call failed and the audit rests on the page alone. */
  groundedOk: boolean;
  out: SiteAuditV2Out;
}

export function composeSiteAudit(input: ComposeInput): SiteAuditContent {
  const { evidence, checklist, groundedText, out } = input;
  const bodyReadable = input.pageStatus === 'read';
  let dropped = 0;
  const kindOf = new WeakMap<SiteAuditFinding, 'working' | 'issue'>();

  // Merge duplicate categories the model emitted, keeping the richer one's verdict.
  const byArea = new Map<SiteAuditArea, SiteAuditV2Out['criteria'][number]>();
  for (const c of out.criteria) {
    const prev = byArea.get(c.area);
    if (!prev) { byArea.set(c.area, { ...c, findings: [...c.findings] }); continue; }
    prev.findings.push(...c.findings);
    if (c.verdict.length > prev.verdict.length) prev.verdict = c.verdict;
    if (prev.score === null) prev.score = c.score;
  }

  const gateFinding = (f: SiteAuditV2Out['criteria'][number]['findings'][number]): SiteAuditFinding | null => {
    const title = f.title.trim();
    const detail = f.detail.trim();
    if (!title && !detail) return null;
    if (f.kind === 'not_observable') {
      return { title: title || 'Not observable', detail: detail || 'The supplied evidence does not show this.', notObservable: true };
    }
    const src = quoteSource(f.quote, evidence, groundedText);
    if (!src) { dropped += 1; return null; }
    const kept: SiteAuditFinding = { title, detail, quote: f.quote!.trim(), evidenceSource: src, ...(f.kind === 'issue' && f.impact?.trim() ? { impact: f.impact.trim() } : {}) };
    kindOf.set(kept, f.kind);
    return kept;
  };

  const criteria: SiteAuditCriterion[] = RUBRIC.map((cat): SiteAuditCriterion => {
    const raw = byArea.get(cat.area);
    const findings: SiteAuditFinding[] = [];
    const seen = new Set<string>();
    for (const f of raw?.findings ?? []) {
      const g = gateFinding(f);
      if (!g) continue;
      const key = normalise(g.title || g.detail);
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(g);
    }
    const keptFindings = findings.slice(0, 5);

    if (cat.scoredBy === 'checks') {
      const score = scoreFromChecks(cat.area, checklist);
      const own = checklist.filter((c) => c.area === cat.area);
      const failing = own.filter((c) => c.status === 'fail').length;
      const known = own.filter((c) => c.status !== 'unknown').length;
      return {
        area: cat.area, label: cat.label, weight: cat.weight, score, observable: score !== null, scoredBy: 'checks',
        verdict: score === null
          ? (bodyReadable || evidence ? 'Too few of the fixed checks could be decided from the page.' : 'The page could not be read, so these fixed checks were not run.')
          : `${known - failing} of ${known} fixed checks pass.`,
        findings: keptFindings,
      };
    }

    // Judged category. It needs the page (or search context where the rubric allows it).
    const canJudge = cat.observableWithoutPage || bodyReadable;
    let score: number | null = null;
    let verdict = raw?.verdict.trim() ?? '';
    if (canJudge && raw && raw.observable !== false && raw.score !== undefined && raw.score !== null && Number.isFinite(raw.score)) {
      const supported = keptFindings.some((f) => !f.notObservable);
      if (supported) {
        score = clamp(raw.score);
        const cap = scoreCeiling(cat.area, checklist);
        if (cap && score > cap.max) {
          verdict = `${verdict} (Capped at ${cap.max}/10: ${cap.reason}.)`.trim();
          score = cap.max;
        }
      } else {
        // A score with no surviving evidence behind it is not a score.
        verdict = 'No finding in this category could be tied to the supplied evidence.';
      }
    } else if (!canJudge) {
      verdict = 'Not observable: the page itself could not be read.';
    } else if (!verdict) {
      verdict = 'Not observable from the supplied evidence.';
    }
    return {
      area: cat.area, label: cat.label, weight: cat.weight, score, observable: score !== null, scoredBy: 'model',
      verdict: score === null && !/not observable|no finding/i.test(verdict) ? `Not observable. ${verdict}`.trim() : verdict,
      findings: keptFindings,
    };
  });

  const scored = criteria.filter((c) => c.score !== null);
  const weightScored = scored.reduce((s, c) => s + c.weight, 0);
  const coverage = Math.round((weightScored / RUBRIC.reduce((s, c) => s + c.weight, 0)) * 100) / 100;
  const overall = weightScored > 0 ? Math.round((scored.reduce((s, c) => s + c.weight * c.score!, 0) / weightScored) * 10) : 0;

  // Fixes: model fixes that quote real evidence (or point at an area with a failing fixed check), plus checklist fixes.
  const failingAreas = new Set(checklist.filter((c) => c.status === 'fail').map((c) => c.area));
  const fixes: SiteAuditFix[] = [];
  const fixSeen = new Set<string>();
  const pushFix = (f: SiteAuditFix): void => {
    const key = normalise(f.title);
    if (!key || fixSeen.has(key)) return;
    fixSeen.add(key);
    fixes.push(f);
  };
  for (const c of checklist) {
    const known = CHECK_FIXES[c.id];
    if (c.status === 'fail' && known) pushFix({ ...known, area: c.area, quote: null });
  }
  for (const f of out.fixes) {
    const title = f.title.trim();
    if (!title && !f.detail.trim()) continue;
    const src = quoteSource(f.quote, evidence, groundedText);
    if (src) pushFix({ title, detail: f.detail.trim(), impact: f.impact, effort: f.effort, area: f.area, quote: f.quote!.trim() });
    else if (f.area && failingAreas.has(f.area)) pushFix({ title, detail: f.detail.trim(), impact: f.impact, effort: f.effort, area: f.area, quote: null });
    else dropped += 1;
  }
  fixes.sort((a, b) => IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] || EFFORT_RANK[b.effort] - EFFORT_RANK[a.effort]);

  const testFirst: SiteAuditFinding[] = [];
  for (const t of out.testFirst) {
    if (!t.title.trim() && !t.hypothesis.trim()) continue;
    const src = quoteSource(t.quote, evidence, groundedText);
    if (!src) { dropped += 1; continue; }
    testFirst.push({
      title: t.title.trim(), detail: `${t.hypothesis.trim()}${t.metric.trim() ? ` Measure: ${t.metric.trim()}.` : ''}`.trim(),
      quote: t.quote!.trim(), evidenceSource: src,
    });
  }

  // Design register: kept only when it quotes evidence; otherwise an honest not-observable line.
  const designSrc = quoteSource(out.designQuote, evidence, groundedText);
  const designStyle = designSrc && out.designSummary.trim()
    ? { summary: out.designSummary.trim(), notes: out.designNotes.map((n) => n.trim()).filter(Boolean).slice(0, 6) }
    : { summary: 'Not observable. Colour, typography, imagery and layout are not judged: only the page source and web context were read, no rendered screenshot.', notes: [] };

  // Legacy lists so the markdown twin and older renderers keep working.
  const working: SiteAuditFinding[] = [];
  const missing: SiteAuditFinding[] = [];
  for (const f of criteria.flatMap((c) => c.findings)) {
    const kind = kindOf.get(f);
    if (kind === 'working') working.push(f);
    else if (kind === 'issue') missing.push(f);
  }

  const confidence = scoreConfidence({ pageStatus: input.pageStatus, coverage, dropped, kept: criteria.reduce((s, c) => s + c.findings.length, 0), groundedOk: input.groundedOk, reason: input.pageReason ?? null });

  return {
    url: input.url,
    siteName: input.siteName,
    overall,
    scores: scored.map((c) => ({ area: c.area, score: c.score!, verdict: c.verdict })),
    working: dedupeFindings(working).slice(0, 8),
    missing: dedupeFindings(missing).slice(0, 8),
    designStyle,
    testFirst: testFirst.slice(0, 5),
    version: 2,
    criteria,
    checklist,
    fixes: fixes.slice(0, 10),
    confidence,
    page: { status: input.pageStatus, finalUrl: input.finalUrl ?? null, reason: input.pageReason ?? null, ...(evidence ? { words: evidence.wordCount } : {}) },
    droppedFindings: dropped,
  };
}

function dedupeFindings(list: SiteAuditFinding[]): SiteAuditFinding[] {
  const seen = new Set<string>();
  return list.filter((f) => {
    const k = normalise(f.title || f.detail);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function scoreConfidence(i: { pageStatus: PageStatus; coverage: number; dropped: number; kept: number; groundedOk: boolean; reason: string | null }): SiteAuditConfidence {
  const pageRead = i.pageStatus === 'read';
  let level: SiteAuditConfidence['level'] = pageRead ? (i.coverage >= 0.85 ? 'high' : i.coverage >= 0.6 ? 'medium' : 'low') : 'low';
  // When most of what the model said could not be tied to evidence, trust the rest less.
  if (i.dropped > 0 && i.dropped >= i.kept && level === 'high') level = 'medium';
  else if (i.dropped > 0 && i.dropped >= i.kept && level === 'medium') level = 'low';
  if (!i.groundedOk && level === 'high') level = 'medium';
  const pct = Math.round(i.coverage * 100);
  const parts: string[] = [];
  if (i.pageStatus === 'unavailable') parts.push(`The page could not be read${i.reason ? ` (${i.reason.replace(/\.$/, '')})` : ''}, so this audit rests on web search context only; layout, calls to action, forms and technical checks were not assessed.`);
  else if (i.pageStatus === 'js_only') parts.push('The page renders in the browser: its HTML carries almost no copy, so only head-level checks and web context were used.');
  else parts.push('The page source was read and checked against fixed rules.');
  if (!i.groundedOk) parts.push('Web search context was unavailable.');
  if (pct < 100) parts.push(`${pct}% of the rubric could be observed.`);
  if (i.dropped > 0) parts.push(`${i.dropped} model claim(s) were removed because they quoted nothing in the evidence.`);
  return { level, coverage: i.coverage, pageRead, note: parts.join(' ') };
}

/** A faithful markdown twin so the .md export and share paths keep working. */
export function siteAuditMarkdown(audit: SiteAuditContent): string {
  const lines: string[] = [];
  const c = audit.confidence;
  if (c) {
    lines.push(`> **Confidence: ${c.level}.** ${c.note}`, ``);
  }
  const partial = c && c.coverage < 0.85;
  lines.push(`## Scorecard (${audit.scores.length ? `overall ${audit.overall}/100${partial ? `, partial: ${Math.round(c.coverage * 100)}% of the rubric observed` : ''}` : 'no score: nothing could be observed'})`);
  if (audit.criteria?.length) {
    for (const k of audit.criteria) {
      lines.push(`- **${k.label}** (${k.weight}%) — ${k.score === null ? 'not observable' : `${k.score}/10`}. ${k.verdict}`);
    }
  } else {
    lines.push(...audit.scores.map((x) => `- **${x.area.replace(/_/g, ' ')}** — ${x.score}/10. ${x.verdict}`));
  }
  if (audit.checklist?.length) {
    lines.push(``, `## Checklist`);
    for (const k of audit.checklist) lines.push(`- [${k.status === 'pass' ? 'x' : ' '}] ${k.label}${k.status === 'unknown' ? ' (not observable)' : ''} — ${k.detail}`);
  }
  const quoted = (f: SiteAuditFinding): string => (f.quote ? ` > "${f.quote}"` : '');
  lines.push(``, `## What's working`, ...audit.working.map((f) => `- **${f.title}** — ${f.detail}${quoted(f)}`));
  lines.push(``, `## What's missing`, ...audit.missing.map((f) => `- **${f.title}** — ${f.detail}${f.impact ? ` _Impact: ${f.impact}_` : ''}${quoted(f)}`));
  if (audit.fixes?.length) {
    lines.push(``, `## Fixes, by impact`, ...audit.fixes.map((f, i) => `${i + 1}. **${f.title}** — ${f.detail} _(impact ${f.impact}, effort ${f.effort})_`));
  }
  lines.push(``, `## Design style`, audit.designStyle.summary, ...audit.designStyle.notes.map((n) => `- ${n}`));
  lines.push(``, `## Test first`, ...audit.testFirst.map((f, i) => `${i + 1}. **${f.title}** — ${f.detail}`));
  return lines.join('\n');
}
