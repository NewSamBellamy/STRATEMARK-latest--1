import { useMemo } from 'react';
import type { Components } from 'react-markdown';
import { usableCitations } from '@mi/contracts';
import { BoundedMarkdown } from '@/components/BoundedMarkdown';
import { useReadOnly } from '@/lib/readOnly';
import { MARKDOWN_CHUNK_CAP, MARKDOWN_TRUSTED_BUDGET } from '@/lib/boundedMarkdown';
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
export function SafeMarkdown({ children, linkClassName, components, budget = MARKDOWN_TRUSTED_BUDGET, citableLinksOnly = false }: {
  children: string;
  /** Class for links, for surfaces that style them themselves. */
  linkClassName?: string;
  /** Extra element overrides (tables, say). `a` and `img` cannot be replaced. */
  components?: Omit<Components, 'a' | 'img'>;
  /** How much text is parsed at once (see `lib/boundedMarkdown`); the rest is shown as plain paragraphs. */
  budget?: number;
  /** Research prose only: a link must also be one a source list would show (no search pages or redirect addresses). */
  citableLinksOnly?: boolean;
}) {
  const merged = useMemo<Components>(() => ({
    ...components,
    a: ({ children: label, href }) => {
      const safe = safeHttpUrl(href);
      const shown = safe && (!citableLinksOnly || usableCitations([{ title: 'Source', url: safe }]).length > 0);
      return shown
        ? <a href={safe} target="_blank" rel="noopener noreferrer" className={linkClassName}>{label}</a>
        : <span>{label}</span>;
    },
    img: ({ alt }) => <span>{alt}</span>,
  }), [components, linkClassName, citableLinksOnly]);
  return <BoundedMarkdown text={children} budget={budget} components={merged} />;
}

/** The renderer for model-authored research prose. Repairs storage
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
  return <SafeMarkdown budget={readOnly ? MARKDOWN_CHUNK_CAP : MARKDOWN_TRUSTED_BUDGET} citableLinksOnly>{markdown}</SafeMarkdown>;
}
