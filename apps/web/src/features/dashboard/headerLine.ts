/**
 * The company header's description is one short line. The stored one-liner can be a full 240-character sentence, so it is
 * cut at display time: the first sentence, then at the last natural break (comma, dash, semicolon, "that/which/focused on")
 * that fits, then at a word, ending in an ellipsis only when something was dropped. The producer cannot shorten it, since
 * it must stay a literal sentence from an official page.
 */
export const HEADER_LINE_MAX = 96;

export function headerLine(text: string | null | undefined, max = HEADER_LINE_MAX): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const firstSentence = clean.match(/^.+?[.!?](?=\s+[A-Z“"']|$)/)?.[0] ?? clean;
  const sentence = firstSentence.replace(/[.!?]$/, '');
  if (sentence.length <= max) return sentence;
  const window = sentence.slice(0, max);
  const breaks = [...window.matchAll(/[,;:—–]| - | (?:that|which|focused on|with|using|for) /g)];
  const cut = breaks.length > 0 ? breaks[breaks.length - 1]!.index! : -1;
  if (cut >= 36) return `${window.slice(0, cut).trimEnd()}…`;
  const word = window.lastIndexOf(' ');
  return `${window.slice(0, word > 36 ? word : max).trimEnd()}…`;
}
