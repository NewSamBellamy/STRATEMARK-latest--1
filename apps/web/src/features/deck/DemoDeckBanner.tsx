import { FlaskConical } from 'lucide-react';
import { useRepositoryMode } from '@/lib/repository/RepositoryProvider';
import { useApiKey } from '@/lib/settings/apiKey';

/**
 * Demo labeling (production red team, Oct 8): the keyless preview shows a real
 * researched deck with real-looking figures — sample data that was repeatedly
 * mistaken for live findings (the "1B active users" card, empty categories).
 * The honest fix is a loud, persistent label on the deck itself, plus a
 * one-click path to the real thing.
 */
export function DemoDeckBanner() {
  const mode = useRepositoryMode();
  const hasKey = useApiKey((s) => s.hasKey);
  if (mode !== 'demo') return null;
  return (
    <div role="note" data-testid="demo-banner"
      className="panel flex items-start gap-3 border-primary/20 bg-primary/5 px-4 py-2.5 text-[13px] leading-snug">
      <FlaskConical className="h-4 w-4 shrink-0 text-primary" />
      <p>
        <span className="font-medium text-content">Demo deck — sample research, not live.</span>{' '}
        <span className="text-content/80">
        {hasKey
          ? 'Switch the engine in Settings to run real research on this market.'
          : 'Add your Gemini API key in Settings to run real research on any market.'}
        </span>
      </p>
    </div>
  );
}
