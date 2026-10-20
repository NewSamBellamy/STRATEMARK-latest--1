/**
 * Risk (vice) and culture cards for the companies a deck already holds.
 *
 * Barrier and insight cards come from one market-level search (signal-agents). Vice and culture cards used to
 * come only from discovery tagging a company as "known for a controversy" or "known for its culture", and the
 * passes that look for those were switched off for any market whose words include "infrastructure" or "B2B"
 * (the Meal Kit market's cold-chain theme was enough). Four live decks in a row came out with none, and a deck
 * with no vice or culture card reads as unfinished.
 *
 * This is the second way in: ONE grounded search, asked about the deck's own companies by name, for a documented
 * controversy and for what a company's culture stands for. Nothing is invented and nothing is attributed on a guess:
 *   - the company the answer names must be exactly one company of the deck, by its own name (not a longer name
 *     that merely contains it: "Check Point Software" is not "Check");
 *   - the sentence must name that company near its start, and no other company of the deck in any case or form
 *     (a sentence about a rival is not a claim about this one);
 *   - it must carry a clickable source from the search itself, and that source must be attached to sentences of the
 *     answer that are about this company and say the same thing, or it is dropped.
 * A market with nothing documented gets no card, and says so; it is never padded.
 */
import { z } from 'zod';
import type { CardWithCompany, Citation, Company } from '@mi/contracts';
import { claimSupportCitations, resolveClaimCitations, sourceBacksClaim } from './claim-support';
import { companyAliases } from './company-aliases';
import { companyNameKey } from './market-quote';
import { GROUNDED_SYSTEM, STRUCTURE_SYSTEM } from './prompts';
import {
  MAX_CLAIMS_PER_COMPANY, SENTENCE_MIN, aboutCompany, acceptedRiskClaim, claimKey, noteSentences, scopeFor, sourceIsFit,
} from './risk-claims';
import { namesRosterRival } from './reported-metrics';
import { createCultureCard, createViceCard, extractSourcedViceClaims, type RawViceClaimInput } from './signal-agents';
import type { LlmClient, MarketPlan } from './types';
import { throwIfAborted } from './util';

const rosterSignalsOutSchema = z.object({
  risks: z.array(z.object({
    company: z.string().min(1),
    text: z.string().min(1),
    sourceIndex: z.number().int().nullable().default(null),
  })).default([]),
  culture: z.array(z.object({
    company: z.string().min(1),
    note: z.string().min(1),
    sourceIndex: z.number().int().nullable().default(null),
  })).default([]),
});

export { aboutCompany };

export interface RosterSignalsOptions {
  signal?: AbortSignal;
  /** Which kinds are wanted: a deck that already has enough of one does not pay to search for it. */
  want?: { vice: boolean; culture: boolean };
  /** Companies that already have this kind of card (never a second one for the same company). */
  haveVice?: ReadonlySet<string>;
  haveCulture?: ReadonlySet<string>;
  /** Most cards of each kind one search may add. */
  maxVice?: number;
  maxCulture?: number;
}

/** The most companies one question names; a longer list dilutes the search. */
const ROSTER_LIMIT = 20;
const NOTE_MAX = 320;

export function rosterSignalsPrompt(plan: MarketPlan, roster: readonly Pick<Company, 'name'>[], want: { vice: boolean; culture: boolean }): string {
  const where = plan.geography ? ` in ${plan.geography}` : '';
  const names = roster.slice(0, ROSTER_LIMIT).map((company) => `- ${JSON.stringify(company.name)}`).join('\n');
  const lines = [
    `Using Google Search, look for documented controversies and culture signals about companies in the market "${plan.marketName}" (${plan.vertical})${where}.`,
    '',
    'Companies (use these exact names):',
    names,
    '',
  ];
  if (want.vice) {
    lines.push('RISKS: for as many of these companies as have one (aim for at least 4), find a documented controversy: a lawsuit, regulatory action, fine, recall, data breach, labour dispute, misleading-practice ruling, or investigative report. Write each as one plain sentence that begins with the company, says what happened and when, and names no other company. Skip a company with nothing credible.', '');
  }
  if (want.culture) {
    lines.push('CULTURE: for as many of these companies as have one (aim for at least 4), find what its culture or community stands for according to its sources: stated mission and values, employee-reported culture, customer community, public stands, certified-company status. Write each as one plain sentence that begins with the company and names no other company. Skip a company with nothing credible.', '');
  }
  lines.push('Ground every point in what you actually find. Never speculate, and never pad the list: if a company has nothing credible, leave it out.');
  return lines.join('\n');
}

/**
 * The sentences a culture note opens with, cut at a sentence end; null when it is too short or when its first sentence
 * alone does not fit (a decimal or "U.S." is not a sentence end, so a long note is never cut mid-sentence).
 */
function cultureNote(raw: string): string | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length < SENTENCE_MIN) return null;
  if (text.length <= NOTE_MAX) return text;
  let out = '';
  for (const sentence of noteSentences(text)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > NOTE_MAX) break;
    out = next;
  }
  return out.length >= SENTENCE_MIN ? out : null;
}

