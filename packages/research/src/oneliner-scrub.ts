/**
 * Deterministic scrubber for MODEL-written company one-liners (discovery
 * descriptors and enrichment copy). A model describes companies the way their
 * press pages do: "a pioneering creator", "a global category leader". None of
 * that is sourced, so it is removed or the sentence is rejected. Never adds a
 * fact: it only deletes words, re-conjugates one verb, or drops a sentence.
 */

const MODIFIERS = [
  'world[- ]leading', 'world[- ]class', 'world[- ]renowned', 'world[- ]famous', 'market[- ]leading', 'industry[- ]leading',
  'category[- ]leading', 'best[- ]in[- ]class', 'top[- ]tier', 'top[- ]rated', 'top[- ]selling', 'best[- ]selling',
  'cutting[- ]edge', 'leading[- ]edge', 'state[- ]of[- ]the[- ]art', 'next[- ]generation', 'game[- ]changing',
  'technology[- ]driven', 'innovation[- ]driven', 'award[- ]winning', 'fastest[- ]growing', 'fast[- ]growing', 'rapidly[- ]growing',
  'well[- ]known', 'well[- ]established', 'pioneering', 'dominant', 'leading', 'premier', 'foremost', 'top', 'best',
  'innovative', 'revolutionary', 'comprehensive', 'high[- ]end', 'renowned', 'iconic', 'trusted', 'visionary', 'disruptive',
  'unrivall?ed', 'unparalleled', 'unmatched', 'preeminent', 'prominent', 'acclaimed', 'celebrated', 'famed', 'legendary',
  'sophisticated', 'dynamic', 'passionate', 'global', 'worldwide', 'full[- ]service', 'end[- ]to[- ]end',
  'category', 'largest', 'biggest',
];
const MOD = `(?:${MODIFIERS.join('|')})`;
const MOD_RUN = new RegExp(`\\b${MOD}(?:\\s*,\\s*|\\s+and\\s+|\\s+)(?=[\\p{L}])`, 'giu');
const SUPERLATIVE = '(?:world[- ]leading|market[- ]leading|industry[- ]leading|leading|largest|biggest|top|best|foremost|premier|dominant|preeminent)';
// "the leading X", "the world's largest X", "one of the top X": a uniqueness or
// rank claim that deleting one word would only turn into a different claim.
const RANK_CLAIM = new RegExp(
  `\\bthe\\s+(?:\\p{L}+['’]s\\s+)?${SUPERLATIVE}\\b|\\b\\p{L}+['’]s\\s+${SUPERLATIVE}\\b|\\bone of the\\b[^.]*?\\b${SUPERLATIVE}\\b|\\b(?:ranked|ranking)\\b|#\\s?1\\b|\\bnumber[- ]one\\b`, 'iu');
// Nouns that are themselves the boast once their adjectives are gone.
const BOAST_NOUN = /\b(?:leaders?|pioneers?|innovators?|powerhouses?|giants?|authorit(?:y|ies)|trailblazers?|titans?|champions?|juggernauts?|frontrunners?|disruptors?|visionar(?:y|ies))\b/i;
const ING_TO_S: Record<string, string> = {
  manufacturing: 'manufactures', producing: 'produces', providing: 'provides', developing: 'develops', making: 'makes',
  offering: 'offers', building: 'builds', creating: 'creates', designing: 'designs', delivering: 'delivers',
  operating: 'operates', supplying: 'supplies', distributing: 'distributes', selling: 'sells', brewing: 'brews',
  distilling: 'distills', crafting: 'crafts', serving: 'serves',
};
const LEADER_VERB = new RegExp(
  `\\b(?:is|are)\\s+(?:an?|the)\\s+(?:[\\p{L}'’-]+\\s+){0,3}?(?:leaders?|pioneers?|innovators?|giants?|powerhouses?)\\s+(${Object.keys(ING_TO_S).join('|')})\\b`, 'iu');

