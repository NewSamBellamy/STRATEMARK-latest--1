/**
 * The card reader's short summary of a company: a few whole sentences, every one of them stating something the
 * card already holds with its source. Nothing is written from memory and nothing is estimated here: a figure the
 * card face does not show as sourced is named as "not found yet", never given a value.
 */
import { publisherOf } from '@mi/contracts';
import { formatDate } from '@/lib/format';
import { faceFigureStatus, type CardView } from './card-view';

type Item = CardView['faceMetrics'][number];

export interface SummarySource {
  url: string;
  publisher: string;
  title?: string | null;
  /** The figures this source stands behind (empty for the description's own sources). */
  labels: string[];
}

export interface CompanySummary {
  /** Whole sentences, in reading order. */
  sentences: string[];
  sources: SummarySource[];
}

const ABBREVIATION = /(?:\b(?:Inc|Ltd|Corp|Co|Mr|Ms|Mrs|Dr|St|vs|No|Jr|Sr)|\b[A-Z]|\be\.g|\bi\.e|\bU\.S|\bU\.K|\betc)\.$/;

/** The first `max` whole sentences of a text (never a cut one), kept under `maxChars` unless that leaves nothing. */
export function leadSentences(text: string, max: number, maxChars = 380): string[] {
  const pieces = text.trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
  const sentences: string[] = [];
  for (const piece of pieces) {
    const last = sentences[sentences.length - 1];
    if (last !== undefined && ABBREVIATION.test(last)) sentences[sentences.length - 1] = `${last} ${piece}`;
    else sentences.push(piece);
  }
  const out: string[] = [];
  let length = 0;
  for (const sentence of sentences.slice(0, max)) {
    if (out.length > 0 && length + sentence.length > maxChars) break;
    out.push(sentence);
    length += sentence.length + 1;
  }
  return out;
}

const STATUS_PHRASE: Record<string, string> = {
  'Human checked': 'checked by a person',
  'Source reported · not verified': 'source-reported and not independently verified',
  'Primary source': 'from a primary source',
  'Independent reporting': 'from independent reporting',
  'Industry source': 'from an industry source',
  'Source linked': 'linked to a source',
};

const join = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const day = (asOf: string) => (/^\d{4}-\d{2}-\d{2}/.test(asOf) ? formatDate(asOf) : asOf);

function figureDates(items: readonly Item[]): string[] {
  const dates: string[] = [];
  for (const item of items) {
    const asOf = item.metric?.quotedSupport?.asOf ?? item.metric?.reportedSupport?.asOf ?? item.metric?.reportedBand?.asOf ?? null;
    if (asOf && !dates.includes(day(asOf))) dates.push(day(asOf));
  }
  return dates;
}

export function buildCompanySummary(input: {
  name: string;
  summary: string | null | undefined;
  hqLocation: string | null | undefined;
  foundedYear: number | null | undefined;
  items: readonly Item[];
  /** Sources recorded for the description itself. */
  descriptionSources: ReadonlyArray<{ url: string; title?: string | null }>;
}): CompanySummary {
  const sentences: string[] = [];
  const description = input.summary?.trim() ?? '';
  const lead = description ? leadSentences(description, 2) : [];
  sentences.push(...(lead.length > 0 ? lead : ['No concise research summary has been recorded for this card.']));

  // Where and when, unless the description already says where.
  const place = input.hqLocation?.trim() ?? '';
  const placeKnown = place !== '' && description.toLowerCase().includes((place.split(',')[0] ?? '').trim().toLowerCase());
  const founded = input.foundedYear && Number.isFinite(input.foundedYear) ? Math.round(input.foundedYear) : null;
  if (place && !placeKnown && founded) sentences.push(`${input.name} is based in ${place} and was founded in ${founded}.`);
  else if (place && !placeKnown) sentences.push(`${input.name} is based in ${place}.`);
  else if (founded && !description.includes(String(founded))) sentences.push(`${input.name} was founded in ${founded}.`);

  const known = input.items.filter((item) => faceFigureStatus(item) !== 'No source-backed figure');
  const unknown = input.items.filter((item) => faceFigureStatus(item) === 'No source-backed figure');
  const sources: SummarySource[] = [];

  if (known.length > 0) {
    sentences.push(`Sourced figures: ${known.map((item) => `${item.label} ${item.display}`).join('; ')}.`);
    const groups = new Map<string, Item[]>();
    for (const item of known) {
      const status = faceFigureStatus(item);
      groups.set(status, [...(groups.get(status) ?? []), item]);
    }
    for (const [status, group] of groups) {
      const phrase = STATUS_PHRASE[status] ?? 'linked to a source';
      sentences.push(groups.size === 1
        ? `${group.length === 1 ? 'It is' : 'All of them are'} ${phrase}.`
        : `${join(group.map((item) => item.label))}: ${phrase}.`);
    }
    const dates = figureDates(known);
    const recorded = known.map((item) => item.metric?.capturedAt).find((value) => value && Number.isFinite(new Date(value).getTime()));
    sentences.push(dates.length > 0
      ? `${known.length === 1 ? 'It is' : 'They are'} dated ${join(dates)}.`
      : `The sources give no date for ${known.length === 1 ? 'it' : 'them'}${recorded ? ` (recorded ${formatDate(recorded)})` : ''}.`);
    for (const item of known) {
      const citation = item.citations[0];
      if (!citation) continue;
      const existing = sources.find((source) => source.url === citation.url);
      if (existing) existing.labels.push(item.label);
      else sources.push({ url: citation.url, publisher: publisherOf(citation.url, citation.title), title: citation.title, labels: [item.label] });
    }
  }
  if (unknown.length > 0) sentences.push(`No sourced figure was found yet for ${join(unknown.map((item) => item.label))}.`);

  for (const citation of input.descriptionSources) {
    if (!sources.some((source) => source.url === citation.url)) {
      sources.push({ url: citation.url, publisher: publisherOf(citation.url, citation.title ?? undefined), title: citation.title, labels: [] });
    }
  }
  // A short read: at most six sentences. The place line goes first, then the date line, never a figure or its caveat.
  while (sentences.length > 6) {
    const droppable = sentences.findIndex((sentence, index) => index > 0 && (/ is based in | was founded in /.test(sentence) || /^(?:It is|They are) dated |^The sources give no date/.test(sentence)));
    if (droppable < 0) break;
    sentences.splice(droppable, 1);
  }
  return { sentences, sources };
}
