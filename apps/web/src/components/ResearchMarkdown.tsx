import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { usableCitations } from '@mi/contracts';

/** The one renderer for model-authored research prose. Repairs escaped
 * separators in saved projections (some retained evidence stores literal
 * "\\n" instead of newlines), renders normal Markdown, and keeps links
 * usable without letting arbitrary markup through. Every surface that shows
 * research text — overview, saved notes, history, mission — renders through
 * this component so one dialect of model output reaches the user one way. */
export function ResearchMarkdown({ text }: { text: string }) {
  const markdown = text.includes('\n') ? text : text.replace(/\\r\\n|\\n/g, '\n');
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children, href }) => usableCitations([{ title: 'Source', url: href ?? '' }]).length
      ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      : <span>{children}</span>,
    img: ({ alt }) => <span>{alt}</span>,
  }}>{markdown}</ReactMarkdown>;
}
