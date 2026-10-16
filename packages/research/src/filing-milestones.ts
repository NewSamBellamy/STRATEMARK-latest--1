/**
 * A listed company's notable SEC filings as History milestones: free, official
 * and dated. Each milestone is named only from the form and the 8-K item numbers
 * EDGAR filed (sec-filings.ts), never from reading or summarizing the document,
 * so it can say "Acquisition or sale completed" but never what was bought.
 */
import type { Citation, HistoryContent, TimelineEvent } from '@mi/contracts';
import type { CompanyFiling } from './sec-filings';

/**
 * 8-K events a company story would tell, titled as the SEC's own item caption says
 * (results, votes and FD notices are routine). Item 5.02 also covers officers' pay,
 * so its row never claims a leadership change. Registrations (S-1, S-4) are left
 * out: from an already-listed company they are mostly resales or exchange offers,
 * and EDGAR does not say which.
 */
const MILESTONE_TITLES: Record<string, string> = {
  'Acquisition or sale completed': 'Completed an acquisition or disposition of assets',
  'Change in control': 'Change in control of the company',
  'Executive or director change': 'Director or officer departure, appointment or pay arrangement',
  'Material agreement': 'Entered into a material definitive agreement',
  'Bankruptcy': 'Bankruptcy or receivership',
  'Restructuring costs': 'Committed to exit or disposal costs',
  'Auditor change': 'Change of auditor',
  'Cybersecurity incident': 'Material cybersecurity incident',
  'Prior financials no longer reliable': 'Prior financial statements no longer to be relied on',
};
/** What a researched row about the same event says, so the event is not told twice in one month. */
const SAME_EVENT: Record<string, RegExp> = {
  'Acquisition or sale completed': /\b(?:acqui\w*|merg\w*|bought|buys?|sold|sells?|sale|divest\w*)\b/i,
  'Change in control': /\b(?:acqui\w*|merg\w*|taken private|buyout|control)\b/i,
  'Executive or director change': /\b(?:ceo|cfo|coo|cto|chief|president|chair\w*|appoint\w*|named|hire[sd]?|join\w*|resign\w*|depart\w*|steps? down|director|board|officer|successor)\b/i,
  'Material agreement': /\b(?:agreement|partner\w*|deal|contract|credit facility|loan)\b/i,
  'Bankruptcy': /\b(?:bankrupt\w*|chapter 11|receiver\w*|insolven\w*)\b/i,
  'Restructuring costs': /\b(?:restructur\w*|layoffs?|job cuts|closure|wind(?:s|ing)? down)\b/i,
  'Cybersecurity incident': /\b(?:cyber\w*|breach\w*|hack\w*|ransomware|incident)\b/i,
};
/** Filing milestones added to one History, newest first. */
export const MAX_FILING_MILESTONES = 8;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "May 1, 2026"; null for a date that is not a real calendar day. */
function dayLabel(iso: string): string | null {
  const [year, month, day] = iso.split('-').map(Number);
  const at = new Date(Date.UTC(year!, month! - 1, day!));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month! - 1 || at.getUTCDate() !== day) return null;
  return `${MONTHS[month! - 1]} ${day}, ${year}`;
}

export interface FilingMilestone { event: TimelineEvent; citation: Citation; events: string[] }

export function filingMilestones(filings: readonly CompanyFiling[]): FilingMilestone[] {
  const out: FilingMilestone[] = [];
  for (const filing of filings) {
    const events = filing.events.filter((e) => MILESTONE_TITLES[e]);
    if (!events.length) continue;
    // An 8-K's report date is the day the event happened; the filing can follow by days.
    const date = dayLabel(filing.reportDate ?? filing.filingDate);
    const filed = dayLabel(filing.filingDate);
    if (!date || !filed) continue;
    out.push({
      event: { date, title: events.map((e) => MILESTONE_TITLES[e]!).join('; '), detail: `Form ${filing.form} filed with the SEC on ${filed}.` },
      citation: { title: `SEC EDGAR: Form ${filing.form}, ${filing.filingDate}`, url: filing.url },
      events,
    });
    if (out.length >= MAX_FILING_MILESTONES) break;
  }
  return out;
}

const PART_MONTH: Record<string, number> = { Early: 2, Spring: 4, Mid: 6, Summer: 7, Fall: 10, Late: 11, Winter: 12 };

/** Where a written timeline date falls, as year*10000 + month*100 + day; null when it cannot be read. */
export function timelineDateKey(date: string): number | null {
  const year = /\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/.exec(date);
  if (!year) return null;
  const y = Number(year[1]) * 10_000;
  const month = MONTHS.findIndex((m) => date.startsWith(m));
  if (month >= 0) {
    const day = /^\w+ (\d{1,2}),/.exec(date);
    return y + (month + 1) * 100 + (day ? Number(day[1]) : 0);
  }
  const quarter = /^Q([1-4]) /.exec(date);
  if (quarter) return y + (Number(quarter[1]) * 3 - 2) * 100;
  const part = /^(\w+) \d{4}$/.exec(date);
  if (part && PART_MONTH[part[1]!]) return y + PART_MONTH[part[1]!]! * 100;
  return date.trim() === year[1] ? y : null;
}

/**
 * The researched History with filing milestones placed by date. Researched rows
 * keep their own order. A milestone already on the timeline is not repeated: the
 * same day and title, or a researched row in the same month telling the same
 * kind of event. The filings become sources of the tab.
 */
export function withFilingMilestones<C extends Pick<HistoryContent, 'timeline'>>(content: C, citations: Citation[],
  milestones: readonly FilingMilestone[]): { content: C; citations: Citation[] } {
  const timeline = [...content.timeline];
  const added: Citation[] = [];
  // Oldest first, so each lands after any earlier milestone already placed.
  const researched = content.timeline;
  for (const { event, citation, events } of [...milestones].reverse()) {
    const key = timelineDateKey(event.date);
    if (key == null) continue;
    if (timeline.some((row) => row.date === event.date && row.title.toLowerCase() === event.title.toLowerCase())) continue;
    const month = Math.floor(key / 100);
    const told = researched.some((row) => {
      const k = timelineDateKey(row.date);
      return k != null && k % 10_000 >= 100 && Math.floor(k / 100) === month &&
        events.some((e) => SAME_EVENT[e]?.test(`${row.title} ${row.detail}`));
    });
    if (told) continue;
    // Right after the last row dated on or before it; before every row when none is.
    let at = 0;
    timeline.forEach((row, i) => { const k = timelineDateKey(row.date); if (k != null && k <= key) at = i + 1; });
    timeline.splice(at, 0, event);
    added.push(citation);
  }
  if (!added.length) return { content, citations };
  const known = new Set(citations.map((c) => c.url));
  return { content: { ...content, timeline }, citations: [...citations, ...added.filter((c) => !known.has(c.url))] };
}
