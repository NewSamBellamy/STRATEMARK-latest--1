/**
 * Markdown that cannot freeze a tab.
 *
 * The markdown parser behind every research screen (react-markdown with remark-gfm) is fine on prose and slow on
 * a hostile string: repeated unmatched `*a`, `~~a`, `[a](b` or table rows cost time that grows with the square of
 * the text (measured on this renderer: 6,000 characters of `*a` take about 0.25 s, 12,000 take about 2 s, and 160,000
 * never finish), and a long run of nested `> ` or `- ` markers overflows the stack. A share link can carry that
 * text, so nothing here hands the parser more than a few thousand characters in one piece.
 *
 * Honest research prose is a few thousand characters (the longest overview in the real sample deck is 3,400). So:
 *   - text up to {@link MARKDOWN_CHUNK_CAP} characters, and not nested past reason, is parsed exactly as before;
 *   - longer text is cut at its blank lines and parsed in pieces of at most that size, until a budget of parsed
 *     characters is spent (an honest 19,000-character report stays formatted);
 *   - whatever is not parsed (one piece that is too long to parse safely, or text past the budget) is shown as plain
 *     paragraphs: split on blank lines, text only, no parsing, and itself bounded, so the tail of an enormous string
 *     is dropped rather than turned into a hundred thousand elements.
 */

/** The most characters handed to the parser as one piece. Worst measured pattern at this size: about 0.25 s. */
export const MARKDOWN_CHUNK_CAP = 5_000;

/** Parsed characters allowed in one render of trusted text (the app's own research): honest text never reaches it. */
export const MARKDOWN_TRUSTED_BUDGET = 24_000;

/** The most plain text, and the most paragraphs, one render will show; the tail of anything longer is dropped. */
export const PLAIN_MAX_CHARS = 60_000;
export const PLAIN_MAX_PARAGRAPHS = 300;

/** Text past this is never read: nothing honest is this long, and scanning it would be work for nothing. */
const SCAN_MAX_CHARS = 250_000;

export type MarkdownPart = { plain: false; text: string } | { plain: true; paragraphs: string[] };

/** A line that opens sixteen block containers in a row (`> > > ...`, `- - - ...`) is nesting no honest text has. */
const DEEP_NESTING = /^(?:[ \t]*(?:>|[-*+]|\d{1,9}[.)])(?=[ \t>]|$)){16}/m;

export function nestsTooDeep(text: string): boolean {
  return DEEP_NESTING.test(text);
}

/** Blank-line separated blocks, never cutting inside a fenced code block. */
function blocksOf(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (fence === null) fence = marker[0]!;
      else if (marker[0] === fence) fence = null;
    }
    if (fence === null && !marker && line.trim() === '') {
      if (current.length) blocks.push(current.join('\n'));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join('\n'));
  return blocks;
}

/** Text as paragraphs, nothing parsed. */
export function plainParagraphs(text: string): string[] {
  return text.split(/\r?\n[ \t]*\r?\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

/**
 * How to show `text`: the pieces to parse as markdown and the pieces to show as plain paragraphs, in reading order.
 * `budget` is how many characters may be parsed in all; a budget no larger than one piece means all or nothing.
 */
export function planMarkdown(text: string, options: { chunk?: number; budget?: number } = {}): MarkdownPart[] {
  const chunk = options.chunk ?? MARKDOWN_CHUNK_CAP;
  const budget = options.budget ?? chunk;
  const source = text.length > SCAN_MAX_CHARS ? text.slice(0, SCAN_MAX_CHARS) : text;
  if (source.length <= chunk && !nestsTooDeep(source)) return [{ plain: false, text: source }];

  const parts: MarkdownPart[] = [];
  let plainChars = 0;
  let plainParagraphCount = 0;
  let parsed = 0;
  let pending = '';
  const flush = () => {
    if (pending) parts.push({ plain: false, text: pending });
    pending = '';
  };
  /** False once the plain budget is spent: the tail is dropped. */
  const showPlain = (block: string): boolean => {
    flush();
    for (const paragraph of plainParagraphs(block)) {
      const room = PLAIN_MAX_CHARS - plainChars;
      if (room <= 0 || plainParagraphCount >= PLAIN_MAX_PARAGRAPHS) return false;
      const shown = paragraph.length > room ? paragraph.slice(0, room) : paragraph;
      const last = parts[parts.length - 1];
      if (last?.plain) last.paragraphs.push(shown);
      else parts.push({ plain: true, paragraphs: [shown] });
      plainChars += shown.length;
      plainParagraphCount += 1;
    }
    return true;
  };

  // One piece, or no piece: the budget cannot cover a second one, so nothing is parsed.
  if (budget <= chunk) {
    showPlain(source);
    return parts;
  }
  for (const block of blocksOf(source)) {
    const startsNewPiece = pending === '' || pending.length + 2 + block.length > chunk;
    // The blank line that joins a block to the one before it is parsed too, so it counts.
    const cost = block.length + (startsNewPiece ? 0 : 2);
    const parseable = block.length <= chunk && parsed + cost <= budget && !nestsTooDeep(block);
    if (!parseable) {
      if (!showPlain(block)) break;
      continue;
    }
    if (startsNewPiece) flush();
    pending = pending ? `${pending}\n\n${block}` : block;
    parsed += cost;
  }
  flush();
  return parts;
}
