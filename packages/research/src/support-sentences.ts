import type { ProviderGrounding } from './types';
import { normalizedName } from './registries/shared';

/**
 * Sentence ends for claim checks. A period followed by a space ends a sentence,
 * with ONE exception: a company's legal form ("Co.", "Inc.", "Corp.", "Ltd.")
 * followed by a lower-case word is the middle of a sentence ("Lyre's Spirit Co.
 * operates ..."). A capital after the abbreviation, or any other abbreviation,
 * still splits: merging two sentences would let one sentence's company vouch for
 * another sentence's claim, which is the failure this guards against.
 *
 * (An earlier version tried to exclude abbreviations with a look-behind that left
 * out the period, so it never matched and every "Co." cut its sentence in two.
 * Fixing that by also excluding initials and "St."/"Dr." over-merged instead.)
 */
export const SENTENCE_END = /(?<=[.!?])\s+(?!(?<=\b(?:Inc|Corp|Ltd|Co)\.\s+)[a-z])|\n+/u;

/** Words in a sentence that retract, date or hedge a claim: a clause is never lifted out of such a sentence. */
const RETRACTS = /\b(?:former(?:ly)?|ex|ended|terminat\w*|no longer|not|never|stopped|dropped|exited|resign\w*|depart\w*|left|discontinu\w*|retir\w*|rumou?r\w*|reportedly|considering|will|would|plans?)\b/i;

function occurrences(text: string, fragment: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(fragment); at >= 0; at = text.indexOf(fragment, at + 1)) found.push(at);
  return found;
}

/** Google reports offsets in UTF-8 bytes; the answer text is indexed in characters. */
function charIndexOfByteOffset(text: string, byteOffset: number): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes === byteOffset) return i;
    const code = text.codePointAt(i)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (code >= 0x10000) i += 1;
  }
  return bytes === byteOffset ? text.length : -1;
}

/**
 * Where a support's clause really sits in the answer. Provider offsets win when
 * they validate (as characters or as UTF-8 bytes); otherwise the clause must occur
 * exactly once. A clause that repeats ("operates the Widget" for two companies)
 * with no offset to tell them apart is not located at all.
 */
function locate(answerText: string, clause: string, startIndex: number | undefined): number {
  const starts = occurrences(answerText, clause);
  if (starts.length === 0) return -1;
  if (startIndex !== undefined) {
    if (starts.includes(startIndex)) return startIndex;
    const asChars = charIndexOfByteOffset(answerText, startIndex);
    if (asChars >= 0 && starts.includes(asChars)) return asChars;
  }
  return starts.length === 1 ? starts[0]! : -1;
}

/** The text before a clause is only the company's own name: "Acme ", "Lyre's Spirit Co. ", "Acme's ". */
function isSubjectOnly(prefix: string, aliases: readonly string[]): boolean {
  const name = normalizedName(prefix);
  const bare = name.endsWith(' s') ? name.slice(0, -2) : name;
  return name !== '' && aliases.some((alias) => alias === name || alias === bare);
}

/**
 * Give a clause-only support its subject.
 *
 * Google marks only the clause it can attribute and routinely leaves the
 * sentence's subject outside the span: "Lyre's Spirit Co. operates the Bourbon
 * Alternative as its product." arrives as a support reading "operates the
 * Bourbon Alternative as its product". The product and team gates need the
 * company named in the supporting sentence, so they dropped every such claim.
 *
 * The clause is extended to the left, and only by the company's own name.
 * Anything else in front of it ("Globex, a supplier to Acme, makes ...", "Bob
 * Stone, who left Acme, is ...", "Acme formerly sold ...") leaves the support as
 * it was, as does a sentence whose remainder retracts or hedges the claim ("... but
 * the partnership ended"). The result is verbatim answer text; provider
 * attribution still covers the clause it covered before.
 */
export function widenSupportsToSentences(grounding: ProviderGrounding, aliases: readonly string[]): ProviderGrounding {
  if (aliases.length === 0) return grounding;
  const answer = grounding.answerText;
  return {
    ...grounding,
    supports: grounding.supports.map((support) => {
      const clause = support.text;
      const at = locate(answer, clause, support.startIndex);
      if (at < 0) return support;
      // The sentence the clause opens in: from the last sentence end on its line, up to the clause.
      // (The clause's first character stays in the region so a lower-case start can keep "Co." attached.)
      const lineStart = answer.lastIndexOf('\n', at - 1) + 1;
      const pieces = answer.slice(lineStart, at + 1).split(SENTENCE_END);
      const leading = pieces[pieces.length - 1]!;
      const prefix = leading.slice(0, leading.length - 1);
      if (!prefix.trim() || !isSubjectOnly(prefix, aliases)) return support;
      const lineEnd = answer.indexOf('\n', at + clause.length);
      const tail = answer.slice(at + clause.length, lineEnd < 0 ? answer.length : lineEnd).split(SENTENCE_END)[0] ?? '';
      if (RETRACTS.test(`${prefix} ${tail}`)) return support;
      const from = at - prefix.length + (prefix.length - prefix.trimStart().length);
      // When the clause is the whole rest of the sentence, its closing punctuation belongs to it ("... as its product.").
      const closing = /^[.!?]+$/.test(tail) ? tail : '';
      const end = at + clause.length + closing.length;
      return { ...support, text: answer.slice(from, end), startIndex: from, endIndex: end };
    }),
  };
}
