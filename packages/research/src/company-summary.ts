import { usableCitations, type Citation } from '@mi/contracts';
import type { OriginalSourceReceipt } from './original-source';
import { normalizeSourceText } from './original-source';
import { pageText } from './search-fallback';

export const UNSUPPORTED_COMPANY_SUMMARY = 'No source-backed company snapshot is ready yet.';

function officialHost(sourceUrl: string, websiteUrl?: string | null): boolean {
  try {
    const source = new URL(sourceUrl);
    const website = new URL(websiteUrl ?? '');
    const sourceHost = source.hostname.toLowerCase().replace(/^www\./, '');
    const websiteHost = website.hostname.toLowerCase().replace(/^www\./, '');
    return source.protocol === 'https:' && website.protocol === 'https:' &&
      (sourceHost === websiteHost || sourceHost.endsWith(`.${websiteHost}`));
  } catch { return false; }
}

const SALES_LINE = /^(?:experience|revolutioni[sz]e|accelerate|discover|explore|learn|get|meet|build|transform|unlock|empower|join|see|find|shop|buy|order|try|enjoy|sip|elevate|fuel|boost|upgrade|introducing|say hello|welcome|take|browse|save|subscribe|feel)\b/i;
const CONTEXT_BOUND = /\b(?:this|these|those|such)\s+(?:environment|market|moment|landscape|challenge|challenges|era|world|need|needs|space|problem|problems|opportunity|time|times|reason|way)\b/i;

/**
 * A stored or proposed company summary that cannot stand as the company's
 * description: a sales line ("Discover Alter Domus, offering expert
 * services…"), a sentence leaning on the page it was lifted from ("…is
 * purpose-built for this environment"), or broken extraction (a space before
 * punctuation). Judged sentence by sentence; one unfit sentence is enough.
 */
export function summaryIsUnfit(summary: string): boolean {
  return (summary.match(/[^.!?]+[.!?]*/g) ?? []).map(sentence => sentence.trim()).filter(Boolean).some(sentence =>
    SALES_LINE.test(sentence) || CONTEXT_BOUND.test(sentence)) || /\s[.,;:!?]/.test(summary);
}

