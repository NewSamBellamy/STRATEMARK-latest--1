/**
 * A listed company's notable SEC filings as History milestones: free, official
 * and dated. Each milestone is named only from the form and the 8-K item numbers
 * EDGAR filed (sec-filings.ts), never from reading or summarizing the document,
 * so it can say "Acquisition or sale completed" but never what was bought.
 */
import type { Citation, HistoryContent, TimelineEvent } from '@mi/contracts';
import type { CompanyFiling } from './sec-filings';

/** 8-K events a company story would tell; results, votes and FD notices are routine. */
const MILESTONE_EVENTS = new Set(['Acquisition or sale completed', 'Change in control', 'Executive or director change', 'Material agreement',
  'Bankruptcy', 'Restructuring costs', 'Auditor change', 'Cybersecurity incident', 'Prior financials no longer reliable']);
/** Registrations that mark a listing or a merger (never their amendments). */
const MILESTONE_FORMS = new Set(['S-1', 'F-1', 'S-4']);
/** Filing milestones added to one History, newest first. */
export const MAX_FILING_MILESTONES = 8;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dayLabel(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${MONTHS[month! - 1]} ${day}, ${year}`;
}

export interface FilingMilestone { event: TimelineEvent; citation: Citation }

export function filingMilestones(filings: readonly CompanyFiling[]): FilingMilestone[] {
  const out: FilingMilestone[] = [];
  for (const filing of filings) {
    const events = filing.events.filter((e) => MILESTONE_EVENTS.has(e));
    if (!events.length && !MILESTONE_FORMS.has(filing.form)) continue;
    // An 8-K's report date is the day the event happened; the filing can follow by days.
    const date = dayLabel(filing.reportDate ?? filing.filingDate);
    out.push({
      event: { date, title: events.length ? events.join('; ') : filing.title,
        detail: `Form ${filing.form} filed with the SEC on ${dayLabel(filing.filingDate)}.` },
      citation: { title: `SEC EDGAR: Form ${filing.form}, ${filing.filingDate}`, url: filing.url },
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
 * keep their own order; a milestone already on the timeline (same day, same
 * title) is not repeated. The filings become sources of the tab.
 */
export function withFilingMilestones<C extends Pick<HistoryContent, 'timeline'>>(content: C, citations: Citation[],
  milestones: readonly FilingMilestone[]): { content: C; citations: Citation[] } {
  const timeline = [...content.timeline];
  const added: Citation[] = [];
  // Oldest first, so each lands after any earlier milestone already placed.
  for (const { event, citation } of [...milestones].reverse()) {
    if (timeline.some((row) => row.date === event.date && row.title.toLowerCase() === event.title.toLowerCase())) continue;
    const key = timelineDateKey(event.date)!;
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
