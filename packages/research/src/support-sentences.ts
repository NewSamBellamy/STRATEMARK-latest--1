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

/** Words that retract, date or hedge a claim. A clause is never lifted out of a sentence that contains one. */
const RETRACTS = /\b(?:former(?:ly)?|previously|used to|no longer|never|not|until|ended|terminat\w*|stopped|ceased|dropped|exited|divested|resign\w*|departed|departing|departs|retire[sd]?|retiring|discontinu\w*|cancell?ed|rumou?r\w*|reportedly|considering|planned|planning|plans? to)\b|n['’]t\b|\bex-/i;
/** Hedges that are only hedges in lower case: "Will" and "Left Hand" are names. */
const HEDGES = /\b(?:will|would|may|might|left)\b/;

/**
 * A clause is only given a subject when it opens with a predicate: an
 * ownership, offering or role verb. "supplier Globex makes ...", "growers like
 * Globex sell ..." or "ex-Chief Executive ..." continue the NAME in front of them
 * rather than say something about it, and are left exactly as Google gave them.
 */
const PREDICATE_START = /^(?:currently\s+|also\s+)?(?:operat\w*|offer\w*|mak(?:es?|ing)|made|sell\w*|sold|produc\w*|provid\w*|launch\w*|releas\w*|introduc\w*|unveil\w*|build\w*|built|creat\w*|own\w*|market\w*|manufactur\w*|distribut\w*|brew\w*|develop\w*|ship\w*|is|are|was|were|has|have|serves?|serving|appointed|named|lead\w*|head\w*|chair\w*|found\w*|co-found\w*|join\w*)\b/i;

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
 * Where a support's clause really sits in the answer. A provider offset is trusted
 * when it validates as a character index or as a UTF-8 byte offset, but not when the
 * two readings validate to DIFFERENT occurrences; with no usable offset the clause
 * must occur exactly once. A clause that repeats ("operates the Widget" for two
 * companies) and cannot be told apart is not located at all.
 */
function locate(answerText: string, clause: string, startIndex: number | undefined): number {
  const starts = occurrences(answerText, clause);
  if (starts.length === 0) return -1;
  if (startIndex !== undefined) {
    const asChar = starts.includes(startIndex) ? startIndex : -1;
    const bytes = charIndexOfByteOffset(answerText, startIndex);
    const asByte = bytes >= 0 && starts.includes(bytes) ? bytes : -1;
    if (asChar >= 0 && asByte >= 0 && asChar !== asByte) return -1;
    if (asChar >= 0 || asByte >= 0) return Math.max(asChar, asByte);
  }
  return starts.length === 1 ? starts[0]! : -1;
}

/**
 * The text before a clause is only the company's own name ("Acme ", "Lyre's Spirit
 * Co. ", "Acme's "): name characters only, ending in a space. A hyphen or bracket
 * at the end ("Meta-", "Acme (acme.com) ") means the name continues or is qualified.
 */
function isSubjectOnly(prefix: string, aliases: readonly string[]): boolean {
  if (!/\s$/.test(prefix) || !/^[\p{L}\p{N}\s.,'’&-]+$/u.test(prefix)) return false;
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
 * The clause is extended to the left, and only by the company's own name, and only
 * when the clause opens with a predicate verb. Anything else in front of it ("Globex,
 * a supplier to Acme, makes ...", "Acme's supplier Globex makes ...", "Acme
 * formerly sold ...") leaves the support as it was, as does a sentence that
 * retracts or hedges the claim anywhere ("Acme no longer sells ...", "... but the
 * partnership ended"). The result is verbatim answer text; provider attribution
 * still covers the clause it covered before. A person's name is never lent this
 * way: who the person is has to sit inside the attributed span.
 */
export function widenSupportsToSentences(grounding: ProviderGrounding, aliases: readonly string[]): ProviderGrounding {
  if (aliases.length === 0) return grounding;
  const answer = grounding.answerText;
  return {
    ...grounding,
    supports: grounding.supports.map((support) => {
      const clause = support.text;
      if (!PREDICATE_START.test(clause)) return support;
      const at = locate(answer, clause, support.startIndex);
      if (at < 0) return support;
      // The sentence the clause opens in: from the last sentence end on its line, up to the clause.
      // (The clause's first character stays in the region so a lower-case start can keep "Co." attached.)
      const lineStart = answer.lastIndexOf('\n', at - 1) + 1;
      const pieces = answer.slice(lineStart, at + 1).split(SENTENCE_END);
      const leading = pieces[pieces.length - 1]!;
      const prefix = leading.slice(0, leading.length - 1);
      if (!prefix.trim() || !isSubjectOnly(prefix, aliases)) return support;
      // What follows the clause in its sentence. A clause that already ends the sentence has no tail:
      // whatever comes next is another sentence.
      const lineEnd = answer.indexOf('\n', at + clause.length);
      const rest = answer.slice(at + clause.length, lineEnd < 0 ? answer.length : lineEnd);
      const tail = /[.!?]$/.test(clause) ? '' : (rest.split(SENTENCE_END)[0] ?? '');
      const whole = `${prefix} ${clause} ${tail}`;
      if (RETRACTS.test(whole) || HEDGES.test(whole)) return support;
      const from = at - prefix.length + (prefix.length - prefix.trimStart().length);
      // When the clause is the whole rest of the sentence, its closing punctuation belongs to it ("... as its product.").
      const closing = /^[.!?]+$/.test(tail) ? tail : '';
      const end = at + clause.length + closing.length;
      return { ...support, text: answer.slice(from, end), startIndex: from, endIndex: end };
    }),
  };
}
