import { Fragment, useMemo, type ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MARKDOWN_TRUSTED_BUDGET, planMarkdown } from '@/lib/boundedMarkdown';

type Components = ComponentProps<typeof ReactMarkdown>['components'];

/**
 * Markdown that is parsed only as far as it is safe to (see `lib/boundedMarkdown`): short text exactly as
 * react-markdown renders it, long text in pieces, and anything too long or too nested as plain paragraphs. A
 * screen that shows text a stranger could have written renders it through here, never through react-markdown directly.
 */
export function BoundedMarkdown({ text, budget = MARKDOWN_TRUSTED_BUDGET, components }: { text: string; budget?: number; components?: Components }) {
  const parts = useMemo(() => planMarkdown(typeof text === 'string' ? text : '', { budget }), [text, budget]);
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part.plain
            ? part.paragraphs.map((paragraph, at) => <p key={at} className="whitespace-pre-line">{paragraph}</p>)
            : <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{part.text}</ReactMarkdown>}
        </Fragment>
      ))}
    </>
  );
}
