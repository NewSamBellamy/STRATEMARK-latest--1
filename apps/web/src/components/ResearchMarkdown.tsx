import { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeHttpUrl } from '@/lib/sourceHref';

/** The one place Markdown from outside this codebase becomes elements: model
 * answers, saved reports, imported snapshots and shared links all arrive as
 * text someone else could have written. Two things are decided here so no
 * surface can forget them.
 *
 * Images are never loaded. Bare `ReactMarkdown` turns `![a](https://host/p.gif?x=1)`
 * into a real request, which tells that host the reader's address and whatever
 * the sender put in the query string; the alt text is shown instead.
 *
 * A link is a link only when `safeHttpUrl` accepts it (http or https, a real
 * host). Protocol-relative `//host/x` passes react-markdown's own URL check as
 * a "relative" address, so it has to be refused here.
 *
 * Callers keep their own typography by wrapping this in their own element. */
export function SafeMarkdown({ children, linkClassName, components }: {
  children: string;
  /** Class for links, for surfaces that style them themselves. */
  linkClassName?: string;
  /** Extra element overrides (tables, say). `a` and `img` cannot be replaced. */
  components?: Omit<Components, 'a' | 'img'>;
}) {
  const merged = useMemo<Components>(() => ({
    ...components,
    a: ({ children: label, href }) => {
      const safe = safeHttpUrl(href);
      return safe
        ? <a href={safe} target="_blank" rel="noopener noreferrer" className={linkClassName}>{label}</a>
        : <span>{label}</span>;
    },
    img: ({ alt }) => <span>{alt}</span>,
  }), [components, linkClassName]);
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={merged}>{children}</ReactMarkdown>;
}

/** The renderer for model-authored research prose. Repairs storage
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
  return <SafeMarkdown>{markdown}</SafeMarkdown>;
}
