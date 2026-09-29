import { Loader2 } from 'lucide-react';

export function FullPageLoader({ label }: { label?: string }) {
  return (
    <div
      className="flex h-full min-h-[60vh] w-full flex-col items-center justify-center gap-3 text-muted"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
      <span className="text-sm">{label ?? 'Loading…'}</span>
    </div>
  );
}
