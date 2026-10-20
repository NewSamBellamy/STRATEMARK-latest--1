import type { ReactNode } from 'react';
import { usableCitations } from '@mi/contracts';
import { BoundedMarkdown } from '@/components/BoundedMarkdown';
import { useReadOnly } from '@/lib/readOnly';
import { MARKDOWN_CHUNK_CAP, MARKDOWN_TRUSTED_BUDGET } from '@/lib/boundedMarkdown';

const COMPONENTS = {
  a: ({ children, href }: { children?: ReactNode; href?: string }) => usableCitations([{ title: 'Source', url: href ?? '' }]).length
    ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    : <span>{children}</span>,
  img: ({ alt }: { alt?: string }) => <span>{alt}</span>,
};

/** The one renderer for model-authored research prose. Repairs storage
 * artifacts in saved projections — escaped newlines (`\n` stored literally)
 * and escaped asterisks (`\*`), which leaked as raw `**bold**` markers in the
 * source-reported overview — renders normal Markdown, and keeps links usable
 * without letting arbitrary markup through. Every surface that shows research
 * text — overview, saved notes, history, mission — renders through this
 * component so one dialect of model output reaches the user one way.
 *
 * It is also bounded (see `lib/boundedMarkdown`): text too long or too nested to parse safely is shown as plain
 * paragraphs. Inside a share link, where the text may have been written by a stranger, only a few thousand
 * characters are ever parsed; in the app, where it is the app's own research, honest text never reaches the bound. */
export function ResearchMarkdown({ text }: { text: string }) {
  const readOnly = useReadOnly();
  const markdown = (typeof text === 'string' ? text : '')
    .replace(/\\r\\n|\\n/g, '\n')
    .replace(/\\\*/g, '*');
  return <BoundedMarkdown text={markdown} budget={readOnly ? MARKDOWN_CHUNK_CAP : MARKDOWN_TRUSTED_BUDGET} components={COMPONENTS} />;
}
