import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

/** The one back link: 14px muted, left edge on the content column. Pages pass the destination and its label. */
export function BackLink({ to, children, className = '' }: { to: string; children: string; className?: string }) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-content ${className}`}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {children}
    </Link>
  );
}
