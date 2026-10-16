import { usableCitations, type Company } from '@mi/contracts';
import { companyStoryPart } from './company-team';
import { namesRosterRival } from './reported-metrics';
import type { LlmClient } from './types';

type GroundResult = Awaited<ReturnType<LlmClient['ground']>>;

/** Companies per combined tabs search: a search is billed per call and per query, so one call for
 * several companies costs a fraction of one call per company per tab pair. */
export const TAB_BATCH_SIZE = 4;

const TEAM_MARKER = /^[ \t#*_]*COMPANY TEAM[ \t]*:?[ \t*_]*$/gm;
const HEADING = /^#{1,6}[ \t]+.+$/;

/**
 * ONE grounded search that answers what companyBriefingPrompt (Overview + Products) and
 * companyStoryPrompt (Team + History) each ask, for several companies at once. Each company gets
 * its own "### Name" section with the briefing, a COMPANY TEAM line, the team, a COMPANY STORY
 * line and the story, so every tab still reads only its own company's part.
 */
export function companyTabsBatchPrompt(companies: ReadonlyArray<{ company: Pick<Company, 'name' | 'websiteUrl'>; marketName: string }>): string {
  const roster = companies.map(({ company, marketName }, i) =>
    `${i + 1}. ${JSON.stringify(company.name)} (known official domain: ${JSON.stringify(company.websiteUrl ?? 'not established')}; market: ${JSON.stringify(marketName)})`).join('\n');
  return `Research each company below separately, from its own sources. Write one section per company, in the order listed, each starting with a line "### " followed by the company's exact name as listed. Never put one company's facts in another company's section, and do not compare the companies with each other.

Companies:
${roster}

In each section, in this order:
1. A short paragraph of plain sentences on what the company does, its market positioning, and its customers and distribution, naming the company in each sentence and no other company; give no financial figures, user counts or rankings there (they are supplied separately).
2. Its current products, brands, models and services, and its announced product plans: official product/catalog/docs pages and dated company announcements first, then reputable reporting for gaps; up to 12 main products, one product per sentence, each naming the company and the product together and saying it is the company's product (for example: "SpaceX operates Starlink, a satellite internet service."). No headings, name-only bullets, or comparisons with competitors' products. State a lifecycle (available/launched, beta, discontinued) only where a source states it; distinguish current status from planned or historical availability; for plans, preserve the exact announcement and any explicit date.
3. In a separate paragraph, up to 8 current customers, suppliers (including manufacturing and cloud providers) and partners that the company, its filings or reputable reporting name, one relationship per sentence naming both companies and the relationship (for example: "Pfizer is a customer of Anthropic."); omit it when sources name none, and never list a relationship described as former, rumoured or under discussion.
4. A line that reads exactly COMPANY TEAM, then its current leadership and team from official team/about pages and recent company announcements first, then reputable reporting: the founders and the leadership team (executives, heads of major functions, board chair), up to 20 people, one person per plain, complete sentence naming the person, exact current role, current status and the company together (for example: "Sam Altman currently serves as Chief Executive Officer of OpenAI."). No name-only or role-only bullets. Exclude former, departed and future roles from this part.
5. A line that reads exactly COMPANY STORY, then in separate paragraphs: the founding story as a short readable narrative; dated milestones from inception to today (every major product and model release, funding round, leadership change, pivot, stumble and partnership; month-level dates such as "2026 Mar" for the most recent 18 months where coverage supports it; 12-20 milestones for an established company); then 3-6 notable verbatim quotes said by named people (founders, executives, investors) with where and when they said them.

Include a legal entity or brand alias only when a source explicitly links it to the company; do not assume similarly named affiliates. Return direct original-page URLs as discovery leads; provider grounding passages are reported evidence, not original-page verification. Never infer users, revenue, ranking, or unsupported dates. Cite sources.`;
}

/**
 * One part of a batched answer as a search result of its own: its text, and only the provider
 * supports that lie inside it, appear nowhere else in the answer and name no other company of
 * the batch (a sentence naming a rival may be about the rival). Null when no support is left.
 */
function groundPart(result: GroundResult, part: string, companyName: string, peers: readonly string[]): GroundResult | null {
  const text = part.trim();
  if (!text || !result.grounding) return null;
  const elsewhere = result.text.replace(part, '\n');
  const supports = result.grounding.supports
    .filter(support => support.text.trim() && text.includes(support.text) && !elsewhere.includes(support.text)
      && !namesRosterRival(support.text, companyName, peers))
    // Provider offsets index the whole answer, so they are dropped with it.
    .map(({ startIndex: _start, endIndex: _end, ...support }) => support);
  if (!supports.length) return null;
  const citations = usableCitations(supports.flatMap(support => support.sources.map(source => ({ url: source.url, title: source.title }))));
  return { text, citations, queries: result.queries, grounding: { ...result.grounding, answerText: text, supports } };
}

/**
 * A company's two tab answers out of its section of the batched answer (companySection): the
 * briefing (Overview + Products) before the COMPANY TEAM line, and the story (Team + History,
 * still carrying its COMPANY STORY line for companyStoryPart). A part that cannot be told apart
 * or has no support of its own is null, and that tab pair runs its own search instead.
 */
export function companyTabsParts(result: GroundResult, section: string, companyName: string, peers: readonly string[]):
  { briefing: GroundResult | null; story: GroundResult | null } {
  const lines = section.split('\n');
  while (lines.length && (HEADING.test(lines[0]!) || !lines[0]!.trim())) lines.shift();
  const body = lines.join('\n');
  const markers = [...body.matchAll(TEAM_MARKER)];
  if (markers.length !== 1) return { briefing: null, story: null };
  const at = markers[0]!.index!;
  const briefing = groundPart(result, body.slice(0, at), companyName, peers);
  let story = groundPart(result, body.slice(at + markers[0]![0].length), companyName, peers);
  // The story must split into its Team and History halves, or both tabs would search on their own.
  if (story && (!companyStoryPart(story, 'team') || !companyStoryPart(story, 'story'))) story = null;
  return { briefing, story };
}
