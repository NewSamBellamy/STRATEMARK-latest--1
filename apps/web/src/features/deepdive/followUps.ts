/**
 * The chat model ends an answer with `Follow-ups: a | b | c`. Split it off so
 * the UI can render chips instead of raw text (and exports never include it).
 */
export function splitFollowUps(text: string): { body: string; followUps: string[] } {
  const m = text.match(/(?:^|\n)[ \t]*\**Follow-?ups?:?\**[ \t]*:?[ \t]*([^\n]+?)[ \t]*$/i);
  if (!m || m.index === undefined) return { body: text.trim(), followUps: [] };
  const followUps = m[1]!
    .split('|')
    .map((q) => q.replace(/^[\s\-*"“`]+|[\s"”`*]+$/g, '').trim())
    .filter((q) => q.length > 3 && q.length <= 160)
    .slice(0, 3);
  if (followUps.length === 0) return { body: text.trim(), followUps: [] };
  return { body: text.slice(0, m.index).trim(), followUps };
}
