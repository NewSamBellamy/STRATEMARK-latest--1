import { usableCitations, type Citation } from '@mi/contracts';
import type { OriginalSourceReceipt } from './original-source';
import { normalizeSourceText } from './original-source';

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
