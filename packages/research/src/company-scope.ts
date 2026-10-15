/**
 * Which companies a market plan may name as the user's own.
 *
 * The scope step asks the model for `companyScope.names` and tells it to list
 * only companies the USER named. A model working from search notes does not
 * always obey: for "Specialty coffee roasters" it returned twenty names (Starbucks,
 * McDonald's, Nestlé ...) lifted from the notes, and those became priority
 * anchors for the whole deck. The instruction is enforced here instead of
 * trusted: a name stays only if the user's own request contains it.
 */

const LEGAL_WORDS = new Set([
  'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'llc', 'plc', 'sa', 'nv', 'ag', 'gmbh', 'lp', 'llp', 'pbc', 'the',
]);

const fold = (text: string): string[] =>
  text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.'’]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/** The distinguishing words of a company name: legal suffixes and a leading "the" removed. */
function coreWords(name: string): string[] {
  const words = fold(name).filter((word) => !LEGAL_WORDS.has(word));
  return words.length ? words : fold(name);
}

/**
 * True when the name's opening words occur in `request` consecutively, as whole words.
 * Two words are enough ("Pilot Coffee" for "Pilot Coffee Roasters"): users type the
 * short form and models expand it. Precision beats recall here: a dropped anchor only
 * costs a nudge, while a kept invented one skews the whole deck.
 */
function mentions(request: string[], fullCore: string[]): boolean {
  const core = fullCore.slice(0, 2);
  if (core.length === 0 || core.length > request.length) return false;
  for (let start = 0; start + core.length <= request.length; start += 1) {
    if (core.every((word, offset) => request[start + offset] === word)) return true;
  }
  return false;
}

/** Keep only the proposed names that the user's own request contains. Order and spelling of the proposals are kept. */
export function namesFromRequest(proposed: readonly string[], request: string): string[] {
  const words = fold(request);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of proposed) {
    const name = raw.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    if (mentions(words, coreWords(name))) kept.push(name);
  }
  return kept;
}