/**
 * The one deck company a name in the answer means; null when it means none or more than one. A name matches by the
 * company's own name or one of its aliases, exactly: a longer name that merely contains a company's name ("Check Point
 * Software" for "Check", "Merge Labs" for "Merge", "Square Enix" for "Square") is a different company.
 */
export function companyNamed(name: string, roster: readonly Company[]): Company | null {
  const asked = companyNameKey(name.replace(/\([^)]*\)/g, ' '));
  if (!asked) return null;
  const exact = roster.filter((company) => companyNameKey(company.name.replace(/\([^)]*\)/g, ' ')) === asked);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const aliased = roster.filter((company) => companyAliases(company.name, company.websiteUrl).some((alias) => companyNameKey(alias) === asked));
  return aliased.length === 1 ? aliased[0]! : null;
}

export async function researchRosterSignals(
  client: LlmClient,
  plan: MarketPlan,
  deckId: string,
  roster: readonly Company[],
  options: RosterSignalsOptions = {},
): Promise<{ vice: CardWithCompany[]; culture: CardWithCompany[] }> {
  throwIfAborted(options.signal);
  const want = options.want ?? { vice: true, culture: true };
  const empty = { vice: [] as CardWithCompany[], culture: [] as CardWithCompany[] };
  if ((!want.vice && !want.culture) || roster.length === 0) return empty;

  const names = roster.map((company) => company.name);
  const grounded = await client.ground(rosterSignalsPrompt(plan, roster, want), {
    system: GROUNDED_SYSTEM, label: 'signal:roster', signal: options.signal,
  });
  const sources = grounded.citations.map((c, i) => `[${i}] ${c.title} — ${c.url}`).join('\n') || '(none)';
  const out = await client.structure(
    [
      'From the notes, output JSON { "risks": [ { "company", "text", "sourceIndex" } ], "culture": [ { "company", "note", "sourceIndex" } ] }.',
      '"company" is the exact name from the list the notes were asked about. "text" and "note" are one plain sentence taken from the notes that names the company and no other company.',
      '"sourceIndex" is the 0-based index of the source that supports it, or null if none of the listed sources do.',
      'If the notes do not support an item, leave it out rather than inventing it. Return nothing for a company the notes say nothing about.',
      '',
      'SOURCES:',
      sources,
      '',
      'NOTES:',
      grounded.text,
    ].join('\n'),
    rosterSignalsOutSchema,
    { system: STRUCTURE_SYSTEM, signal: options.signal },
  );

  const citations = grounded.citations;
  const vice: CardWithCompany[] = [];
  const culture: CardWithCompany[] = [];

  if (want.vice) {
    const byCompany = new Map<string, { company: Company; raw: RawViceClaimInput[] }>();
    for (const risk of out.risks) {
      const company = companyNamed(risk.company, roster);
      if (!company || options.haveVice?.has(company.id)) continue;
      // The same rule the company's own search applies (risk-claims): one sentence about this company, one fit source the
      // search itself attributed to a sentence that reads the event. A risk is never filed on a source that cannot be checked.
      const accepted = acceptedRiskClaim(risk, company, roster, { citations, grounding: grounded.grounding });
      if (!accepted) continue;
      const entry = byCompany.get(company.id) ?? { company, raw: [] };
      if (entry.raw.length < MAX_CLAIMS_PER_COMPANY && !entry.raw.some((r) => claimKey(r.text) === claimKey(accepted.text))) entry.raw.push(accepted);
      byCompany.set(company.id, entry);
    }
    for (const { company, raw } of byCompany.values()) {
      if (vice.length >= (options.maxVice ?? 8)) break;
      const claims = extractSourcedViceClaims(raw, company.id);
      if (claims.length > 0) vice.push(createViceCard(company, claims, deckId));
    }
  }

  if (want.culture) {
    const seen = new Set<string>();
    for (const item of out.culture) {
      if (culture.length >= (options.maxCulture ?? 8)) break;
      const company = companyNamed(item.company, roster);
      if (!company || seen.has(company.id) || options.haveCulture?.has(company.id)) continue;
      const whole = cultureNote(item.note);
      if (!whole || !aboutCompany(whole, company, roster)) continue;
      if (namesRosterRival(whole, company.name, names)) continue;
      const scope = scopeFor(company, roster, false);
      // Each sentence of the note needs its own backing: the ones nothing backs are left out, never carried along on the
      // source of the one that is.
      const kept: string[] = [];
      const cited: Citation[] = [];
      for (const part of noteSentences(whole)) {
        const named = resolveClaimCitations(item.sourceIndex, null, citations)
          .filter((c) => sourceIsFit(c, company, roster, false) && sourceBacksClaim(c.url, part, grounded.grounding, scope));
        const found = named.length > 0 ? named : claimSupportCitations(part, grounded.grounding, 2, scope).filter((c) => sourceIsFit(c, company, roster, false));
        if (found.length === 0) continue;
        kept.push(part);
        for (const c of found) if (!cited.some((have) => have.url === c.url)) cited.push(c);
      }
      const note = kept.join(' ');
      if (kept.length === 0 || note.length < SENTENCE_MIN || !aboutCompany(note, company, roster)) continue;
      seen.add(company.id);
      culture.push(createCultureCard(company, note, cited.slice(0, 2), deckId));
    }
  }
  return { vice, culture };
}
