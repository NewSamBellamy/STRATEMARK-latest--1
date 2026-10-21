import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { usableCitations } from '@mi/contracts';

/** The one renderer for model-authored research prose. Repairs storage
 * artifacts in saved projections — escaped newlines (`\n` stored literally)
 * and escaped asterisks (`\*`), which leaked as raw `**bold**` markers in the
 * source-reported overview — renders normal Markdown, and keeps links usable
 * without letting arbitrary markup through. Every surface that shows research
 * text — overview, saved notes, history, mission — renders through this
 * component so one dialect of model output reaches the user one way. */
export function ResearchMarkdown({ text }: { text: string }) {
  const markdown = text
    .replace(/\\r\\n|\\n/g, '\n')
    .replace(/\\\*/g, '*');
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children, href }) => usableCitations([{ title: 'Source', url: href ?? '' }]).length
      ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      : <span>{children}</span>,
    img: ({ alt }) => <span>{alt}</span>,
  }}>{markdown}</ReactMarkdown>;
}
