/**
 * Sources for a claim, from the search engine's own attribution.
 *
 * A grounded answer comes with "supports": a sentence of the answer and the sources the search attributes it to. The
 * structuring step that turns the answer into cards is asked for a source number per card, and on live decks it often
 * answered null for every card (seven barriers, seven nulls), so a market with plenty of sourced material ended with
 * one card or none. The sources the engine itself attached to the answer's sentences were right there.
 *
 * A card's sources are therefore also looked up from those supports: a support counts when most of its distinctive words
 * are in the claim (a claim is built from the answer's own sentences, so its words are theirs), with at least three of
 * them shared. The model never writes a source here, and a claim no support backs still has none and is dropped.
 */
import { usableCitations, type Citation } from '@mi/contracts';
import type { ProviderGrounding } from './types';

const STOP_WORDS = new Set([
  'about', 'after', 'also', 'among', 'been', 'being', 'between', 'both', 'could', 'during', 'each', 'from', 'have', 'into', 'more',
  'most', 'other', 'over', 'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
  'under', 'were', 'what', 'when', 'where', 'which', 'while', 'will', 'with', 'would', 'your', 'market', 'markets',
]);

const wordsOf = (text: string): Set<string> => new Set(
  text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9%$.]+/g, ' ').split(/\s+/)
    .map((word) => word.replace(/^[.$]+|[.]+$/g, ''))
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word)),
);

/** Fewest distinctive words a support needs before it can back anything: a short fragment matches by chance. */
const SUPPORT_WORDS_MIN = 5;
const SHARED_WORDS_MIN = 3;
const SHARE_OF_SUPPORT_MIN = 0.6;

/** The sources the search attributed to the answer's sentences that this claim is built from; empty when none fits. */
export function claimSupportCitations(claim: string, grounding: ProviderGrounding | undefined, max = 2): Citation[] {
  if (!grounding || grounding.supports.length === 0) return [];
  const claimWords = wordsOf(claim);
  if (claimWords.size < SHARED_WORDS_MIN) return [];
  const scored: Array<{ ratio: number; shared: number; citations: Citation[] }> = [];
  for (const support of grounding.supports) {
    const words = wordsOf(support.text);
    if (words.size < SUPPORT_WORDS_MIN) continue;
    const shared = [...words].filter((word) => claimWords.has(word)).length;
    const ratio = shared / words.size;
    if (shared >= SHARED_WORDS_MIN && ratio >= SHARE_OF_SUPPORT_MIN) {
      scored.push({ ratio, shared, citations: support.sources.map((source) => ({ title: source.title, url: source.url })) });
    }
  }
  scored.sort((a, b) => b.ratio - a.ratio || b.shared - a.shared);
  return usableCitations(scored.slice(0, max).flatMap((entry) => entry.citations));
}
