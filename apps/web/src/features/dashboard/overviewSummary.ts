/**
 * The Overview's "Who they are" paragraph: one readable paragraph put together only from
 * text the research already stored (the company description, the lead sentence of each
 * brief section, and the names of the products the Products tab recorded). Nothing is
 * written from memory, and no figure is added: a sentence appears only when stored text
 * says it, and the sources of each sentence travel with it.
 */
import { leadSentences } from '@/features/card/companySummary';

export interface SummaryLink { title: string; url: string }

export interface OverviewParagraph {
  sentences: string[];
  links: SummaryLink[];
  /** Product names named in the paragraph (from the Products & roadmap research). */
  products: string[];
}

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** A sentence cut where a list began ("four buyer personas: 1.") ends at the colon instead. */
function tidy(sentence: string): string {
  const cut = sentence.trim().replace(/:\s*(?:\d+|[a-z])[.)]?$/i, '.').replace(/\s*[:;,]$/, '.');
  return /[.!?"”)]$/.test(cut) ? cut : `${cut}.`;
}

const join = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** Too alike to say twice: one contains most of the other's words. */
function repeats(sentence: string, said: readonly string[]): boolean {
  const words = new Set(norm(sentence).split(' ').filter((w) => w.length > 3));
  if (words.size === 0) return true;
  return said.some((other) => {
    const theirs = new Set(norm(other).split(' ').filter((w) => w.length > 3));
    let shared = 0;
    for (const w of words) if (theirs.has(w)) shared += 1;
    return shared / Math.min(words.size, Math.max(1, theirs.size)) >= 0.7;
  });
}

export function overviewParagraph(input: {
  name: string;
  /** The stored company description (null when none, or when it is a placeholder). */
  description: string | null | undefined;
  takeaways: ReadonlyArray<{ text: string; links: SummaryLink[] }>;
  productNames: readonly string[];
  maxSentences?: number;
}): OverviewParagraph {
  const max = input.maxSentences ?? 4;
  const sentences: string[] = [];
  const links: SummaryLink[] = [];
  const add = (sentence: string, from: readonly SummaryLink[] = []) => {
    const clean = tidy(sentence);
    if (clean.length < 20 || repeats(clean, sentences) || sentences.length >= max) return;
    sentences.push(clean);
    for (const link of from) if (!links.some((l) => l.url === link.url)) links.push(link);
  };

  const description = input.description?.trim() ?? '';
  if (description) for (const s of leadSentences(description, 2)) add(s);
  for (const takeaway of input.takeaways) {
    const lead = leadSentences(takeaway.text, 1)[0];
    if (lead) add(lead, takeaway.links);
  }

  // Products the paragraph has not already named, by their recorded names only.
  const said = norm(sentences.join(' '));
  const named = [...new Set(input.productNames.map((n) => n.trim()).filter(Boolean))];
  const fresh = named.filter((n) => !said.includes(norm(n))).slice(0, 4);
  // The product line may follow a full paragraph: it is a list of names, not another claim to read.
  if (fresh.length > 0) sentences.push(`Products on record include ${join(fresh)}.`);
  return { sentences, links, products: fresh };
}
