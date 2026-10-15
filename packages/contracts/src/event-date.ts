/**
 * One way to write the date of a timeline event.
 *
 * Research hands back the same kind of date a dozen ways: "2019 (September)",
 * "2024 Early", "Mid-2024", "2026 (April 29)", "2025 (Full-Year)", "2026
 * (Current Year)". Side by side on a timeline they read as noise. This turns
 * the ones it can read with certainty into a single form and leaves every other
 * string exactly as the research wrote it: it never guesses a date it cannot
 * parse, and it never adds precision the source did not give.
 *
 *   September 2019 · April 29, 2026 · Q3 2019 · Early 2024 · Mid 2024 · Spring 2020 · 2025
 */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_NAMES = MONTHS.map((month) => month[0]!.toUpperCase() + month.slice(1));
const SEASONS: Record<string, string> = { spring: 'Spring', summer: 'Summer', fall: 'Fall', autumn: 'Fall', winter: 'Winter' };
const PARTS: Record<string, string> = { early: 'Early', mid: 'Mid', middle: 'Mid', late: 'Late' };
/** Words that say "the whole year" or "this year": nothing a reader needs beside the year itself. */
const WHOLE_YEAR = /\b(?:full[- ]?year|fy|current year|this year|year[- ]end|annual)\b/i;

function monthOf(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, '');
  // Full names, three-letter abbreviations, and "Sept".
  return MONTHS.findIndex((month) => month === w || (w.length >= 3 && w.length <= 4 && month.startsWith(w)));
}

export function normalizeEventDate(raw: string): string {
  const text = raw.trim();
  const years = text.match(/\b(?:1[5-9]\d{2}|20\d{2}|21\d{2})\b/g) ?? [];
  // No year, or two years ("Late 2022 / Early 2023", "2019-2021"): a range or a non-date. Leave it.
  if (years.length !== 1) return text;
  const year = years[0]!;
  // The text with the year and brackets removed: what is left describes the part of the year.
  const rest = text.replace(year, ' ').replace(/[()[\],]/g, ' ').replace(/[-–—_/]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (rest === '') return year;
  const words = rest.split(' ');

  const quarter = /^Q([1-4])$/i.exec(rest);
  if (quarter) return `Q${quarter[1]} ${year}`;

  const months = words.map(monthOf).filter((index) => index >= 0);
  const day = words.find((word) => /^\d{1,2}(?:st|nd|rd|th)?$/.test(word));
  const others = words.filter((word) => monthOf(word) < 0 && !(day && word === day));
  // A month, optionally with a day, and nothing else.
  if (months.length === 1 && others.length === 0) {
    const month = MONTH_NAMES[months[0]!]!;
    return day ? `${month} ${Number.parseInt(day, 10)}, ${year}` : `${month} ${year}`;
  }
  // Two months is a span ("May – September 2026"): keep it readable, in order.
  if (months.length === 2 && others.length === 0 && !day) return `${MONTH_NAMES[months[0]!]} – ${MONTH_NAMES[months[1]!]} ${year}`;
  if (months.length > 0) return text;

  const only = words.length === 1 ? words[0]!.toLowerCase() : '';
  if (only && PARTS[only]) return `${PARTS[only]} ${year}`;
  if (only && SEASONS[only]) return `${SEASONS[only]} ${year}`;
  // "Mid-Year" / "Mid year": the middle of that year.
  if (/^mid year$/i.test(rest)) return `Mid ${year}`;
  if (WHOLE_YEAR.test(rest) && words.every((word) => WHOLE_YEAR.test(word) || /^(?:full|year|current|this|end|fy|annual)$/i.test(word))) return year;
  return text;
}
