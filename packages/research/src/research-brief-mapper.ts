import {
  researchBriefCitationSchema,
  researchBriefSchema,
  type ResearchBrief,
} from '@mi/contracts';
import { withResearchBriefOmissions, type ResearchBriefOut } from './schemas';
import type { Citation } from './types';

function ownCitation(source: Citation | undefined) {
  try {
    const parsed = researchBriefCitationSchema.safeParse(
      source && { title: source.title, url: source.url },
    );
    return parsed.success ? parsed.data : null;
  } catch {
    // Shared URL refinements may throw rather than returning a validation failure.
    return null;
  }
}

function noteId(section: string, text: string) {
  // Local content identity only, not a canonical claim ID or a verification/security digest.
  let hash = 0xcbf29ce484222325n;
  const content = `${section}\0${text}`;
  for (let i = 0; i < content.length; i++)
    hash = BigInt.asUintN(64, (hash ^ BigInt(content.charCodeAt(i))) * 0x100000001b3n);
  return `note_${section}_${hash.toString(16).padStart(16, '0')}`;
}

export function mapResearchBrief(
  draft: ResearchBriefOut | null | undefined,
  sources: readonly Citation[],
): { researchBrief?: ResearchBrief; gapNotes: string[] } {
  if (!draft) return { gapNotes: [] };
  const omissions: string[] = [];
  const identities = new Set<string>();
  const sections: ResearchBrief['sections'] = [];
  for (const section of draft.sections) {
    const blocks: ResearchBrief['sections'][number]['blocks'] = [];
    for (const note of section.blocks) {
      const citations: ResearchBrief['sections'][number]['blocks'][number]['citations'] = [];
      const urls = new Set<string>();
      for (const index of note.sourceIndices) {
        const source = Number.isSafeInteger(index) && index >= 0 ? sources[index] : undefined;
        const citation = ownCitation(source);
        if (!citation) {
          omissions.push(`${section.section} note: unavailable source index omitted.`);
          continue;
        }
        if (!urls.has(citation.url)) {
          urls.add(citation.url);
          citations.push(citation);
        }
      }
      if (note.kind === 'reported' && !citations.length) {
        omissions.push(
          `${section.section} reported note omitted: no usable own source attribution.`,
        );
        continue;
      }
      const id = noteId(section.section, note.text);
      if (identities.has(id)) {
        omissions.push(`${section.section} duplicate local note identity omitted.`);
        continue;
      }
      identities.add(id);
      if (note.kind === 'estimate' && note.timeWindow === null)
        omissions.push(
          `${section.section} estimate period is unspecified; no time window was inferred.`,
        );
      blocks.push({
        id,
        text: note.text,
        kind: note.kind,
        support: 'unreviewed',
        timeWindow: note.timeWindow,
        citations,
        method: note.method,
        assumptions: note.assumptions,
      });
    }
    if (blocks.length) sections.push({ section: section.section, blocks });
  }
  const limitations = withResearchBriefOmissions(draft.limitations, omissions);
  const gapNotes = [
    ...limitations,
    ...draft.openQuestions.map((question) => `Open question: ${question}`),
  ];
  if (!sections.length)
    return { gapNotes: [...gapNotes, 'Research brief omitted: no usable notes remain.'] };
  const checked = researchBriefSchema.safeParse({
    sections,
    openQuestions: draft.openQuestions,
    limitations,
  });
  if (!checked.success) {
    const reason = checked.error.issues.some((issue) => issue.message.includes('128 KiB'))
      ? 'Research brief omitted: retained notes exceed the 128 KiB size limit.'
      : 'Research brief omitted: invalid retained notes.';
    return { gapNotes: [...gapNotes, reason] };
  }
  return { researchBrief: checked.data, gapNotes: [] };
}