function eligibleSentences(text: string, companyName: string): string[] {
  const normalizedName = normalizeSourceText(companyName).toLocaleLowerCase();
  const protectedText = text.replace(/\b(Inc|Ltd|Corp|Co|U\.S|e\.g|i\.e)\.(?=\s)/gi, '$1<PERIOD>');
  return (protectedText.match(/[^.!?]+[.!?](?=\s|$)|[^.!?]+$/gu) ?? [])
    .map(sentence => sentence.replace(/<PERIOD>/g, '.'))
    .map(normalizeSourceText)
    .filter(sentence => sentence.length >= 40 && sentence.length <= 240 &&
      /^[\p{Lu}“‘"'(]/u.test(sentence) &&
      !/[\p{N}$€£¥%]/u.test(sentence) &&
      !/\b(?:leading|world['’]s|best|largest|first|only|most|number one|#1|valued|valuation|revenue|ARR|funding|market share|users|customers|employees)\b/i.test(sentence) &&
      !/\b(?:cookies?|privacy|javascript|browser|sign (?:in|up)|log ?in|subscribe|newsletter|copyright|all rights reserved)\b/i.test(sentence) &&
      // A sales line sells; a sentence leaning on its page ("purpose-built for
      // this environment") says nothing once lifted out of it.
      !summaryIsUnfit(sentence) &&
      (sentence.toLocaleLowerCase().includes(normalizedName) ||
        /\b(?:builds?|develops?|creates?|provides?|offers?|research(?:es)?|designs?|operates?|serves?|platform|software|company|laborator|models?)\b/i.test(sentence)));
}

/**
 * Return one literal, qualitative sentence from a readable official original.
 * A provider-written paraphrase is accepted only when it is itself an exact
 * sentence in that original; citations alone never ground generated copy.
 */
export function sourceBackedCompanySummary(input: {
  companyName: string;
  websiteUrl?: string | null;
  proposedSummaries?: Array<string | null | undefined>;
  originals: readonly OriginalSourceReceipt[];
}): { summary: string; citations: Citation[] } | null {
  const sources = input.originals.filter(source => source.status === 'retrieved' && source.httpStatus === 200 &&
    !source.format && typeof source.text === 'string' && source.contentHash &&
    /^[a-f0-9]{64}$/.test(source.contentHash) && officialHost(source.finalUrl ?? '', input.websiteUrl));
  for (const source of sources) {
    const sentences = eligibleSentences(source.text!, input.companyName);
    const proposals = (input.proposedSummaries ?? []).map(proposal => normalizeSourceText(proposal ?? ''))
      .filter(proposal => proposal.length >= 40 && proposal.length <= 240);
    const sentence = proposals.find(proposal => sentences.some(candidate => candidate === proposal)) ?? sentences
      .sort((a, b) => {
        const name = normalizeSourceText(input.companyName).toLocaleLowerCase();
        const aNamed = a.toLocaleLowerCase().includes(name) ? 1 : 0;
        const bNamed = b.toLocaleLowerCase().includes(name) ? 1 : 0;
        return bNamed - aNamed;
      })[0];
    if (!sentence) continue;
    const citation = usableCitations([{
      title: new URL(source.finalUrl!).hostname,
      url: source.finalUrl!,
    }], input.websiteUrl)[0];
    if (citation) return { summary: sentence, citations: [citation] };
  }
  return null;
}

export const isPendingCompanySummary = (summary?: string | null): boolean =>
  !summary?.trim() || summary.startsWith(UNSUPPORTED_COMPANY_SUMMARY);

/**
 * The company's own homepage describing itself: its meta / social description
 * and any body sentence that names it. Never navigation, cookie or legal
 * boilerplate, and the same literal-sentence gate as every other summary.
 */
export function homepageCompanySummary(input: {
  companyName: string;
  websiteUrl?: string | null;
  homepage: OriginalSourceReceipt;
}): { summary: string; citations: Citation[] } | null {
  const html = input.homepage.status === 'retrieved' ? input.homepage.text ?? '' : '';
  if (!html) return null;
  const described = [...html.matchAll(/<meta\b[^>]*>/gi)].map(tag => tag[0])
    .filter(tag => /\b(?:name|property)\s*=\s*["'](?:description|og:description|twitter:description)["']/i.test(tag))
    .map(tag => /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag))
    .map(match => pageText(match?.[1] ?? match?.[2] ?? ''));
  const name = normalizeSourceText(input.companyName).toLocaleLowerCase();
  // "<Company> is/builds/makes …" plainly says what it does. Any other body
  // sentence (testimonials, alt text, "X does not …", awards) is not a summary.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const selfDescribing = new RegExp(`^${escaped}(?:['’]s)?\\s(?:is|are|builds?|develops?|designs?|makes?|manufactures?|provides?|offers?|creates?|delivers?|operates?|helps?|specializ(?:es|ing)|enables?|powers?)\\b`, 'i');
  const named = (pageText(html).match(/[^.!?]+[.!?]/g) ?? []).map(normalizeSourceText)
    .filter(sentence => selfDescribing.test(sentence) && !/\bnot\b|n['’]t\b/i.test(sentence));
  const text = [...described, ...named].map(line => line.trim()).filter(Boolean)
    .map(line => (/[.!?]$/.test(line) ? line : `${line}.`)).join(' ');
  // A shop-window line ("Discover Kin Euphorics sparkling cans …", "Shop the
  // collection") sells; it does not say what the company is. Never a summary,
  // even when it is the only copy on the page.
  const sentences = (text.match(/[^.!?]+[.!?]/g) ?? []).map(normalizeSourceText).filter(sentence => !SALES_LINE.test(sentence));
  if (!sentences.length) return null;
  // Best first: a self-describing sentence; then one naming the company.
  const score = (sentence: string) =>
    (selfDescribing.test(sentence) ? 4 : 0) + (sentence.toLocaleLowerCase().includes(name) ? 1 : 0);
  const ranked = sentences
    .map((sentence, index) => ({ sentence, index, score: score(sentence) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).map(row => row.sentence);
  const { format: _format, ...homepage } = input.homepage;
  return sourceBackedCompanySummary({ companyName: input.companyName, websiteUrl: input.websiteUrl,
    proposedSummaries: ranked, originals: [{ ...homepage, text: sentences.join(' ') }] });
}
