import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import { safeHttpUrl } from '@/lib/sourceHref';

/**
 * An outbound link whose target came from data (a model answer, an imported
 * snapshot, a shared link). It is a link only when `safeHttpUrl` accepts the
 * value; otherwise the same words render as plain text in the same box, so the
 * layout around it does not move and nothing clickable is offered.
 */
export function SafeLink({ href, className, title, style, tabIndex, onClick, children, 'data-testid': testId }: {
  href: string | null | undefined;
  className?: string;
  title?: string;
  style?: CSSProperties;
  tabIndex?: number;
  onClick?: MouseEventHandler<HTMLElement>;
  children: ReactNode;
  'data-testid'?: string;
}) {
  const safe = safeHttpUrl(href);
  if (!safe) {
    // Plain text should not look like a link when you point at it.
    const plain = className?.split(/\s+/).filter((token) => token && !token.startsWith('hover:')).join(' ');
    return <span className={plain || undefined} title={title} style={style} data-testid={testId}>{children}</span>;
  }
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className={className} title={title} style={style}
      tabIndex={tabIndex} onClick={onClick} data-testid={testId}>
      {children}
    </a>
  );
}