const LOCATION_TAIL = /^[\p{L}\p{N} ,'’.&-]+$/u;
const DESCRIBES = /\b(?:and|that|which|where|with|making|producing|manufactur\w*|develop\w*|provid\w*|offer\w*|sell\w*|brew\w*|distill\w*)\b/i;
const LOCATION_ONLY_HEAD = /^.{1,100}?\b(?:is|are|was|were)\s+(?:an?\s+[\p{L}\p{N} .&'’-]{0,30}?\s)?(?:headquartered|based|located|founded|established|incorporated|registered)\s+(?:in|at|on)\s+(.+?)\.?$/iu;
const BASED_COMPANY = /^.{1,100}?\b(?:is|are)\s+an?\s+(?:private\s+|public\s+)?(?:[\p{L}. -]{1,40}[- ]based\s+)?(?:company|firm|business|corporation|organi[sz]ation)\.?$/iu;

/** A sentence that states only where the company is or when it began. */
export function isContentFreeOneLiner(sentence: string): boolean {
  const text = sentence.trim();
  if (BASED_COMPANY.test(text)) return true;
  const match = LOCATION_ONLY_HEAD.exec(text);
  return !!match && LOCATION_TAIL.test(match[1]!) && !DESCRIBES.test(match[1]!);
}

function sentencesOf(text: string): string[] {
  const protectedText = text.replace(/\b(Inc|Ltd|Corp|Co|Cos|Bros|U\.S|St|Mt|e\.g|i\.e)\.(?=\s)/gi, '$1<PERIOD>');
  return (protectedText.match(/[^.!?]+(?:[.!?]+|$)/g) ?? []).map(s => s.replace(/<PERIOD>/g, '.').trim()).filter(Boolean);
}

function fixArticles(text: string): string {
  return text.replace(/\b(a|an)\s+(?=\p{L})/giu, (match, article: string, offset: number, whole: string) => {
    const word = /^\p{L}+/u.exec(whole.slice(offset + match.length))?.[0] ?? '';
    const vowel = /^(?:[aeiou]|hour|honest|heir)/i.test(word) && !/^(?:uni(?!versi)|use|usu|eu|one)/i.test(word);
    const wanted = vowel ? 'an' : 'a';
    return `${article[0] === article[0]!.toUpperCase() ? wanted[0]!.toUpperCase() + wanted.slice(1) : wanted} `;
  });
}

function scrubSentence(sentence: string): string | null {
  if (RANK_CLAIM.test(sentence)) return null;
  let text = sentence;
  const leader = LEADER_VERB.exec(text);
  if (leader) text = text.replace(LEADER_VERB, ING_TO_S[leader[1]!.toLowerCase()]!);
  let previous: string;
  do { previous = text; text = text.replace(MOD_RUN, ''); } while (text !== previous);
  text = fixArticles(text).replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/,\s*,/g, ',').trim();
  // The boast survives as a noun ("...craft beverage pioneer scaling..."), or a
  // modifier was the whole predicate ("is innovative."): not salvageable.
  if (BOAST_NOUN.test(text)) return null;
  if (/\b(?:is|are|an?|the|of|for|in)\s*[.,;!?]|\b(?:is|are)\s+(?:and|or)\b/i.test(text)) return null;
  if (!/^[\p{Lu}\p{N}“‘"'(]/u.test(text) || text.length < 20) return null;
  return text;
}

/**
 * A model-written one-liner with its unverifiable evaluative wording removed,
 * or null when nothing plain and descriptive is left (every sentence boasted,
 * or only said where the company is). Idempotent: scrub(scrub(x)) === scrub(x).
 */
export function scrubOneLiner(text: string | null | undefined): string | null {
  const kept = sentencesOf(text ?? '').map(scrubSentence)
    .filter((s): s is string => !!s && !isContentFreeOneLiner(s));
  const joined = kept.join(' ').trim();
  return joined || null;
}
