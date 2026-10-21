/**
 * A one-person report as data. It holds what research reported about the
 * person (each field says "Not reported" when it is not), the verified portrait
 * if there is one (credited), and, when someone ran it, the deeper research with
 * its sources as numbered footnotes. Nothing is inferred to fill a field.
 */
import type { OrgNode } from '@mi/contracts';
import { formatDateLong } from '@/lib/format';
import { exportSource } from './exportModel';
import type { ReportCompanyInfo, ReportFootnote, ReportImage } from './topicReportModel';

export interface PersonReportModel {
  company: ReportCompanyInfo;
  person: { name: string; role: string; group: string };
  dateText: string;
  portrait: ReportImage | null;
  facts: Array<{ label: string; value: string | null }>;
  bio: string | null;
  evidence: { quote: string; sourceTitle: string; url: string; retrieved: string | null } | null;
  deeper: { markdown: string; footnotes: ReportFootnote[] } | null;
}

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

export function buildPersonReportModel(args: {
  company: ReportCompanyInfo;
  person: OrgNode;
  groupLabel: string;
  portrait: ReportImage | null;
  deeper: { markdown: string; citations: ReadonlyArray<{ title: string; url: string }> } | null;
  now?: Date;
}): PersonReportModel {
  const { person } = args;
  const seen = new Set<string>();
  const footnotes: ReportFootnote[] = [];
  for (const c of args.deeper?.citations ?? []) {
    if (!/^https?:\/\//i.test(c.url) || seen.has(c.url)) continue;
    seen.add(c.url);
    footnotes.push({ n: footnotes.length + 1, ...exportSource(c) });
  }
  const quote = clean(person.supportingQuote);
  return {
    company: args.company,
    person: { name: person.name, role: clean(person.role) ?? 'Role not reported', group: args.groupLabel },
    dateText: formatDateLong(args.now ?? new Date()),
    portrait: args.portrait,
    facts: [
      { label: 'Role', value: clean(person.role) },
      { label: 'Tenure', value: clean(person.tenure) },
      { label: 'Previously', value: clean(person.priorCompany) },
      { label: 'Known for', value: clean(person.notableProject) },
    ],
    bio: clean(person.bio),
    evidence: quote && person.sourceUrl
      ? { quote, sourceTitle: exportSource({ url: person.sourceUrl }).title, url: person.sourceUrl, retrieved: person.sourceRetrievedAt?.slice(0, 10) ?? null }
      : null,
    deeper: args.deeper && args.deeper.markdown.trim() ? { markdown: args.deeper.markdown, footnotes } : null,
  };
}
